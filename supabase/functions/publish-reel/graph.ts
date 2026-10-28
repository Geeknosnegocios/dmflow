import type { ReelRow } from "../_shared/reel-publishing.ts";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
const safeGraphVersion = (version: string) => /^v\d+\.\d+$/.test(version) ? version : "v22.0";

export function createReelGraphClient({ graphVersion, accessToken, instagramUserId, fetchImpl = fetch, requestTimeoutMs = 20_000 }: {
  graphVersion: string;
  accessToken: string;
  instagramUserId: string;
  fetchImpl?: Fetcher;
  requestTimeoutMs?: number;
}) {
  const base = `https://graph.instagram.com/${safeGraphVersion(graphVersion)}`;
  async function read(path: string, fields: string) {
    const url = new URL(`${base}/${path}`);
    url.searchParams.set("fields", fields);
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) throw new Error(`Instagram Graph HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.error) throw new Error("Instagram Graph rejected the request");
    return payload;
  }
  async function write(path: string, params: Record<string, string>) {
    const response = await fetchImpl(`${base}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) throw new Error(`Instagram Graph HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.error) throw new Error("Instagram Graph rejected the request");
    return payload;
  }
  return {
    async createReel(row: ReelRow) {
      return write(`${instagramUserId}/media`, { media_type: "REELS", video_url: row.video_url,
        cover_url: row.cover_url, caption: row.caption, share_to_feed: "true" });
    },
    async getReelStatus(id: string) { return (await read(id, "status_code")).status_code as string; },
    async publishReel(id: string) {
      const data = await write(`${instagramUserId}/media_publish`, { creation_id: id });
      return { id: data.id as string, timestamp: new Date().toISOString() };
    },
    async createStory(row: ReelRow) {
      if (!row.story_url) throw new Error("Approved Story URL is missing");
      return write(`${instagramUserId}/media`, { media_type: "STORIES", video_url: row.story_url });
    },
    async getStoryStatus(id: string) { return (await read(id, "status_code")).status_code as string; },
    async publishStory(id: string) {
      const data = await write(`${instagramUserId}/media_publish`, { creation_id: id });
      return { id: data.id as string, timestamp: new Date().toISOString() };
    },
  };
}

