import { createClient } from "@supabase/supabase-js";
import { assertAuthorizedInstagramAccount, resolveInstagramIdentity } from "../_shared/meta-graph.ts";
import { publishReelStep, publishStoryStep, type ReelRow } from "../_shared/reel-publishing.ts";
import { verifyReelAssets, verifyStoryAsset } from "./media.ts";
import { createReelGraphClient } from "./graph.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const supabaseUrl = env("SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const configuredGraphVersion = env("META_GRAPH_VERSION") || "v22.0";
const graphVersion = /^v\d+\.\d+$/.test(configuredGraphVersion) ? configuredGraphVersion : "v22.0";

function repository(supabase: ReturnType<typeof createClient>) {
  const table = () => supabase.schema("dmflow").from("scheduled_reels");
  async function loadApproval(contentType: "reel" | "reel_story", contentId: string, accountId: string, fingerprint: string) {
    const { data, error } = await supabase.schema("dmflow").from("approved_content")
      .select("fingerprint,revoked_at").eq("content_type", contentType).eq("content_id", contentId)
      .eq("account_id", accountId).eq("fingerprint", fingerprint).is("revoked_at", null).maybeSingle();
    if (error) throw error;
    return data ? { ...data, approved: true } : null;
  }
  async function claim(rpc: string, id: string, fingerprint: string, now: number) {
    const { data, error } = await supabase.schema("dmflow").rpc(rpc, {
      p_reel_id: id, p_fingerprint: fingerprint, p_now: new Date(now).toISOString(),
    }).maybeSingle();
    if (error) throw error;
    const row = data as ReelRow | null;
    const token = row?.claim_token ?? row?.story_claim_token;
    return row && token ? { row, claim_token: token as string } : null;
  }
  async function checkpoint(id: string, tokenField: string, token: string, patch: Record<string, unknown>) {
    const { data, error } = await table().update(patch).eq("id", id).eq(tokenField, token).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Reel claim was lost before checkpoint");
  }
  async function reconcile(id: string, tokenField: string, token: string, lane: "reel" | "story", reason: string) {
    const stateField = lane === "reel" ? "publish_state" : "story_publish_state";
    const statusField = lane === "reel" ? "status" : "story_status";
    const errorField = lane === "reel" ? "error" : "story_error";
    const leaseField = lane === "reel" ? "lease_until" : "story_lease_until";
    await checkpoint(id, tokenField, token, { [stateField]: "needs_reconciliation", [statusField]: "error",
      [errorField]: reason.slice(0, 500), [tokenField]: null, [leaseField]: null });
  }
  return {
    async peekDueReel(now: number) {
      const { data, error } = await table().select("*").eq("publish_state", "pending")
        .lte("scheduled_unix", Math.floor(now / 1000)).order("scheduled_unix").limit(1).maybeSingle();
      if (error) throw error;
      return data as ReelRow | null;
    },
    async peekDueStory(now: number) {
      const { data, error } = await table().select("*").eq("publish_state", "published")
        .eq("story_publish_state", "pending").not("story_url", "is", null)
        .lte("scheduled_unix", Math.floor(now / 1000)).order("scheduled_unix").limit(1).maybeSingle();
      if (error) throw error;
      return data as ReelRow | null;
    },
    loadApproval,
    async claimReel(id: string, fp: string, now: number) { return claim("claim_due_reel", id, fp, now); },
    async claimStory(id: string, fp: string, now: number) { return claim("claim_due_reel_story", id, fp, now); },
    async checkpointReel(id: string, token: string, patch: Record<string, unknown>) {
      return checkpoint(id, "claim_token", token, patch);
    },
    async checkpointStory(id: string, token: string, patch: Record<string, unknown>) {
      return checkpoint(id, "story_claim_token", token, patch);
    },
    async reconcileReel(id: string, token: string, reason: string) { return reconcile(id, "claim_token", token, "reel", reason); },
    async reconcileStory(id: string, token: string, reason: string) { return reconcile(id, "story_claim_token", token, "story", reason); },
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let correctProject = false;
  try { correctProject = new URL(supabaseUrl).origin === "https://zoknypleoribwomifzgi.supabase.co"; } catch { /* fail closed */ }
  if (!correctProject || !serviceKey ||
      request.headers.get("authorization") !== `Bearer ${serviceKey}`) {
    return new Response("Publishing service unavailable", { status: 503 });
  }
  let mode: "reel" | "story";
  try {
    const payload = await request.json();
    if (payload.mode !== "reel" && payload.mode !== "story") return new Response("Invalid mode", { status: 400 });
    mode = payload.mode;
  } catch { return new Response("Invalid request", { status: 400 }); }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: account, error } = await supabase.schema("dmflow").from("accounts")
    .select("id,active,ig_username,ig_business_id,ig_access_token,ig_token_expires_at")
    .eq("ig_username", "andreyogeek").eq("active", true).maybeSingle();
  if (error || !account?.id || !account.ig_access_token || !account.ig_business_id ||
      Date.parse(account.ig_token_expires_at ?? "") <= Date.now()) {
    return new Response("Instagram account is not ready", { status: 503 });
  }
  try {
    assertAuthorizedInstagramAccount({ active: account.active, ig_username: account.ig_username });
    const identity = await resolveInstagramIdentity({ graphVersion, now: Date.now(), account });
    if (identity !== account.ig_business_id) return new Response("Instagram identity does not match the account", { status: 503 });
    const graph = createReelGraphClient({ graphVersion, accessToken: account.ig_access_token, instagramUserId: identity });
    graph.validateReel = async (row) => verifyReelAssets(row, supabaseUrl);
    graph.validateStory = async (row) => verifyStoryAsset(row, supabaseUrl);
    const repo = repository(supabase);
    const result = mode === "reel"
      ? await publishReelStep({ repository: repo, graph, now: Date.now() })
      : await publishStoryStep({ repository: repo, graph, now: Date.now() });
    return Response.json(result);
  } catch {
    return new Response("Instagram publishing step failed; inspect the queue receipt", { status: 500 });
  }
});

