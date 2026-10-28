import { canonicalCarouselFingerprint, publishCarouselStep } from "./publishing-state.ts";
import { verifyCarouselAsset } from "./carousel-assets.ts";

Deno.test("canonical carousel fingerprint uses trimmed caption and ordered approved hashes", async () => {
  const fingerprint = await canonicalCarouselFingerprint({
    account_id: "a",
    card_id: "CARD-1",
    caption: "  Hi  ",
    slide_hashes: ["sha256:x", "sha256:y"],
  });
  if (fingerprint !== "sha256:576a46d222786ced314f6c8131a4a84ac6ea8d48a2f7ada73db53149f9df86d7") {
    throw new Error(`Unexpected canonical fingerprint: ${fingerprint}`);
  }
});

Deno.test("approved carousel assets must be eight PNGs under the configured bucket and match hashes", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const imageUrls = Array.from({ length: 8 }, (_, index) =>
    `https://storage.example/storage/v1/object/public/dmflow-content/carrosseis/${index + 1}.png`);
  let fetches = 0;
  for (const imageUrl of imageUrls) await verifyCarouselAsset({
    storageUrl: "https://storage.example", imageUrl, slideHash: hash,
    fetchImpl: async (_url, init) => {
      fetches += 1;
      if (init?.redirect !== "manual") throw new Error("Asset fetch must not follow redirects");
      if (!(init?.signal instanceof AbortSignal)) throw new Error("Asset fetch must have a timeout signal");
      return new Response(bytes, { headers: { "content-type": "image/png" } });
    },
  });
  if (fetches !== 8) throw new Error(`Expected eight asset checks; got ${fetches}`);

  await verifyCarouselAsset({
    storageUrl: "https://storage.example", imageUrl: imageUrls[0], slideHash: "sha256:wrong",
    fetchImpl: async () => new Response(bytes, { headers: { "content-type": "image/png" } }),
  }).then(() => { throw new Error("Hash mismatch must fail validation"); }, () => undefined);
});

Deno.test("terminal child status transitions to reconciliation and does not retry Graph", async () => {
  const row = {
    id: "queue-1", card_id: "CARD-1", account_id: "account-1", slide_hashes: Array(8).fill("hash"),
    canal: "instagram", caption: "Deno test caption", image_urls: Array(8).fill("https://storage.example/slide.png"),
    status: "scheduled", publish_at: "2026-10-29T13:06:00.000Z", approval_fingerprint: "approved",
    child_containers: Array.from({ length: 8 }, (_, index) => `child-${index + 1}`),
    child_statuses: Array(8).fill("PENDING"),
    slide_container_ids: Array.from({ length: 8 }, (_, index) => `child-${index + 1}`),
    slide_statuses: Array(8).fill("PENDING"),
    parent_container_id: null, parent_status: null,
    post_id: null, published_at: null, permalink: null,
  };
  let claimed = false;
  let graphCalls = 0;
  let reconciliations = 0;
  const repository = {
    async peekNextDue() { return claimed ? null : row; },
    async loadApproval() { return { fingerprint: "approved", revoked_at: null }; },
    async canonicalApprovalFingerprint() { return "approved"; },
    async claimByCard() { claimed = true; return { row, claim_token: "token" }; },
    async saveClaimed() { throw new Error("ERROR status cannot be checkpointed as safe"); },
    async needsReconciliation() { reconciliations += 1; },
  };
  const graph = {
    async getContainerStatus() { graphCalls += 1; return "ERROR"; },
    async createChild() { graphCalls += 1; return { id: "child" }; },
    async createParent() { graphCalls += 1; return { id: "parent" }; },
    async publish() { graphCalls += 1; return { id: "post", timestamp: "2026-10-29T13:07:00.000Z" }; },
    async getPermalink() { graphCalls += 1; return "https://www.instagram.com/p/x/"; },
  };

  const first = await publishCarouselStep({ repository, graph, now: Date.parse("2026-10-29T13:07:00.000Z") });
  const second = await publishCarouselStep({ repository, graph, now: Date.parse("2026-10-29T13:07:00.000Z") });
  if (first.status !== "needs_reconciliation" || second.status !== "not_claimed") {
    throw new Error(`Expected reconciliation without retry; got ${first.status}, ${second.status}`);
  }
  if (graphCalls !== 1 || reconciliations !== 1) throw new Error("Terminal Graph status must be handled once");
});
