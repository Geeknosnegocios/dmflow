import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendDirectMessage } from "@/lib/meta";
import { buildTrackedButtons, resolveBaseUrl } from "@/lib/tracking";
import { interpolate } from "@/lib/placeholders";
import type { Account, Rule } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const isVercelCron = req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  if (isVercelCron) return true;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const baseUrl = resolveBaseUrl(req);
  const now = new Date().toISOString();

  const { data: pending } = await sb
    .from("followups")
    .select("*")
    .is("sent_at", null)
    .is("skipped_reason", null)
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(50);

  const results: any[] = [];

  for (const followup of (pending ?? []) as any[]) {
    const { data: rule } = await sb
      .from("rules")
      .select("*")
      .eq("id", followup.rule_id)
      .maybeSingle<Rule>();
    const { data: account } = await sb
      .from("accounts")
      .select("*")
      .eq("id", followup.account_id)
      .maybeSingle<Account>();

    if (!rule || !account) {
      await sb
        .from("followups")
        .update({ skipped_reason: "rule_or_account_missing" })
        .eq("id", followup.id);
      results.push({ id: followup.id, status: "skipped", reason: "missing" });
      continue;
    }

    // Skip if user already clicked (conversion achieved)
    const { data: clicked } = await sb
      .from("tracked_links")
      .select("id")
      .eq("event_id", followup.event_id)
      .gt("click_count", 0)
      .limit(1);

    if (clicked && clicked.length > 0) {
      await sb
        .from("followups")
        .update({ skipped_reason: "already_clicked" })
        .eq("id", followup.id);
      results.push({ id: followup.id, status: "skipped", reason: "converted" });
      continue;
    }

    if (!rule.followup_message) {
      await sb
        .from("followups")
        .update({ skipped_reason: "no_message" })
        .eq("id", followup.id);
      continue;
    }

    const personalized = interpolate(rule.followup_message, {
      username: null, // followup doesn't have username context readily; optional enhancement
    });

    const buttons = rule.followup_buttons ?? rule.dm_buttons ?? [];
    const tracked =
      buttons.length > 0
        ? await buildTrackedButtons({
            buttons,
            accountId: account.id,
            ruleId: rule.id,
            eventId: followup.event_id,
            igUserId: followup.ig_user_id,
            baseUrl,
          })
        : [];

    const dm = await sendDirectMessage({
      recipientId: followup.ig_user_id,
      message: personalized,
      buttons: tracked.length > 0 ? tracked : null,
      accessToken: account.ig_access_token,
    });

    await sb
      .from("followups")
      .update({
        sent_at: new Date().toISOString(),
        skipped_reason: dm.ok ? null : `send_failed: ${dm.error}`,
      })
      .eq("id", followup.id);

    results.push({
      id: followup.id,
      status: dm.ok ? "sent" : "failed",
      error: dm.ok ? null : dm.error,
    });
  }

  return NextResponse.json({
    checked: (pending ?? []).length,
    processed: results.length,
    sent: results.filter((r) => r.status === "sent").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
}
