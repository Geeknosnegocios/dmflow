import { createClient } from "@supabase/supabase-js";
import { createReelsBatchControlHandler, type BatchRepository, type ExistingRow } from "./handler.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const config = {
  supabaseUrl: env("SUPABASE_URL"),
  serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY"),
  publishableKey: env("SUPABASE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY"),
  batchTokenSha256: env("REELS_BATCH_TOKEN_SHA256"),
};

function repository(): BatchRepository {
  const client: any = createClient(config.supabaseUrl, config.serviceRoleKey, {
    db: { schema: "dmflow" }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const table = () => client.schema("dmflow").from("scheduled_reels");
  const approvalTable = () => client.schema("dmflow").from("approved_content");
  const fields = [
    "id", "slug", "idx", "account_id", "video_url", "video_sha256", "cover_url", "cover_sha256",
    "story_url", "story_sha256", "caption", "canal", "scheduled_unix", "status", "publish_state",
    "story_status", "story_publish_state", "approval_fingerprint", "story_approval_fingerprint",
    "approved_content_id", "story_approved_content_id", "post_id", "published_at", "permalink",
    "story_post_id", "story_published_at", "story_permalink", "error", "story_error",
  ].join(",");

  return {
    async listSlugs() {
      const rows: Record<string, unknown>[] = [];
      for (let offset = 0; offset < 50_000; offset += 1000) {
        const { data, error } = await table().select(
          "slug,idx,status,publish_state,story_status,story_publish_state,post_id,permalink,published_at,story_post_id,story_published_at,error,story_error",
        ).order("slug").order("idx").range(offset, offset + 999);
        if (error) throw error;
        rows.push(...(data ?? []));
        if ((data ?? []).length < 1000) return rows;
      }
      throw new Error("Reserved Reel index exceeded its safe page limit");
    },
    async verifyBatch(date: string, sourceVideoId: string) {
      const start = Math.floor(new Date(`${date}T00:00:00-03:00`).getTime() / 1000);
      const end = start + 86400;
      const { data, error } = await table().select(
        "slug,idx,status,publish_state,story_status,story_publish_state,scheduled_unix,post_id,permalink,published_at,cover_url,story_url,story_post_id,story_published_at,error,story_error",
      ).eq("slug", sourceVideoId).gte("scheduled_unix", start).lt("scheduled_unix", end).order("idx").limit(10);
      if (error) throw error;
      return (data ?? []) as unknown as ExistingRow[];
    },
    async signUpload(path: string, _contentType: string) {
      const { data, error } = await client.storage.from("dmflow-content").createSignedUploadUrl(path, { upsert: false });
      if (error || !data?.signedUrl || !data.token) throw new Error("Could not create one-time upload URL");
      return { signedUrl: data.signedUrl, token: data.token };
    },
    async getActiveAccount(username: string) {
      const { data, error } = await client.schema("dmflow").from("accounts")
        .select("id,owner_user_id,active,ig_username").eq("ig_username", username).eq("active", true).maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    async listRowsBySource(source: string) {
      const { data, error } = await table().select(fields).eq("slug", source).order("idx").limit(100);
      if (error) throw error;
      if ((data ?? []).length >= 100) throw new Error("Source Reel history exceeded safe validation limit");
      return (data ?? []) as unknown as ExistingRow[];
    },
    async listRowsByDay(_accountId: string, start: number, end: number) {
      const { data, error } = await table().select(fields).gte("scheduled_unix", start).lt("scheduled_unix", end)
        .order("scheduled_unix").limit(4);
      if (error) throw error;
      return data ?? [];
    },
    async listApprovals(contentType: string, contentId: string, accountId: string) {
      const { data, error } = await approvalTable().select("id,content_type,content_id,account_id,fingerprint,approved_by,revoked_at")
        .eq("content_type", contentType).eq("content_id", contentId).eq("account_id", accountId).limit(20);
      if (error) throw error;
      if ((data ?? []).length >= 20) throw new Error("Approval history exceeded safe validation limit");
      return data ?? [];
    },
    async insertScheduledRows(rows: Record<string, unknown>[]) {
      const { data, error } = await table().insert(rows)
        .select("id,slug,idx,account_id,canal,caption,video_url,video_sha256,cover_url,cover_sha256,story_url,story_sha256,scheduled_unix,status,publish_state,story_status,story_publish_state,approval_fingerprint,story_approval_fingerprint,approved_content_id,story_approved_content_id");
      if (error) throw error;
      return data ?? [];
    },
  };
}

Deno.serve((request) => createReelsBatchControlHandler({ config, repository })(request));

