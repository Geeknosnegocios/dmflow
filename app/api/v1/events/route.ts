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
    return NextResponse.json({ data: [], meta: { total: 0 } });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit") ?? 100)));
  const since = searchParams.get("since"); // ISO date

  let q = sb
    .from("events")
    .select(
      "id, created_at, rule_id, ig_comment_id, ig_user_id, ig_username, comment_text, matched_keyword, dm_sent, public_reply_sent"
    )
    .in("account_id", accountIds)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (since) q = q.gte("created_at", since);

  const { data } = await q;
  return NextResponse.json({
    data: data ?? [],
    meta: { total: (data ?? []).length, limit },
  });
}
