import { supabaseAdmin } from "./supabase";

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function shortId(len = 10): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export type TrackedButton = { url: string; title: string };

export async function buildTrackedButtons(params: {
  buttons: TrackedButton[];
  accountId: string;
  ruleId: string | null;
  eventId?: string | null;
  igUserId?: string | null;
  baseUrl: string;
}): Promise<TrackedButton[]> {
  const sb = supabaseAdmin();
  const out: TrackedButton[] = [];

  for (let i = 0; i < params.buttons.length; i++) {
    const b = params.buttons[i];
    const id = shortId(10);
    const { error } = await sb.from("tracked_links").insert({
      id,
      account_id: params.accountId,
      rule_id: params.ruleId,
      event_id: params.eventId ?? null,
      button_index: i,
      button_title: b.title,
      target_url: b.url,
      ig_user_id: params.igUserId ?? null,
    });
    if (error) {
      // fallback: return original if insert fails
      out.push(b);
      continue;
    }
    out.push({ title: b.title, url: `${params.baseUrl}/r/${id}` });
  }

  return out;
}

export function resolveBaseUrl(req: Request): string {
  const env = process.env.PUBLIC_BASE_URL;
  if (env) return env.replace(/\/$/, "");
  const host = req.headers.get("host") ?? "dmflow.vercel.app";
  const proto =
    req.headers.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
