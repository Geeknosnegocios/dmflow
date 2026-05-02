import { supabaseAdmin } from "@/lib/supabase";
import {
  Sparkline,
  StatusPill,
  Funnel,
  Heatmap,
  Delta,
  EmptyState,
  Card,
  CardHeader,
} from "@/components/viz";
import { LineChart } from "@/components/chart";
import { ABCard } from "@/components/ab-card";
import { KeywordSuggestions } from "@/components/keyword-suggestions";
import { bucket7Days, heatmapMatrix, fmtRelative, fmtCompact, fmtPct } from "@/lib/format";
import { Flame, Download } from "lucide-react";
import Link from "next/link";

function bucket30Days(dates: string[]): number[] {
  const buckets = new Array(30).fill(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = today.getTime() - 29 * 86400000;
  for (const d of dates) {
    const t = new Date(d).getTime();
    if (t < start) continue;
    const idx = Math.floor((t - start) / 86400000);
    if (idx >= 0 && idx < 30) buckets[idx]++;
  }
  return buckets;
}

function last30Labels(): string[] {
  const out: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = today.getTime() - 29 * 86400000;
  for (let i = 0; i < 30; i++) {
    const d = new Date(start + i * 86400000);
    out.push(d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }));
  }
  return out;
}

export const dynamic = "force-dynamic";

async function load() {
  const sb = supabaseAdmin();
  const since30d = new Date(Date.now() - 30 * 86400000).toISOString();
  const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
  const since14d = new Date(Date.now() - 14 * 86400000).toISOString();

  const [rulesRes, eventsAllRes, events30Res, linksRes, clicks30Res, recentRes] =
    await Promise.all([
      sb
        .from("rules")
        .select(
          "id, name, trigger_type, keyword, active, triggered_count, variants, variant_hits, variant_conversions, dm_message, dm_buttons"
        ),
      sb.from("events").select("rule_id, dm_sent, created_at, matched_keyword"),
      sb
        .from("events")
        .select("created_at, dm_sent, rule_id, ig_username, comment_text, matched_keyword, public_reply_sent, dm_error, ig_user_id")
        .gte("created_at", since30d)
        .order("created_at", { ascending: false }),
      sb
        .from("tracked_links")
        .select("rule_id, click_count, created_at"),
      sb
        .from("link_clicks")
        .select("clicked_at")
        .gte("clicked_at", since30d),
      sb
        .from("events")
        .select(
          "id, created_at, ig_username, comment_text, matched_keyword, dm_sent, public_reply_sent, dm_error, rule_id, ig_user_id"
        )
        .order("created_at", { ascending: false })
        .limit(40),
    ]);

  const rules = (rulesRes.data ?? []) as any[];
  const allEvents = (eventsAllRes.data ?? []) as any[];
  const events30 = (events30Res.data ?? []) as any[];
  const links = (linksRes.data ?? []) as any[];
  const clicks30 = (clicks30Res.data ?? []) as any[];
  const recent = (recentRes.data ?? []) as any[];

  // Stats 7d
  const events7 = events30.filter((e) => e.created_at >= since7d);
  const prev7 = events30.filter(
    (e) => e.created_at < since7d && e.created_at >= since14d
  );
  const totalEvents7 = events7.length;
  const prevEvents7 = prev7.length;
  const dms7 = events7.filter((e) => e.dm_sent).length;
  const clicks7 = clicks30.filter(
    (c) => c.clicked_at >= since7d
  ).length;
  const prevClicks7 = clicks30.filter(
    (c) => c.clicked_at < since7d && c.clicked_at >= since14d
  ).length;

  // Sparkline series (7 days)
  const eventsSeries = bucket7Days(events7.map((e) => e.created_at));
  const dmsSeries = bucket7Days(events7.filter((e) => e.dm_sent).map((e) => e.created_at));
  const clicksSeries = bucket7Days(
    clicks30.filter((c) => c.clicked_at >= since7d).map((c) => c.clicked_at)
  );

  // Funil global
  const totalAll = allEvents.length;
  const dmsAll = allEvents.filter((e) => e.dm_sent).length;
  const clicksAll = links.reduce((acc, l) => acc + (l.click_count ?? 0), 0);

  // Funnel per rule
  const ruleMap = new Map<string, any>();
  for (const r of rules) ruleMap.set(r.id, { ...r, events: 0, dms: 0, clicks: 0 });
  for (const e of allEvents) {
    if (!e.rule_id) continue;
    const m = ruleMap.get(e.rule_id);
    if (!m) continue;
    m.events++;
    if (e.dm_sent) m.dms++;
  }
  for (const l of links) {
    if (!l.rule_id) continue;
    const m = ruleMap.get(l.rule_id);
    if (!m) continue;
    m.clicks += l.click_count ?? 0;
  }
  const ruleFunnels = Array.from(ruleMap.values())
    .filter((r) => r.events > 0 || r.clicks > 0)
    .sort((a, b) => b.events - a.events);

  // Heatmap
  const heatmap = heatmapMatrix(events30.map((e) => e.created_at));

  // 30d series
  const eventsSeries30 = bucket30Days(events30.map((e) => e.created_at));
  const dmsSeries30 = bucket30Days(events30.filter((e) => e.dm_sent).map((e) => e.created_at));
  const clicksSeries30 = bucket30Days(clicks30.map((c) => c.clicked_at));
  const labels30 = last30Labels();

  // Top leads (contagem por username/user_id)
  const leadsMap = new Map<string, { username: string | null; user_id: string; count: number; last: string }>();
  for (const e of events30) {
    const key = e.ig_user_id ?? `anon-${e.id}`;
    if (!e.ig_user_id) continue;
    const cur = leadsMap.get(key);
    if (cur) {
      cur.count++;
      if (e.created_at > cur.last) cur.last = e.created_at;
    } else {
      leadsMap.set(key, {
        username: e.ig_username,
        user_id: e.ig_user_id,
        count: 1,
        last: e.created_at,
      });
    }
  }
  const topLeads = Array.from(leadsMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    stats: {
      totalEvents7,
      prevEvents7,
      dms7,
      clicks7,
      prevClicks7,
      totalAll,
      dmsAll,
      clicksAll,
      eventsSeries,
      dmsSeries,
      clicksSeries,
    },
    ruleFunnels,
    heatmap,
    recent,
    topLeads,
    eventsSeries30,
    dmsSeries30,
    clicksSeries30,
    labels30,
    abRules: rules.filter(
      (r: any) => Array.isArray(r.variants) && r.variants.length > 1
    ),
    hasData: totalAll > 0,
  };
}

export default async function DashboardPage() {
  const {
    stats,
    ruleFunnels,
    heatmap,
    recent,
    topLeads,
    eventsSeries30,
    dmsSeries30,
    clicksSeries30,
    labels30,
    abRules,
    hasData,
  } = await load();

  if (!hasData) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-4xl font-bold tracking-tight">Overview</h1>
          <p className="text-dim-2 text-sm">Seu funil de automação em tempo real</p>
        </header>
        <EmptyState
          title="Aguardando o primeiro evento"
          message="Quando alguém comentar numa keyword, responder seu story ou mandar primeira DM, vai aparecer aqui em segundos."
          cta={{ label: "Criar primeira regra", href: "/dashboard/rules" }}
        />
      </div>
    );
  }

  const eventsDelta = stats.totalEvents7 - stats.prevEvents7;
  const clicksDelta = stats.clicks7 - stats.prevClicks7;

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Overview</h1>
          <p className="text-dim-2 text-sm">
            Funil de automação · últimos 7 dias
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/api/admin/export?kind=events"
            download="dmflow_events.csv"
            className="text-xs rounded-lg border border-line-2 bg-surface hover:bg-surface-2 px-3 py-2 text-dim-2 hover:text-fg transition-colors min-h-[36px] inline-flex items-center gap-1.5"
          >
            <Download className="h-3.5 w-3.5" /> Eventos
          </a>
          <a
            href="/api/admin/export?kind=clicks"
            download="dmflow_clicks.csv"
            className="text-xs rounded-lg border border-line-2 bg-surface hover:bg-surface-2 px-3 py-2 text-dim-2 hover:text-fg transition-colors min-h-[36px] inline-flex items-center gap-1.5"
          >
            <Download className="h-3.5 w-3.5" /> Cliques
          </a>
        </div>
      </header>

      {/* KPI grid */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Eventos 7d"
          value={fmtCompact(stats.totalEvents7)}
          delta={eventsDelta}
          series={stats.eventsSeries}
          color="#22d3ee"
        />
        <Kpi
          label="DMs enviadas 7d"
          value={fmtCompact(stats.dms7)}
          sub={
            stats.totalEvents7
              ? `${fmtPct(stats.dms7, stats.totalEvents7)} dos eventos`
              : "—"
          }
          series={stats.dmsSeries}
          color="#34d399"
        />
        <Kpi
          label="Cliques 7d"
          value={fmtCompact(stats.clicks7)}
          delta={clicksDelta}
          series={stats.clicksSeries}
          color="#a78bfa"
        />
        <Kpi
          label="Total histórico"
          value={fmtCompact(stats.totalAll)}
          sub={`${fmtCompact(stats.dmsAll)} DMs · ${fmtCompact(stats.clicksAll)} clicks`}
          series={[]}
          color="#fbbf24"
        />
      </section>

      {/* Funnel + Heatmap */}
      <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Funil consolidado"
              subtitle="Todos os eventos históricos"
            />
            <div className="p-5">
              <Funnel
                steps={[
                  { label: "Eventos recebidos", value: stats.totalAll },
                  { label: "DMs enviadas", value: stats.dmsAll },
                  { label: "Cliques em botão", value: stats.clicksAll },
                ]}
              />
            </div>
          </Card>
        </div>
        <div className="lg:col-span-3">
          <Card>
            <CardHeader
              title="Quando seus seguidores comentam"
              subtitle="Últimos 30 dias · intensidade por hora"
            />
            <div className="p-5">
              <Heatmap data={heatmap} />
            </div>
          </Card>
        </div>
      </section>

      {/* 30-day trend */}
      <section>
        <Card>
          <CardHeader
            title="Tendência 30 dias"
            subtitle="Eventos × DMs enviadas × cliques"
            right={
              <Link
                href="/dashboard/analytics"
                className="text-tiny text-accent hover:underline"
              >
                Ver analytics →
              </Link>
            }
          />
          <div className="p-5">
            <LineChart
              labels={labels30}
              series={[
                { label: "Eventos", data: eventsSeries30, color: "#22d3ee" },
                { label: "DMs", data: dmsSeries30, color: "#34d399" },
                { label: "Cliques", data: clicksSeries30, color: "#a78bfa" },
              ]}
              height={200}
            />
          </div>
        </Card>
      </section>

      {/* Rule funnels table */}
      <section>
        <Card>
          <CardHeader
            title="Performance por regra"
            subtitle="Conversão comentário → DM → clique, all-time"
            right={
              <Link
                href="/dashboard/rules"
                className="text-tiny text-accent hover:underline"
              >
                Gerenciar →
              </Link>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-tiny text-dim-2 uppercase tracking-wider">
                  <th className="px-5 py-3 text-left font-medium">Regra</th>
                  <th className="px-3 py-3 text-left font-medium">Trigger</th>
                  <th className="px-3 py-3 text-right font-medium">Eventos</th>
                  <th className="px-3 py-3 text-right font-medium">DMs</th>
                  <th className="px-3 py-3 text-right font-medium">Cliques</th>
                  <th className="px-5 py-3 text-right font-medium">Conv. DM→Click</th>
                </tr>
              </thead>
              <tbody>
                {ruleFunnels.map((f) => {
                  const convClick = f.dms ? (f.clicks / f.dms) * 100 : 0;
                  return (
                    <tr
                      key={f.id}
                      className="border-t border-line hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-5 py-3">
                        <div className="font-medium text-fg">{f.name}</div>
                        {f.keyword && (
                          <div className="text-tiny text-dim-2 font-mono mt-0.5">
                            {f.keyword}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <TriggerBadge type={f.trigger_type} />
                      </td>
                      <td className="px-3 py-3 text-right mono-num">
                        {f.events}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className="mono-num">{f.dms}</span>
                        {f.events > 0 && (
                          <span className="text-tiny text-dim-2 ml-1">
                            {fmtPct(f.dms, f.events)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right mono-num">
                        {f.clicks}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span
                          className={`mono-num ${
                            convClick >= 30
                              ? "text-good"
                              : convClick >= 10
                              ? "text-warn"
                              : "text-dim-2"
                          }`}
                        >
                          {convClick.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {ruleFunnels.length === 0 && (
              <div className="p-8 text-center text-dim-2 text-sm">
                Nenhuma regra acionada ainda
              </div>
            )}
          </div>
        </Card>
      </section>

      {/* A/B tests + Keyword suggestions */}
      {(abRules.length > 0 || hasData) && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {abRules.length > 0 ? (
            <div className="space-y-3">
              <div className="text-sm font-semibold flex items-center gap-2">
                🅰🅱 A/B tests em andamento
              </div>
              {abRules.slice(0, 3).map((r: any) => (
                <ABCard key={r.id} rule={r} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-line p-6 text-center text-dim-2 text-sm">
              Nenhum A/B test ativo. Adicione <strong>variantes</strong> numa regra pra começar.
            </div>
          )}
          <KeywordSuggestions />
        </section>
      )}

      {/* Activity feed + Top leads */}
      <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <Card>
            <CardHeader
              title="Atividade recente"
              subtitle="Últimos 40 eventos"
            />
            <div className="divide-y divide-line">
              {recent.map((e) => (
                <ActivityRow key={e.id} event={e} />
              ))}
              {recent.length === 0 && (
                <div className="p-8 text-center text-dim-2 text-sm">
                  Sem atividade
                </div>
              )}
            </div>
          </Card>
        </div>
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Top leads"
              subtitle="Mais engajados · últimos 30d"
            />
            <div className="divide-y divide-line">
              {topLeads.map((lead, idx) => (
                <Link
                  key={lead.user_id}
                  href={`/dashboard/leads/${lead.user_id}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors group"
                >
                  <div className="mono-num text-tiny text-dim-2 w-6">
                    {String(idx + 1).padStart(2, "0")}
                  </div>
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-accent/40 to-violet/40 flex items-center justify-center text-tiny font-bold uppercase">
                    {(lead.username || "??").slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate group-hover:text-accent transition-colors">
                      {lead.username ? `@${lead.username}` : "anônimo"}
                    </div>
                    <div className="text-tiny text-dim-2 font-mono">
                      {fmtRelative(lead.last)} atrás
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-warn">
                    <Flame className="h-3.5 w-3.5" />
                    <span className="mono-num text-sm text-fg">{lead.count}</span>
                  </div>
                </Link>
              ))}
              {topLeads.length === 0 && (
                <div className="p-8 text-center text-dim-2 text-sm">
                  Nenhum lead identificado
                </div>
              )}
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}

/* =========== helpers =========== */

function Kpi({
  label,
  value,
  delta,
  sub,
  series,
  color = "#22d3ee",
}: {
  label: string;
  value: string;
  delta?: number;
  sub?: string;
  series: number[];
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface shadow-card p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-tiny text-dim-2 uppercase tracking-wider">
            {label}
          </div>
          <div className="mt-2 text-2xl font-semibold mono-num text-fg">
            {value}
          </div>
          <div className="mt-1 text-tiny flex items-center gap-2 text-dim-2">
            {delta !== undefined && <Delta value={delta} />}
            {sub && <span>{sub}</span>}
          </div>
        </div>
        <div style={{ color }}>
          <Sparkline data={series} color={color} />
        </div>
      </div>
    </div>
  );
}

function TriggerBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; tone: any }> = {
    comment: { label: "comentário", tone: "accent" },
    first_dm: { label: "1ª DM", tone: "violet" },
    story_reply: { label: "story", tone: "warn" },
  };
  const v = map[type] ?? { label: type, tone: "dim" };
  return <StatusPill tone={v.tone} label={v.label} />;
}

function ActivityRow({ event: e }: { event: any }) {
  const ok = e.dm_sent || e.public_reply_sent;
  const tone: any = e.dm_error
    ? "danger"
    : ok
    ? "good"
    : "dim";
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="h-8 w-8 rounded-full bg-gradient-to-br from-bg-2 to-surface-2 flex items-center justify-center text-tiny font-bold uppercase text-dim-2 border border-line-2">
        {(e.ig_username || "??").slice(0, 2)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">
            {e.ig_username ? `@${e.ig_username}` : "anônimo"}
          </span>
          {e.matched_keyword && (
            <span className="text-tiny font-mono text-accent bg-accent-dim rounded px-1.5 py-0.5">
              {e.matched_keyword}
            </span>
          )}
        </div>
        <div className="text-sm text-dim-2 truncate">{e.comment_text}</div>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <StatusPill
          tone={tone}
          label={e.dm_sent ? "DM ok" : e.dm_error ? "falha" : "sem DM"}
        />
        <span className="text-tiny text-dim-2 font-mono">
          {fmtRelative(e.created_at)}
        </span>
      </div>
    </div>
  );
}
