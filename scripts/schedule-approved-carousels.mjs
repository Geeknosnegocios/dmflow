import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  APPROVED_CARDS, TARGET_REF, cleanupTempRoot, createLinkedWorkdir, loadApprovedCarouselPackages, parseCliJson,
  packageFingerprint, querySupabase, runSupabase, sqlQuote, verifyCutoverReady,
} from "./register-approved-carousel-batch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUCKET = "dmflow-content";
const SLOT = "10:06";
const MAX_BYTES = 10 * 1024 * 1024;

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function brtDate(epochMs) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(epochMs));
  const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return value.year + "-" + value.month + "-" + value.day;
}

function addDays(date, count) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + count, 12));
  return next.getUTCFullYear() + "-" + String(next.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(next.getUTCDate()).padStart(2, "0");
}

function weekdayBrt(date) {
  const day = new Date(date + "T12:00:00-03:00").getUTCDay();
  return day > 0 && day < 6;
}

export function chooseCarouselScheduleDates({ nowMs, occupiedDates = [], count = 4 }) {
  const occupied = new Set(occupiedDates);
  const today = brtDate(nowMs);
  const slotMs = Date.parse(today + "T" + SLOT + ":00-03:00");
  let date = slotMs >= nowMs + 20 * 60_000 ? today : addDays(today, 1);
  const selected = [];
  for (let attempt = 0; attempt < 45 && selected.length < count; attempt++, date = addDays(date, 1)) {
    if (!weekdayBrt(date) || occupied.has(date)) continue;
    selected.push({ date, publishAt: date + "T" + SLOT + ":00-03:00" });
  }
  if (selected.length !== count) throw new Error("Quatro dias úteis livres não encontrados no horizonte de 45 dias");
  return selected;
}

export function carouselSlidePath(cardId, slide) {
  if (!APPROVED_CARDS.some((card) => card.cardId === cardId) || !/^sha256:[0-9a-f]{64}$/.test(slide.sha256)) {
    throw new Error("Mídia fora da lista W44 aprovada");
  }
  const index = Number(slide.name.match(/^slide-(\d{2})\.png$/)?.[1]);
  if (!Number.isInteger(index) || index < 1 || index > 8) throw new Error("Índice de slide inválido");
  return "instagram/carousels/" + cardId + "/slide-" + String(index).padStart(2, "0") + "-" + slide.sha256.slice(7, 19) + ".png";
}

export function carouselInsertSql(accountId, ownerUserId, rows) {
  if (!accountId || !ownerUserId || rows.length !== 4 || rows.some((row) => !APPROVED_CARDS.some((card) => card.cardId === row.cardId))) {
    throw new Error("Agendamento limitado aos quatro cards W44 aprovados");
  }
  const values = rows.map((row) => {
    const urls = row.slideUrls.map(sqlQuote).join(",");
    const hashes = row.pkg.slides.map((slide) => sqlQuote(slide.sha256)).join(",");
    return "(" + [row.cardId, accountId, row.pkg.canal, row.pkg.caption].map(sqlQuote).join(",") +
      ",array[" + urls + "]::text[],array[" + hashes + "]::text[]," + sqlQuote(row.pkg.fingerprint) +
      "," + sqlQuote(row.publishAt) + "::timestamptz,'scheduled')";
  }).join(",\n");
  const ids = rows.map((row) => sqlQuote(row.cardId)).join(",");
  const times = rows.map((row) => sqlQuote(row.publishAt) + "::timestamptz").join(",");
  const approvals = rows.map((row) => "(" + sqlQuote(row.cardId) + "," + sqlQuote(row.pkg.fingerprint) + ")").join(",");
  return [
    "begin;",
    "do $preflight$ begin",
    "  if (select count(*) from dmflow.accounts where id=" + sqlQuote(accountId) + " and owner_user_id=" + sqlQuote(ownerUserId) + " and active is true and lower(ig_username)='andreyogeek') <> 1 then raise exception 'target account owner changed'; end if;",
    "  if (select count(*) from dmflow.approved_content a join (values " + approvals + ") requested(content_id,fingerprint) on a.content_id=requested.content_id and a.fingerprint=requested.fingerprint where a.content_type='carousel' and a.account_id=" + sqlQuote(accountId) + " and a.approved_by=" + sqlQuote(ownerUserId) + " and a.revoked_at is null) <> 4 then raise exception 'four exact active owner approvals are required'; end if;",
    "  if exists(select 1 from dmflow.scheduled_carousels where account_id=" + sqlQuote(accountId) + " and publish_at=any(array[" + times + "]::timestamptz[]) and card_id<>all(array[" + ids + "]::text[])) then raise exception 'a publishing slot is occupied'; end if;",
    "end $preflight$;",
    "insert into dmflow.scheduled_carousels(card_id,account_id,canal,caption,image_urls,slide_hashes,approval_fingerprint,publish_at,status) values",
    values + " on conflict(card_id) do nothing;",
    "do $verify$ begin if (select count(*) from dmflow.scheduled_carousels q where q.account_id=" + sqlQuote(accountId) + " and q.card_id=any(array[" + ids + "]::text[]) and q.publish_at=any(array[" + times + "]::timestamptz[]) and q.status in ('scheduled','processing','published')) <> 4 then raise exception 'the four approved queue rows did not persist'; end if; end $verify$;",
    "commit;",
    "",
  ].join("\n");
}

export function existingCarouselBatchMatches(packages, queueRows, accountId) {
  if (packages.length !== 4 || queueRows.length !== 4) return false;
  return packages.every((pkg) => {
    const row = queueRows.find((item) => item.card_id === pkg.cardId);
    const expectedUrls = pkg.slides.map((slide) => storageUrl(carouselSlidePath(pkg.cardId, slide)));
    const validState = row && ["scheduled", "processing", "published"].includes(row.status) &&
      (row.status !== "published" || Boolean(row.post_id && row.published_at));
    return Boolean(validState && row.account_id === accountId && row.canal === pkg.canal &&
      row.caption === pkg.caption && row.approval_fingerprint === pkg.fingerprint &&
      JSON.stringify(row.image_urls) === JSON.stringify(expectedUrls) &&
      JSON.stringify(row.slide_hashes) === JSON.stringify(pkg.slides.map((slide) => slide.sha256)));
  });
}

function storageUrl(objectPath) {
  return "https://" + TARGET_REF + ".supabase.co/storage/v1/object/public/" + BUCKET + "/" + objectPath;
}

export async function verifyRemoteSlide(url, expectedHash, fetchImpl = fetch) {
  const response = await fetchImpl(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (response.status === 400 || response.status === 404) return { exists: false };
  if (!response.ok) throw new Error("Storage returned HTTP " + response.status);
  if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("image/png")) throw new Error("Storage object is not PNG");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("Storage PNG size is invalid");
  const actual = "sha256:" + createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedHash) throw new Error("Storage bytes differ from approved local SHA-256");
  return { exists: true };
}

export async function requestCarouselUploadSignature({ controlUrl, batchToken, publishableKey, objectPath, fetchImpl = fetch }) {
  let endpoint;
  try { endpoint = new URL(controlUrl); } catch { throw new Error("Batch-control upload URL is invalid"); }
  if (endpoint.origin !== `https://${TARGET_REF}.supabase.co` ||
      endpoint.pathname !== "/functions/v1/reels-batch-control" || endpoint.search || endpoint.hash ||
      !batchToken || !publishableKey ||
      !/^instagram\/carousels\/ANDREY-W44-2026-C0[1-4]\/slide-0[1-8]-[0-9a-f]{12}\.png$/.test(objectPath)) {
    throw new Error("Upload signing is limited to approved W44 carousel PNGs in Geek Academy");
  }
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-reels-token": batchToken,
        apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
      body: JSON.stringify({ action: "sign-carousel-upload", path: objectPath, contentType: "image/png" }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new Error("Carousel upload signing request failed"); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Carousel upload signing request was rejected");
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error("Carousel upload signing response is invalid"); }
  if (!data || data.ok !== true || data.path !== objectPath || data.contentType !== "image/png" ||
      typeof data.signedUrl !== "string" || typeof data.token !== "string" || !data.token || data.token.length > 4096) {
    throw new Error("Carousel upload signing response did not match the requested asset");
  }
  return { signedUrl: data.signedUrl, token: data.token };
}

export async function uploadApprovedSlide({ supabaseUrl, publishableKey, objectPath, bytes, signUpload, fetchImpl = fetch }) {
  if (new URL(supabaseUrl).origin !== `https://${TARGET_REF}.supabase.co` || !publishableKey ||
      typeof signUpload !== "function" ||
      !/^instagram\/carousels\/ANDREY-W44-2026-C0[1-4]\/slide-0[1-8]-[0-9a-f]{12}\.png$/.test(objectPath)) {
    throw new Error("Upload rejected: only an approved W44 slide in the target Storage bucket is allowed");
  }
  const signed = await signUpload(objectPath, "image/png");
  let signedUrl;
  try { signedUrl = new URL(signed.signedUrl); } catch { throw new Error("Storage signed URL is invalid"); }
  const expectedPath = `/storage/v1/object/upload/sign/${BUCKET}/${objectPath}`;
  if (signedUrl.origin !== `https://${TARGET_REF}.supabase.co` || signedUrl.pathname !== expectedPath ||
      signedUrl.searchParams.size !== 1 || signedUrl.searchParams.get("token") !== signed.token || signedUrl.hash) {
    throw new Error("Storage returned a signed URL outside the approved object path");
  }
  const response = await fetchImpl(signedUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${publishableKey}`, apikey: publishableKey,
      "Content-Type": "image/png", "Cache-Control": "max-age=3600", "x-upsert": "false" },
    body: bytes,
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  await response.body?.cancel();
  return { ok: response.ok, status: response.status, url: storageUrl(objectPath) };
}

async function loadBatchControlCredentials(envPath) {
  if (!envPath) throw new Error("Pass --reelsflow-env with the existing local Reelsflow .env file");
  const values = new Map();
  for (const line of (await readFile(envPath, "utf8")).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith("#")) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  const config = { controlUrl: values.get("DMFLOW_BATCH_CONTROL_URL"),
    batchToken: values.get("DMFLOW_BATCH_CONTROL_TOKEN"), publishableKey: values.get("DMFLOW_PUBLISHABLE_KEY") };
  let endpoint;
  try { endpoint = new URL(config.controlUrl ?? ""); } catch { throw new Error("Reelsflow batch-control URL is invalid"); }
  if (endpoint.origin !== `https://${TARGET_REF}.supabase.co` ||
      endpoint.pathname !== "/functions/v1/reels-batch-control" || endpoint.search || endpoint.hash ||
      !config.batchToken || !config.publishableKey) {
    throw new Error("Reelsflow upload signer is not configured for the target project");
  }
  return config;
}

async function main() {
  const commit = process.argv.includes("--commit");
  const vercelConfirmed = process.argv.includes("--vercel-crons-removed");
  const reelsflowEnv = option("--reelsflow-env") ?? process.env.REELSFLOW_ENV_FILE ?? null;
  if (commit && !vercelConfirmed) throw new Error("Confirm zero legacy Vercel publish-reels cron jobs before --commit");
  const assetsRoot = option("--assets-dir") ?? process.env.INSTAGRAM_CAROUSEL_ASSETS ??
    "C:\\Users\\freit\\Documents\\ChatGPT\\Instagram\\carrosseis-semana-26out";
  const packages = await loadApprovedCarouselPackages(assetsRoot);
  const cutover = await verifyCutoverReady({ reelsflowEnv, vercelCronConfirmed: vercelConfirmed });
  if (!cutover.ready) {
    if (commit) throw new Error("Carousel scheduling requires completed publisher cutover: " + cutover.reason);
    console.log(JSON.stringify({ mode: "dry-run", ready: false, writes: 0, cards: 4, slides: 32, reason: cutover.reason }));
    return;
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "instagram-carousel-schedule-"));
  try {
    const workdir = await createLinkedWorkdir(tempRoot);
    const accounts = querySupabase(workdir, "select id,owner_user_id from dmflow.accounts where active is true and lower(ig_username)='andreyogeek' limit 2");
    if (accounts.length !== 1 || !accounts[0].id || !accounts[0].owner_user_id) throw new Error("Exactly one active @andreyogeek account and owner are required");
    const accountId = accounts[0].id;
    const ownerUserId = accounts[0].owner_user_id;
    for (const pkg of packages) pkg.fingerprint = await packageFingerprint(accountId, pkg);

    const ids = packages.map((pkg) => sqlQuote(pkg.cardId)).join(",");
    const approvalRows = querySupabase(workdir, "select content_id,fingerprint,account_id,approved_by,revoked_at from dmflow.approved_content " +
      "where content_type='carousel' and account_id=" + sqlQuote(accountId) + " and content_id=any(array[" + ids + "]::text[]) order by content_id");
    for (const pkg of packages) {
      const exact = approvalRows.filter((row) => row.content_id === pkg.cardId && row.fingerprint === pkg.fingerprint &&
        row.account_id === accountId && row.approved_by === ownerUserId && row.revoked_at === null);
      if (exact.length !== 1 || approvalRows.some((row) => row.content_id === pkg.cardId && row.revoked_at === null &&
          (row.fingerprint !== pkg.fingerprint || row.approved_by !== ownerUserId))) {
        throw new Error(pkg.cardId + ": exact active owner approval is missing or conflicts with another revision");
      }
    }

    const queueRows = querySupabase(workdir, "select card_id,account_id,canal,caption,image_urls,slide_hashes,approval_fingerprint,publish_at,status,post_id,published_at " +
      "from dmflow.scheduled_carousels where account_id=" + sqlQuote(accountId) + " and card_id=any(array[" + ids + "]::text[]) order by card_id");
    if (queueRows.length && queueRows.length !== 4) throw new Error("Partial W44 queue requires manual reconciliation");
    if (queueRows.length === 4) {
      if (!existingCarouselBatchMatches(packages, queueRows, accountId)) {
        throw new Error("Existing W44 queue rows differ from the exact approved packages");
      }
      const remote = [];
      for (const pkg of packages) for (const slide of pkg.slides) {
        const url = storageUrl(carouselSlidePath(pkg.cardId, slide));
        remote.push({ cardId: pkg.cardId, slide: slide.name, ...(await verifyRemoteSlide(url, slide.sha256)) });
      }
      if (remote.some((asset) => !asset.exists)) throw new Error("An already scheduled package is missing an approved Storage asset");
      console.log(JSON.stringify({ mode: commit ? "commit" : "dry-run", alreadyScheduled: true,
        cards: 4, slides: 32, rows: queueRows.map((row) => ({ cardId: row.card_id, status: row.status, hasPostId: Boolean(row.post_id) })),
        storageVerified: remote.length, dmKeywordWrites: 0 }));
      return;
    }

    const occupiedRows = querySupabase(workdir, "select distinct day from (" +
      "select (publish_at at time zone 'America/Sao_Paulo')::date::text as day from dmflow.scheduled_carousels " +
      "where account_id=" + sqlQuote(accountId) + " and status in ('draft','scheduled','processing','published') union " +
      "select (to_timestamp(scheduled_unix) at time zone 'America/Sao_Paulo')::date::text as day from dmflow.scheduled_reels " +
      "where account_id=" + sqlQuote(accountId) + " and status in ('pending','processing','published')) occupied_days;");
    const dates = chooseCarouselScheduleDates({ nowMs: Date.now(), occupiedDates: occupiedRows.map((row) => row.day), count: 4 });
    const rows = packages.map((pkg, index) => {
      const publishAt = dates[index].publishAt;
      const assets = pkg.slides.map((slide) => {
        const objectPath = carouselSlidePath(pkg.cardId, slide);
        return { slide, objectPath, url: storageUrl(objectPath) };
      });
      return { cardId: pkg.cardId, date: dates[index].date, publishAt, pkg,
        slideUrls: assets.map((asset) => asset.url), assets };
    });

    const remoteAssets = [];
    for (const row of rows) for (const asset of row.assets) {
      remoteAssets.push({ cardId: row.cardId, slide: asset.slide.name,
        ...(await verifyRemoteSlide(asset.url, asset.slide.sha256)) });
    }
    if (!commit) {
      console.log(JSON.stringify({ mode: "dry-run", ready: true, writes: 0, cards: 4, slides: 32,
        storageVerified: remoteAssets.filter((asset) => asset.exists).length,
        storageMissing: remoteAssets.filter((asset) => !asset.exists).length,
        schedule: rows.map(({ cardId, date, publishAt }) => ({ cardId, date, publishAt })), dmKeywordWrites: 0 }));
      return;
    }

    const uploadCredentials = await loadBatchControlCredentials(reelsflowEnv);
    for (const row of rows) for (const asset of row.assets) {
      const cached = remoteAssets.find((item) => item.cardId === row.cardId && item.slide === asset.slide.name);
      if (!cached?.exists) {
        const uploaded = await uploadApprovedSlide({ supabaseUrl: `https://${TARGET_REF}.supabase.co`,
          publishableKey: uploadCredentials.publishableKey, objectPath: asset.objectPath, bytes: asset.slide.bytes,
          signUpload: (path, contentType) => requestCarouselUploadSignature({ ...uploadCredentials, objectPath: path, contentType }) });
        if (!uploaded.ok && !(await verifyRemoteSlide(asset.url, asset.slide.sha256)).exists) {
          throw new Error(row.cardId + "/" + asset.slide.name + ": Storage upload failed with HTTP " + uploaded.status);
        }
      }
      if (!(await verifyRemoteSlide(asset.url, asset.slide.sha256)).exists) {
        throw new Error(row.cardId + "/" + asset.slide.name + ": upload verification failed");
      }
    }
    const sqlDir = path.join(tempRoot, "queue");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(sqlDir, { recursive: true });
    const sqlFile = path.join(sqlDir, "approved-carousel-queue.sql");
    try {
      await writeFile(sqlFile, carouselInsertSql(accountId, ownerUserId, rows), "utf8");
      runSupabase(["db", "query", "--workdir", workdir, "--linked", "--file", sqlFile], workdir);
    } finally {
      const resolved = path.resolve(sqlDir);
      if (path.dirname(resolved) !== path.resolve(tempRoot) || path.basename(resolved) !== "queue") {
        throw new Error("Refusing to remove a queue SQL folder outside its exact temp root");
      }
      await rm(sqlDir, { recursive: true, force: true });
    }
    const verified = querySupabase(workdir, "select card_id,status,post_id,cardinality(image_urls)::int as image_count " +
      "from dmflow.scheduled_carousels where account_id=" + sqlQuote(accountId) + " and card_id=any(array[" + ids + "]::text[]) order by card_id");
    if (verified.length !== 4 || verified.some((row) => row.status !== "scheduled" || row.post_id !== null || Number(row.image_count) !== 8)) {
      throw new Error("Target queue did not confirm four scheduled eight-slide rows with no premature post_id");
    }
    console.log(JSON.stringify({ mode: "commit", ok: true, cards: 4, slides: 32,
      schedule: rows.map(({ cardId, date, publishAt }) => ({ cardId, date, publishAt })), dmKeywordWrites: 0 }));
  } finally {
    await cleanupTempRoot(tempRoot, "instagram-carousel-schedule-");
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error("Carousel scheduling stopped: " + (error instanceof Error ? error.message : "unknown error")); process.exitCode = 1; });
}
