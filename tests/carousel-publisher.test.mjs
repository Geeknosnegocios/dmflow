import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import * as publishingState from "../supabase/functions/_shared/publishing-state.ts";

const { publishCarouselStep } = publishingState;
const canonicalCarouselFingerprint = (...args) => {
  assert.equal(typeof publishingState.canonicalCarouselFingerprint, "function",
    "publishing-state must export canonicalCarouselFingerprint");
  return publishingState.canonicalCarouselFingerprint(...args);
};

const SLIDE_HASHES = ["sha256:slide-one", "sha256:slide-two", "sha256:slide-three", "sha256:slide-four", "sha256:slide-five", "sha256:slide-six", "sha256:slide-seven", "sha256:slide-eight"];
const EXPECTED_CANONICAL = JSON.stringify({
  content_type: "carousel",
  account_id: "account-7",
  card_id: "ANDREY-W44-2026-C01",
  caption: "Approved caption",
  image_hashes: SLIDE_HASHES,
});
const APPROVED = `sha256:${createHash("sha256").update(EXPECTED_CANONICAL).digest("hex")}`;

function fixture(overrides = {}) {
  const row = {
    id: "card-1",
    card_id: "ANDREY-W44-2026-C01",
    account_id: "account-7",
    caption: "Approved caption",
    content_type: "carousel",
    slide_hashes: SLIDE_HASHES,
    status: "scheduled",
    publish_at: "2026-10-29T13:06:00.000Z",
    approval_fingerprint: APPROVED,
    child_containers: Array(8).fill(null),
    child_statuses: Array(8).fill(null),
    parent_container_id: null,
    parent_status: null,
    post_id: null,
    published_at: null,
    permalink: null,
  };
  const calls = [];
  let claimSequence = 0;
  let activeClaimToken = null;
  const repository = {
    async peekNextDue(now) {
      calls.push("peek");
      if (now < Date.parse(row.publish_at) || row.status !== "scheduled") return null;
      return structuredClone(row);
    },
    async loadApproval(cardId, accountId, contentType) {
      assert.equal(cardId, row.card_id, "approval registry key must be the editorial card_id, not queue UUID");
      assert.equal(accountId, row.account_id, "approval lookup must be scoped to the Instagram account");
      assert.equal(contentType, "carousel");
      calls.push("approval");
      return { fingerprint: APPROVED, approved: true, revoked_at: null };
    },
    async canonicalApprovalFingerprint(candidate) {
      assert.equal(candidate.id, row.id);
      calls.push("fingerprint");
      return canonicalCarouselFingerprint({
        account_id: candidate.account_id,
        card_id: candidate.card_id,
        caption: candidate.caption,
        slide_hashes: candidate.slide_hashes,
      });
    },
    async claimByCard(cardId, fingerprint, now) {
      calls.push("claim");
      assert.equal(cardId, row.card_id);
      assert.equal(fingerprint, APPROVED);
      if (now < Date.parse(row.publish_at) || row.status !== "scheduled") return null;
      claimSequence += 1;
      row.status = "processing";
      activeClaimToken = `claim-${claimSequence}`;
      return { row: structuredClone(row), claim_token: activeClaimToken };
    },
    async saveClaimed(id, claimToken, patch) {
      assert.equal(id, row.id);
      assert.equal(claimToken, activeClaimToken, "every checkpoint must be guarded by the token returned from the current atomic claim");
      calls.push(["save", structuredClone(patch)]);
      Object.assign(row, structuredClone(patch));
      if (patch.status === "scheduled" || patch.status === "published") activeClaimToken = null;
    },
    async needsReconciliation(id, reason, claimToken) {
      assert.equal(id, row.id);
      assert.equal(claimToken, activeClaimToken, "reconciliation transitions must be guarded by the current claim token");
      calls.push(["reconciliation", reason]);
      row.status = "needs_reconciliation";
      activeClaimToken = null;
    },
    row,
  };
  const graph = {
    async createChild({ index }) {
      calls.push(["createChild", index]);
      return { id: `child-${index + 1}` };
    },
    async getContainerStatus(id) {
      calls.push(["status", id]);
      return "FINISHED";
    },
    async createParent({ children }) {
      calls.push(["createParent", [...children]]);
      return { id: "parent-1" };
    },
    async publish(id) {
      calls.push(["publish", id]);
      return { id: "post-1", timestamp: "2026-10-29T13:06:11.000Z" };
    },
    async getPermalink(id) {
      calls.push(["permalink", id]);
      return "https://www.instagram.com/p/post-1/";
    },
  };
  Object.assign(repository, overrides.repository);
  Object.assign(graph, overrides.graph);
  if (overrides.currentFingerprint !== undefined) {
    repository.canonicalApprovalFingerprint = async () => {
      calls.push("fingerprint");
      return overrides.currentFingerprint;
    };
  }
  if (overrides.approval !== undefined) {
    repository.loadApproval = async () => {
      calls.push("approval");
      return overrides.approval;
    };
  }
  return { row, calls, repository, graph };
}

async function invokeUntilTerminal(f) {
  let result;
  for (let i = 0; i < 60; i += 1) {
    result = await publishCarouselStep({
      repository: f.repository,
      graph: f.graph,
      now: Date.parse("2026-10-29T13:07:00.000Z"),
    });
    if (["published", "needs_reconciliation", "not_claimed", "rejected"].includes(result?.status)) return result;
  }
  assert.fail("publisher did not reach a terminal state within its bounded lifecycle steps");
}

test("canonical fingerprint hashes normalized caption and ordered slide hashes in the approved field order", async () => {
  const fingerprint = await canonicalCarouselFingerprint({
    account_id: "account-7",
    card_id: "ANDREY-W44-2026-C01",
    caption: "  Approved caption  ",
    slide_hashes: SLIDE_HASHES,
  });

  assert.equal(fingerprint, APPROVED);
});

test("rejects a changed canonical approval fingerprint before claim or Graph calls", async () => {
  const f = fixture({ currentFingerprint: "sha256:tampered-caption-or-slide" });

  const result = await publishCarouselStep({
    repository: f.repository, graph: f.graph,
    now: Date.parse("2026-10-29T13:07:00.000Z"),
  });

  assert.equal(result.status, "rejected");
  assert.deepEqual(f.calls, ["peek", "approval", "fingerprint"],
    "approval mismatch must be rejected before claim and Graph calls");
  assert.equal(f.calls.filter((call) => Array.isArray(call) && ["createChild", "status", "createParent", "publish", "permalink"].includes(call[0])).length, 0);
  assert.equal(f.row.status, "scheduled");
});

test("rejects a revoked or missing immutable approval before claim or Graph calls", async () => {
  const f = fixture({ approval: { fingerprint: APPROVED, approved: false, revoked_at: "2026-10-28T12:00:00Z" } });

  const result = await publishCarouselStep({
    repository: f.repository, graph: f.graph,
    now: Date.parse("2026-10-29T13:07:00.000Z"),
  });

  assert.equal(result.status, "rejected");
  assert.equal(f.calls.includes("claim"), false);
  assert.equal(f.calls.filter((call) => Array.isArray(call) && ["createChild", "status", "createParent", "publish", "permalink"].includes(call[0])).length, 0);
});

test("rejects blank or missing captions before claim and Graph calls", async () => {
  for (const caption of ["", "   ", undefined]) {
    const f = fixture();
    if (caption === undefined) delete f.row.caption;
    else f.row.caption = caption;

    const result = await publishCarouselStep({
      repository: f.repository, graph: f.graph,
      now: Date.parse("2026-10-29T13:07:00.000Z"),
    });

    assert.equal(result.status, "rejected", `caption ${String(caption)} must be rejected`);
    assert.equal(f.calls.includes("claim"), false, "invalid copy must be rejected before claim");
    assert.equal(f.calls.some((call) => Array.isArray(call) && ["createChild", "status", "createParent", "publish", "permalink"].includes(call[0])), false);
  }
});

test("revalidates claimed row contents and stops if they changed after the approved preflight snapshot", async () => {
  const f = fixture();
  const claimByCard = f.repository.claimByCard;
  f.repository.claimByCard = async (...args) => {
    const claim = await claimByCard(...args);
    return { ...claim, row: { ...claim.row, caption: "Changed after preflight" } };
  };

  const result = await publishCarouselStep({
    repository: f.repository, graph: f.graph,
    now: Date.parse("2026-10-29T13:07:00.000Z"),
  });

  assert.equal(result.status, "needs_reconciliation");
  assert.equal(f.calls.some((call) => Array.isArray(call) && ["createChild", "status", "createParent", "publish", "permalink"].includes(call[0])), false,
    "changed claimed content must never reach Graph");
  assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === "reconciliation").length, 1);
});

test("a fresh scheduled row with eight PENDING checkpoints starts child creation, not reconciliation", async () => {
  const f = fixture();
  f.row.child_containers = Array(8).fill(null);
  f.row.child_statuses = Array(8).fill("PENDING");

  const result = await publishCarouselStep({
    repository: f.repository, graph: f.graph,
    now: Date.parse("2026-10-29T13:07:00.000Z"),
  });

  assert.equal(result.status, "scheduled");
  assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === "createChild").length, 1);
  assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === "reconciliation").length, 0);
});

test("claims each bounded invocation and persists one child before scheduling the next step", async () => {
  const f = fixture();
  const result = await invokeUntilTerminal(f);

  assert.equal(result.status, "published");
  assert.ok(f.calls.filter((call) => call === "claim").length > 8,
    "each bounded lifecycle step must receive its own atomic queue claim");
  const externalStep = (call) => Array.isArray(call) &&
    ["createChild", "status", "createParent", "publish", "permalink"].includes(call[0]);
  const claimIndexes = f.calls.flatMap((call, index) => call === "claim" ? [index] : []);
  for (let index = 0; index < claimIndexes.length; index += 1) {
    const start = claimIndexes[index];
    const end = claimIndexes[index + 1] ?? f.calls.length;
    const steps = f.calls.slice(start + 1, end).filter(externalStep);
    assert.ok(steps.length <= 1, "a claim may perform at most one external lifecycle operation");
    if (steps.length === 1 && index + 1 < claimIndexes.length) {
      const saveAt = f.calls.findIndex((call, position) => position > start && position < end &&
        Array.isArray(call) && call[0] === "save" && call[1].status === "scheduled");
      assert.ok(saveAt > start, "safe external outcomes must persist a scheduled checkpoint before the next invocation claims");
    }
  }
  const childCreates = f.calls.filter((call) => Array.isArray(call) && call[0] === "createChild");
  assert.deepEqual(childCreates.map((call) => call[1]), [0, 1, 2, 3, 4, 5, 6, 7]);
  for (let index = 0; index < 8; index += 1) {
    const createAt = f.calls.findIndex((call) => Array.isArray(call) && call[0] === "createChild" && call[1] === index);
    const childId = `child-${index + 1}`;
    const persistedAt = f.calls.findIndex((call) => Array.isArray(call) && call[0] === "save" &&
      call[1].child_containers?.[index] === childId);
    const nextCreateAt = f.calls.findIndex((call) => Array.isArray(call) && call[0] === "createChild" && call[1] === index + 1);
    assert.ok(persistedAt > createAt, `child ${index + 1} id must be saved after creation`);
    if (index < 7) assert.ok(nextCreateAt > persistedAt, `child ${index + 2} must wait for child ${index + 1} persistence`);
  }
  const parentAt = f.calls.findIndex((call) => Array.isArray(call) && call[0] === "createParent");
  const eighthFinishedAt = f.calls.findIndex((call) => Array.isArray(call) && call[0] === "save" &&
    call[1].child_statuses?.length === 8 && call[1].child_statuses.every((status) => status === "FINISHED"));
  assert.ok(eighthFinishedAt >= 0 && parentAt > eighthFinishedAt,
    "parent creation must wait until all eight persisted child statuses are FINISHED");
  assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === "publish").length, 1);
  assert.equal(f.row.status, "published");
});

test("resumes scheduled rows with persisted finished children without recreating their containers", async () => {
  const f = fixture();
  f.row.child_containers = ["child-1", "child-2", null, null, null, null, null, null];
  f.row.child_statuses = ["FINISHED", "FINISHED", null, null, null, null, null, null];

  const result = await invokeUntilTerminal(f);

  assert.equal(result.status, "published");
  assert.deepEqual(
    f.calls.filter((call) => Array.isArray(call) && call[0] === "createChild").map((call) => call[1]),
    [2, 3, 4, 5, 6, 7],
  );
});

test("does not automatically reclaim a row left processing after an interrupted invocation", async () => {
  const f = fixture();
  f.row.status = "processing";

  const result = await publishCarouselStep({
    repository: f.repository, graph: f.graph,
    now: Date.parse("2026-10-29T13:07:00.000Z"),
  });

  assert.equal(result.status, "not_claimed");
  assert.equal(f.calls.filter((call) => Array.isArray(call) && ["createChild", "createParent", "publish"].includes(call[0])).length, 0);
});

test("persists and polls the parent before publishing, then saves the receipt before permalink lookup", async () => {
  const f = fixture();
  await invokeUntilTerminal(f);

  const parentCreatedAt = f.calls.findIndex((call) => Array.isArray(call) && call[0] === "createParent");
  const parentSavedAt = f.calls.findIndex((call) => Array.isArray(call) && call[0] === "save" && call[1].parent_container_id === "parent-1");
  const parentPolledAt = f.calls.findIndex((call) => Array.isArray(call) && call[0] === "status" && call[1] === "parent-1");
  const parentFinishedSavedAt = f.calls.findIndex((call) => Array.isArray(call) && call[0] === "save" && call[1].parent_status === "FINISHED");
  const publishAt = f.calls.findIndex((call) => Array.isArray(call) && call[0] === "publish");
  const receiptSavedAt = f.calls.findIndex((call) => Array.isArray(call) && call[0] === "save" &&
    call[1].post_id === "post-1" && call[1].published_at);
  const permalinkAt = f.calls.findIndex((call) => Array.isArray(call) && call[0] === "permalink");

  assert.ok(parentSavedAt > parentCreatedAt);
  assert.ok(parentPolledAt > parentSavedAt && parentFinishedSavedAt > parentPolledAt && publishAt > parentFinishedSavedAt,
    "parent FINISHED must be checkpointed before a later invocation publishes it");
  assert.ok(receiptSavedAt > publishAt && permalinkAt > receiptSavedAt,
    "durable post id and timestamp must be saved before permalink finalization");
  assert.equal(f.row.permalink, "https://www.instagram.com/p/post-1/");
});

test("moves uncertain external acceptance to reconciliation and never retries publish", async () => {
  const f = fixture({ graph: { async publish(id) {
    f.calls.push(["publish", id]);
    throw Object.assign(new Error("request timed out after possible acceptance"), { uncertain: true });
  } } });

  const result = await invokeUntilTerminal(f);

  assert.equal(result.status, "needs_reconciliation");
  assert.equal(f.row.status, "needs_reconciliation");
  assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === "publish").length, 1);
  assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === "reconciliation").length, 1);
});

test("moves uncertain child creation to reconciliation and never retries the create", async () => {
  const f = fixture({ graph: { async createChild({ index }) {
    f.calls.push(["createChild", index]);
    throw Object.assign(new Error("request timed out after possible child acceptance"), { uncertain: true });
  } } });

  const result = await publishCarouselStep({
    repository: f.repository, graph: f.graph,
    now: Date.parse("2026-10-29T13:07:00.000Z"),
  });
  const retry = await publishCarouselStep({
    repository: f.repository, graph: f.graph,
    now: Date.parse("2026-10-29T13:07:00.000Z"),
  });

  assert.equal(result.status, "needs_reconciliation");
  assert.equal(retry.status, "not_claimed");
  assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === "createChild").length, 1);
});

test("ERROR, EXPIRED, and unknown child statuses stop for reconciliation without polling again", async () => {
  for (const status of ["ERROR", "EXPIRED", ""]) {
    const f = fixture({ graph: { async getContainerStatus(id) {
      f.calls.push(["status", id]);
      return status;
    } } });
    f.row.child_containers = Array.from({ length: 8 }, (_, index) => `child-${index + 1}`);
    f.row.child_statuses = Array(8).fill(null);

    const first = await publishCarouselStep({
      repository: f.repository, graph: f.graph,
      now: Date.parse("2026-10-29T13:07:00.000Z"),
    });
    const second = await publishCarouselStep({
      repository: f.repository, graph: f.graph,
      now: Date.parse("2026-10-29T13:07:00.000Z"),
    });

    assert.equal(first.status, "needs_reconciliation", `child status ${status} is not publishable`);
    assert.equal(second.status, "not_claimed", "reconciled rows must not be automatically retried");
    assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === "status").length, 1);
    assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === "reconciliation").length, 1);
  }
});

test("missing child or parent container ids stop for reconciliation without retry", async () => {
  const child = fixture({ graph: { async createChild() {
    child.calls.push(["createChild", 0]);
    return {};
  } } });
  const childResult = await publishCarouselStep({
    repository: child.repository, graph: child.graph,
    now: Date.parse("2026-10-29T13:07:00.000Z"),
  });
  assert.equal(childResult.status, "needs_reconciliation");
  assert.equal(child.calls.filter((call) => Array.isArray(call) && call[0] === "createChild").length, 1);

  const parent = fixture({ graph: { async createParent() {
    parent.calls.push(["createParent", []]);
    return { id: "" };
  } } });
  parent.row.child_containers = Array.from({ length: 8 }, (_, index) => `child-${index + 1}`);
  parent.row.child_statuses = Array(8).fill("FINISHED");
  const parentResult = await publishCarouselStep({
    repository: parent.repository, graph: parent.graph,
    now: Date.parse("2026-10-29T13:07:00.000Z"),
  });
  assert.equal(parentResult.status, "needs_reconciliation");
  assert.equal(parent.calls.filter((call) => Array.isArray(call) && call[0] === "createParent").length, 1);
});
