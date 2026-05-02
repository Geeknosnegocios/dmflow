import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { Account } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account_id");
  const limit = Number(searchParams.get("limit") ?? 50);

  const sb = supabaseAdmin();
  let query = sb.from("accounts").select("*").eq("active", true).limit(1);
  if (accountId) query = query.eq("id", accountId) as any;
  const { data: account } = await query.maybeSingle<Account>();
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  const fields = [
    "id",
    "caption",
    "permalink",
    "thumbnail_url",
    "media_url",
    "media_type",
    "media_product_type",
    "timestamp",
    "like_count",
    "comments_count",
  ].join(",");

  const url = `https://graph.instagram.com/v25.0/me/media?fields=${fields}&limit=${Math.min(
    100,
    Math.max(1, limit)
  )}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${account.ig_access_token}` },
    cache: "no-store",
  });
  const json: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    return NextResponse.json(
      { error: json?.error?.message ?? "failed to fetch media" },
      { status: res.status }
    );
  }

  const media = (json.data ?? []).map((m: any) => ({
    id: m.id,
    caption: m.caption ?? "",
    permalink: m.permalink,
    thumbnail: m.thumbnail_url ?? m.media_url,
    media_type: m.media_type,
    product_type: m.media_product_type,
    timestamp: m.timestamp,
    likes: m.like_count ?? 0,
    comments: m.comments_count ?? 0,
  }));

  return NextResponse.json({
    account_id: account.id,
    count: media.length,
    media,
  });
}
