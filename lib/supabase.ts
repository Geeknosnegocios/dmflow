import { createClient } from "@supabase/supabase-js";

let admin: ReturnType<typeof build> | null = null;

function build() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "dmflow" as any },
  });
}

export function supabaseAdmin() {
  if (!admin) admin = build();
  return admin;
}
