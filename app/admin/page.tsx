import { requireProfile } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { Card, CardHeader, StatusPill } from "@/components/viz";
import { fmtRelative, fmtCompact } from "@/lib/format";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) redirect("/dashboard");

  const admin = supabaseAdmin();

  const [usersRes, accountsRes, eventsRes, subsRes] = await Promise.all([
    admin
      .from("user_profiles")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200),
    admin.from("accounts").select("id, owner_user_id, ig_username, active, created_at"),
    admin
      .from("events")
      .select("account_id, created_at")
      .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()),
    admin
      .from("subscription_events")
      .select("*")
      .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString())
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const users = usersRes.data ?? [];
  const accounts = accountsRes.data ?? [];
  const events30 = eventsRes.data ?? [];
  const subs = subsRes.data ?? [];

  const eventsByAccount = new Map<string, number>();
  for (const e of events30) {
    eventsByAccount.set(
      (e as any).account_id,
      (eventsByAccount.get((e as any).account_id) ?? 0) + 1
    );
  }

  const accountsByUser = new Map<string, any[]>();
  for (const a of accounts as any[]) {
    if (!a.owner_user_id) continue;
    const arr = accountsByUser.get(a.owner_user_id) ?? [];
    arr.push(a);
    accountsByUser.set(a.owner_user_id, arr);
  }

  const mrr = users
    .filter((u: any) => u.plan_slug === "pro")
    .length * 37 +
    users.filter((u: any) => u.plan_slug === "business").length * 97;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Admin</h1>
          <p className="text-dim-2 text-sm">Sistema overview · {users.length} usuários</p>
        </div>
        <Link
          href="/dashboard"
          className="text-tiny rounded-lg border border-line-2 hover:border-accent/40 px-3 py-2 text-dim-2 hover:text-fg transition-colors"
        >
          ← voltar dashboard
        </Link>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Usuários total" value={fmtCompact(users.length)} />
        <Stat
          label="MRR estimado"
          value={`R$${mrr}`}
          tone="good"
        />
        <Stat
          label="Contas IG conectadas"
          value={fmtCompact(accounts.length)}
          tone="accent"
        />
        <Stat label="Eventos 30d" value={fmtCompact(events30.length)} tone="violet" />
      </section>

      {/* Plan distribution */}
      <Card>
        <CardHeader title="Distribuição de planos" />
        <div className="p-5 grid grid-cols-3 gap-4">
          {["free", "pro", "business"].map((slug) => {
            const count = users.filter((u: any) => u.plan_slug === slug).length;
            const pct = users.length
              ? Math.round((count / users.length) * 100)
              : 0;
            return (
              <div key={slug} className="rounded-lg border border-line bg-bg-1 p-4">
                <div className="text-tiny text-dim-2 uppercase tracking-wider">
                  {slug}
                </div>
                <div className="mono-num text-2xl font-bold mt-1">{count}</div>
                <div className="text-tiny text-dim-2">{pct}%</div>
                <div className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={`h-full ${
                      slug === "free"
                        ? "bg-dim-2"
                        : slug === "pro"
                        ? "bg-accent"
                        : "bg-violet"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Users table */}
      <Card>
        <CardHeader
          title="Usuários recentes"
          subtitle={`Últimos ${users.length} signups`}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-tiny text-dim-2 uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 text-left">Email</th>
                <th className="px-3 py-3 text-left">Plano</th>
                <th className="px-3 py-3 text-right">Contas</th>
                <th className="px-3 py-3 text-right">Eventos 30d</th>
                <th className="px-5 py-3 text-right">Desde</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: any) => {
                const userAccts = accountsByUser.get(u.id) ?? [];
                const acctEvents = userAccts.reduce(
                  (acc, a) => acc + (eventsByAccount.get(a.id) ?? 0),
                  0
                );
                return (
                  <tr key={u.id} className="border-t border-line">
                    <td className="px-5 py-3">
                      <div className="font-medium">{u.full_name ?? "—"}</div>
                      <div className="text-tiny text-dim-2">{u.email}</div>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill
                        tone={
                          u.plan_slug === "free"
                            ? "dim"
                            : u.plan_slug === "pro"
                            ? "accent"
                            : "violet"
                        }
                        label={u.plan_slug}
                      />
                    </td>
                    <td className="px-3 py-3 text-right mono-num">
                      {userAccts.length}
                    </td>
                    <td className="px-3 py-3 text-right mono-num">
                      {acctEvents}
                    </td>
                    <td className="px-5 py-3 text-right text-tiny text-dim-2 font-mono">
                      {fmtRelative(u.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Recent payments */}
      <Card>
        <CardHeader
          title="Assinaturas recentes"
          subtitle="Últimos 30 dias de eventos Lastlink"
        />
        <div className="divide-y divide-line">
          {subs.length === 0 ? (
            <div className="p-8 text-center text-dim-2 text-sm">
              Nenhum evento de assinatura
            </div>
          ) : (
            subs.map((s: any) => (
              <div
                key={s.id}
                className="px-5 py-3 flex items-center justify-between text-sm"
              >
                <div>
                  <div className="font-mono text-tiny text-dim-2">
                    {s.external_id ?? s.id.slice(0, 12)}
                  </div>
                  <div>
                    {s.plan_slug ?? "—"} ·{" "}
                    <span className="text-dim-2">{fmtRelative(s.created_at)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {s.amount_brl && (
                    <span className="mono-num">R${Number(s.amount_brl).toFixed(2)}</span>
                  )}
                  <StatusPill
                    tone={s.status === "paid" ? "good" : "dim"}
                    label={s.status}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "accent" | "violet";
}) {
  const color =
    tone === "good"
      ? "text-good"
      : tone === "accent"
      ? "text-accent"
      : tone === "violet"
      ? "text-violet"
      : "text-fg";
  return (
    <div className="rounded-xl border border-line bg-surface shadow-card p-4">
      <div className="text-tiny text-dim-2 uppercase tracking-wider">{label}</div>
      <div className={`mt-2 text-2xl font-semibold mono-num ${color}`}>
        {value}
      </div>
    </div>
  );
}
