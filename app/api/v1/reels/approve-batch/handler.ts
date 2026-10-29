import { createHash } from "node:crypto";

type ReelBatchAccount = { id: string; owner_user_id: string; active: boolean; ig_username: string };

const MAX_BODY_BYTES = 2 * 1024 * 1024;
type ApiKeyVerifier = (raw: string) => Promise<{ valid: boolean; user_id?: string }>;
type ApprovalRepository = {
  getActiveAccount(username: string): Promise<ReelBatchAccount | null>;
  listApprovals(contentType: string, contentId: string, accountId: string): Promise<ApprovalRecord[]>;
  insertApprovals(rows: ApprovalInput[]): Promise<ApprovalRecord[]>;
};
type ApprovalRecord = { id: string; content_type: string; content_id: string; account_id: string; fingerprint: string; approved_by: string; revoked_at: string | null };
type ApprovalInput = { content_type: string; content_id: string; account_id: string; fingerprint: string; approved_by: string };
type Dependencies = {
  verifyApiKey: ApiKeyVerifier;
  repository: ApprovalRepository | (() => ApprovalRepository);
  supabaseUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

class EndpointError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function matchingApproval(rows: ApprovalRecord[], type: string, contentId: string, accountId: string, fingerprint: string) {
  if (rows.some((row) => row.content_type !== type || row.content_id !== contentId || row.account_id !== accountId)) {
    throw new EndpointError(409, `approval record mismatch for ${contentId}`);
  }
  if (rows.some((row) => row.fingerprint !== fingerprint && row.revoked_at === null)) {
    throw new EndpointError(409, `an active approval already exists for another version of ${contentId}`);
  }
  const exact = rows.filter((row) => row.fingerprint === fingerprint);
  if (exact.some((row) => row.revoked_at !== null)) throw new EndpointError(409, `approval revoked for ${contentId}`);
  if (exact.length > 1) throw new EndpointError(409, `duplicate approval record for ${contentId}`);
  return exact[0] ?? null;
}

async function readBody(request: Request) {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new EndpointError(413, "request body too large");
  if (!request.body) throw new EndpointError(400, "invalid request body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new EndpointError(413, "request body too large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all)); }
  catch { throw new EndpointError(400, "invalid JSON"); }
}

const BRT_SLOTS = ["08:00", "12:00", "20:00"];
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
function validBatchDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}
async function makeFingerprint(value: Record<string, unknown>) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
function approvedHash(value: string) {
  if (!/^sha256:[0-9a-f]{64}$/i.test(value)) throw new EndpointError(400, "approved media hash invalid");
  return value.toLowerCase();
}
async function reelFingerprint(row: Record<string, any>) {
  return makeFingerprint({ content_type: "reel", account_id: row.account_id, source_slug: row.slug, source_index: row.idx,
    video_sha256: approvedHash(row.video_sha256), cover_sha256: approvedHash(row.cover_sha256),
    caption: row.caption.trim(), scheduled_unix: Number(row.scheduled_unix), channel: row.canal });
}
async function reelStoryFingerprint(row: Record<string, any>) {
  if (!row.approval_fingerprint) throw new EndpointError(400, "associated Reel approval fingerprint missing");
  return makeFingerprint({ content_type: "reel_story", account_id: row.account_id, source_slug: row.slug,
    source_index: row.idx, story_sha256: approvedHash(row.story_sha256),
    associated_reel_approval: row.approval_fingerprint, scheduled_unix: Number(row.scheduled_unix), channel: row.canal });
}
function expectedScheduleUnix(date: string, time: string, idx: number, nowMs: number) {
  if (!validBatchDate(date) || !TIME_RE.test(time)) throw new EndpointError(400, `Reel ${idx}: invalid schedule`);
  const scheduled = new Date(`${date}T${time}:00-03:00`).getTime();
  if (!Number.isFinite(scheduled) || scheduled < nowMs + 20 * 60_000) {
    throw new EndpointError(400, `Reel ${idx} slot has passed or is too close`);
  }
  return Math.floor(scheduled / 1000);
}
function approvalSchedule(body: Record<string, any>, nowMs: number) {
  const sequenceRequested = body.dates !== undefined || body.time !== undefined;
  if (sequenceRequested) {
    if (body.date !== undefined || !Array.isArray(body.dates) || body.dates.length !== 3 ||
        body.dates.some((date: unknown) => !validBatchDate(date)) || !TIME_RE.test(body.time ?? "") ||
        new Set(body.dates).size !== 3 || body.dates.some((date: string, index: number) => index > 0 && date <= body.dates[index - 1])) {
      throw new EndpointError(400, "invalid Reel sequence schedule");
    }
    return body.dates.map((date: string, index: number) => ({
      date, scheduledUnix: expectedScheduleUnix(date, body.time, index + 1, nowMs),
    }));
  }
  if (!validBatchDate(body.date)) throw new EndpointError(400, "invalid Reel batch date");
  return BRT_SLOTS.map((time, index) => ({
    date: body.date, scheduledUnix: expectedScheduleUnix(body.date, time, index + 1, nowMs),
  }));
}
function mediaUrls(item: Record<string, any>, date: string, source: string, idx: number, supabaseUrl: string) {
  if (typeof item.video_url !== "string" || typeof item.cover_url !== "string" || typeof item.story_url !== "string") {
    throw new EndpointError(400, `Reel ${idx}: invalid media URL`);
  }
  let video: URL; let cover: URL; let story: URL;
  try { video = new URL(item.video_url); cover = new URL(item.cover_url); story = new URL(item.story_url); }
  catch { throw new EndpointError(400, `Reel ${idx}: invalid media URL`); }
  const origin = new URL(supabaseUrl).origin;
  for (const url of [video, cover, story]) {
    if (url.origin !== origin || url.protocol !== "https:" || url.search || url.hash) throw new EndpointError(400, `Reel ${idx}: media must be in the approved bucket`);
  }
  const root = "/storage/v1/object/public/dmflow-content/";
  const videoPath = video.pathname.startsWith(root) ? video.pathname.slice(root.length) : "";
  const match = videoPath.match(new RegExp(`^reels/${date}/${source}/reel-0${idx}-([0-9a-f]{12})\\.mp4$`));
  if (!match) throw new EndpointError(400, `Reel ${idx}: invalid video path`);
  const stem = `${root}reels/${date}/${source}/reel-0${idx}-${match[1]}`;
  if (cover.pathname !== `${stem}-cover.jpg` || story.pathname !== `${stem}-story.mp4`) throw new EndpointError(400, `Reel ${idx}: cover or Story does not match its cut`);
  return { videoUrl: video.toString(), coverUrl: cover.toString(), storyUrl: story.toString(), hashPrefix: match[1] };
}
async function hashMedia(url: string, kind: "video" | "image", fetchImpl: typeof fetch) {
  const response = await fetchImpl(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) throw new EndpointError(400, `public media unavailable (HTTP ${response.status})`);
  const expectedMime = kind === "image" ? "image/jpeg" : "video/mp4";
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (mime !== expectedMime) throw new EndpointError(400, "public media type mismatch");
  const limit = kind === "image" ? 10 * 1024 * 1024 : 256 * 1024 * 1024;
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new EndpointError(400, "media exceeds the size limit");
  const reader = response.body.getReader();
  const digest = createHash("sha256");
  let size = 0; let signature = new Uint8Array();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new EndpointError(400, "media exceeds the size limit"); }
    digest.update(value);
    if (signature.length < 8) {
      const keep = Math.min(8 - signature.length, value.length);
      const next = new Uint8Array(signature.length + keep); next.set(signature); next.set(value.subarray(0, keep), signature.length); signature = next;
    }
  }
  if (kind === "video" && (size < 100_000 || new TextDecoder().decode(signature.slice(4, 8)) !== "ftyp")) throw new EndpointError(400, "invalid MP4 media");
  if (kind === "image" && (signature[0] !== 0xff || signature[1] !== 0xd8 || signature[2] !== 0xff)) throw new EndpointError(400, "invalid JPEG cover");
  return `sha256:${digest.digest("hex")}`;
}
async function prepareApprovalRows(body: Record<string, any>, account: ReelBatchAccount, supabaseUrl: string,
  fetchImpl: typeof fetch, nowMs: number) {
  if (typeof body.sourceVideoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(body.sourceVideoId) ||
      !["GN", "GI"].includes(body.channel) || body.account !== "andreyogeek" || !Array.isArray(body.items) || body.items.length !== 3) {
    throw new EndpointError(400, "invalid Reel batch");
  }
  const schedule = approvalSchedule(body, nowMs);
  const rows = []; const coverHashes = new Set<string>();
  for (let index = 0; index < 3; index++) {
    const idx = index + 1; const item = body.items[index];
    if (!isRecord(item) || item.idx !== idx || typeof item.caption !== "string" || !item.caption.trim() ||
        item.caption !== item.caption.trim() || item.caption.length > 2200) throw new EndpointError(400, `Reel ${idx}: invalid caption`);
    const { date, scheduledUnix: scheduled_unix } = schedule[index];
    const urls = mediaUrls(item, date, body.sourceVideoId, idx, supabaseUrl);
    const [video_sha256, cover_sha256, story_sha256] = await Promise.all([
      hashMedia(urls.videoUrl, "video", fetchImpl), hashMedia(urls.coverUrl, "image", fetchImpl), hashMedia(urls.storyUrl, "video", fetchImpl),
    ]);
    if (video_sha256.slice(7, 19) !== urls.hashPrefix) throw new EndpointError(400, `Reel ${idx}: video hash/path mismatch`);
    if (coverHashes.has(cover_sha256)) throw new EndpointError(400, `Reel ${idx}: duplicate cover`);
    coverHashes.add(cover_sha256);
    const row = { slug: body.sourceVideoId, idx, account_id: account.id, canal: body.channel,
      video_url: urls.videoUrl, video_sha256, cover_url: urls.coverUrl, cover_sha256,
      story_url: urls.storyUrl, story_sha256, caption: item.caption, scheduled_unix, approval_fingerprint: "" };
    row.approval_fingerprint = await reelFingerprint(row);
    const story_approval_fingerprint = await reelStoryFingerprint(row);
    rows.push({ ...row, story_approval_fingerprint });
  }
  return rows;
}

export function createReelBatchApprovalHandler(deps: Dependencies) {
  return async function handle(request: Request) {
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
    let correctProject = false;
    try { correctProject = new URL(deps.supabaseUrl).origin === "https://zoknypleoribwomifzgi.supabase.co"; } catch { /* fail closed */ }
    if (!correctProject) return json({ error: "approval service is not configured for the target project" }, 503);
    const authorization = request.headers.get("authorization") ?? "";
    const rawKey = authorization.replace(/^Bearer\s+/i, "");
    if (!rawKey.startsWith("dmf_")) return json({ error: "invalid api key" }, 401);
    let userId: string;
    try {
      const verified = await deps.verifyApiKey(rawKey);
      if (!verified.valid || !verified.user_id) return json({ error: "invalid api key" }, 401);
      userId = verified.user_id;
    } catch { return json({ error: "invalid api key" }, 401); }

    const repository = typeof deps.repository === "function" ? deps.repository() : deps.repository;
    let body: unknown;
    try { body = await readBody(request); }
    catch (error) {
      if (error instanceof EndpointError) return json({ error: error.message }, error.status);
      return json({ error: "invalid request body" }, 400);
    }
    if (!isRecord(body)) return json({ error: "invalid batch" }, 400);

    try {
      const account = await repository.getActiveAccount("andreyogeek");
      if (!account || account.active !== true || account.ig_username !== "andreyogeek" ||
          !account.owner_user_id || account.owner_user_id !== userId) {
        throw new EndpointError(403, "API key must belong to the owner of the active andreyogeek account");
      }
      if (body.action === "preflight") return json({ ok: true });
      const prepared = await prepareApprovalRows(body, account, deps.supabaseUrl, deps.fetchImpl ?? fetch,
        deps.now?.() ?? Date.now());

      const approvalsToInsert: ApprovalInput[] = [];
      for (const row of prepared) {
        const contentId = `${row.slug}:${row.idx}`;
        for (const [contentType, fingerprint] of [["reel", row.approval_fingerprint], ["reel_story", row.story_approval_fingerprint]] as const) {
          const approvals = await repository.listApprovals(contentType, contentId, account.id);
          const exact = matchingApproval(approvals, contentType, contentId, account.id, String(fingerprint));
          if (exact) {
            if (exact.approved_by !== userId) throw new EndpointError(403, `approval owner mismatch for ${contentId}`);
          } else {
            approvalsToInsert.push({ content_type: contentType, content_id: contentId, account_id: account.id,
              fingerprint: String(fingerprint), approved_by: userId });
          }
        }
      }

      if (approvalsToInsert.length) await repository.insertApprovals(approvalsToInsert);

      const approvals = [];
      for (const row of prepared) {
        const contentId = `${row.slug}:${row.idx}`;
        for (const [contentType, fingerprint] of [["reel", row.approval_fingerprint], ["reel_story", row.story_approval_fingerprint]] as const) {
          const stored = await repository.listApprovals(contentType, contentId, account.id);
          const exact = matchingApproval(stored, contentType, contentId, account.id, String(fingerprint));
          if (!exact || exact.approved_by !== userId) throw new EndpointError(500, `approval persistence failed for ${contentId}`);
          approvals.push({ idx: row.idx, type: contentType, stored: true });
        }
      }
      return json({ ok: true, alreadyApproved: approvalsToInsert.length === 0, count: approvals.length / 2,
        approvals: prepared.map((row) => ({ idx: row.idx, reel: true, story: true })) });
    } catch (error) {
      if (error instanceof EndpointError) return json({ error: error.message }, error.status);
      if (isRecord(error) && typeof error.status === "number" && typeof error.message === "string") {
        const status = error.status >= 400 && error.status < 600 ? error.status : 400;
        return json({ error: error.message }, status);
      }
      return json({ error: "could not approve Reel batch" }, 400);
    }
  };
}

