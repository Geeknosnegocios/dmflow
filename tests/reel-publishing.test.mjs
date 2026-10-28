import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as reelState from "../supabase/functions/_shared/reel-publishing.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = `sha256:${"a".repeat(64)}`;

function fixture(overrides = {}) {
  return {
    id: "reel-1", slug: "B07no8JWSvo", idx: 1, account_id: "account-1",
    canal: "GI", video_url: "https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/reels/video.mp4",
    video_sha256: hash, cover_url: "https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/reels/cover.jpg",
    cover_sha256: `sha256:${"b".repeat(64)}`, story_url: "https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/reels/story.mp4",
    story_sha256: `sha256:${"c".repeat(64)}`, caption: "Approved caption", scheduled_unix: 1793208000,
    status: "pending", publish_state: "pending", story_publish_state: "pending",
    approval_fingerprint: "approved-reel-fingerprint", story_approval_fingerprint: "approved-story-fingerprint",
    container_id: null, container_status: null, post_id: null, published_at: null, permalink: null,
    story_container_id: null, story_container_status: null, story_post_id: null, story_published_at: null,
    story_permalink: null, ...overrides,
  };
}

function repository(row, overrides = {}) {
  const events = [];
  const repo = {
    async peekDueReel() { return row; },
    async peekDueStory() { return row; },
    async loadApproval(type, id, accountId, fingerprint) {
      events.push(["approval", type, id, accountId, fingerprint]);
      return { approved: true, revoked_at: null, fingerprint };
    },
    async claimReel() { events.push(["claim-reel"]); return { row, claim_token: "claim-1" }; },
    async claimStory() { events.push(["claim-story"]); return { row, claim_token: "story-claim-1" }; },
    async checkpointReel(id, token, patch) { events.push(["checkpoint-reel", id, token, patch]); },
    async checkpointStory(id, token, patch) { events.push(["checkpoint-story", id, token, patch]); },
    async reconcileReel(id, token, reason) { events.push(["reconcile-reel", id, token, reason]); row.publish_state = "needs_reconciliation"; },
    async reconcileStory(id, token, reason) { events.push(["reconcile-story", id, token, reason]); row.story_publish_state = "needs_reconciliation"; },
    ...overrides,
  };
  return { repo, events };
}

test("approval fingerprint binds exact Reel, Story assets, caption, source, account and schedule", async () => {
  assert.equal(typeof reelState.canonicalReelFingerprint, "function");
  const row = fixture();
  const baseline = await reelState.canonicalReelFingerprint(row);
  for (const patch of [
    { video_sha256: `sha256:${"d".repeat(64)}` }, { cover_sha256: `sha256:${"e".repeat(64)}` },
    { caption: "Changed" }, { account_id: "other" },
    { scheduled_unix: row.scheduled_unix + 60 }, { idx: 2 }, { slug: "other-source" },
  ]) assert.notEqual(await reelState.canonicalReelFingerprint({ ...row, ...patch }), baseline);
  const storyBaseline = await reelState.canonicalStoryFingerprint(row);
  assert.notEqual(await reelState.canonicalStoryFingerprint({ ...row, story_sha256: `sha256:${"f".repeat(64)}` }), storyBaseline);
});

test("unapproved or changed Reel does not claim or call Graph", async () => {
  const { repo, events } = repository(fixture(), {
    async loadApproval() { return null; },
  });
  const result = await reelState.publishReelStep({ repository: repo, graph: {}, now: Date.now() });
  assert.equal(result.status, "rejected");
  assert.equal(events.some(([name]) => name.startsWith("claim")), false);
});

test("each Reel invocation performs one Graph lifecycle operation and saves its returned container immediately", async () => {
  const row = fixture();
  row.approval_fingerprint = await reelState.canonicalReelFingerprint(row);
  const { repo, events } = repository(row);
  let calls = 0;
  const result = await reelState.publishReelStep({ repository: repo, now: Date.now(), graph: {
    async createReel() { calls++; return { id: "container-1" }; },
  } });
  assert.equal(result.status, "pending");
  assert.equal(calls, 1);
  assert.ok(events.some(([name, , , patch]) => name === "checkpoint-reel" && patch.container_id === "container-1"));
});

test("approval is checked again after media validation immediately before Reel creation", async () => {
  const row = fixture();
  row.approval_fingerprint = await reelState.canonicalReelFingerprint(row);
  let checks = 0;
  const { repo, events } = repository(row, {
    async loadApproval(type, id, accountId, fingerprint) {
      checks++;
      return checks < 3 ? { approved: true, revoked_at: null, fingerprint } : null;
    },
  });
  let graphCalls = 0;
  const result = await reelState.publishReelStep({ repository: repo, now: Date.now(), graph: {
    async validateReel() {},
    async createReel() { graphCalls++; return { id: "should-not-happen" }; },
  } });
  assert.equal(result.status, "needs_reconciliation");
  assert.equal(graphCalls, 0);
  assert.equal(checks, 3);
  assert.ok(events.some(([name]) => name === "reconcile-reel"));
});

test("ambiguous media_publish failure is reconciled and never retried", async () => {
  const row = fixture({ container_id: "container-1", container_status: "FINISHED" });
  row.approval_fingerprint = await reelState.canonicalReelFingerprint(row);
  const { repo, events } = repository(row);
  let publishes = 0;
  const graph = { async publishReel() { publishes++; throw new Error("network timeout after request"); } };
  const first = await reelState.publishReelStep({ repository: repo, graph, now: Date.now() });
  assert.equal(first.status, "needs_reconciliation");
  assert.equal(publishes, 1);
  const second = await reelState.publishReelStep({ repository: repo, graph, now: Date.now() });
  assert.equal(second.status, "rejected");
  assert.equal(publishes, 1);
  assert.ok(events.some(([name]) => name === "reconcile-reel"));
});

test("successful media_publish durably stores Reel ID and observed time before any later work", async () => {
  const row = fixture({ container_id: "container-1", container_status: "FINISHED" });
  row.approval_fingerprint = await reelState.canonicalReelFingerprint(row);
  const { repo, events } = repository(row);
  let calls = 0;
  const result = await reelState.publishReelStep({ repository: repo, graph: {
    async publishReel() { calls++; return { id: "published-reel-1", timestamp: "2026-10-28T15:00:00.000Z" }; },
  }, now: Date.parse("2026-10-28T15:00:00.000Z") });
  const saved = events.find(([name]) => name === "checkpoint-reel");
  assert.equal(result.status, "published");
  assert.equal(calls, 1);
  assert.equal(saved[3].post_id, "published-reel-1");
  assert.equal(saved[3].published_at, "2026-10-28T15:00:00.000Z");
  assert.equal(saved[3].publish_state, "published");
});

test("Reel Story waits for published Reel and checkpoints Story IDs separately", async () => {
  const due = fixture({ publish_state: "processing", story_publish_state: "pending" });
  const blocked = repository(due);
  const blockedResult = await reelState.publishStoryStep({ repository: blocked.repo, graph: {}, now: Date.now() });
  assert.equal(blockedResult.status, "not_eligible");
  assert.equal(blocked.events.some(([name]) => name === "claim-story"), false);

  const eligible = fixture({ publish_state: "published", post_id: "reel-post", published_at: "2026-10-28T12:00:00Z", story_publish_state: "pending" });
  eligible.approval_fingerprint = await reelState.canonicalReelFingerprint(eligible);
  eligible.story_approval_fingerprint = await reelState.canonicalStoryFingerprint(eligible);
  const { repo, events } = repository(eligible);
  let calls = 0;
  const result = await reelState.publishStoryStep({ repository: repo, graph: {
    async createStory() { calls++; return { id: "story-container-1" }; },
  }, now: Date.now() });
  assert.equal(result.status, "pending");
  assert.equal(calls, 1);
  assert.ok(events.some(([name, , , patch]) => name === "checkpoint-story" && patch.story_container_id === "story-container-1"));
  assert.equal(events.some(([name, , , patch]) => name === "checkpoint-reel" && "post_id" in patch), false);
});

test("successful Story publish preserves the Reel receipt and writes an independent Story receipt", async () => {
  const row = fixture({ publish_state: "published", post_id: "reel-post", published_at: "2026-10-28T12:00:00Z",
    story_container_id: "story-container", story_container_status: "FINISHED" });
  row.approval_fingerprint = await reelState.canonicalReelFingerprint(row);
  row.story_approval_fingerprint = await reelState.canonicalStoryFingerprint(row);
  const { repo, events } = repository(row);
  let calls = 0;
  const result = await reelState.publishStoryStep({ repository: repo, graph: {
    async publishStory() { calls++; return { id: "story-post", timestamp: "2026-10-28T12:01:00Z" }; },
  }, now: Date.parse("2026-10-28T12:01:00Z") });
  const saved = events.find(([name]) => name === "checkpoint-story");
  assert.equal(result.status, "published");
  assert.equal(calls, 1);
  assert.equal(saved[3].story_post_id, "story-post");
  assert.equal(saved[3].story_published_at, "2026-10-28T12:01:00Z");
  assert.equal(saved[3].story_publish_state, "published");
  assert.equal(row.post_id, "reel-post");
  assert.equal(row.published_at, "2026-10-28T12:00:00Z");
});

test("migration protects Reel and Story approvals and exposes atomic BRT claims only to service_role", async () => {
  const sql = await readFile(path.join(root, "supabase/migrations/20261028160000_reel_publishing_state.sql"), "utf8");
  assert.match(sql, /approved_content_id/i);
  assert.match(sql, /story_approved_content_id/i);
  assert.match(sql, /claim_due_reel/i);
  assert.match(sql, /claim_due_reel_story/i);
  assert.match(sql, /America\/Sao_Paulo/i);
  assert.match(sql, /update\s+dmflow\.scheduled_reels/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /story_claim_token/i);
  assert.match(sql, /revoke all on function dmflow\.claim_due_reel/i);
  assert.match(sql, /grant execute on function dmflow\.claim_due_reel[^;]*service_role/i);
  assert.match(sql, /revoke all on function dmflow\.claim_due_reel_story/i);
  assert.match(sql, /grant execute on function dmflow\.claim_due_reel_story[^;]*service_role/i);
});

