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

