import { createClient } from "@supabase/supabase-js";
import { verifyCarouselAsset } from "../_shared/carousel-assets.ts";
import { canonicalCarouselFingerprint, publishCarouselStep } from "../_shared/publishing-state.ts";
import { assertAuthorizedInstagramAccount, createMetaGraphClient, resolveInstagramIdentity } from "../_shared/meta-graph.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const supabaseUrl = env("SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const graphVersion = env("META_GRAPH_VERSION") || "v22.0";

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!supabaseUrl || !serviceKey) return new Response("Publishing service is not configured", { status: 503 });

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const repository = {
    async peekNextDue(now: number) {
      const { data, error } = await supabase.schema("dmflow").from("scheduled_carousels")
        .select("*").eq("status", "scheduled").lte("publish_at", new Date(now).toISOString())
        .order("publish_at").limit(1).maybeSingle();
      if (error) throw error;
      return data ? normalize(data) : null;
    },
    async loadApproval(cardId: string, accountId: string, contentType: "carousel", fingerprint: string) {
      const { data, error } = await supabase.schema("dmflow").from("approved_content")
        .select("fingerprint,revoked_at").eq("content_id", cardId).eq("account_id", accountId)
        .eq("content_type", contentType).eq("fingerprint", fingerprint).is("revoked_at", null).maybeSingle();
      if (error) throw error;
      return data ? { ...data, approved: true } : null;
    },
    async canonicalApprovalFingerprint(row: CarouselRow) {
      return canonicalCarouselFingerprint(row);
    },
    async claimByCard(cardId: string, fingerprint: string, now: number) {
      const { data, error } = await supabase.schema("dmflow").rpc("claim_carousel_by_card", {
        p_card_id: cardId,
        p_fingerprint: fingerprint,
        p_now: new Date(now).toISOString(),
      }).maybeSingle();
      if (error) throw error;
      const claimed = data as (CarouselRow & { claim_token?: string }) | null;
      return claimed?.claim_token ? { row: normalize(claimed), claim_token: claimed.claim_token } : null;
    },
    async saveClaimed(id: string, token: string, patch: Record<string, unknown>) {
      const dbPatch = toDatabasePatch(patch);
      if (dbPatch.status === "scheduled" || dbPatch.status === "published") {
        dbPatch.claim_token = null;
        dbPatch.lease_until = null;
      }
      const { data, error } = await supabase.schema("dmflow").from("scheduled_carousels")
        .update(dbPatch).eq("id", id).eq("claim_token", token).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Carousel claim was lost before checkpoint");
    },
    async needsReconciliation(id: string, reason: string, token: string) {
      const { data, error } = await supabase.schema("dmflow").from("scheduled_carousels")
        .update({ status: "needs_reconciliation", error: reason, claim_token: null, lease_until: null })
        .eq("id", id).eq("claim_token", token).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Carousel claim was lost before reconciliation checkpoint");
    },
  };

  const graph = {
    async validateAsset(row: CarouselRow, index: number) {
      const imageUrl = row.image_urls[index];
      const slideHash = row.slide_hashes[index];
      if (!imageUrl || !slideHash) throw new Error("Carousel slide URL or approved hash is missing");
      await verifyCarouselAsset({ imageUrl, slideHash, storageUrl: supabaseUrl });
    },
    async forCarousel(row: CarouselRow) {
      const { data, error } = await supabase.schema("dmflow").from("accounts")
        .select("active,ig_username,ig_access_token,ig_token_expires_at").eq("id", row.account_id).single();
      if (error || !data) throw new Error("Instagram account credentials are unavailable");
      assertAuthorizedInstagramAccount(data);
      const instagramUserId = await resolveInstagramIdentity({ graphVersion, now: Date.now(), account: data });
      return createMetaGraphClient({ graphVersion, accessToken: data.ig_access_token, instagramUserId });
    },
  };

  try {
    const result = await publishCarouselStep({ repository, graph, now: Date.now() });
    return Response.json(result);
  } catch {
    return Response.json({ status: "error" }, { status: 500 });
  }
});

type CarouselRow = {
  id: string;
  card_id: string;
  account_id: string;
  canal: string;
  caption: string;
  image_urls: string[];
  slide_hashes: string[];
  slide_container_ids: Array<string | null> | null;
  slide_statuses: Array<string | null> | null;
  status: string;
  publish_at: string;
  approval_fingerprint: string;
  parent_container_id: string | null;
  parent_status: string | null;
  post_id: string | null;
  published_at: string | null;
  permalink: string | null;
  claim_token?: string | null;
  lease_until?: string | null;
  error?: string | null;
  updated_at?: string;
};

function normalize(row: CarouselRow) {
  return {
    ...row,
    child_containers: checkpointArray(row.slide_container_ids),
    child_statuses: checkpointArray(row.slide_statuses),
    parent_status: row.parent_status ?? null,
  };
}

function checkpointArray(values: Array<string | null> | null | undefined) {
  const stored = values ?? [];
  return Array.from({ length: Math.max(8, stored.length) }, (_, index) => stored[index] ?? null);
}

function toDatabasePatch(patch: Record<string, unknown>) {
  const result = { ...patch };
  if ("child_containers" in result) {
    result.slide_container_ids = result.child_containers;
    delete result.child_containers;
  }
  if ("child_statuses" in result) {
    result.slide_statuses = result.child_statuses;
    delete result.child_statuses;
  }
  return result;
}
