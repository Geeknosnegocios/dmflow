import { requireProfile, getPlan } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { createApiKey } from "@/lib/api-keys";
import { Card, CardHeader, StatusPill, EmptyState } from "@/components/viz";
import { ConfirmForm } from "@/components/confirm-form";
import { SubmitButton } from "@/components/submit-button";
import { setFlash, setNewKey, readAndClearNewKey } from "@/lib/flash";
import { fmtRelative } from "@/lib/format";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { Key } from "lucide-react";
import { CopyButton } from "@/components/copy-button";

export const dynamic = "force-dynamic";

async function create(formData: FormData) {
  "use server";
  const profile = await requireProfile();
  const plan = await getPlan(profile.plan_slug);
  if (!plan?.has_api) {
    await setFlash({
      kind: "error",
      message: "Seu plano não inclui API pública. Faça upgrade pra Business.",
    });
    return;
  }
  const name = String(formData.get("name") ?? "Key").trim() || "Key";
  const result = await createApiKey(profile.id, name);
  await setNewKey(result.full_key);
  revalidatePath("/dashboard/api-keys");
}

async function revoke(formData: FormData) {
  "use server";
  const profile = await requireProfile();
  const id = String(formData.get("id"));
  const sb = supabaseAdmin();
  await sb
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", profile.id);
  await setFlash({ kind: "warn", message: "API key revogada" });
  revalidatePath("/dashboard/api-keys");
}

export default async function ApiKeysPage() {
  const profile = await requireProfile();
  const plan = await getPlan(profile.plan_slug);

  if (!plan?.has_api) {
    return (
      <div className="space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">API Keys</h1>
        <EmptyState
          title="API pública não incluída no seu plano"
          message="Faça upgrade pro plano Business pra usar a API REST, criar keys e integrar com sistemas externos."
          cta={{ label: "Ver planos", href: "/dashboard/billing" }}
        />
      </div>
    );
  }

  const sb = supabaseAdmin();
  const [{ data: keys }, newKey] = await Promise.all([
    sb.from("api_keys").select("*").eq("user_id", profile.id).order("created_at", { ascending: false }),
    readAndClearNewKey(),
  ]);

  const list = (keys ?? []) as any[];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-4xl font-bold tracking-tight flex items-center gap-2">
          <Key className="h-8 w-8" />
          API Keys
        </h1>
        <p className="text-dim-2 text-sm">
          Tokens pra acessar a API pública do DMFlow (Business plan)
        </p>
      </header>

      <Card>
        <CardHeader title="Nova key" subtitle="Gere uma chave nomeada" />
        <form action={create} className="p-5 flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-tiny text-dim-2 uppercase tracking-wider block mb-1">
              Nome
            </label>
            <input
              name="name"
              placeholder="ex: Zapier integration"
              required
              className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/50"
            />
          </div>
          <SubmitButton
            pendingLabel="Gerando…"
            className="rounded-lg bg-accent hover:bg-accent/90 text-accent-ink font-semibold px-4 py-2 text-sm"
          >
            Gerar key
          </SubmitButton>
        </form>
      </Card>

      {newKey && (
        <div className="rounded-xl border border-good/40 bg-good/5 p-4 space-y-2">
          <div className="text-sm font-semibold text-good">✓ Key criada — copie agora, não será mostrada novamente</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-bg-1 border border-line rounded-lg px-3 py-2 text-sm font-mono text-good break-all">
              {newKey}
            </code>
            <CopyButton value={newKey} />
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState
          title="Sem keys ainda"
          message="Gere sua primeira key acima. A key só é mostrada uma vez no momento da criação."
        />
      ) : (
        <div className="space-y-2">
          {list.map((k) => (
            <div
              key={k.id}
              className="rounded-xl border border-line bg-surface p-4 flex items-center justify-between gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{k.name}</span>
                  {k.revoked_at ? (
                    <StatusPill tone="danger" label="revogada" />
                  ) : (
                    <StatusPill tone="good" label="ativa" pulse />
                  )}
                </div>
                <div className="mt-1 text-tiny text-dim-2 font-mono">
                  {k.key_prefix}...{" "}
                  {k.last_used_at
                    ? `· última uso ${fmtRelative(k.last_used_at)}`
                    : "· nunca usada"}{" "}
                  · criada {fmtRelative(k.created_at)}
                </div>
              </div>
              {!k.revoked_at && (
                <ConfirmForm
                  action={revoke}
                  label="revogar"
                  confirmLabel="confirmar?"
                  hiddenFields={{ id: k.id }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <Card>
        <CardHeader title="Como usar" subtitle="Exemplos de chamada" />
        <div className="p-5 space-y-3 text-sm">
          <div>
            <div className="text-dim-2 mb-1">Listar eventos:</div>
            <code translate="no" className="block bg-bg-1 border border-line rounded-lg p-3 text-tiny font-mono overflow-x-auto">
              curl https://dmflow.vercel.app/api/v1/events{"\n"}
              {"  "}-H "Authorization: Bearer dmf_sua_key_aqui"
            </code>
          </div>
          <div>
            <div className="text-dim-2 mb-1">Listar regras:</div>
            <code translate="no" className="block bg-bg-1 border border-line rounded-lg p-3 text-tiny font-mono overflow-x-auto">
              curl https://dmflow.vercel.app/api/v1/rules{"\n"}
              {"  "}-H "Authorization: Bearer dmf_sua_key_aqui"
            </code>
          </div>
        </div>
      </Card>
    </div>
  );
}
