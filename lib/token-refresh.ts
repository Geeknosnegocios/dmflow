import { supabaseAdmin } from "./supabase";
import type { Account } from "@/types/db";

const IG_GRAPH = "https://graph.instagram.com";

export type RefreshResult =
  | { ok: true; account_id: string; new_expires_at: string; days_added: number }
  | { ok: false; account_id: string; error: string };

/**
 * Refresh a long-lived Instagram User token.
 * Must be called BEFORE the current token expires.
 * Returns a new token valid for another ~60 days.
 */
export async function refreshAccountToken(account: Account): Promise<RefreshResult> {
  const url = `${IG_GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(
    account.ig_access_token
  )}`;
  try {
    const res = await fetch(url, { method: "GET" });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        account_id: account.id,
        error: json?.error?.message || `HTTP ${res.status}`,
      };
    }

    const newToken: string = json.access_token;
    const expiresInSec: number = json.expires_in ?? 60 * 24 * 3600;
    const newExpiresAt = new Date(Date.now() + expiresInSec * 1000);

    const sb = supabaseAdmin();
    await sb
      .from("accounts")
      .update({
        ig_access_token: newToken,
        ig_token_expires_at: newExpiresAt.toISOString(),
        ig_token_refreshed_at: new Date().toISOString(),
      })
      .eq("id", account.id);

    return {
      ok: true,
      account_id: account.id,
      new_expires_at: newExpiresAt.toISOString(),
      days_added: Math.round(expiresInSec / 86400),
    };
  } catch (e) {
    return { ok: false, account_id: account.id, error: (e as Error).message };
  }
}

export async function refreshAllExpiring(thresholdDays = 14): Promise<RefreshResult[]> {
  const sb = supabaseAdmin();
  const cutoff = new Date(Date.now() + thresholdDays * 86400 * 1000).toISOString();

  const { data } = await sb
    .from("accounts")
    .select("*")
    .eq("active", true)
    .or(`ig_token_expires_at.is.null,ig_token_expires_at.lt.${cutoff}`);

  const accounts = (data ?? []) as Account[];
  const results: RefreshResult[] = [];
  for (const acc of accounts) {
    results.push(await refreshAccountToken(acc));
  }
  return results;
}
