import { NextRequest, NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/api-keys";
import { supabaseAdmin } from "@/lib/supabase";
import { pickRule } from "@/lib/match";
import type { Rule } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LinkedInPayload = {
  event: string;
  keyword: string;
  commenter: {
    name: string;
    profileUrl: string;
    profileId: string;
  };
  comment: string;
  postUrl: string;
  timestamp: string;
};

export async function POST(req: NextRequest) {
  // 1. Auth
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const v = await verifyApiKey(token);
  if (!v.valid) {
    return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  }

  // 2. Parse body
  let body: LinkedInPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { keyword, commenter, comment, postUrl, timestamp } = body;
  if (!comment || !commenter?.profileId) {
    return NextResponse.json({ error: "missing required fields" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // 3. Fetch active LinkedIn rules for this user
  // Rules are scoped to accounts; find all accounts owned by this user
  const { data: accounts } = await sb
    .from("accounts")
    .select("id")
    .eq("owner_user_id", v.user_id!);

  const accountIds = (accounts ?? []).map((a: { id: string }) => a.id);
  if (accountIds.length === 0) {
    return NextResponse.json({ action: "ignore" });
  }

  const { data: rules } = await sb
    .from("rules")
    .select("*")
    .in("account_id", accountIds)
    .eq("platform", "linkedin")
    .eq("active", true);

  // 4. Match keyword against rules
  const matched = pickRule(comment, (rules ?? []) as Rule[]);

  // 5. Log event
  await sb.from("events").insert({
    account_id: accountIds[0],
    rule_id: matched?.id ?? null,
    ig_comment_id: `li_${commenter.profileId}_${Date.now()}`,
    ig_user_id: commenter.profileId,
    ig_username: commenter.name,
    comment_text: comment,
    matched_keyword: matched?.keyword ?? null,
    dm_sent: matched !== null,
    public_reply_sent: false,
    raw_payload: body,
    platform: "linkedin",
  });

  if (!matched) {
    return NextResponse.json({ action: "ignore" });
  }

  // Increment triggered_count
  await sb
    .from("rules")
    .update({ triggered_count: (matched.triggered_count ?? 0) + 1 })
    .eq("id", matched.id);

  return NextResponse.json({
    action: "send_dm",
    message: matched.dm_message,
    delay: 4000,
  });
}
