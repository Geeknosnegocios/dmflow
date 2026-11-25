import { NextRequest } from "next/server";
import { verifyApiKey } from "@/lib/api-keys";
import { supabaseAdmin } from "@/lib/supabase";
import { createReelBatchApprovalHandler } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const configuredUrl = process.env.SUPABASE_URL ?? "";
let correctSupabaseProject = false;
try { correctSupabaseProject = new URL(configuredUrl).origin === "https://zoknypleoribwomifzgi.supabase.co"; } catch { /* fail closed */ }

const approveBatch = createReelBatchApprovalHandler({
  verifyApiKey,
  supabaseUrl: correctSupabaseProject ? configuredUrl : "",
  repository: () => {
    const sb = supabaseAdmin();
    const approvalTable = () => sb.from("approved_content");
    return {
      async getActiveAccount(username: string) {
        const { data, error } = await sb.from("accounts").select("id,owner_user_id,active,ig_username")
          .eq("ig_username", username).eq("active", true).maybeSingle();
        if (error) throw error;
        return data;
      },
      async listApprovals(contentType: string, contentId: string, accountId: string) {
        const { data, error } = await approvalTable().select("id,content_type,content_id,account_id,fingerprint,approved_by,revoked_at")
          .eq("content_type", contentType).eq("content_id", contentId).eq("account_id", accountId).limit(20);
        if (error) throw error;
        if ((data ?? []).length >= 20) throw new Error("Approval history exceeded the validation limit");
        return data ?? [];
      },
      async scheduleSingle(row) {
        const queue = () => sb.from("scheduled_reels");
        const readExisting = async () => {
          const fields = "id,slug,idx,account_id,canal,caption,video_url,video_sha256,cover_url,cover_sha256,scheduled_unix,approval_fingerprint,approved_content_id,story_status,story_publish_state,story_url,story_sha256,story_approval_fingerprint,story_approved_content_id,status,publish_state";
          const { data, error } = await queue().select(fields).eq("slug", row.slug).limit(4);
          if (error) throw error;
          if (!data?.length) return null;
          const existing = data[0];
          if (data.length !== 1 || !["pending", "processing", "published"].includes(existing.publish_state) ||
              Object.entries(row).some(([key, value]) =>
                key !== "status" && key !== "publish_state" && existing[key as keyof typeof existing] !== value)) {
            throw { status: 409, message: "origin already reserved or queued assets differ" };
          }
          return existing as typeof row & { id: string };
        };
        const existing = await readExisting();
        if (existing) return { row: existing, alreadyScheduled: true };
        const { error } = await queue().insert(row);
        if (error && !["23505", "P0001"].includes(error.code)) throw error;
        const confirmed = await readExisting();
        if (confirmed) return { row: confirmed, alreadyScheduled: Boolean(error) };
        if (error) throw { status: 409, message: error.code === "23505" ? "Reel slot already reserved" : error.message };
        throw { status: 500, message: "queue row was not confirmed" };
      },
      async insertApprovals(rows: Record<string, unknown>[]) {
        const { data, error } = await approvalTable().insert(rows)
          .select("id,content_type,content_id,account_id,fingerprint,approved_by,revoked_at");
        if (error) throw error;
        return data ?? [];
      },
    };
  },
});

export async function POST(request: NextRequest) {
  return approveBatch(request);
}

