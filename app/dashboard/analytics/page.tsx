import { supabaseAdmin } from "@/lib/supabase";
import { Card, CardHeader, EmptyState, StatusPill } from "@/components/viz";
import { LineChart } from "@/components/chart";
import { CohortTable } from "@/components/cohort-table";
import { CompareCard } from "@/components/compare-card";
import { ForecastChart } from "@/components/forecast-chart";
import { buildCohorts, forecastLinear } from "@/lib/analytics";
import { fmtCompact, fmtPct } from "@/lib/format";
import Link from "next/link";

export const dynamic = "force-dynamic";

type PeriodKey = "7d" | "30d" | "90d";

const PERIODS: Record<PeriodKey, { label: string; days: number; bucket: "day" }> = {
  "7d": { label: "7 dias", days: 7, bucket: "day" },
  "30d": { label: "30 dias", days: 30, bucket: "day" },
  "90d": { label: "90 dias", days: 90, bucket: "day" },
};

function bucketDays(dates: string[], days: number): number[] {
  const buckets = new Array(days).fill(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = today.getTime() - (days - 1) * 86400000;
  for (const d of dates) {
    const t = new Date(d).getTime();
    if (t < start) continue;
    const idx = Math.floor((t - start) / 86400000);
    if (idx >= 0 && idx < days) buckets[idx]++;
  }
  return buckets;
}

function buildLabels(days: number): string[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = today.getTime() - (days - 1) * 86400000;
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start + i * 86400000);
    out.push(
      d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    );
  }
  return out;
}

async function load(period: PeriodKey) {
  const sb = supabaseAdmin();
  const { days } = PERIODS[period];
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const prevStart = new Date(Date.now() - 2 * days * 86400000).toISOString();

  const [
    eventsRes,
    clicksRes,
    rulesRes,
    linksRes,
    prevEventsRes,
    prevClicksRes,
    allEventsForCohortRes,
    allClicksForCohortRes,
  ] = await Promise.all([
    sb
      .from("events")
      .select("created_at, dm_sent, rule_id, matched_keyword, ig_user_id, ig_username")
      .gte("created_at", since),
    sb.from("link_clicks").select("clicked_at, tracked_link_id").gte("clicked_at", since),
    sb.from("rules").select("id, name, trigger_type, keyword"),
    sb
      .from("tracked_links")
      .select("id, rule_id, button_title, click_count, created_at, event_id, ig_user_id")
      .gte("created_at", since),
    sb
      .from("events")
      .select("created_at, dm_sent, ig_user_id")
      .gte("created_at", prevStart)
      .lt("created_at", since),
    sb
      .from("link_clicks")
      .select("clicked_at")
      .gte("clicked_at", prevStart)
      .lt("clicked_at", since),
    // Cohort: últimos 90 dias de eventos com ig_user_id
    sb
      .from("events")
      .select("created_at, ig_user_id")
      .not("ig_user_id", "is", null)
      .gte("created_at", new Date(Date.now() - 90 * 86400000).toISOString()),
    // Cohort: cliques dos últimos 90 dias cruzados com user
    sb
      .from("tracked_links")
      .select("ig_user_id, first_clicked_at")
      .not("ig_user_id", "is", null)
      .gt("click_count", 0)
      .gte("created_at", new Date(Date.now() - 90 * 86400000).toISOString()),
  ]);

  const events = (eventsRes.data ?? []) as any[];
  const clicks = (clicksRes.data ?? []) as any[];
  const rules = (rulesRes.data ?? []) as any[];
  const links = (linksRes.data ?? []) as any[];
  const prevEvents = (prevEventsRes.data ?? []) as any[];
  const prevClicks = (prevClicksRes.data ?? []) as any[];
  const cohortEvents = (allEventsForCohortRes.data ?? []) as any[];
  const cohortLinks = (allClicksForCohortRes.data ?? []) as any[];

  const eventSeries = bucketDays(
    events.map((e) => e.created_at),
    days
  );
  const dmSeries = bucketDays(
    events.filter((e) => e.dm_sent).map((e) => e.created_at),
    days
  );
  const clickSeries = bucketDays(
    clicks.map((c) => c.clicked_at),
    days
  );
  const labels = buildLabels(days);

  const totalEvents = events.length;
  const totalDms = events.filter((e) => e.dm_sent).length;
  const totalClicks = clicks.length;

  // top keywords
  const kwMap = new Map<string, number>();
  for (const e of events) {
    if (!e.matched_keyword) continue;
    kwMap.set(e.matched_keyword, (kwMap.get(e.matched_keyword) ?? 0) + 1);
  }
  const topKeywords = Array.from(kwMap.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([keyword, count]) => ({ keyword, count }));

  // top buttons by clicks
  const topButtons = links
    .filter((l) => (l.click_count ?? 0) > 0)
    .sort((a, b) => (b.click_count ?? 0) - (a.click_count ?? 0))
    .slice(0, 8);

  // unique users
  const uniqueUsers = new Set(events.map((e) => e.ig_user_id).filter(Boolean)).size;

  // Compare period (current vs previous)
  const prevTotalEvents = prevEvents.length;
  const prevTotalDms = prevEvents.filter((e) => e.dm_sent).length;
  const prevTotalClicks = prevClicks.length;
  const prevUniqueUsers = new Set(
    prevEvents.map((e) => e.ig_user_id).filter(Boolean)
  ).size;

  // Cohort
  const clicksByUser = new Map<string, number[]>();
  for (const l of cohortLinks) {
    if (!l.ig_user_id || !l.first_clicked_at) continue;
    const arr = clicksByUser.get(l.ig_user_id) ?? [];
    arr.push(new Date(l.first_clicked_at).getTime());
    clicksByUser.set(l.ig_user_id, arr);
  }
  const cohorts = buildCohorts(cohortEvents, clicksByUser);

  // Forecast: projeta 4 bucket futuros baseado em last-half do eventSeries
  const lastHalf = eventSeries.slice(-Math.min(14, Math.floor(eventSeries.length / 2) + 1));
  const forecastData = forecastLinear(lastHalf, Math.min(14, days));

  return {
    eventSeries,
    dmSeries,
    clickSeries,
    labels,
    totalEvents,
    totalDms,
    totalClicks,
    uniqueUsers,
    topKeywords,
    topButtons,
    rules,
    days,
    prev: {
      totalEvents: prevTotalEvents,
      totalDms: prevTotalDms,
      totalClicks: prevTotalClicks,
      uniqueUsers: prevUniqueUsers,
    },
    cohorts,
    forecastData,
  };
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const params = await searchParams;
  const period = (params.p as PeriodKey) in PERIODS ? (params.p as PeriodKey) : "30d";
  const data = await load(period);

  if (data.totalEvents === 0) {
    return (
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Analytics</h1>
            <p className="text-dim-2 text-sm">Métricas detalhadas de performance</p>
          </div>
          <PeriodSwitcher current={period} />
        </header>
        <EmptyState
          title="Sem dados no período selecionado"
          message="Ajuste o período acima ou aguarde novos eventos."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Analytics</h1>
          <p className="text-dim-2 text-sm">
            Métricas detalhadas · {PERIODS[period].label}
          </p>
        </div>
        <PeriodSwitcher current={period} />
      </header>

      {/* Summary */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Eventos" value={fmtCompact(data.totalEvents)} />
        <Metric
          label="DMs enviadas"
          value={fmtCompact(data.totalDms)}
          sub={fmtPct(data.totalDms, data.totalEvents) + " dos eventos"}
          tone="good"
        />
        <Metric
          label="Cliques"
          value={fmtCompact(data.totalClicks)}
          sub={fmtPct(data.totalClicks, data.totalDms) + " das DMs"}
          tone="violet"
        />
        <Metric
          label="Usuários únicos"
          value={fmtCompact(data.uniqueUsers)}
          tone="warn"
        />
      </section>

      {/* Big chart */}
      <Card>
        <CardHeader
          title="Performance no tempo"
          subtitle={`Eventos · DMs · Cliques · ${PERIODS[period].label}`}
        />
        <div className="p-5">
          <LineChart
            labels={data.labels}
            series={[
              { label: "Eventos", data: data.eventSeries, color: "#22d3ee" },
              { label: "DMs", data: data.dmSeries, color: "#34d399" },
              { label: "Cliques", data: data.clickSeries, color: "#a78bfa" },
            ]}
            height={260}
          />
        </div>
      </Card>

      {/* Compare with previous period */}
      <CompareCard
        currentLabel={`últimos ${data.days}d`}
        previousLabel={`${data.days}d anteriores`}
        rows={[
          {
            label: "Eventos recebidos",
            current: data.totalEvents,
            previous: data.prev.totalEvents,
          },
          {
            label: "DMs enviadas",
            current: data.totalDms,
            previous: data.prev.totalDms,
          },
          {
            label: "Cliques",
            current: data.totalClicks,
            previous: data.prev.totalClicks,
          },
          {
            label: "Usuários únicos",
            current: data.uniqueUsers,
            previous: data.prev.uniqueUsers,
          },
        ]}
      />

      {/* Forecast */}
      <Card>
        <CardHeader
          title="Previsão (linear regression)"
          subtitle={`Projeção dos próximos ${data.forecastData.length} dias baseado na tendência atual`}
        />
        <div className="p-5">
          <ForecastChart
            actual={data.eventSeries}
            actualLabels={data.labels}
            forecast={data.forecastData}
            forecastLabels={data.forecastData.map((_, i) => `+${i + 1}d`)}
            height={220}
          />
        </div>
      </Card>

      {/* Cohort analysis */}
      <Card>
        <CardHeader
          title="Cohort de retenção"
          subtitle="Semana do primeiro contato × cliques em 7/14/30 dias (últimas 12 semanas)"
        />
        <CohortTable rows={data.cohorts} />
      </Card>

      {/* Top keywords + buttons */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Top keywords" subtitle="Que acionaram automações" />
          <div className="divide-y divide-line">
            {data.topKeywords.length === 0 ? (
              <div className="p-8 text-center text-dim-2 text-sm">
                Nenhuma keyword acionada
              </div>
            ) : (
              data.topKeywords.map((k, i) => {
                const max = data.topKeywords[0].count || 1;
                const pct = (k.count / max) * 100;
                return (
                  <div key={k.keyword} className="px-5 py-3 flex items-center gap-3">
                    <span className="mono-num text-tiny text-dim-2 w-6">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-sm font-mono text-accent bg-accent-dim rounded px-2 py-0.5">
                      {k.keyword}
                    </span>
                    <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full bg-accent/50"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="mono-num text-sm w-10 text-right">
                      {k.count}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Top botões por cliques"
            subtitle="Melhores performers"
          />
          <div className="divide-y divide-line">
            {data.topButtons.length === 0 ? (
              <div className="p-8 text-center text-dim-2 text-sm">
                Nenhum clique ainda
              </div>
            ) : (
              data.topButtons.map((b, i) => {
                const max = data.topButtons[0].click_count || 1;
                const pct = (b.click_count / max) * 100;
                return (
                  <div key={b.id} className="px-5 py-3 flex items-center gap-3">
                    <span className="mono-num text-tiny text-dim-2 w-6">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-sm truncate max-w-[12rem]">
                      {b.button_title || "(sem título)"}
                    </span>
                    <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full bg-violet/50"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="mono-num text-sm w-10 text-right">
                      {b.click_count}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "violet" | "warn";
}) {
  const color =
    tone === "good"
      ? "text-good"
      : tone === "violet"
      ? "text-violet"
      : tone === "warn"
      ? "text-warn"
      : "text-fg";
  return (
    <div className="rounded-xl border border-line bg-surface shadow-card p-4">
      <div className="text-tiny text-dim-2 uppercase tracking-wider">{label}</div>
      <div className={`mt-2 text-2xl font-semibold mono-num ${color}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-tiny text-dim-2">{sub}</div>}
    </div>
  );
}

function PeriodSwitcher({ current }: { current: PeriodKey }) {
  return (
    <div className="flex items-center rounded-lg border border-line-2 bg-surface p-0.5 text-sm">
      {(Object.entries(PERIODS) as [PeriodKey, (typeof PERIODS)[PeriodKey]][]).map(
        ([key, p]) => {
          const active = key === current;
          return (
            <Link
              key={key}
              href={`/dashboard/analytics?p=${key}`}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                active
                  ? "bg-accent-dim text-accent"
                  : "text-dim-2 hover:text-fg"
              }`}
            >
              {p.label}
            </Link>
          );
        }
      )}
    </div>
  );
}
