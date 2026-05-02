import { supabaseServer } from "./supabase-server";
import { supabaseAdmin } from "./supabase";
import { redirect } from "next/navigation";

export type UserProfile = {
  id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
  plan_slug: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  created_at: string;
};

export type Plan = {
  slug: string;
  name: string;
  price_brl: number;
  max_accounts: number;
  max_rules: number;
  max_events_per_month: number;
  has_api: boolean;
  has_white_label: boolean;
  has_ai: boolean;
  lastlink_product_url: string | null;
};

export async function getUser() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

export async function getProfile(): Promise<UserProfile | null> {
  const user = await getUser();
  if (!user) return null;
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<UserProfile>();
  return data ?? null;
}

export async function getPlan(slug: string): Promise<Plan | null> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("plans")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Plan>();
  return data ?? null;
}

export async function requireProfile(): Promise<UserProfile> {
  const profile = await getProfile();
  if (!profile) redirect("/auth/login");
  return profile;
}

export async function getUserAccounts(userId: string) {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("accounts")
    .select("*")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true });
  return data ?? [];
}
