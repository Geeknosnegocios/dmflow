import Link from "next/link";
import { requireProfile, getPlan } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { Card, CardHeader, StatusPill, EmptyState } from "@/components/viz";
import { fmtRelative } from "@/lib/format";
import { Check, X } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const profile = await requireProfile();
  const admin = supabaseAdmin();

  const [plansRes, eventsRes, currentPlan] = await Promise.all([
    admin.from("plans").select("*").order("price_brl", { ascending: true }),
    admin
      .from("subscription_events")
      .select("*")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(10),
    getPlan(profile.plan_slug),
  ]);

  const plans = plansRes.data ?? [];
  const events = eventsRes.data ?? [];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-4xl font-bold tracking-tight">Plano e billing</h1>
        <p className="text-dim-2 text-sm">
          Plano atual: <strong>{currentPlan?.name ?? profile.plan_slug}</strong>{" "}
          {currentPlan?.price_brl ? `· R$${currentPlan.price_brl}/mês` : "· grátis"}
        </p>
      </header>

      {/* Plans grid */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((p: any) => {
          const active = p.slug === profile.plan_slug;
          return (
            <Card
              key={p.slug}
              className={`p-5 flex flex-col gap-4 ${
                active ? "ring-2 ring-accent" : ""
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold uppercase tracking-wider text-dim-2">
                    {p.name}
                  </div>
                  {active && <StatusPill tone="accent" label="atual" pulse />}
                </div>
                <div className="mt-2">
                  <span className="text-3xl font-bold mono-num">
                    R${p.price_brl}
                  </span>
                  <span className="text-dim-2 text-sm">/mês</span>
                </div>
              </div>

              <ul className="text-sm space-y-2 flex-1">
                <Feat ok>{p.max_accounts} conta(s) Instagram</Feat>
                <Feat ok>Até {p.max_rules} regras ativas</Feat>
                <Feat ok>
                  {p.max_events_per_month.toLocaleString("pt-BR")} eventos/mês
                </Feat>
                <Feat ok={p.has_ai}>Filtro de sentimento IA</Feat>
                <Feat ok={p.has_ai}>Sugestão de keywords IA</Feat>
                <Feat ok={p.has_api}>API pública + webhook outgoing</Feat>
                <Feat ok={p.has_white_label}>White-label</Feat>
              </ul>

              {!active && p.price_brl > 0 && p.lastlink_product_url && (
                <a
                  href={p.lastlink_product_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="w-full text-center rounded-lg bg-accent hover:bg-accent/90 text-accent-ink font-semibold py-2.5 text-sm transition-colors"
                >
                  Assinar {p.name}
                </a>
              )}
              {!active && p.price_brl > 0 && !p.lastlink_product_url && (
                <div className="w-full text-center rounded-lg border border-line text-dim-2 py-2.5 text-sm">
                  Link Lastlink pendente
                </div>
              )}
              {active && (
                <div className="w-full text-center text-tiny text-dim-2">
                  {profile.subscription_expires_at
                    ? `Renova em ${fmtRelative(profile.subscription_expires_at)}`
                    : "Plano ativo"}
                </div>
              )}
            </Card>
          );
        })}
      </section>

      {/* History */}
      <Card>
        <CardHeader
          title="Histórico de assinaturas"
          subtitle="Eventos de pagamento recentes"
        />
        <div className="divide-y divide-line">
          {events.length === 0 ? (
            <div className="p-8 text-center text-dim-2 text-sm">
              Sem eventos de assinatura ainda
            </div>
          ) : (
            events.map((e: any) => (
              <div
                key={e.id}
                className="flex items-center justify-between px-5 py-3 text-sm"
              >
                <div>
                  <div className="font-medium">{e.plan_slug}</div>
                  <div className="text-tiny text-dim-2 font-mono">
                    {fmtRelative(e.created_at)} · {e.provider}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {e.amount_brl && (
                    <span className="mono-num text-sm">
                      R${Number(e.amount_brl).toFixed(2)}
                    </span>
                  )}
                  <StatusPill
                    tone={e.status === "paid" || e.status === "active" ? "good" : "dim"}
                    label={e.status}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <p className="text-tiny text-dim-2 text-center">
        Pagamento processado pela Lastlink. Cancele a qualquer momento.
      </p>
    </div>
  );
}

function Feat({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <Check className="h-3.5 w-3.5 text-good flex-shrink-0" />
      ) : (
        <X className="h-3.5 w-3.5 text-dim-2 flex-shrink-0" />
      )}
      <span className={ok ? "" : "text-dim-2 line-through"}>{children}</span>
    </li>
  );
}
