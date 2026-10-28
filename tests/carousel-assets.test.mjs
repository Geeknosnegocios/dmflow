import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { verifyCarouselAsset } from "../supabase/functions/_shared/carousel-assets.ts";
import { publishCarouselStep } from "../supabase/functions/_shared/publishing-state.ts";

const storageUrl = "https://storage.example";
const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const pngHash = `sha256:${createHash("sha256").update(pngBytes).digest("hex")}`;
const urls = Array.from({ length: 8 }, (_, index) =>
  `${storageUrl}/storage/v1/object/public/dmflow-content/carrosseis/slide-${index + 1}.png`);

function imageResponse(bytes = pngBytes, { status = 200, type = "image/png", length } = {}) {
  const headers = { "content-type": type };
  if (length !== undefined) headers["content-length"] = String(length);
  return new Response(bytes, { status, headers });
}

test("verifies only the requested slide at the configured public carousel bucket", async () => {
  const requests = [];
  await verifyCarouselAsset({
    imageUrl: urls[4], slideHash: pngHash, storageUrl, requestTimeoutMs: 100,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return imageResponse();
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, urls[4]);
  assert.equal(requests[0].init.redirect, "manual");
  assert.ok(requests[0].init.signal instanceof AbortSignal);

  await assert.rejects(() => verifyCarouselAsset({
    imageUrl: "https://evil.example/storage/v1/object/public/dmflow-content/carrosseis/slide.png",
    slideHash: pngHash, storageUrl,
    fetchImpl: async () => { throw new Error("out-of-origin asset must be rejected before fetch"); },
  }), /approved public storage path/i);
});

test("rejects redirects, oversized bodies, non-PNG content, and mismatched approved hashes", async () => {
  const verify = (responseFactory) => verifyCarouselAsset({
    imageUrl: urls[0], slideHash: pngHash, storageUrl,
    fetchImpl: async () => responseFactory(),
  });

  await assert.rejects(() => verify(() => imageResponse(null, { status: 302 })), /redirected/i);
  await assert.rejects(() => verify(() => ({
    status: 200,
    ok: true,
    headers: new Headers({ "content-type": "image/png", "content-length": String(10 * 1024 * 1024 + 1) }),
    body: null,
  })), /size limit/i);
  await assert.rejects(() => verify(() => imageResponse(pngBytes, { type: "image/jpeg" })), /PNG/i);
  await assert.rejects(() => verifyCarouselAsset({
    imageUrl: urls[0], slideHash: "sha256:wrong", storageUrl,
    fetchImpl: async () => imageResponse(),
  }), /hash does not match/i);
});

test("stalled asset fetches time out before a Graph child create", async () => {
  const graphCalls = [];
  const row = {
    id: "queue-timeout", card_id: "CARD-TIMEOUT", account_id: "ACCOUNT-1", canal: "instagram",
    caption: "caption", image_urls: urls, slide_hashes: Array(8).fill(pngHash),
    status: "scheduled", publish_at: "2026-10-29T13:06:00.000Z", approval_fingerprint: "approved",
    child_containers: Array(8).fill(null), child_statuses: Array(8).fill("PENDING"),
    parent_container_id: null, parent_status: null, post_id: null, published_at: null, permalink: null,
  };
  let status = "scheduled";
  const repository = {
    async peekNextDue() { return status === "scheduled" ? structuredClone(row) : null; },
    async loadApproval() { return { fingerprint: "approved", revoked_at: null }; },
    async canonicalApprovalFingerprint() { return "approved"; },
    async claimByCard() { status = "processing"; return { row: structuredClone(row), claim_token: "claim-1" }; },
    async saveClaimed() { throw new Error("timed-out asset must not be checkpointed as safe"); },
    async needsReconciliation() { status = "needs_reconciliation"; },
  };
  const graph = {
    async validateAsset(candidate, index) {
      await verifyCarouselAsset({
        imageUrl: candidate.image_urls[index], slideHash: candidate.slide_hashes[index],
        storageUrl, requestTimeoutMs: 5,
        fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
          const keepEventLoopAlive = setTimeout(() => reject(new Error("test fetch should be aborted first")), 100);
          init.signal.addEventListener("abort", () => {
            clearTimeout(keepEventLoopAlive);
            reject(init.signal.reason);
          }, { once: true });
        }),
      });
    },
    async createChild() { graphCalls.push("createChild"); return { id: "child" }; },
    async getContainerStatus() { graphCalls.push("status"); return "FINISHED"; },
    async createParent() { graphCalls.push("createParent"); return { id: "parent" }; },
    async publish() { graphCalls.push("publish"); return { id: "post", timestamp: "2026-10-29T13:07:00Z" }; },
    async getPermalink() { graphCalls.push("permalink"); return "https://www.instagram.com/p/x/"; },
  };

  const result = await publishCarouselStep({ repository, graph, now: Date.parse("2026-10-29T13:07:00Z") });
  const retry = await publishCarouselStep({ repository, graph, now: Date.parse("2026-10-29T13:07:00Z") });
  assert.equal(result.status, "needs_reconciliation");
  assert.equal(retry.status, "not_claimed", "timed-out storage checks must not be retried automatically");
  assert.deepEqual(graphCalls, []);
});

test("validates the selected slide once before creating its matching child container", async () => {
  const row = {
    id: "queue-selected", card_id: "CARD-SELECTED", account_id: "ACCOUNT-1", canal: "instagram",
    caption: "caption", image_urls: urls, slide_hashes: Array(8).fill(pngHash),
    status: "scheduled", publish_at: "2026-10-29T13:06:00.000Z", approval_fingerprint: "approved",
    child_containers: ["child-1", null, null, null, null, null, null, null],
    child_statuses: Array(8).fill("PENDING"),
    parent_container_id: null, parent_status: null, post_id: null, published_at: null, permalink: null,
  };
  const assetRequests = [];
  const graphCalls = [];
  const repository = {
    async peekNextDue() { return structuredClone(row); },
    async loadApproval() { return { fingerprint: "approved", revoked_at: null }; },
    async canonicalApprovalFingerprint() { return "approved"; },
    async claimByCard() { return { row: structuredClone(row), claim_token: "claim-2" }; },
    async saveClaimed(_id, _token, patch) { Object.assign(row, patch); },
    async needsReconciliation() { throw new Error("valid selected slide should not reconcile"); },
  };
  const graph = {
    async validateAsset(candidate, index) {
      await verifyCarouselAsset({
        imageUrl: candidate.image_urls[index], slideHash: candidate.slide_hashes[index], storageUrl,
        fetchImpl: async (url) => { assetRequests.push(String(url)); return imageResponse(); },
      });
    },
    async createChild({ index }) { graphCalls.push(["createChild", index]); return { id: `child-${index + 1}` }; },
    async getContainerStatus() { graphCalls.push(["status"]); return "FINISHED"; },
    async createParent() { graphCalls.push(["parent"]); return { id: "parent" }; },
    async publish() { graphCalls.push(["publish"]); return { id: "post", timestamp: "2026-10-29T13:07:00Z" }; },
    async getPermalink() { graphCalls.push(["permalink"]); return "https://www.instagram.com/p/x/"; },
  };

  const result = await publishCarouselStep({ repository, graph, now: Date.parse("2026-10-29T13:07:00Z") });
  assert.equal(result.status, "scheduled");
  assert.deepEqual(assetRequests, [urls[1]], "only the next missing child's approved image is fetched");
  assert.deepEqual(graphCalls, [["createChild", 1]], "the asset is verified before its matching Graph create");
});
