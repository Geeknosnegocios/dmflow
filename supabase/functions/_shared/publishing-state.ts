type Carousel = {
  id: string;
  card_id: string;
  account_id: string;
  slide_hashes: string[];
  status: string;
  publish_at: string;
  image_urls?: string[];
  caption?: string;
  approval_fingerprint: string;
  child_containers: Array<string | null>;
  child_statuses: Array<string | null>;
  parent_container_id: string | null;
  parent_status: string | null;
  post_id: string | null;
  published_at: string | null;
  permalink: string | null;
};

type Claim = { row: Carousel; claim_token: string };
type Repository = {
  peekNextDue(now: number): Promise<Carousel | null>;
  loadApproval(cardId: string, accountId: string, contentType: "carousel", fingerprint: string): Promise<{ fingerprint: string; approved?: boolean; revoked_at: string | null } | null>;
  canonicalApprovalFingerprint(row: Carousel): Promise<string>;
  claimByCard(cardId: string, fingerprint: string, now: number): Promise<Claim | null>;
  saveClaimed(id: string, token: string, patch: Partial<Carousel> & Record<string, unknown>): Promise<void>;
  needsReconciliation(id: string, reason: string, token: string): Promise<void>;
};
type Graph = {
  validateAssets?(row: Carousel): Promise<void>;
  forCarousel?(row: Carousel): Promise<Graph>;
  createChild(input: { index: number; imageUrl?: string; caption?: string }): Promise<{ id: string }>;
  getContainerStatus(id: string): Promise<string>;
  createParent(input: { children: string[]; caption?: string }): Promise<{ id: string }>;
  publish(id: string): Promise<{ id: string; timestamp: string }>;
  getPermalink(id: string): Promise<string>;
};

const scheduled = (patch: Partial<Carousel> & Record<string, unknown>) => ({ status: "scheduled", ...patch });

export async function canonicalCarouselFingerprint({ account_id, card_id, caption, slide_hashes }: {
  account_id: string;
  card_id: string;
  caption: string;
  slide_hashes: string[];
}) {
  const canonical = JSON.stringify({
    content_type: "carousel",
    account_id,
    card_id,
    caption: caption.trim(),
    image_hashes: slide_hashes,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function externalStep<T>(
  repository: Repository,
  graphCall: () => Promise<T>,
  row: Carousel,
  token: string,
  checkpoint: (value: T) => Partial<Carousel> & Record<string, unknown>,
) {
  try {
    const value = await graphCall();
    const patch = scheduled(checkpoint(value));
    await repository.saveClaimed(row.id, token, patch);
    return { status: patch.status };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Uncertain Instagram Graph result";
    await repository.needsReconciliation(row.id, reason, token);
    return { status: "needs_reconciliation" };
  }
}

export async function publishCarouselStep({ repository, graph, now }: {
  repository: Repository;
  graph: Graph;
  now: number;
}) {
  const due = await repository.peekNextDue(now);
  if (!due) return { status: "not_claimed" };

  const approval = await repository.loadApproval(due.card_id, due.account_id, "carousel", due.approval_fingerprint);
  if (!approval || approval.approved === false || approval.revoked_at !== null) return { status: "rejected" };
  let currentFingerprint: string;
  try {
    currentFingerprint = await repository.canonicalApprovalFingerprint(due);
  } catch {
    return { status: "rejected" };
  }
  if (approval.fingerprint !== due.approval_fingerprint || currentFingerprint !== due.approval_fingerprint) {
    return { status: "rejected" };
  }

  const claim = await repository.claimByCard(due.card_id, due.approval_fingerprint, now);
  if (!claim) return { status: "not_claimed" };
  const { row, claim_token: token } = claim;
  if (row.child_containers.length !== 8 || row.child_statuses.length !== 8) {
    return reconcile(repository, row, token, "Carousel container checkpoints must contain eight entries");
  }
  let activeGraph: Graph;
  try {
    await graph.validateAssets?.(row);
    activeGraph = graph.forCarousel ? await graph.forCarousel(row) : graph;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Carousel validation failed";
    return reconcile(repository, row, token, reason);
  }

  const childIndex = row.child_containers.findIndex((id) => !id);
  if (childIndex >= 0) {
    return externalStep(repository, () => activeGraph.createChild({
      index: childIndex,
      imageUrl: row.image_urls?.[childIndex],
      caption: row.caption,
    }), row, token, (child) => {
      if (typeof child?.id !== "string" || !child.id.trim()) throw new Error("Instagram Graph returned no child container id");
      const children = [...row.child_containers];
      children[childIndex] = child.id;
      return { child_containers: children };
    });
  }

  const unfinishedChild = row.child_statuses.findIndex((status) => status !== "FINISHED");
  if (unfinishedChild >= 0) {
    const childId = row.child_containers[unfinishedChild];
    if (!childId) return reconcile(repository, row, token, "Child container checkpoint is incomplete");
    return externalStep(repository, () => activeGraph.getContainerStatus(childId), row, token, (status) => {
      const statuses = [...row.child_statuses];
      statuses[unfinishedChild] = validContainerStatus(status);
      return { child_statuses: statuses };
    });
  }

  const children = row.child_containers as string[];
  if (!row.parent_container_id) {
    return externalStep(repository, () => activeGraph.createParent({ children, caption: row.caption }), row, token, (parent) => {
      if (typeof parent?.id !== "string" || !parent.id.trim()) throw new Error("Instagram Graph returned no parent container id");
      return { parent_container_id: parent.id, parent_status: null };
    });
  }
  if (row.parent_status !== "FINISHED") {
    return externalStep(repository, () => activeGraph.getContainerStatus(row.parent_container_id!), row, token,
      (status) => ({ parent_status: validContainerStatus(status) }));
  }
  if (!row.post_id) {
    return externalStep(repository, () => activeGraph.publish(row.parent_container_id!), row, token, (receipt) => {
      if (typeof receipt?.id !== "string" || !receipt.id.trim()) throw new Error("Instagram Graph returned no published post id");
      const publishedAt = receipt.timestamp || new Date(now).toISOString();
      if (!Number.isFinite(Date.parse(publishedAt))) throw new Error("Instagram Graph returned an invalid publish timestamp");
      return { post_id: receipt.id, published_at: publishedAt };
    });
  }
  if (!row.permalink) {
    return externalStep(repository, () => activeGraph.getPermalink(row.post_id), row, token, (permalink) => {
      if (typeof permalink !== "string" || !permalink) return {};
      const url = new URL(permalink);
      if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname) ||
          url.search || url.hash) {
        throw new Error("Instagram Graph returned an invalid permalink");
      }
      return { permalink, status: "published" };
    });
  }

  await repository.saveClaimed(row.id, token, { status: "published" });
  return { status: "published" };
}

function validContainerStatus(status: unknown) {
  if (status === "FINISHED" || status === "IN_PROGRESS") return status;
  throw new Error("Instagram Graph returned terminal or unexpected container status");
}

function reconcile(repository: Repository, row: Carousel, token: string, reason: string) {
  return repository.needsReconciliation(row.id, reason, token).then(() => ({ status: "needs_reconciliation" }));
}
