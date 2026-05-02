import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth";
import crypto from "crypto";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts Instagram Business Login OAuth.
 * Generates a random state, saves in cookie, redirects to Meta auth URL.
 */
export async function GET(req: Request) {
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.redirect(new URL("/auth/login", req.url));
  }

  const appId = process.env.META_IG_APP_ID ?? process.env.NEXT_PUBLIC_META_IG_APP_ID;
  if (!appId) {
    return NextResponse.json(
      { error: "META_IG_APP_ID not configured" },
      { status: 500 }
    );
  }

  const state = crypto.randomBytes(16).toString("hex");
  const store = await cookies();
  store.set("ig_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  store.set("ig_oauth_user", profile.id, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  const redirectUri = `${new URL(req.url).origin}/auth/instagram/callback`;
  const scopes = [
    "instagram_business_basic",
    "instagram_business_manage_comments",
    "instagram_business_manage_messages",
  ].join(",");

  const authUrl = new URL("https://www.instagram.com/oauth/authorize");
  authUrl.searchParams.set("client_id", appId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString());
}
