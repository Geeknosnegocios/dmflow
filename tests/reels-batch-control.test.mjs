import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createReelsBatchControlHandler } from "../supabase/functions/reels-batch-control/handler.ts";
import { canonicalReelFingerprint, canonicalStoryFingerprint } from "../supabase/functions/_shared/reel-publishing.ts";

const base = "https://zoknypleoribwomifzgi.supabase.co";
const batchToken = "trusted-batch-control-token";
const publishable = "sb_publishable_test-key";
const tokenHash = createHash("sha256").update(batchToken).digest("hex");
const ownerId = "owner-uuid-from-active-account";
const accountId = "instagram-account-uuid";
const now = Date.parse("2026-10-28T09:00:00-03:00");

function mp4(seed) {
  const bytes = Buffer.alloc(100_256, seed);
  bytes[4] = 0x66; bytes[5] = 0x74; bytes[6] = 0x79; bytes[7] = 0x70;
  return bytes;
}
function jpeg(seed) {
  const bytes = Buffer.alloc(2048, seed);
  bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff;
  return bytes;
}
function sha(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function packageFor(idx, seed = idx, date = "2026-10-29", time) {
  const video = mp4(seed);
  const cover = jpeg(seed + 10);
  const story = mp4(seed + 20);
  const stem = `reels/${date}/B07no8JWSvo/reel-0${idx}-${sha(video).slice(0, 12)}`;
  return {
    idx,
    ...(time ? { date, time } : {}),
    caption: `Approved copy ${idx}`,
    video_url: `${base}/storage/v1/object/public/dmflow-content/${stem}.mp4`,
    cover_url: `${base}/storage/v1/object/public/dmflow-content/${stem}-cover.jpg`,
    story_url: `${base}/storage/v1/object/public/dmflow-content/${stem}-story.mp4`,
    __assets: { video, cover, story },
  };
}
function sequence(overrides = {}) {
  const dates = ["2026-10-30", "2026-10-31", "2026-11-01"];
  const time = "12:00";
  return {
    action: "schedule-sequence", dates, time, sourceVideoId: "B07no8JWSvo",
    channel: "GI", account: "andreyogeek",
    items: dates.map((date, index) => packageFor(index + 1, index + 1, date, time)),
    ...overrides,
  };
}
function batch(overrides = {}) {
  return {
    action: "schedule-batch", date: "2026-10-29", sourceVideoId: "B07no8JWSvo",
    channel: "GI", account: "andreyogeek", items: [1, 2, 3].map((idx) => packageFor(idx)),
    ...overrides,
  };
}
function db(options = {}) {
  const state = {
    account: { id: accountId, owner_user_id: ownerId, active: true, ig_username: "andreyogeek" },
    rows: [], approvals: [], writes: { approvals: 0, rows: 0, signs: 0 },
    ...options,
  };
  const repository = {
    async listSlugs() { return state.rows.map(({ slug, idx, status, post_id, permalink, published_at }) => ({ slug, idx, status, post_id, permalink, published_at })); },
    async verifyBatch(date, source) { return state.rows.filter((row) => row.slug === source && row.date === date); },
    async signUpload(path, contentType) { state.writes.signs++; return { signedUrl: `${base}/storage/v1/upload/${path}?token=single-use`, token: "single-use" }; },
    async getActiveAccount(username) { return state.account?.ig_username === username && state.account.active ? state.account : null; },
    async listRowsBySource(source) { return state.rows.filter((row) => row.slug === source); },
    async listRowsByDay(account, start, end) { return state.rows.filter((row) => row.scheduled_unix >= start && row.scheduled_unix < end); },
    async listApprovals(type, contentId, account) {
      return state.approvals.filter((item) => item.content_type === type && item.content_id === contentId && item.account_id === account);
    },
    async insertScheduledRows(rows) {
      state.writes.rows++;
      const inserted = rows.map((row, idx) => ({ id: `reel-${idx + 1}`, status: "pending", ...row }));
      state.rows.push(...inserted);
      return inserted;
    },
  };
  return { state, repository };
}
function request(body, headers = {}) {
  const serialized = { ...body, ...(Array.isArray(body.items) ? { items: body.items.map(({ __assets, ...item }) => item) } : {}) };
  return new Request("https://edge.invalid/reels-batch-control", {
    method: "POST",
    headers: { "content-type": "application/json", "x-reels-token": batchToken,
      apikey: publishable, authorization: `Bearer ${publishable}`, ...headers },
    body: JSON.stringify(serialized),
  });
}
function config(overrides = {}) {
  return { supabaseUrl: base, serviceRoleKey: "server-role-secret", publishableKey: publishable,
    batchTokenSha256: tokenHash, ...overrides };
}
async function seedOwnerApprovals(payload, state, { revokeContentId } = {}) {
  let index = 1;
  for (const item of payload.items) {
    const idx = item.idx;
    const date = payload.dates?.[idx - 1] ?? payload.date;
    const time = payload.time ?? ["08:00", "12:00", "20:00"][idx - 1];
    const scheduledUnix = Math.floor(Date.parse(`${date}T${time}:00-03:00`) / 1000);
    const row = {
      id: `approved-fixture-${idx}`, slug: payload.sourceVideoId, idx, account_id: state.account.id,
      canal: payload.channel, video_url: item.video_url, video_sha256: `sha256:${sha(item.__assets.video)}`,
      cover_url: item.cover_url, cover_sha256: `sha256:${sha(item.__assets.cover)}`,
      story_url: item.story_url, story_sha256: `sha256:${sha(item.__assets.story)}`,
      caption: item.caption, scheduled_unix: scheduledUnix,
    };
    const reelFingerprint = await canonicalReelFingerprint(row);
    row.approval_fingerprint = reelFingerprint;
    const storyFingerprint = await canonicalStoryFingerprint(row);
    const contentId = `${payload.sourceVideoId}:${idx}`;
    state.approvals.push(
      { id: `approval-reel-${idx}`, content_type: "reel", content_id: contentId, account_id: state.account.id,
        fingerprint: reelFingerprint, approved_by: state.account.owner_user_id, revoked_at: revokeContentId === `reel:${contentId}` ? "2026-10-28T10:00:00Z" : null },
      { id: `approval-story-${idx}`, content_type: "reel_story", content_id: contentId, account_id: state.account.id,
        fingerprint: storyFingerprint, approved_by: state.account.owner_user_id, revoked_at: revokeContentId === `reel_story:${contentId}` ? "2026-10-28T10:00:00Z" : null },
    );
    index++;
  }
}
function fetchMedia(payload) {
  const assets = new Map();
  for (const item of payload.items ?? []) {
    assets.set(item.video_url, item.__assets.video);
    assets.set(item.cover_url, item.__assets.cover);
    assets.set(item.story_url, item.__assets.story);
  }
  return async (url, init = {}) => {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    const asset = assets.get(String(url));
    if (!asset) return new Response("missing", { status: 404 });
    const contentType = String(url).endsWith("-cover.jpg") ? "image/jpeg" : "video/mp4";
    return new Response(asset, { headers: { "content-type": contentType, "content-length": String(asset.length) } });
  };
}

test("controller fails closed if service, publishable, or hashed batch credentials are absent", async () => {
  const { repository, state } = db();
  for (const missing of [
    { serviceRoleKey: "" }, { publishableKey: "" }, { batchTokenSha256: "" }, { supabaseUrl: "" },
  ]) {
    const handler = createReelsBatchControlHandler({ config: config(missing), repository });
    const response = await handler(request({ action: "list-slugs" }));
    assert.equal(response.status, 503);
  }
  assert.equal(state.writes.rows, 0);
  assert.equal(state.writes.approvals, 0);
});

test("controller checks both x-reels-token hash and publishable apikey/bearer before repository access", async () => {
  let calls = 0;
  const handler = createReelsBatchControlHandler({ config: config(), repository: {
    async listSlugs() { calls++; return []; },
  } });
  const badToken = await handler(request({ action: "list-slugs" }, { "x-reels-token": "wrong" }));
  const badKey = await handler(request({ action: "list-slugs" }, { apikey: "wrong" }));
  const badBearer = await handler(request({ action: "list-slugs" }, { authorization: "Bearer wrong" }));
  assert.equal(badToken.status, 401);
  assert.equal(badKey.status, 401);
  assert.equal(badBearer.status, 401);
  assert.equal(calls, 0);
});

test("controller bounds its JSON body without touching the repository", async () => {
  let calls = 0;
  const handler = createReelsBatchControlHandler({ config: config(), repository: {
    async listSlugs() { calls++; return []; },
  } });
  const response = await handler(request({ action: "list-slugs", unused: "x".repeat(2 * 1024 * 1024 + 1) }));
  assert.equal(response.status, 413);
  assert.equal(calls, 0);
});

test("preserves list-slugs, verify-batch, and one-time sign-upload contracts", async () => {
  const payload = batch();
  const { repository, state } = db({ rows: [{ slug: payload.sourceVideoId, idx: 1, status: "published", post_id: "post-1", permalink: "https://instagram.com/reel/x/", published_at: "2026-10-29T11:00:00Z", date: payload.date }] });
  const handler = createReelsBatchControlHandler({ config: config(), repository, now: () => now });
  const slugs = await handler(request({ action: "list-slugs" }));
  assert.equal((await slugs.json()).rows[0].slug, payload.sourceVideoId);
  const verify = await handler(request({ action: "verify-batch", date: payload.date, sourceVideoId: payload.sourceVideoId }));
  assert.equal((await verify.json()).rows.length, 1);
  const signed = await handler(request({ action: "sign-upload", path: "reels/2026-10-29/B07no8JWSvo/reel-01-0123456789ab-cover.jpg", contentType: "image/jpeg" }));
  const signedBody = await signed.json();
  assert.equal(signed.status, 200);
  assert.equal(signedBody.token, "single-use");
  assert.equal(state.writes.signs, 1);
});

test("schedule-batch requires exact preapproved hashes and inserts three rows without creating approvals", async () => {
  const payload = batch();
  payload.approved_by = "caller-forged-owner";
  payload.approval_fingerprints = ["caller-forged-fingerprint"];
  payload.items.forEach((item) => { item.approved_by = "caller-forged-owner"; item.fingerprint = "caller-forged-fingerprint"; });
  const { repository, state } = db();
  await seedOwnerApprovals(payload, state);
  const handler = createReelsBatchControlHandler({ config: config(), repository, fetchImpl: fetchMedia(payload), now: () => now });
  const response = await handler(request(payload));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.rows.length, 3);
  assert.deepEqual(body.rows.map((row) => row.idx), [1, 2, 3]);
  assert.equal(state.writes.approvals, 0);
  assert.equal(state.writes.rows, 1);
  assert.equal(state.approvals.length, 6);
  assert.ok(state.approvals.every((row) => row.approved_by === ownerId));
  assert.ok(state.approvals.every((row) => /^sha256:[0-9a-f]{64}$/.test(row.fingerprint)));
  assert.equal(new Set(state.approvals.map((row) => `${row.content_type}:${row.content_id}`)).size, 6);
  assert.ok(state.rows.every((row) => row.account_id === accountId && row.canal === "GI"));
  assert.deepEqual(state.rows.map((row) => row.scheduled_unix), [
    Date.parse("2026-10-29T08:00:00-03:00") / 1000,
    Date.parse("2026-10-29T12:00:00-03:00") / 1000,
    Date.parse("2026-10-29T20:00:00-03:00") / 1000,
  ]);
  assert.ok(state.rows.every((row) => row.publish_state === "pending" && row.story_publish_state === "pending"));
});

test("schedule-sequence propagates all six owner approvals and inserts one Reel per date", async () => {
  const payload = sequence();
  const { repository, state } = db();
  await seedOwnerApprovals(payload, state);
  const handler = createReelsBatchControlHandler({ config: config(), repository,
    fetchImpl: fetchMedia(payload), now: () => now });
  const response = await handler(request(payload));
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.rows.length, 3);
  assert.deepEqual(state.rows.map(row => row.scheduled_unix), payload.dates.map(date =>
    Date.parse(`${date}T12:00:00-03:00`) / 1000));
  assert.ok(state.rows.every(row => row.approved_content_id && row.story_approved_content_id));
  assert.ok(state.rows.every(row => row.approval_fingerprint && row.story_approval_fingerprint));
  assert.equal(state.writes.approvals, 0);
  assert.equal(state.writes.rows, 1);
  const repeated = await handler(request(payload));
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).alreadyScheduled, true);
  assert.equal(state.writes.rows, 1);
});

test("schedule-sequence requires immutable approvals before queue insertion", async () => {
  const payload = sequence();
  const { repository, state } = db();
  const handler = createReelsBatchControlHandler({ config: config(), repository,
    fetchImpl: fetchMedia(payload), now: () => now });
  const response = await handler(request(payload));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /aprovação explícita ausente/);
  assert.equal(state.writes.rows, 0);
});

test("caller-supplied owner ids or fingerprints cannot mint approvals or schedule an unapproved batch", async () => {
  const payload = batch();
  payload.approved_by = ownerId;
  payload.owner_confirmed = true;
  payload.approval_fingerprints = payload.items.map(() => "sha256:" + "a".repeat(64));
  const { repository, state } = db();
  const handler = createReelsBatchControlHandler({ config: config(), repository,
    fetchImpl: fetchMedia(payload), now: () => now });
  const response = await handler(request(payload));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /aprovação explícita ausente/);
  assert.equal(state.writes.approvals, 0);
  assert.equal(state.writes.rows, 0);
  assert.equal(state.approvals.length, 0);
});

test("media hash/path mismatch, missing owner, daily cap, and changed source fail before approvals or queue writes", async () => {
  const valid = batch();
  const tampered = structuredClone(valid);
  tampered.items[0].video_url = tampered.items[0].video_url.replace(/reel-01-[0-9a-f]{12}/, "reel-01-000000000000");
  const badHashDb = db();
  const badHash = createReelsBatchControlHandler({ config: config(), repository: badHashDb.repository,
    fetchImpl: fetchMedia(valid), now: () => now });
  assert.equal((await badHash(request(tampered))).status, 400);
  assert.equal(badHashDb.state.writes.approvals, 0);

  const wrongBytes = batch();
  const goodFetcher = fetchMedia(wrongBytes);
  const wrongVideoUrl = wrongBytes.items[0].video_url;
  const badBytesState = db();
  const badBytesIsolated = createReelsBatchControlHandler({ config: config(), repository: badBytesState.repository,
    fetchImpl: async (url, init) => {
      if (String(url) === wrongVideoUrl) {
        const bytes = mp4(99);
        return new Response(bytes, { headers: { "content-type": "video/mp4", "content-length": String(bytes.length) } });
      }
      return goodFetcher(url, init);
    }, now: () => now });
  assert.equal((await badBytesIsolated(request(wrongBytes))).status, 400);
  assert.equal(badBytesState.state.writes.approvals, 0);
  assert.equal(badBytesState.state.writes.rows, 0);

  const noOwner = db({ account: { ...db().state.account, owner_user_id: null } });
  const noOwnerHandler = createReelsBatchControlHandler({ config: config(), repository: noOwner.repository,
    fetchImpl: fetchMedia(valid), now: () => now });
  assert.equal((await noOwnerHandler(request(valid))).status, 409);
  assert.equal(noOwner.state.writes.rows, 0);

  const capped = db({ rows: [{ account_id: accountId, slug: "other-source", idx: 1,
    scheduled_unix: Date.parse("2026-10-29T10:00:00-03:00") / 1000, status: "published" }] });
  await seedOwnerApprovals(valid, capped.state);
  const cappedHandler = createReelsBatchControlHandler({ config: config(), repository: capped.repository,
    fetchImpl: fetchMedia(valid), now: () => now });
  assert.equal((await cappedHandler(request(valid))).status, 409);
  assert.equal(capped.state.writes.approvals, 0);

  const reserved = db({ rows: [{ account_id: accountId, slug: valid.sourceVideoId, idx: 1,
    scheduled_unix: Date.parse("2026-10-30T08:00:00-03:00") / 1000, status: "error" }] });
  await seedOwnerApprovals(valid, reserved.state);
  const reservedHandler = createReelsBatchControlHandler({ config: config(), repository: reserved.repository,
    fetchImpl: fetchMedia(valid), now: () => now });
  assert.equal((await reservedHandler(request(valid))).status, 409);
  assert.equal(reserved.state.writes.approvals, 0);
});

test("revoked or changed immutable approval blocks scheduling; exact same batch is idempotent", async () => {
  const payload = batch();
  const first = db();
  await seedOwnerApprovals(payload, first.state);
  const firstHandler = createReelsBatchControlHandler({ config: config(), repository: first.repository,
    fetchImpl: fetchMedia(payload), now: () => now });
  assert.equal((await firstHandler(request(payload))).status, 200);
  const before = first.state.writes.rows;
  const again = await firstHandler(request(payload));
  assert.equal(again.status, 200);
  assert.equal((await again.json()).alreadyScheduled, true);
  assert.equal(first.state.writes.rows, before);

  const changed = batch();
  changed.items[0].caption = "Changed after approval";
  const conflict = await firstHandler(request(changed));
  assert.equal(conflict.status, 409);
  assert.equal(first.state.writes.rows, before);

  first.state.approvals[0].revoked_at = "2026-10-28T10:00:00Z";
  const revoked = await firstHandler(request(payload));
  assert.equal(revoked.status, 409);
  assert.equal(first.state.writes.rows, before);
});

