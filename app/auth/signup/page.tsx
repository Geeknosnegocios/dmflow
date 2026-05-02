import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

async function signUp(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();

  const sb = await supabaseServer();
  const { error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
    },
  });

  if (error) {
    redirect(`/auth/signup?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/onboarding");
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="rounded-2xl border border-line-2 bg-surface shadow-card p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Criar conta grátis</h1>
        <p className="text-dim-2 text-sm mt-1">
          Plano Free sem cartão · 3 regras + 100 eventos/mês
        </p>
      </div>

      {params.error && (
        <div className="rounded-lg bg-danger-dim border border-danger/30 text-danger text-sm px-3 py-2">
          {params.error}
        </div>
      )}

      <form action={signUp} className="space-y-3">
        <Field label="Nome">
          <input
            type="text"
            name="full_name"
            required
            placeholder="Seu nome"
            className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent/50"
          />
        </Field>
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
            minLength={6}
            autoComplete="new-password"
            placeholder="Mínimo 6 caracteres"
            className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent/50"
          />
        </Field>

        <SubmitButton
          pendingLabel="Criando conta…"
          className="w-full rounded-lg bg-accent hover:bg-accent/90 text-accent-ink font-semibold py-2.5 text-sm transition-colors mt-2 justify-center"
        >
          Criar conta grátis
        </SubmitButton>
      </form>

      <p className="text-tiny text-dim-2 text-center">
        Ao criar, você concorda com os{" "}
        <Link href="/terms" className="underline">
          termos
        </Link>{" "}
        e{" "}
        <Link href="/privacy" className="underline">
          privacidade
        </Link>
      </p>

      <div className="text-sm text-dim-2 text-center">
        Já tem conta?{" "}
        <Link href="/auth/login" className="text-accent hover:underline">
          Entrar
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
