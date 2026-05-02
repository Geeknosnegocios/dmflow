import crypto from "crypto";
import { supabaseAdmin } from "./supabase";

export type ApiKeyCreateResult = {
  id: string;
  full_key: string; // only returned once
  key_prefix: string;
};

function hashKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function createApiKey(
  userId: string,
  name: string
): Promise<ApiKeyCreateResult> {
  const random = crypto.randomBytes(24).toString("base64url");
  const full = `dmf_${random}`;
  const prefix = full.slice(0, 12);
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("api_keys")
    .insert({
      user_id: userId,
      key_prefix: prefix,
      key_hash: hashKey(full),
      name,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, full_key: full, key_prefix: prefix };
}

export async function verifyApiKey(raw: string): Promise<{
  valid: boolean;
  user_id?: string;
  plan_slug?: string;
}> {
  if (!raw || !raw.startsWith("dmf_")) return { valid: false };
  const hash = hashKey(raw);
  const sb = supabaseAdmin();
  const { data: key } = await sb
    .from("api_keys")
    .select("id, user_id, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();
  if (!key || key.revoked_at) return { valid: false };

  await sb
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", key.id);

  const { data: profile } = await sb
    .from("user_profiles")
    .select("plan_slug, subscription_status")
    .eq("id", key.user_id)
    .maybeSingle();

  if (!profile || profile.subscription_status !== "active") {
    return { valid: false };
  }

  return {
    valid: true,
    user_id: key.user_id as string,
    plan_slug: profile.plan_slug as string,
  };
}
