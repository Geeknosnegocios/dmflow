import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client bound to the request cookies.
 * Use this in Server Components, Server Actions, and route handlers
 * that need access to `auth.getUser()`.
 */
export async function supabaseServer() {
  const store = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            store.set(name, value, options as CookieOptions)
          );
        } catch {
          // called from a Server Component — cookies() is read-only; ignore
        }
      },
    },
    db: { schema: "dmflow" as any },
  });
}
