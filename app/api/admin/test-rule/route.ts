import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { supabaseServer } from "@/lib/supabase-server";
import { sendDirectMessage } from "@/lib/meta";
import { buildTrackedButtons, resolveBaseUrl } from "@/lib/tracking";
import { interpolate } from "@/lib/placeholders";
import type { Account, Rule } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sends a test DM using the rule's configured message + buttons
 * to the account owner (self-DM). Useful to validate without creating a public trigger.
 */
export async function POST(req: NextRequest) {
  const session = await supabaseServer();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData();
  const ruleId = String(form.get("rule_id") ?? "");
  if (!ruleId) {
    return NextResponse.json({ error: "rule_id required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const baseUrl = resolveBaseUrl(req);

  const { data: rule } = await sb
    .from("rules")
    .select("*")
    .eq("id", ruleId)
    .maybeSingle<Rule>();
  if (!rule) {
    return NextResponse.json({ error: "rule not found" }, { status: 404 });
  }

  const { data: account } = await sb
    .from("accounts")
    .select("*")
    .eq("id", rule.account_id)
    .eq("owner_user_id", user.id)
    .maybeSingle<Account>();
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  const message = interpolate(
    `[TESTE] ${rule.dm_message}`,
    { username: account.ig_username }
  );

  const buttons = rule.dm_buttons?.length ? rule.dm_buttons :
    rule.dm_button_url && rule.dm_button_text ? [{ url: rule.dm_button_url, title: rule.dm_button_text }] : [];
  const publicReplies = rule.public_reply_variants?.length
    ? rule.public_reply_variants : rule.public_reply ? [rule.public_reply] : [];
  if (form.get("preview_only") === "true") {
    return NextResponse.json({ ok: true, message_preview: message, buttons, public_replies: publicReplies },
      { headers: { "Cache-Control": "no-store" } });
  }

  // Fetch own IG user id (for Instagram Login, /me returns IG user id to self-message)
  let recipientId: string | null = null;
  try {
    const r = await fetch(`https://graph.instagram.com/v25.0/me?fields=id`, {
      headers: { Authorization: `Bearer ${account.ig_access_token}` },
    });
    if (r.ok) recipientId = (await r.json())?.id ?? null;
  } catch {}

  if (!recipientId) {
    return NextResponse.json(
      { error: "could not resolve self IG user id" },
      { status: 500 }
    );
  }

  const tracked =
    buttons.length > 0
      ? await buildTrackedButtons({
          buttons,
          accountId: account.id,
          ruleId: rule.id,
          eventId: null,
          igUserId: recipientId,
          baseUrl,
        })
      : [];

  const dm = await sendDirectMessage({
    recipientId,
    message,
    buttons: tracked.length > 0 ? tracked : null,
    accessToken: account.ig_access_token,
  });

  return NextResponse.json({
    ok: dm.ok,
    error: dm.ok ? null : dm.error,
    recipient_id: recipientId,
    message_preview: message,
    public_replies: publicReplies,
  });
}
