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
  metadata_status: string;
  metadata_claim_token: string | null;
  metadata_lease_until: string | null;
  metadata_error: string | null;
  provider_published_at: string | null;
  action_kind: string | null;
  action_started_at: string | null;
  story_action_kind: string | null;
  story_action_started_at: string | null;
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
  peekDueMetadata(now: number): Promise<ReelRow | null>;
  claimMetadata(id: string, now: number): Promise<{ row: ReelRow; claim_token: string } | null>;
  beginAction(id: string, lane: "reel" | "story" | "metadata", token: string, action: "create" | "poll" | "publish" | "lookup", now: number): Promise<boolean>;
  recoverExpired(now: number): Promise<unknown>;
  checkpointReel(id: string, token: string, patch: Record<string, unknown>): Promise<void>;
  checkpointStory(id: string, token: string, patch: Record<string, unknown>): Promise<void>;
  checkpointMetadata(id: string, token: string, patch: Record<string, unknown>): Promise<void>;
  reconcileReel(id: string, token: string, reason: string): Promise<void>;
  reconcileStory(id: string, token: string, reason: string): Promise<void>;
  retryReelPoll(id: string, token: string, reason: string): Promise<void>;
  retryStoryPoll(id: string, token: string, reason: string): Promise<void>;
  reconcileMetadata(id: string, token: string, reason: string): Promise<void>;
};

export type Graph = {
  validateReel?(row: ReelRow): Promise<void>;
  validateStory?(row: ReelRow): Promise<void>;
  createReel(row: ReelRow): Promise<{ id: string }>;
  getReelStatus(id: string): Promise<string>;
  publishReel(id: string): Promise<{ id: string }>;
  getReelMetadata(id: string): Promise<{ permalink?: string; timestamp?: string }>;
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

class TerminalContainerStateError extends Error {}

async function handleReelStep<T>(repository: Repository, row: ReelRow, token: string,
  action: "create" | "poll" | "publish", now: number, graphCall: () => Promise<T>,
  checkpoint: (result: T) => Record<string, unknown>) {
  if (!await repository.beginAction(row.id, "reel", token, action, now)) throw new Error("Reel claim ended before Graph phase checkpoint");
  try {
    const result = await graphCall();
    const patch: Record<string, unknown> = { claim_token: null, lease_until: null, action_kind: null, action_started_at: null, ...checkpoint(result) };
    await repository.checkpointReel(row.id, token, scheduled(patch));
    return { status: patch.publish_state === "published" ? "published" as const : "pending" as const };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Uncertain Meta Graph result";
    if (action === "poll" && !(error instanceof TerminalContainerStateError)) {
      await repository.retryReelPoll(row.id, token, reason);
      return { status: "pending" as const };
    }
    await repository.reconcileReel(row.id, token, reason);
    return { status: "needs_reconciliation" as const };
  }
}

async function handleStoryStep<T>(repository: Repository, row: ReelRow, token: string,
  action: "create" | "poll" | "publish", now: number, graphCall: () => Promise<T>,
  checkpoint: (result: T) => Record<string, unknown>) {
  if (!await repository.beginAction(row.id, "story", token, action, now)) throw new Error("Story claim ended before Graph phase checkpoint");
  try {
    const result = await graphCall();
    const patch = checkpoint(result);
    await repository.checkpointStory(row.id, token,
      { story_status: "pending", story_publish_state: "pending", story_claim_token: null, story_lease_until: null,
        story_action_kind: null, story_action_started_at: null, ...patch });
    return { status: patch.story_publish_state === "published" ? "published" as const : "pending" as const };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Uncertain Meta Graph result";
    if (action === "poll" && !(error instanceof TerminalContainerStateError)) {
      await repository.retryStoryPoll(row.id, token, reason);
      return { status: "pending" as const };
    }
    await repository.reconcileStory(row.id, token, reason);
    return { status: "needs_reconciliation" as const };
  }
}

function idFrom(result: { id?: unknown }, label: string) {
  if (typeof result?.id !== "string" || !result.id.trim()) throw new Error(`Meta returned no ${label} id`);
  return result.id;
}

function knownStatus(status: unknown) {
  if (status === "FINISHED" || status === "IN_PROGRESS") return status;
  throw new TerminalContainerStateError("Meta returned terminal or unexpected container state");
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
    return handleReelStep(repository, row, token, "create", now, () => graph.createReel(row), (container) => ({
      container_id: idFrom(container, "Reel container"), container_status: null,
    }));
  }
  if (row.container_status !== "FINISHED") {
    return handleReelStep(repository, row, token, "poll", now,
      async () => knownStatus(await graph.getReelStatus(row.container_id!)),
      (status) => ({ container_status: status }));
  }
  if (!row.post_id) {
    return handleReelStep(repository, row, token, "publish", now, () => graph.publishReel(row.container_id!), (receipt) => {
      const postId = idFrom(receipt, "published Reel");
      const publishedAt = new Date(now).toISOString();
      if (!Number.isFinite(Date.parse(publishedAt))) throw new Error("Meta returned invalid Reel publication time");
      return { post_id: postId, published_at: publishedAt, status: "published", publish_state: "published",
        metadata_status: "pending", metadata_error: null, metadata_claim_token: null, metadata_lease_until: null,
        metadata_action_started_at: null, provider_published_at: null, permalink: null,
        claim_token: null, lease_until: null, action_kind: null, action_started_at: null };
    });
  }
  await repository.checkpointReel(row.id, token, { status: "published", publish_state: "published", claim_token: null,
    lease_until: null, action_kind: null, action_started_at: null, metadata_status: row.metadata_status ?? "pending" });
  return { status: row.metadata_status === "published" ? "published" as const : "metadata_pending" as const };
}

function validReelPermalink(value: unknown) {
  if (typeof value !== "string") throw new Error("Meta returned no Reel permalink");
  const url = new URL(value);
  if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname) ||
      !/^\/(reel|p)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) || url.search || url.hash) {
    throw new Error("Meta returned an invalid Reel permalink");
  }
  return url.toString();
}

export async function publishReelMetadataStep({ repository, graph, now }: { repository: Repository; graph: Graph; now: number }) {
  const due = await repository.peekDueMetadata(now);
  if (!due || due.metadata_status !== "pending" || due.publish_state !== "published" || !due.post_id) {
    return { status: "not_claimed" as const };
  }
  const claim = await repository.claimMetadata(due.id, now);
  if (!claim) return { status: "not_claimed" as const };
  const { row, claim_token: token } = claim;
  if (row.id !== due.id || row.post_id !== due.post_id || !row.metadata_claim_token) {
    await repository.reconcileMetadata(row.id, token, "Claimed Reel receipt changed before metadata lookup");
    return { status: "needs_reconciliation" as const };
  }
  if (!await repository.beginAction(row.id, "metadata", token, "lookup", now)) {
    throw new Error("Reel metadata claim ended before Graph lookup checkpoint");
  }
  try {
    const metadata = await graph.getReelMetadata(row.post_id);
    const permalink = validReelPermalink(metadata.permalink);
    if (typeof metadata.timestamp !== "string" || !Number.isFinite(Date.parse(metadata.timestamp))) {
      throw new Error("Meta returned no valid provider Reel timestamp");
    }
    await repository.checkpointMetadata(row.id, token, {
      metadata_status: "published", permalink, provider_published_at: metadata.timestamp,
      metadata_error: null, metadata_claim_token: null, metadata_lease_until: null,
      metadata_action_started_at: null,
    });
    return { status: "published" as const };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Reel permalink lookup failed";
    await repository.reconcileMetadata(row.id, token, reason);
    return { status: "needs_reconciliation" as const };
  }
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
    return handleStoryStep(repository, row, token, "create", now, () => graph.createStory(row), (container) => ({
      story_container_id: idFrom(container, "Story container"), story_container_status: null,
    }));
  }
  if (row.story_container_status !== "FINISHED") {
    return handleStoryStep(repository, row, token, "poll", now,
      async () => knownStatus(await graph.getStoryStatus(row.story_container_id!)),
      (status) => ({ story_container_status: status }));
  }
  if (!row.story_post_id) {
    return handleStoryStep(repository, row, token, "publish", now, () => graph.publishStory(row.story_container_id!), (receipt) => {
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

