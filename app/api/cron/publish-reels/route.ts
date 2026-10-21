import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { graphGet, graphPost, verifiedInstagramId } from "@/lib/instagram-publishing-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForContainer(id: string, token: string) {
  for (let attempt = 0; attempt < 30; attempt++) {
    await wait(3000);
    const state = await graphGet(id, token, { fields: "status_code" });
    if (state.status_code === "FINISHED") return;
    if (state.status_code === "ERROR" || state.status_code === "EXPIRED") {
      throw new Error(`Instagram recusou o processamento: ${state.status_code}`);
    }
  }
  throw new Error("Processamento do Instagram excedeu 90 segundos");
}

function coverUrlForReel(reel: { slug: string; idx: number; cover_url?: string }) {
  if (!reel.cover_url) throw new Error("Capa aprovada ausente; publicação bloqueada");
  const url = new URL(reel.cover_url);
  if (url.protocol !== "https:") throw new Error("cover_url precisa ser HTTPS");
  const nn = String(reel.idx).padStart(2, "0");
  const expected = new RegExp(`/reels/\\d{4}-\\d{2}-\\d{2}/${reel.slug}/reel-${nn}-[a-f0-9]{12}-cover\\.jpg$`);
  if (!expected.test(url.pathname)) {
    throw new Error(`Capa não corresponde ao slug ${reel.slug} e ao Reel ${reel.idx}`);
  }
  return url.toString();
}

async function assertPublicJpeg(url: string) {
  const response = await fetch(url, { headers: { Range: "bytes=0-2" } });
  if (!response.ok) throw new Error(`Capa indisponível publicamente: HTTP ${response.status}`);
  if (!response.headers.get("content-type")?.toLowerCase().includes("image/jpeg")) {
    throw new Error("cover_url não retorna image/jpeg");
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data: account, error: accountError } = await sb.from("accounts")
    .select("ig_access_token,ig_token_expires_at")
    .eq("ig_username", "andreyogeek").eq("active", true).single();
  if (accountError || !account?.ig_access_token ||
      (account.ig_token_expires_at && Date.parse(account.ig_token_expires_at) <= Date.now())) {
    return NextResponse.json({ error: "Conta Instagram sem token ativo" }, { status: 503 });
  }
  const token: string = account.ig_access_token;
  let igId: string;
  try {
    igId = await verifiedInstagramId(token, "andreyogeek");
  } catch {
    return NextResponse.json({ error: "Identidade da conta Instagram indisponível ou incorreta" }, { status: 503 });
  }
  const nowUnix = Math.floor(Date.now() / 1000);
  const { data: due, error } = await sb.from("scheduled_reels").select("*")
    .eq("status", "pending").lte("scheduled_unix", nowUnix)
    .order("scheduled_unix", { ascending: true }).limit(3);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const reels = [];
  for (const reel of due ?? []) {
    let coverUrl: string;
    try {
      if (!reel.story_url) throw new Error("Story aprovado ausente; publicação bloqueada");
      coverUrl = coverUrlForReel(reel);
      await assertPublicJpeg(coverUrl);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await sb.from("scheduled_reels").update({ status: "error", error: message })
        .eq("id", reel.id).eq("status", "pending");
      reels.push({ id: reel.id, idx: reel.idx, ok: false, error: message });
      continue;
    }
    const { data: claimed, error: claimError } = await sb.from("scheduled_reels")
      .update({ status: "processing", error: null }).eq("id", reel.id).eq("status", "pending")
      .select("id").maybeSingle();
    if (claimError || !claimed) continue;
    try {
      const container = await graphPost(`${igId}/media`, token, {
        media_type: "REELS", video_url: reel.video_url, cover_url: coverUrl,
        caption: reel.caption, share_to_feed: "true",
      });
      if (!container.id) throw new Error("Instagram não retornou ID do container do Reel.");
      const { error: containerError } = await sb.from("scheduled_reels")
        .update({ container_id: container.id }).eq("id", reel.id);
      if (containerError) throw new Error(`Container sem recibo: ${containerError.message}`);
      await waitForContainer(container.id, token);
      const published = await graphPost(`${igId}/media_publish`, token, { creation_id: container.id });
      if (!published.id) throw new Error("Instagram não retornou ID do Reel publicado.");
      const { error: postReceiptError } = await sb.from("scheduled_reels")
        .update({ post_id: published.id, published_at: new Date().toISOString() })
        .eq("id", reel.id).eq("status", "processing");
      if (postReceiptError) throw new Error(`Post sem ID salvo: ${postReceiptError.message}`);
      const info = await graphGet(published.id, token, { fields: "permalink" });
      if (!info.permalink) throw new Error("Post criado sem permalink; reconciliação manual necessária");
      const { error: updateError } = await sb.from("scheduled_reels").update({
        status: "published", permalink: info.permalink, story_status: "pending",
      }).eq("id", reel.id).eq("status", "processing");
      if (updateError) throw new Error(`Post criado sem recibo na fila: ${updateError.message}`);
      reels.push({ id: reel.id, idx: reel.idx, ok: true, post_id: published.id });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // Processing is deliberately not retried: Graph may have accepted the post.
      await sb.from("scheduled_reels").update({ status: "error", error: message })
        .eq("id", reel.id).eq("status", "processing");
      reels.push({ id: reel.id, idx: reel.idx, ok: false, error: message });
    }
  }

  const { data: storyDue, error: storyQueryError } = await sb.from("scheduled_reels").select("*")
    .eq("status", "published").eq("story_status", "pending")
    .not("story_url", "is", null).order("scheduled_unix", { ascending: true }).limit(3);
  if (storyQueryError) return NextResponse.json({ error: storyQueryError.message, reels }, { status: 500 });
  const stories = [];
  for (const reel of storyDue ?? []) {
    const { data: claimed, error: claimError } = await sb.from("scheduled_reels")
      .update({ story_status: "processing", story_error: null })
      .eq("id", reel.id).eq("story_status", "pending").select("id").maybeSingle();
    if (claimError || !claimed) continue;
    try {
      const container = await graphPost(`${igId}/media`, token, {
        media_type: "STORIES", video_url: reel.story_url,
      });
      if (!container.id) throw new Error("Instagram não retornou ID do container do Story.");
      const { error: containerError } = await sb.from("scheduled_reels")
        .update({ story_container_id: container.id }).eq("id", reel.id);
      if (containerError) throw new Error(`Story sem recibo: ${containerError.message}`);
      await waitForContainer(container.id, token);
      const published = await graphPost(`${igId}/media_publish`, token, { creation_id: container.id });
      if (!published.id) throw new Error("Instagram não retornou ID do Story publicado.");
      const { error: storyReceiptError } = await sb.from("scheduled_reels")
        .update({ story_post_id: published.id, story_published_at: new Date().toISOString() })
        .eq("id", reel.id).eq("story_status", "processing");
      if (storyReceiptError) throw new Error(`Story sem ID salvo: ${storyReceiptError.message}`);
      const { error: updateError } = await sb.from("scheduled_reels").update({
        story_status: "published",
      }).eq("id", reel.id).eq("story_status", "processing");
      if (updateError) throw new Error(`Story criado sem recibo na fila: ${updateError.message}`);
      stories.push({ id: reel.id, idx: reel.idx, ok: true, story_post_id: published.id });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // A failed or ambiguous Story stays stopped until manual reconciliation.
      await sb.from("scheduled_reels").update({ story_status: "error", story_error: message })
        .eq("id", reel.id).eq("story_status", "processing");
      stories.push({ id: reel.id, idx: reel.idx, ok: false, error: message });
    }
  }
  return NextResponse.json({ ok: true, reels, stories });
}
