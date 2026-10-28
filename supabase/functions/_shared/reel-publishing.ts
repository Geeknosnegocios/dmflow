export type ReelRow = {
  id: string;
  slug: string;
  idx: number;
  account_id: string;
  canal: string;
  video_url: string;
  video_sha256: string;
  cover_url: string;
  cover_sha256: string;
  story_url: string | null;
  story_sha256: string | null;
  caption: string;
  scheduled_unix: number;
  status: string;
  publish_state: string;
  story_publish_state: string | null;
  approval_fingerprint: string;
  story_approval_fingerprint: string | null;
  container_id: string | null;
  container_status: string | null;
  post_id: string | null;
  published_at: string | null;
  permalink: string | null;
  story_container_id: string | null;
  story_container_status: string | null;
  story_post_id: string | null;
  story_published_at: string | null;
  story_permalink: string | null;
  publish_claimed_at?: string | null;
  story_claimed_at?: string | null;
  [key: string]: unknown;
};

type Claim = { row: ReelRow; claim_token: string };
type Approval = { fingerprint: string; revoked_at: string | null; approved?: boolean } | null;
type Repository = {
  peekDueReel(now: number): Promise<ReelRow | null>;
  peekDueStory(now: number): Promise<ReelRow | null>;
  loadApproval(contentType: "reel" | "reel_story", contentId: string, accountId: string, fingerprint: string): Promise<Approval>;
  claimReel(id: string, fingerprint: string, now: number): Promise<Claim | null>;
  claimStory(id: string, fingerprint: string, now: number): Promise<Claim | null>;
  checkpointReel(id: string, token: string, patch: Record<string, unknown>): Promise<void>;
  checkpointStory(id: string, token: string, patch: Record<string, unknown>): Promise<void>;
  reconcileReel(id: string, token: string, reason: string): Promise<void>;
  reconcileStory(id: string, token: string, reason: string): Promise<void>;
};

type Graph = {
  validateReel?(row: ReelRow): Promise<void>;
  validateStory?(row: ReelRow): Promise<void>;
  createReel(row: ReelRow): Promise<{ id: string }>;
  getReelStatus(id: string): Promise<string>;
  publishReel(id: string): Promise<{ id: string; timestamp?: string }>;
  createStory(row: ReelRow): Promise<{ id: string }>;
  getStoryStatus(id: string): Promise<string>;
  publishStory(id: string): Promise<{ id: string; timestamp?: string }>;
};

export async function canonicalReelFingerprint(row: ReelRow) {
  return fingerprint({
    content_type: "reel",
    account_id: row.account_id,
    source_slug: row.slug,
    source_index: row.idx,
    video_sha256: normalizedHash(row.video_sha256),
    cover_sha256: normalizedHash(row.cover_sha256),
    caption: row.caption.trim(),
    scheduled_unix: Number(row.scheduled_unix),
    channel: row.canal,
  });
}

export async function canonicalStoryFingerprint(row: ReelRow) {
  if (!row.approval_fingerprint) throw new Error("Associated Reel approval fingerprint is missing");
  return fingerprint({
    content_type: "reel_story",
    account_id: row.account_id,
    source_slug: row.slug,
    source_index: row.idx,
    story_sha256: normalizedHash(row.story_sha256 ?? ""),
    associated_reel_approval: row.approval_fingerprint,
    scheduled_unix: Number(row.scheduled_unix),
    channel: row.canal,
  });
}

async function fingerprint(value: Record<string, unknown>) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function normalizedHash(value: string) {
  if (!/^sha256:[0-9a-f]{64}$/i.test(value)) throw new Error("Approved media SHA-256 is malformed");
  return value.toLowerCase();
}

const reelContentId = (row: ReelRow) => `${row.slug}:${row.idx}`;
const scheduled = (patch: Record<string, unknown>) => ({ status: "pending", publish_state: "pending", ...patch });

async function validApproval(repository: Repository, row: ReelRow, contentType: "reel" | "reel_story") {
  const fingerprint = contentType === "reel"
    ? await canonicalReelFingerprint(row)
    : await canonicalStoryFingerprint(row);
  const stored = contentType === "reel" ? row.approval_fingerprint : row.story_approval_fingerprint;
  if (!stored || stored !== fingerprint) return false;
  const approval = await repository.loadApproval(contentType, reelContentId(row), row.account_id, stored);
  return Boolean(approval && approval.approved !== false && approval.revoked_at === null && approval.fingerprint === stored);
}

async function claimApproved(repository: Repository, due: ReelRow, contentType: "reel" | "reel_story", now: number) {
  if (due.canal !== "GI" && due.canal !== "GN") return null;
  if (!due.account_id || !await validApproval(repository, due, contentType)) return null;
  const fingerprint = contentType === "reel" ? due.approval_fingerprint : due.story_approval_fingerprint!;
  const claim = contentType === "reel"
    ? await repository.claimReel(due.id, fingerprint, now)
    : await repository.claimStory(due.id, fingerprint, now);
  if (!claim) return null;
  const { row, claim_token } = claim;
  if (row.id !== due.id || row.account_id !== due.account_id || row.slug !== due.slug || row.idx !== due.idx) {
    return { row, claim_token, invalid: true };
  }
  try {
    if (!await validApproval(repository, row, contentType)) return { row, claim_token, invalid: true };
  } catch {
    return { row, claim_token, invalid: true };
  }
  return { row, claim_token, invalid: false };
}

async function handleStep<T>(repository: Repository, id: string, token: string, graphCall: () => Promise<T>, checkpoint: (result: T) => Record<string, unknown>, reconcile: (id: string, token: string, reason: string) => Promise<void>) {
  try {
    const result = await graphCall();
    const patch = { claim_token: null, lease_until: null, ...checkpoint(result) };
    await repository.checkpointReel(id, token, scheduled(patch));
    return { status: patch.publish_state === "published" ? "published" as const : "pending" as const };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Uncertain Meta Graph result";
    await reconcile(id, token, reason);
    return { status: "needs_reconciliation" as const };
  }
}

async function handleStoryStep<T>(repository: Repository, id: string, token: string, graphCall: () => Promise<T>, checkpoint: (result: T) => Record<string, unknown>) {
  try {
    const result = await graphCall();
    const patch = checkpoint(result);
    await repository.checkpointStory(id, token,
      { story_publish_state: "pending", story_claim_token: null, story_lease_until: null, ...patch });
    return { status: patch.story_publish_state === "published" ? "published" as const : "pending" as const };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Uncertain Meta Graph result";
    await repository.reconcileStory(id, token, reason);
    return { status: "needs_reconciliation" as const };
  }
}

function idFrom(result: { id?: unknown }, label: string) {
  if (typeof result?.id !== "string" || !result.id.trim()) throw new Error(`Meta returned no ${label} id`);
  return result.id;
}

function knownStatus(status: unknown) {
  if (status === "FINISHED" || status === "IN_PROGRESS") return status;
  throw new Error("Meta returned terminal or unexpected container state");
}

function reconcileItem(repository: Repository, row: ReelRow, token: string, reason: string) {
  return repository.reconcileReel(row.id, token, reason).then(() => ({ status: "needs_reconciliation" as const }));
}

export async function publishReelStep({ repository, graph, now }: { repository: Repository; graph: Graph; now: number }) {
  const due = await repository.peekDueReel(now);
  if (!due) return { status: "not_claimed" as const };
  if (due.publish_state !== "pending") return { status: "rejected" as const };
  const claim = await claimApproved(repository, due, "reel", now);
  if (!claim) return { status: "rejected" as const };
  const { row, claim_token: token } = claim;
  if (claim.invalid) return reconcileItem(repository, row, token, "Claimed Reel differs from its approved package");

  if (!row.container_id) {
    try {
      await graph.validateReel?.(row);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Reel media validation failed";
      return reconcileItem(repository, row, token, reason);
    }
    try {
      if (!await validApproval(repository, row, "reel")) {
        return reconcileItem(repository, row, token, "Reel approval was revoked or changed before media creation");
      }
    } catch {
      return reconcileItem(repository, row, token, "Reel approval could not be rechecked before media creation");
    }
    return handleStep(repository, row.id, token, () => graph.createReel(row), (container) => ({
      container_id: idFrom(container, "Reel container"), container_status: null,
    }), repository.reconcileReel.bind(repository));
  }
  if (row.container_status !== "FINISHED") {
    return handleStep(repository, row.id, token, async () => knownStatus(await graph.getReelStatus(row.container_id!)),
      (status) => ({ container_status: status }), repository.reconcileReel.bind(repository));
  }
  if (!row.post_id) {
    return handleStep(repository, row.id, token, () => graph.publishReel(row.container_id!), (receipt) => {
      const postId = idFrom(receipt, "published Reel");
      const publishedAt = receipt.timestamp ?? new Date(now).toISOString();
      if (!Number.isFinite(Date.parse(publishedAt))) throw new Error("Meta returned invalid Reel publication time");
      return { post_id: postId, published_at: publishedAt, status: "published", publish_state: "published",
        claim_token: null, lease_until: null };
    }, repository.reconcileReel.bind(repository));
  }
  await repository.checkpointReel(row.id, token, { status: "published", publish_state: "published", claim_token: null, lease_until: null });
  return { status: "published" as const };
}

export async function publishStoryStep({ repository, graph, now }: { repository: Repository; graph: Graph; now: number }) {
  const due = await repository.peekDueStory(now);
  if (!due) return { status: "not_claimed" as const };
  if (due.publish_state !== "published" || !due.post_id || due.story_publish_state !== "pending" || !due.story_url) {
    return { status: "not_eligible" as const };
  }
  const claim = await claimApproved(repository, due, "reel_story", now);
  if (!claim) return { status: "rejected" as const };
  const { row, claim_token: token } = claim;
  if (claim.invalid) {
    await repository.reconcileStory(row.id, token, "Claimed Reel Story differs from its approved package");
    return { status: "needs_reconciliation" as const };
  }

  if (!row.story_container_id) {
    try {
      await graph.validateStory?.(row);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Story media validation failed";
      await repository.reconcileStory(row.id, token, reason);
      return { status: "needs_reconciliation" as const };
    }
    try {
      if (!await validApproval(repository, row, "reel_story")) {
        await repository.reconcileStory(row.id, token, "Story approval was revoked or changed before media creation");
        return { status: "needs_reconciliation" as const };
      }
    } catch {
      await repository.reconcileStory(row.id, token, "Story approval could not be rechecked before media creation");
      return { status: "needs_reconciliation" as const };
    }
    return handleStoryStep(repository, row.id, token, () => graph.createStory(row), (container) => ({
      story_container_id: idFrom(container, "Story container"), story_container_status: null,
    }));
  }
  if (row.story_container_status !== "FINISHED") {
    return handleStoryStep(repository, row.id, token,
      async () => knownStatus(await graph.getStoryStatus(row.story_container_id!)),
      (status) => ({ story_container_status: status }));
  }
  if (!row.story_post_id) {
    return handleStoryStep(repository, row.id, token, () => graph.publishStory(row.story_container_id!), (receipt) => {
      const postId = idFrom(receipt, "published Reel Story");
      const publishedAt = receipt.timestamp ?? new Date(now).toISOString();
      if (!Number.isFinite(Date.parse(publishedAt))) throw new Error("Meta returned invalid Story publication time");
      return { story_post_id: postId, story_published_at: publishedAt, story_status: "published",
        story_publish_state: "published", story_claim_token: null, story_lease_until: null };
    });
  }
  await repository.checkpointStory(row.id, token, { story_publish_state: "published", story_claim_token: null, story_lease_until: null });
  return { status: "published" as const };
}

