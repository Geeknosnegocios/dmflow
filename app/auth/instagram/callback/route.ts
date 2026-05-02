import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Handles Instagram Business Login OAuth callback.
 * 1. Validates state from cookie.
 * 2. Exchanges code for short-lived token.
 * 3. Exchanges short for long-lived token (60d).
 * 4. Fetches IG user info.
 * 5. Upserts dmflow.accounts with owner_user_id.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorMsg = url.searchParams.get("error_description");

  const store = await cookies();
  const expectedState = store.get("ig_oauth_state")?.value;
  const userId = store.get("ig_oauth_user")?.value;
  store.delete("ig_oauth_state");
  store.delete("ig_oauth_user");

  if (errorMsg) {
    return redirectWithError(url.origin, errorMsg);
  }
  if (!code || !state || state !== expectedState || !userId) {
    return redirectWithError(url.origin, "invalid state");
  }

  const appId = process.env.META_IG_APP_ID ?? process.env.NEXT_PUBLIC_META_IG_APP_ID;
  const appSecret = process.env.META_IG_APP_SECRET;
  if (!appId || !appSecret) {
    return redirectWithError(url.origin, "app not configured");
  }

  const redirectUri = `${url.origin}/auth/instagram/callback`;

  // 1. Exchange code → short-lived token
  const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
  });
  const shortJson: any = await shortRes.json().catch(() => ({}));
  if (!shortRes.ok || !shortJson.access_token) {
    return redirectWithError(
      url.origin,
      shortJson?.error_message ?? `short-token exchange failed (${shortRes.status})`
    );
  }

  const shortToken: string = shortJson.access_token;

  // 2. Short → long-lived (60d)
  const longRes = await fetch(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(
      appSecret
    )}&access_token=${encodeURIComponent(shortToken)}`
  );
  const longJson: any = await longRes.json().catch(() => ({}));
  if (!longRes.ok || !longJson.access_token) {
    return redirectWithError(
      url.origin,
      longJson?.error?.message ?? "long-token exchange failed"
    );
  }
  const longToken: string = longJson.access_token;
  const expiresInSec: number = longJson.expires_in ?? 60 * 24 * 3600;
  const expiresAt = new Date(Date.now() + expiresInSec * 1000);

  // 3. Fetch user info
  const userRes = await fetch(
    `https://graph.instagram.com/v25.0/me?fields=id,username,account_type&access_token=${encodeURIComponent(longToken)}`
  );
  const userJson: any = await userRes.json().catch(() => ({}));
  if (!userRes.ok || !userJson.id) {
    return redirectWithError(
      url.origin,
      userJson?.error?.message ?? "failed to fetch IG user"
    );
  }

  const igUserId: string = userJson.id;
  const igUsername: string = userJson.username;
  const accountType: string = userJson.account_type;

  if (accountType !== "BUSINESS" && accountType !== "MEDIA_CREATOR") {
    return redirectWithError(
      url.origin,
      "Conta precisa ser Business ou Creator no Instagram"
    );
  }

  // 4. Upsert account
  const admin = supabaseAdmin();
  const { data: existing } = await admin
    .from("accounts")
    .select("id")
    .eq("ig_business_id", igUserId)
    .maybeSingle();

  const verifyToken = `dmflow_verify_${Math.random().toString(36).slice(2, 18)}`;

  if (existing) {
    await admin
      .from("accounts")
      .update({
        owner_user_id: userId,
        ig_username: igUsername,
        ig_access_token: longToken,
        ig_token_expires_at: expiresAt.toISOString(),
        ig_token_refreshed_at: new Date().toISOString(),
        app_id: appId,
        app_secret: appSecret,
        active: true,
      })
      .eq("id", existing.id);
  } else {
    await admin.from("accounts").insert({
      owner_user_id: userId,
      name: `@${igUsername}`,
      ig_business_id: igUserId,
      ig_username: igUsername,
      ig_access_token: longToken,
      ig_token_expires_at: expiresAt.toISOString(),
      ig_token_refreshed_at: new Date().toISOString(),
      app_id: appId,
      app_secret: appSecret,
      verify_token: verifyToken,
      active: true,
    });
  }

  return NextResponse.redirect(new URL("/dashboard?connected=1", url.origin));
}

function redirectWithError(origin: string, msg: string) {
  const url = new URL("/onboarding", origin);
  url.searchParams.set("ig_error", msg);
  return NextResponse.redirect(url);
}
