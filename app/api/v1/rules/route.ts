import { NextRequest, NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/api-keys";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const v = await verifyApiKey(token);
  if (!v.valid) {
    return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data: accounts } = await sb
    .from("accounts")
    .select("id")
    .eq("owner_user_id", v.user_id!);
  const accountIds = (accounts ?? []).map((a: any) => a.id);

  if (accountIds.length === 0) {
    return NextResponse.json({ data: [] });
  }

  const { data } = await sb
    .from("rules")
    .select(
      "id, name, trigger_type, keyword, match_mode, post_id, story_id, active, triggered_count, dm_message, dm_buttons, priority, platform, created_at"
    )
    .in("account_id", accountIds)
    .order("priority", { ascending: false });

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const v = await verifyApiKey(token);
  if (!v.valid) {
    return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data: accounts } = await sb
    .from("accounts")
    .select("id")
    .eq("owner_user_id", v.user_id!);
  const accountIds = (accounts ?? []).map((a: any) => a.id);
  if (accountIds.length === 0) {
    return NextResponse.json({ error: "no account found" }, { status: 400 });
  }
  const accountId = accountIds[0];

  const body = await req.json();
  const {
    name,
    trigger_type = "comment",
    keyword,
    match_mode = "contains",
    post_id = null,
    story_id = null,
    active = true,
    dm_message,
    dm_buttons = [],
    priority = 50,
    platform = "instagram",
  } = body;

  if (!keyword || !dm_message) {
    return NextResponse.json({ error: "keyword e dm_message obrigatorios" }, { status: 400 });
  }

  const { data, error } = await sb
    .from("rules")
    .insert({
      account_id: accountId,
      name: name || keyword,
      trigger_type,
      keyword,
      match_mode,
      post_id,
      story_id,
      active,
      dm_message,
      dm_buttons,
      priority,
      platform,
    })
    .select("id, name, keyword")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id, name: data.name, keyword: data.keyword });
}
