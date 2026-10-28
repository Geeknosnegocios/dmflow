import { createClient } from "npm:@supabase/supabase-js@2";
import { publishCarouselStep } from "../_shared/publishing-state.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const supabaseUrl = env("SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const graphVersion = env("META_GRAPH_VERSION") || "v25.0";

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
    async loadApproval(cardId: string) {
      const { data, error } = await supabase.schema("dmflow").from("approved_content")
        .select("fingerprint,revoked_at").eq("content_id", cardId).eq("content_type", "carousel")
        .order("approved_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data ? { ...data, approved: !data.revoked_at } : null;
    },
    async canonicalApprovalFingerprint(row: CarouselRow) {
      const canonical = JSON.stringify({ caption: row.caption, image_urls: row.image_urls, canal: row.canal });
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
      return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    },
    async claimByCard(cardId: string, fingerprint: string, now: number) {
      const { data, error } = await supabase.schema("dmflow").rpc("claim_carousel_by_card", {
        p_card_id: cardId,
        p_fingerprint: fingerprint,
        p_now: new Date(now).toISOString(),
      }).maybeSingle();
      if (error) throw error;
      return data?.claim_token ? { row: normalize(data), claim_token: data.claim_token } : null;
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
    async forCarousel(row: CarouselRow) {
      const { data, error } = await supabase.schema("dmflow").from("accounts")
        .select("ig_access_token,ig_user_id").eq("id", row.account_id).single();
      if (error || !data?.ig_access_token || !data?.ig_user_id) throw new Error("Instagram account credentials are unavailable");
      const token = data.ig_access_token as string;
      const userId = data.ig_user_id as string;
      const call = async (path: string, params: Record<string, string>) => {
        const response = await fetch(`https://graph.instagram.com/${graphVersion}/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...params, access_token: token }),
        });
        const result = await response.json();
        if (!response.ok || result.error) throw new Error(`Instagram Graph HTTP ${response.status}`);
        return result;
      };
      const get = async (id: string, fields: string) => {
        const url = new URL(`https://graph.instagram.com/${graphVersion}/${id}`);
        url.search = new URLSearchParams({ fields, access_token: token }).toString();
        const response = await fetch(url);
        const result = await response.json();
        if (!response.ok || result.error) throw new Error(`Instagram Graph HTTP ${response.status}`);
        return result;
      };
      return {
        async createChild({ imageUrl }: { imageUrl?: string }) {
          if (!imageUrl) throw new Error("Carousel image URL is missing");
          return call(`${userId}/media`, { image_url: imageUrl, is_carousel_item: "true" });
        },
        async getContainerStatus(id: string) { return (await get(id, "status_code")).status_code; },
        async createParent({ children, caption }: { children: string[]; caption?: string }) {
          return call(`${userId}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: caption ?? "" });
        },
        async publish(id: string) {
          const result = await call(`${userId}/media_publish`, { creation_id: id });
          return { ...result, timestamp: new Date().toISOString() };
        },
        async getPermalink(id: string) { return (await get(id, "permalink")).permalink; },
      };
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
  account_id: string;
  canal: string;
  caption: string;
  image_urls: string[];
  slide_container_ids: string[];
  slide_statuses: string[];
  [key: string]: unknown;
};

function normalize(row: CarouselRow) {
  return {
    ...row,
    child_containers: row.slide_container_ids ?? [],
    child_statuses: row.slide_statuses ?? [],
    parent_status: row.parent_status ?? null,
  };
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
