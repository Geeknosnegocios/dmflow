import { NextRequest, NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/api-keys";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const v = await verifyApiKey(token);
  if (!v.valid) {
    return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  }

  const { slug, idx, video_url, cover_url, story_url, caption, keyword, canal = "GN", scheduled_unix } = await req.json();
  if (!slug || !idx || !video_url || !cover_url || !story_url || !caption || !scheduled_unix) {
    return NextResponse.json({ error: "slug, idx, video_url, cover_url, story_url, caption, scheduled_unix obrigatorios" }, { status: 400 });
  }
  const nn = String(idx).padStart(2, "0");
  let cover: URL;
  try { cover = new URL(cover_url); } catch { return NextResponse.json({ error: "cover_url invalida" }, { status: 400 }); }
  const expected = new RegExp(`/reels/\\d{4}-\\d{2}-\\d{2}/${slug}/reel-${nn}-[a-f0-9]{12}-cover\\.jpg$`);
  if (cover.protocol !== "https:" || !expected.test(cover.pathname)) {
    return NextResponse.json({ error: "cover_url nao corresponde ao slug e idx" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("scheduled_reels")
    .insert({ slug, idx, video_url, cover_url, story_url, story_status: "pending",
      caption, keyword, canal, scheduled_unix, status: "pending" })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}
