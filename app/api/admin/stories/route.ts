import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { Account } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account_id");

  const sb = supabaseAdmin();

  let query = sb.from("accounts").select("*").eq("active", true).limit(1);
  if (accountId) query = query.eq("id", accountId) as any;

  const { data: account } = await query.maybeSingle<Account>();
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  const url =
    "https://graph.instagram.com/v25.0/me/stories?fields=id,media_type,media_url,thumbnail_url,timestamp,permalink,caption";
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${account.ig_access_token}` },
  });

  const json: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    return NextResponse.json(
      {
        error: json?.error?.message ?? "failed to fetch stories",
        hint: "Se retornar vazio ou der erro, verifique se há stories ativos (Stories expiram em 24h).",
      },
      { status: res.status }
    );
  }

  const stories = (json.data ?? []).map((s: any) => ({
    id: s.id,
    media_type: s.media_type,
    media_url: s.media_url,
    thumbnail_url: s.thumbnail_url ?? s.media_url,
    timestamp: s.timestamp,
    permalink: s.permalink,
    caption: s.caption ?? null,
  }));

  return NextResponse.json({ account_id: account.id, count: stories.length, stories });
}
