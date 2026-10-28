type Carousel = {
  id: string;
  card_id?: string;
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
  loadApproval(cardId: string): Promise<{ fingerprint: string; approved?: boolean; revoked_at?: string | null } | null>;
  canonicalApprovalFingerprint(row: Carousel): Promise<string>;
  claimByCard(cardId: string, fingerprint: string, now: number): Promise<Claim | null>;
  saveClaimed(id: string, token: string, patch: Partial<Carousel> & Record<string, unknown>): Promise<void>;
  needsReconciliation(id: string, reason: string, token: string): Promise<void>;
};
type Graph = {
  forCarousel?(row: Carousel): Promise<Graph>;
  createChild(input: { index: number; imageUrl?: string; caption?: string }): Promise<{ id: string }>;
  getContainerStatus(id: string): Promise<string>;
  createParent(input: { children: string[]; caption?: string }): Promise<{ id: string }>;
  publish(id: string): Promise<{ id: string; timestamp: string }>;
  getPermalink(id: string): Promise<string>;
};

const scheduled = (patch: Partial<Carousel> & Record<string, unknown>) => ({ status: "scheduled", ...patch });

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

  const approval = await repository.loadApproval(due.id);
  const currentFingerprint = await repository.canonicalApprovalFingerprint(due);
  if (!approval || approval.approved === false || approval.revoked_at ||
      approval.fingerprint !== due.approval_fingerprint || currentFingerprint !== due.approval_fingerprint) {
    return { status: "rejected" };
  }

  const claim = await repository.claimByCard(due.card_id ?? due.id, due.approval_fingerprint, now);
  if (!claim) return { status: "not_claimed" };
  const { row, claim_token: token } = claim;
  let activeGraph: Graph;
  try {
    activeGraph = graph.forCarousel ? await graph.forCarousel(row) : graph;
  } catch {
    await repository.saveClaimed(row.id, token, { status: "scheduled" });
    return { status: "scheduled" };
  }

  const childIndex = row.child_containers.findIndex((id) => !id);
  if (childIndex >= 0) {
    return externalStep(repository, () => activeGraph.createChild({
      index: childIndex,
      imageUrl: row.image_urls?.[childIndex],
      caption: row.caption,
    }), row, token, (child) => {
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
      statuses[unfinishedChild] = status;
      return { child_statuses: statuses };
    });
  }

  const children = row.child_containers as string[];
  if (!row.parent_container_id) {
    return externalStep(repository, () => activeGraph.createParent({ children, caption: row.caption }), row, token, (parent) => ({
      parent_container_id: parent.id,
      parent_status: null,
    }));
  }
  if (row.parent_status !== "FINISHED") {
    return externalStep(repository, () => activeGraph.getContainerStatus(row.parent_container_id!), row, token,
      (status) => ({ parent_status: status }));
  }
  if (!row.post_id) {
    return externalStep(repository, () => activeGraph.publish(row.parent_container_id!), row, token, (receipt) => ({
      post_id: receipt.id,
      published_at: receipt.timestamp,
    }));
  }
  if (!row.permalink) {
    return externalStep(repository, () => activeGraph.getPermalink(row.post_id), row, token, (permalink) => ({
      permalink,
      status: "published",
    }));
  }

  await repository.saveClaimed(row.id, token, { status: "published" });
  return { status: "published" };
}

function reconcile(repository: Repository, row: Carousel, token: string, reason: string) {
  return repository.needsReconciliation(row.id, reason, token).then(() => ({ status: "needs_reconciliation" }));
}
