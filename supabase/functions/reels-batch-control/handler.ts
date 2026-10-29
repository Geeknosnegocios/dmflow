import { createHash } from "node:crypto";
import { canonicalReelFingerprint, canonicalStoryFingerprint, type ReelRow } from "../_shared/reel-publishing.ts";

const BUCKET = "dmflow-content";
const CHANNELS = new Set(["GI", "GN"]);
const SLOTS = ["08:00", "12:00", "20:00"] as const;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const VIDEO_LIMIT = 256 * 1024 * 1024;
const COVER_LIMIT = 10 * 1024 * 1024;
const MAX_CONTROL_BODY = 2 * 1024 * 1024;
const SHA_PREFIX = "sha256:";

export type BatchControlAccount = { id: string; owner_user_id: string; active: boolean; ig_username: string };
export type BatchApprovalRecord = { id: string; content_type: string; content_id: string; account_id: string; fingerprint: string; approved_by: string; revoked_at: string | null };
export type BatchApprovalInput = { content_type: string; content_id: string; account_id: string; fingerprint: string; approved_by: string };
export type ExistingRow = Record<string, unknown> & {
  id: string;
  slug: string;
  idx: number;
  scheduled_unix: number;
  status: string;
};
export type BatchRepository = {
  listSlugs(): Promise<unknown[]>;
  verifyBatch(date: string, sourceVideoId: string): Promise<unknown[]>;
  signUpload(path: string, contentType: string): Promise<{ signedUrl: string; token: string }>;
  getActiveAccount(username: string): Promise<BatchControlAccount | null>;
  listRowsBySource(source: string): Promise<ExistingRow[]>;
  listRowsByDay(accountId: string, start: number, end: number): Promise<ExistingRow[]>;
  listApprovals(contentType: string, contentId: string, accountId: string): Promise<BatchApprovalRecord[]>;
  insertScheduledRows(rows: Record<string, unknown>[]): Promise<ExistingRow[]>;
};
export type BatchControlConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  publishableKey: string;
  batchTokenSha256: string;
};
type HandlerDependencies = {
  config: BatchControlConfig;
  repository: BatchRepository | (() => BatchRepository);
  fetchImpl?: typeof fetch;
  now?: () => number;
  logger?: (event: string, context: Record<string, unknown>) => void;
};

class ControlError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function strictDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}

function expectedUnix(date: string, time: string) {
  return Math.floor(new Date(`${date}T${time}:00-03:00`).getTime() / 1000);
}

function validateConfig(config: BatchControlConfig) {
  if (!config.supabaseUrl || !config.serviceRoleKey || !config.publishableKey ||
      !/^[0-9a-f]{64}$/i.test(config.batchTokenSha256)) return false;
  try { return new URL(config.supabaseUrl).origin === "https://zoknypleoribwomifzgi.supabase.co"; }
  catch { return false; }
}

async function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function constantTimeHexEqual(left: string, right: string) {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  left = left.toLowerCase();
  right = right.toLowerCase();
  let diff = 0;
  for (let index = 0; index < 64; index++) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

function safeDiagnostic(error: unknown, config: BatchControlConfig) {
  const raw = error instanceof Error ? error.message
    : isRecord(error) && typeof error.message === "string" ? error.message : "unknown error";
  let message = raw;
  for (const secret of [config.serviceRoleKey, config.publishableKey]) {
    if (secret) message = message.replaceAll(secret, "[redacted]");
  }
  return message
    .replace(/(?:sb_secret_|sb_publishable_|dmf_)[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+[^\s,;]+/ig, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_.-]{24,}\b/g, "[redacted]")
    .slice(0, 300);
}

async function authenticated(request: Request, config: BatchControlConfig, token: string) {
  const suppliedKey = request.headers.get("apikey") ?? "";
  const suppliedBearer = request.headers.get("authorization") ?? "";
  const suppliedToken = token;
  const suppliedHash = suppliedToken ? await sha256Text(suppliedToken) : "";
  return suppliedKey === config.publishableKey && suppliedBearer === `Bearer ${config.publishableKey}` &&
    suppliedToken.length > 0 && suppliedToken.length <= 512 && constantTimeHexEqual(suppliedHash, config.batchTokenSha256);
}

async function readControlBody(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_CONTROL_BODY) throw new ControlError(413, "request body too large");
  if (!request.body) throw new ControlError(400, "invalid request body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_CONTROL_BODY) {
      await reader.cancel();
      throw new ControlError(413, "request body too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(body); }
  catch { throw new ControlError(400, "invalid JSON encoding"); }
}

function assertBatchDateAndSource(date: unknown, sourceVideoId: unknown): asserts date is string {
  if (!strictDate(date) || typeof sourceVideoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(sourceVideoId)) {
    throw new ControlError(400, "fonte ou data inválida");
  }
}

function publicationPlan(body: Record<string, any>, nowMs: number) {
  if (body.action === "schedule-sequence") {
    const { dates, time } = body;
    if (body.date !== undefined || !Array.isArray(dates) || dates.length !== 3 ||
        dates.some((date: unknown) => !strictDate(date)) || !TIME_RE.test(time ?? "") ||
        new Set(dates).size !== 3 || dates.some((date: string, index: number) => index > 0 && date <= dates[index - 1])) {
      throw new ControlError(400, "sequência inválida: informe três datas em ordem e um horário HH:MM");
    }
    return dates.map((date: string, index: number) => {
      const scheduledUnix = expectedUnix(date, time);
      if (scheduledUnix < nowMs / 1000 + 20 * 60) throw new ControlError(400, `Reel ${index + 1}: horário passou ou está próximo`);
      return { date, time, scheduledUnix };
    });
  }
  assertBatchDateAndSource(body.date, body.sourceVideoId);
  return SLOTS.map((time, index) => ({ date: body.date, time,
    scheduledUnix: assertUpcomingSlot(body.date, index + 1, nowMs) }));
}

function assertUpcomingSlot(date: string, idx: number, nowMs: number) {
  const slot = SLOTS[idx - 1];
  if (!slot) throw new ControlError(400, "slot de Reel inválido");
  const scheduled = expectedUnix(date, slot);
  if (scheduled < nowMs / 1000 + 20 * 60) throw new ControlError(400, `Reel ${idx}: horário passou ou está próximo`);
  return scheduled;
}

function expectedMediaPath(date: string, source: string, idx: number, suffix: "video" | "cover" | "story", prefix?: string) {
  if (suffix === "video") {
    if (!prefix || !/^[0-9a-f]{12}$/.test(prefix)) throw new ControlError(400, `Reel ${idx}: nome de vídeo inválido`);
    return `reels/${date}/${source}/reel-0${idx}-${prefix}.mp4`;
  }
  if (!prefix || !/^[0-9a-f]{12}$/.test(prefix)) throw new ControlError(400, `Reel ${idx}: nome de mídia inválido`);
  return suffix === "cover"
    ? `reels/${date}/${source}/reel-0${idx}-${prefix}-cover.jpg`
    : `reels/${date}/${source}/reel-0${idx}-${prefix}-story.mp4`;
}

function validateUploadPath(path: unknown, contentType: unknown, nowMs: number) {
  if (typeof path !== "string" || typeof contentType !== "string") throw new ControlError(400, "asset inválido");
  const match = path.match(/^reels\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9_-]{11})\/reel-(0[1-3])-([0-9a-f]{12})(-cover\.jpg|-story\.mp4|\.mp4)$/);
  if (!match || !strictDate(match[1])) throw new ControlError(400, "caminho de mídia inválido");
  const date = match[1];
  const source = match[2];
  const idx = Number(match[3]);
  const hashPrefix = match[4];
  const suffix = match[5];
  const expectedPath = suffix === "-cover.jpg" ? expectedMediaPath(date, source, idx, "cover", hashPrefix)
    : suffix === "-story.mp4" ? expectedMediaPath(date, source, idx, "story", hashPrefix)
      : expectedMediaPath(date, source, idx, "video", hashPrefix);
  if (path !== expectedPath) throw new ControlError(400, "caminho de mídia inválido");
  const expectedType = suffix === "-cover.jpg" ? "image/jpeg" : "video/mp4";
  if (contentType !== expectedType) throw new ControlError(400, "tipo de mídia inválido");
  const scheduled = assertUpcomingSlot(date, idx, nowMs);
  return { date, sourceVideoId: source, idx, scheduledUnix: scheduled, path, contentType };
}

function validateCarouselUploadPath(path: unknown, contentType: unknown) {
  if (typeof path === "string" && contentType === "image/png" &&
      /^instagram\/carousels\/ANDREY-W44-2026-C0[1-4]\/slide-0[1-8]-[0-9a-f]{12}\.png$/.test(path)) return { path, contentType };
  throw new ControlError(400, "carrossel inválido");
}

function expectedAssetUrls(item: Record<string, unknown>, date: string, source: string, idx: number, config: Pick<BatchControlConfig, "supabaseUrl">) {
  for (const field of ["video_url", "cover_url", "story_url"] as const) {
    if (typeof item[field] !== "string") throw new ControlError(400, `Reel ${idx}: ${field} inválida`);
  }
  let videoUrl: URL;
  let coverUrl: URL;
  let storyUrl: URL;
  try {
    videoUrl = new URL(item.video_url as string);
    coverUrl = new URL(item.cover_url as string);
    storyUrl = new URL(item.story_url as string);
  } catch { throw new ControlError(400, `Reel ${idx}: URL de mídia inválida`); }
  const origin = new URL(config.supabaseUrl).origin;
  for (const url of [videoUrl, coverUrl, storyUrl]) {
    if (url.origin !== origin || url.protocol !== "https:" || url.search || url.hash) {
      throw new ControlError(400, `Reel ${idx}: mídia fora do bucket aprovado`);
    }
  }
  const mediaRoot = `/storage/v1/object/public/${BUCKET}/`;
  if (!videoUrl.pathname.startsWith(mediaRoot)) throw new ControlError(400, `Reel ${idx}: video_url inválida`);
  const videoPath = videoUrl.pathname.slice(mediaRoot.length);
  const videoMatch = videoPath.match(new RegExp(`^reels/${date}/${source}/reel-0${idx}-([0-9a-f]{12})\\.mp4$`));
  if (!videoMatch) throw new ControlError(400, `Reel ${idx}: video_url inválida`);
  const prefix = videoMatch[1];
  const coverPath = expectedMediaPath(date, source, idx, "cover", prefix);
  const storyPath = expectedMediaPath(date, source, idx, "story", prefix);
  if (coverUrl.pathname !== `${mediaRoot}${coverPath}` || storyUrl.pathname !== `${mediaRoot}${storyPath}`) {
    throw new ControlError(400, `Reel ${idx}: capa ou Story não pertence ao corte aprovado`);
  }
  return { videoUrl: videoUrl.toString(), coverUrl: coverUrl.toString(), storyUrl: storyUrl.toString(), hashPrefix: prefix };
}

async function verifiedAsset(url: string, kind: "video" | "image", fetchImpl: typeof fetch) {
  const response = await fetchImpl(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new ControlError(400, `mídia pública ausente (HTTP ${response.status})`);
  const expectedMime = kind === "image" ? "image/jpeg" : "video/mp4";
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (mime !== expectedMime || !response.body) throw new ControlError(400, "tipo de mídia pública inválido");
  const maxBytes = kind === "image" ? COVER_LIMIT : VIDEO_LIMIT;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new ControlError(400, "mídia excede o limite de tamanho");
  const reader = response.body.getReader();
  const hash = createHash("sha256");
  let length = 0;
  let prefix = new Uint8Array();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new ControlError(400, "mídia excede o limite de tamanho");
    }
    hash.update(value);
    if (prefix.length < 8) {
      const keep = Math.min(8 - prefix.length, value.length);
      const next = new Uint8Array(prefix.length + keep);
      next.set(prefix);
      next.set(value.subarray(0, keep), prefix.length);
      prefix = next;
    }
  }
  if (kind === "video" && (length < 100_000 || prefix.length < 8 || new TextDecoder().decode(prefix.slice(4, 8)) !== "ftyp")) {
    throw new ControlError(400, "vídeo MP4 inválido ou pequeno demais");
  }
  if (kind === "image" && (length === 0 || prefix[0] !== 0xff || prefix[1] !== 0xd8 || prefix[2] !== 0xff)) {
    throw new ControlError(400, "capa JPEG inválida");
  }
  return `${SHA_PREFIX}${hash.digest("hex")}`;
}

export function assertApprovalStatus(rows: BatchApprovalRecord[], contentType: string, contentId: string, accountId: string, fingerprint: string) {
  if (rows.some((row) => row.content_type !== contentType || row.content_id !== contentId || row.account_id !== accountId)) {
    throw new ControlError(409, `aprovação fora do pacote solicitado para ${contentId}`);
  }
  if (rows.some((row) => row.fingerprint !== fingerprint && row.revoked_at === null)) {
    throw new ControlError(409, `aprovação anterior diverge do pacote ${contentId}; exige revisão explícita`);
  }
  const exact = rows.filter((row) => row.fingerprint === fingerprint);
  if (exact.some((row) => row.revoked_at !== null)) {
    throw new ControlError(409, `aprovação revogada para ${contentId}`);
  }
  if (exact.some((row) => row.approved_by !== rows[0]?.approved_by)) {
    throw new ControlError(409, `assinatura da aprovação inconsistente para ${contentId}`);
  }
  if (exact.length > 1) throw new ControlError(409, `aprovação duplicada para ${contentId}`);
  return exact[0] ?? null;
}

export async function prepareReelBatch(
  body: Record<string, any>,
  accountRow: BatchControlAccount,
  config: Pick<BatchControlConfig, "supabaseUrl">,
  fetchImpl: typeof fetch = fetch,
  nowMs = Date.now(),
) {
  if (!accountRow || accountRow.active !== true || accountRow.ig_username !== "andreyogeek" || !accountRow.owner_user_id) {
    throw new ControlError(409, "conta ativa ou proprietário não validado");
  }
  const { sourceVideoId, channel, account, items } = body;
  if (typeof sourceVideoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(sourceVideoId)) {
    throw new ControlError(400, "fonte inválida");
  }
  if (!CHANNELS.has(channel) || account !== "andreyogeek" || !Array.isArray(items) || items.length !== 3) {
    throw new ControlError(400, "lote inválido");
  }
  const plan = publicationPlan(body, nowMs);
  const expectedRows: Record<string, unknown>[] = [];
  const coverHashes = new Set<string>();
  for (let index = 0; index < 3; index++) {
    const idx = index + 1;
    const item = items[index];
    if (!isRecord(item) || item.idx !== idx || typeof item.caption !== "string" || !item.caption.trim() ||
        item.caption !== item.caption.trim() || item.caption.length > 2200) {
      throw new ControlError(400, `Reel ${idx}: copy inválida`);
    }
    const slot = plan[index];
    if (body.action === "schedule-sequence" && (item.date !== slot.date || item.time !== slot.time)) {
      throw new ControlError(400, `Reel ${idx}: data ou horário diverge da sequência`);
    }
    const urls = expectedAssetUrls(item, slot.date, sourceVideoId, idx, config);
    const scheduledUnix = slot.scheduledUnix;
    const [videoSha, coverSha, storySha] = await Promise.all([
      verifiedAsset(urls.videoUrl, "video", fetchImpl),
      verifiedAsset(urls.coverUrl, "image", fetchImpl),
      verifiedAsset(urls.storyUrl, "video", fetchImpl),
    ]);
    if (videoSha.slice(SHA_PREFIX.length, SHA_PREFIX.length + 12) !== urls.hashPrefix) {
      throw new ControlError(400, `Reel ${idx}: hash do vídeo não corresponde ao caminho`);
    }
    if (coverHashes.has(coverSha)) throw new ControlError(400, `Reel ${idx}: capa duplicada no lote`);
    coverHashes.add(coverSha);
    const reelBase: ReelRow = {
      id: "pending", slug: sourceVideoId, idx, account_id: accountRow.id, canal: channel,
      video_url: urls.videoUrl, video_sha256: videoSha, cover_url: urls.coverUrl, cover_sha256: coverSha,
      story_url: urls.storyUrl, story_sha256: storySha, caption: item.caption,
      scheduled_unix: scheduledUnix, status: "pending", publish_state: "pending", story_publish_state: "pending",
      approval_fingerprint: "", story_approval_fingerprint: "", container_id: null, container_status: null,
      post_id: null, published_at: null, permalink: null, story_container_id: null, story_container_status: null,
      story_post_id: null, story_published_at: null, story_permalink: null,
      metadata_status: "pending", metadata_claim_token: null, metadata_lease_until: null,
      metadata_error: null, provider_published_at: null, action_kind: null, action_started_at: null,
      story_action_kind: null, story_action_started_at: null,
    };
    const reelFingerprint = await canonicalReelFingerprint(reelBase);
    reelBase.approval_fingerprint = reelFingerprint;
    const storyFingerprint = await canonicalStoryFingerprint(reelBase);
    reelBase.story_approval_fingerprint = storyFingerprint;
    expectedRows.push({
      ...reelBase,
      approved_content_id: null,
      story_approved_content_id: null,
      keyword: null,
      story_status: "pending",
    });
  }
  return expectedRows;
}

async function scheduleBatch(body: Record<string, any>, deps: HandlerDependencies, repository: BatchRepository, nowMs: number) {
  const { sourceVideoId } = body;
  const accountRow = await repository.getActiveAccount("andreyogeek");
  if (!accountRow || accountRow.active !== true || accountRow.ig_username !== "andreyogeek" || !accountRow.owner_user_id) {
    throw new ControlError(409, "conta ativa ou proprietário não validado");
  }
  const expectedRows = await prepareReelBatch(body, accountRow, deps.config, deps.fetchImpl ?? fetch, nowMs);

  const dates = body.action === "schedule-sequence" ? body.dates as string[] : [body.date as string];
  const dayResults = await Promise.all([...new Set(dates)].map(async (date) => {
    const start = expectedUnix(date, "00:00");
    return { date, rows: await repository.listRowsByDay(accountRow.id, start, start + 86400) };
  }));
  const sourceRows = await repository.listRowsBySource(sourceVideoId);
  const dayRows = dayResults.flatMap((result) => result.rows);
  const activeApprovals = new Map<string, BatchApprovalRecord>();
  for (const row of expectedRows) {
    const contentId = `${sourceVideoId}:${row.idx}`;
    for (const contentType of ["reel", "reel_story"] as const) {
      const fingerprint = String(contentType === "reel" ? row.approval_fingerprint : row.story_approval_fingerprint);
      const approvals = await repository.listApprovals(contentType, contentId, accountRow.id);
      const exact = assertApprovalStatus(approvals, contentType, contentId, accountRow.id, fingerprint);
      if (!exact || exact.approved_by !== accountRow.owner_user_id) {
        throw new ControlError(409, `aprovação explícita ausente para ${contentId}; valide o pacote no controlador administrativo`);
      }
      activeApprovals.set(`${contentType}:${contentId}`, exact);
    }
  }

  if (sourceRows.length) {
    const alreadySame = sourceRows.length === 3 && sourceRows.every((old) => {
      const next = expectedRows.find((row) => row.idx === old.idx);
      return Boolean(next && ["pending", "processing", "published"].includes(String(old.status)) &&
        ["pending", "processing", "published"].includes(String(old.publish_state)) &&
        ["pending", "processing", "published"].includes(String(old.story_status)) &&
        ["pending", "processing", "published"].includes(String(old.story_publish_state)) &&
        old.account_id === next.account_id && old.canal === next.canal &&
        Number(old.scheduled_unix) === Number(next.scheduled_unix) && old.video_url === next.video_url &&
        old.video_sha256 === next.video_sha256 && old.cover_url === next.cover_url && old.cover_sha256 === next.cover_sha256 &&
        old.story_url === next.story_url && old.story_sha256 === next.story_sha256 && old.caption === next.caption &&
        old.approval_fingerprint === next.approval_fingerprint && old.story_approval_fingerprint === next.story_approval_fingerprint);
    });
    if (alreadySame) {
      return { ok: true, alreadyScheduled: true, rows: sourceRows.map(({ id, idx, status, scheduled_unix, cover_url, story_url }) =>
        ({ id, idx, status, scheduled_unix, cover_url, story_url })) };
    }
    throw new ControlError(409, "origem já reservada ou lote divergente; reconciliação manual necessária");
  }
  if (body.action === "schedule-sequence") {
    for (const day of dayResults) {
      const additions = expectedRows.filter((row) => Number(row.scheduled_unix) >= expectedUnix(day.date, "00:00") &&
        Number(row.scheduled_unix) < expectedUnix(day.date, "00:00") + 86400).length;
      if (day.rows.length + additions > 3) throw new ControlError(409, `limite diário de três Reels excedido em ${day.date}`);
    }
  } else if (dayRows.length + 3 > 3) throw new ControlError(409, "limite diário de três Reels excedido");

  const queueRows = expectedRows.map((row) => {
    const contentId = `${sourceVideoId}:${row.idx}`;
    const reelApproval = activeApprovals.get(`reel:${contentId}`);
    const storyApproval = activeApprovals.get(`reel_story:${contentId}`);
    if (!reelApproval || !storyApproval || reelApproval.revoked_at !== null || storyApproval.revoked_at !== null) {
      throw new ControlError(500, "aprovação aprovada incompleta; fila não gravada");
    }
    const queueRow: Record<string, unknown> = { ...row };
    // prepareReelBatch uses a local placeholder while calculating fingerprints; PostgreSQL owns the UUID primary key.
    delete queueRow.id;
    return { ...queueRow, approved_content_id: reelApproval.id, story_approved_content_id: storyApproval.id };
  });
  const insertedRows = await repository.insertScheduledRows(queueRows);
  if (insertedRows.length !== 3) throw new ControlError(500, "fila não confirmou os três Reels");
  return { ok: true, alreadyScheduled: false, rows: insertedRows.map(({ id, idx, status, scheduled_unix, cover_url, story_url }) =>
    ({ id, idx, status, scheduled_unix, cover_url, story_url })) };
}

export function createReelsBatchControlHandler(deps: HandlerDependencies) {
  return async function handle(request: Request) {
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
    if (!validateConfig(deps.config)) return json({ error: "batch controller is not configured" }, 503);
    if (!await authenticated(request, deps.config, request.headers.get("x-reels-token") ?? "")) {
      return json({ error: "unauthorized" }, 401);
    }
    let raw: string;
    try { raw = await readControlBody(request); }
    catch (error) {
      if (error instanceof ControlError) return json({ error: error.message }, error.status);
      return json({ error: "invalid request body" }, 400);
    }
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ error: "invalid JSON" }, 400); }
    if (!isRecord(body) || typeof body.action !== "string") return json({ error: "ação inválida" }, 400);
    const repository = typeof deps.repository === "function" ? deps.repository() : deps.repository;
    const nowMs = deps.now?.() ?? Date.now();
    try {
      if (body.action === "list-slugs") return json({ ok: true, rows: await repository.listSlugs() });
      if (body.action === "verify-batch") {
        assertBatchDateAndSource(body.date, body.sourceVideoId);
        return json({ ok: true, rows: await repository.verifyBatch(body.date, body.sourceVideoId) });
      }
      if (body.action === "sign-upload" || body.action === "sign-carousel-upload") {
        const parsed = body.action === "sign-upload" ? validateUploadPath(body.path, body.contentType, nowMs) : validateCarouselUploadPath(body.path, body.contentType);
        const signed = await repository.signUpload(parsed.path, parsed.contentType);
        return json({ ok: true, ...parsed, signedUrl: signed.signedUrl, token: signed.token });
      }
      if (body.action !== "schedule-batch" && body.action !== "schedule-sequence") return json({ error: "ação inválida" }, 400);
      return json(await scheduleBatch(body, deps, repository, nowMs));
    } catch (error) {
      if (error instanceof ControlError) return json({ error: error.message }, error.status);
      if (isRecord(error) && typeof error.status === "number" && typeof error.message === "string") {
        const status = error.status >= 400 && error.status < 600 ? error.status : 400;
        return json({ error: error.message }, status);
      }
      const logger = deps.logger ?? ((event, context) => console.error(event, context));
      logger("reels-batch-control internal failure", {
        action: isRecord(body) && typeof body.action === "string" ? body.action : "unknown",
        code: isRecord(error) && typeof error.code === "string" ? error.code : null,
        status: isRecord(error) && typeof error.status === "number" ? error.status : null,
        message: safeDiagnostic(error, deps.config),
      });
      return json({ error: "batch controller operation failed" }, 500);
    }
  };
}

