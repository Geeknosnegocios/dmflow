import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IG_ID = "17841400100030080";
const IG_TOKEN = process.env.IG_ACCESS_TOKEN ?? "EAASN8hLPi6sBRa9cYar6pkQjl1WJbYXxAJBSZCB8ep2wgEQk0pN76MSpFeu1PFxxvHcb8ZAnrq7u7OBZAzHYHnNtGqrWjNMomZCzUWtoz7GAUiZCeNexaroWXVZCSzza6QuMSI56ZBCruxw0gtmjBT75FC9wPWI4kv6ZC2iG8yLzLZCT4W2ZBavEiroORvOemRsJjzMwZDZD"; // novo nao-expira
// backup: EAASN8hLPi6sBRPNXnUFUzGUQfI6rqFMDj8vg8ZBRW1RODcINOhVkW6xH8mf1TSNrcTZC1azwgx9vBunxrZAZAIoyqpT8WvGQFUle8gwdPuGlv9fy4OKGD39zIoDBTF1vVutXIHip2Rx0IolG5gBV0CabtMfesZCz68d4z6NfZAfU4aqg4d9Hhiu3kgbv9EuqtmBMYY1iBLjWemButn
const API = "https://graph.facebook.com/v19.0";

async function graphPost(path: string, data: Record<string, string>) {
  const body = new URLSearchParams({ ...data, access_token: IG_TOKEN });
  const res = await fetch(`${API}/${path}`, { method: "POST", body });
  const json = await res.json();
  if (!res.ok) throw new Error(`Graph ${res.status}: ${json?.error?.message ?? JSON.stringify(json)}`);
  return json;
}

async function graphGet(path: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams({ ...params, access_token: IG_TOKEN });
  const res = await fetch(`${API}/${path}?${qs}`);
  const json = await res.json();
  if (!res.ok) throw new Error(`Graph ${res.status}: ${json?.error?.message ?? JSON.stringify(json)}`);
  return json;
}

async function publishReel(videoUrl: string, caption: string): Promise<{ post_id: string; permalink: string }> {
  const container = await graphPost(`${IG_ID}/media`, {
    media_type: "REELS",
    video_url: videoUrl,
    caption,
    share_to_feed: "true",
  });
  const containerId: string = container.id;

  // Poll ate FINISHED (max 90s)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const info = await graphGet(containerId, { fields: "status_code" });
    if (info.status_code === "FINISHED") break;
    if (info.status_code === "ERROR") throw new Error(`IG processing error: ${JSON.stringify(info)}`);
  }

  const pub = await graphPost(`${IG_ID}/media_publish`, { creation_id: containerId });
  const postId: string = pub.id;

  let permalink = "";
  try {
    const info2 = await graphGet(postId, { fields: "permalink" });
    permalink = info2.permalink ?? "";
  } catch {}

  return { post_id: postId, permalink };
}

export async function GET(req: NextRequest) {
  // Verifica CRON_SECRET se configurado
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const nowUnix = Math.floor(Date.now() / 1000);

  const { data: due, error } = await sb
    .from("scheduled_reels")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_unix", nowUnix)
    .limit(5);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!due || due.length === 0) return NextResponse.json({ ok: true, published: 0 });

  const results = [];
  for (const reel of due) {
    try {
      const { post_id, permalink } = await publishReel(reel.video_url, reel.caption);
      await sb.from("scheduled_reels").update({
        status: "published",
        post_id,
        permalink,
        published_at: new Date().toISOString(),
      }).eq("id", reel.id);
      results.push({ id: reel.id, slug: reel.slug, idx: reel.idx, post_id, ok: true });
    } catch (e: any) {
      await sb.from("scheduled_reels").update({ status: "error", error: e.message }).eq("id", reel.id);
      results.push({ id: reel.id, slug: reel.slug, idx: reel.idx, ok: false, error: e.message });
    }
  }

  return NextResponse.json({ ok: true, published: results.filter((r) => r.ok).length, results });
}
