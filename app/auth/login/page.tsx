import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

async function signIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/auth/login?error=${encodeURIComponent(error.message)}`);
  }
  redirect(next);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="rounded-2xl border border-line-2 bg-surface shadow-card p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Entrar</h1>
        <p className="text-dim-2 text-sm mt-1">
          Acesse seu dashboard DMFlow
        </p>
      </div>

      {params.error && (
        <div className="rounded-lg bg-danger-dim border border-danger/30 text-danger text-sm px-3 py-2">
          {params.error}
        </div>
      )}

      <form action={signIn} className="space-y-3">
        <input type="hidden" name="next" value={params.next ?? "/dashboard"} />
        <Field label="Email">
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent/50"
          />
        </Field>
        <Field label="Senha">
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            minLength={6}
            className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent/50"
          />
        </Field>

        <SubmitButton
          pendingLabel="Entrando…"
          className="w-full rounded-lg bg-accent hover:bg-accent/90 text-accent-ink font-semibold py-2.5 text-sm transition-colors mt-2 justify-center"
        >
          Entrar
        </SubmitButton>
      </form>

      <div className="text-sm text-dim-2 text-center">
        Sem conta?{" "}
        <Link href="/auth/signup" className="text-accent hover:underline">
          Criar grátis
        </Link>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
