import assert from "node:assert/strict";
import test from "node:test";
import { createMetaGraphClient } from "../supabase/functions/_shared/meta-graph.ts";
import { canonicalCarouselFingerprint, publishCarouselStep } from "../supabase/functions/_shared/publishing-state.ts";

test("creates VIDEO children, waits until both finish, then creates only the parent", async () => {
  const item = "https://test.invalid/slide.mp4";
  const row = {
    id: "queue", card_id: "test-card", account_id: "test-account", caption: "test",
    image_urls: [item, item], media_types: ["VIDEO", "VIDEO"], slide_hashes: ["1", "2"],
    child_containers: [null, null], child_statuses: [null, null], parent_container_id: null,
  };
  row.approval_fingerprint = await canonicalCarouselFingerprint(row);
  assert.notEqual(row.approval_fingerprint, await canonicalCarouselFingerprint({ ...row, media_types: null }));
  const requests = [];
  let seq = 0;
  let firstPoll = true;
  const graph = createMetaGraphClient({
    graphVersion: "v25.0", accessToken: "test", instagramUserId: "42",
    async fetchImpl(url, init) {
      const fields = Object.fromEntries(init.body ?? []);
      requests.push({ path: new URL(url).pathname, fields });
      if (init.method !== "POST") {
        const status_code = firstPoll ? "IN_PROGRESS" : "FINISHED";
        firstPoll = false;
        return Response.json({ status_code });
      }
      return Response.json({ id: String(++seq) });
    },
  });
  const repository = {
    peekNextDue: async () => structuredClone(row),
    loadApproval: async () => ({ fingerprint: row.approval_fingerprint, revoked_at: null }),
    canonicalApprovalFingerprint: canonicalCarouselFingerprint,
    claimByCard: async () => ({ row: structuredClone(row), claim_token: "test" }),
    saveClaimed: async (_id, _token, patch) => Object.assign(row, patch),
    needsReconciliation: async (_id, reason) => assert.fail(reason),
  };
  for (let step = 0; step < 6; step += 1) await publishCarouselStep({ repository, graph, now: 0 });
  assert.deepEqual(requests.slice(0, 2).map(({ fields }) => fields), [
    { media_type: "VIDEO", video_url: item, is_carousel_item: "true" },
    { media_type: "VIDEO", video_url: item, is_carousel_item: "true" },
  ]);
  assert.deepEqual(row.child_statuses, ["FINISHED", "FINISHED"]);
  assert.equal(requests.at(-1).fields.children, "1,2");
  assert.equal(requests.at(-1).fields.media_type, "CAROUSEL");
  assert.ok(!requests.some(({ path }) => path.endsWith("media_publish")));
});
