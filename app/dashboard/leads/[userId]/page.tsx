import { supabaseAdmin } from "@/lib/supabase";
import { Card, CardHeader, EmptyState, StatusPill } from "@/components/viz";
import { fmtRelative } from "@/lib/format";
import {
  MessageSquare,
  Hand,
  Camera,
  Mail,
  MousePointerClick,
  Send,
  XCircle,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

type TimelineItem =
  | {
      kind: "event";
      at: string;
      event_id: string;
      trigger: string;
      rule_name: string | null;
      comment_text: string | null;
      matched_keyword: string | null;
      dm_sent: boolean;
      dm_error: string | null;
      public_reply_sent: boolean;
      post_id: string | null;
    }
  | {
      kind: "click";
      at: string;
      button_title: string | null;
      target_url: string;
      rule_name: string | null;
    };

async function load(userId: string) {
  const sb = supabaseAdmin();

  const [eventsRes, linksRes, clicksRes] = await Promise.all([
    sb
      .from("events")
      .select(
        "id, created_at, rule_id, matched_keyword, comment_text, dm_sent, dm_error, public_reply_sent, ig_media_id, ig_username"
      )
      .eq("ig_user_id", userId)
      .order("created_at", { ascending: true }),
    sb
      .from("tracked_links")
      .select("id, rule_id, button_title, target_url, event_id, click_count, first_clicked_at, last_clicked_at")
      .eq("ig_user_id", userId),
    sb
      .from("link_clicks")
      .select("tracked_link_id, clicked_at")
      .order("clicked_at", { ascending: true }),
  ]);

  const events = (eventsRes.data ?? []) as any[];
  const links = (linksRes.data ?? []) as any[];
  const clicks = (clicksRes.data ?? []) as any[];

  const { data: rules } = await sb
    .from("rules")
    .select("id, name, trigger_type");
  const ruleNameById = new Map<string, { name: string; trigger_type: string }>();
  for (const r of (rules ?? []) as any[]) ruleNameById.set(r.id, r);

  const linkIds = new Set(links.map((l) => l.id));
  const linkMetaById = new Map<string, any>();
  for (const l of links) linkMetaById.set(l.id, l);

  const timeline: TimelineItem[] = [];

  for (const e of events) {
    timeline.push({
      kind: "event",
      at: e.created_at,
      event_id: e.id,
      trigger: ruleNameById.get(e.rule_id)?.trigger_type ?? "unknown",
      rule_name: ruleNameById.get(e.rule_id)?.name ?? null,
      comment_text: e.comment_text,
      matched_keyword: e.matched_keyword,
      dm_sent: e.dm_sent,
      dm_error: e.dm_error,
      public_reply_sent: e.public_reply_sent,
      post_id: e.ig_media_id,
    });
  }

  for (const c of clicks) {
    if (!linkIds.has(c.tracked_link_id)) continue;
    const meta = linkMetaById.get(c.tracked_link_id);
    timeline.push({
      kind: "click",
      at: c.clicked_at,
      button_title: meta?.button_title ?? null,
      target_url: meta?.target_url ?? "",
      rule_name: meta ? ruleNameById.get(meta.rule_id)?.name ?? null : null,
    });
  }

  timeline.sort((a, b) => a.at.localeCompare(b.at));

  const firstSeen = events[0]?.created_at ?? null;
  const username = events[0]?.ig_username ?? null;
  const totalClicks = clicks.filter((c) => linkIds.has(c.tracked_link_id))
    .length;
  const totalEvents = events.length;
  const totalDms = events.filter((e) => e.dm_sent).length;

  return {
    timeline,
    firstSeen,
    username,
    totalClicks,
    totalEvents,
    totalDms,
    userId,
  };
}

export default async function LeadJourneyPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const data = await load(userId);

  if (data.totalEvents === 0) {
    return (
      <div className="space-y-6">
        <Link href="/dashboard" className="text-tiny text-dim-2 hover:text-fg inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> voltar
        </Link>
        <h1 className="text-4xl font-bold tracking-tight">Lead</h1>
        <EmptyState
          title="Usuário não tem atividade"
          message={`Nenhum evento registrado para user_id ${userId}.`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/dashboard"
          className="text-tiny text-dim-2 hover:text-fg inline-flex items-center gap-1 mb-3"
        >
          <ArrowLeft className="h-3 w-3" /> voltar ao dashboard
        </Link>
        <header className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-gradient-to-br from-accent via-violet to-warn flex items-center justify-center text-2xl font-bold uppercase">
            {(data.username ?? "??").slice(0, 2)}
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {data.username ? `@${data.username}` : "Usuário anônimo"}
            </h1>
            <p className="text-dim-2 text-sm font-mono">
              {userId} · primeiro contato {data.firstSeen ? fmtRelative(data.firstSeen) + " atrás" : "—"}
            </p>
          </div>
        </header>
      </div>

      {/* Quick stats */}
      <section className="grid grid-cols-3 gap-3">
        <QuickStat label="Eventos" value={data.totalEvents} tone="accent" />
        <QuickStat label="DMs recebidas" value={data.totalDms} tone="good" />
        <QuickStat label="Cliques" value={data.totalClicks} tone="violet" />
      </section>

      {/* Timeline */}
      <Card>
        <CardHeader
          title="Timeline completa"
          subtitle={`${data.timeline.length} eventos do primeiro contato até agora`}
        />
        <div className="p-5">
          <ol className="relative space-y-5">
            {/* vertical rail */}
            <div
              className="absolute left-4 top-2 bottom-2 w-px bg-line-2"
              aria-hidden
            />
            {data.timeline.map((item, idx) => (
              <TimelineRow key={idx} item={item} />
            ))}
          </ol>
        </div>
      </Card>
    </div>
  );
}

function QuickStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "accent" | "good" | "violet";
}) {
  const color =
    tone === "accent" ? "text-accent" : tone === "good" ? "text-good" : "text-violet";
  return (
    <div className="rounded-xl border border-line bg-surface shadow-card p-4">
      <div className="text-tiny text-dim-2 uppercase tracking-wider">{label}</div>
      <div className={`mt-2 text-2xl font-semibold mono-num ${color}`}>
        {value}
      </div>
    </div>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  if (item.kind === "event") {
    const triggerMap: Record<string, any> = {
      comment: { Icon: MessageSquare, tone: "accent", label: "comentou" },
      first_dm: { Icon: Hand, tone: "violet", label: "primeira DM" },
      story_reply: { Icon: Camera, tone: "warn", label: "respondeu story" },
      unknown: { Icon: Mail, tone: "dim", label: "evento" },
    };
    const t = triggerMap[item.trigger] ?? triggerMap.unknown;
    const { Icon } = t;
    return (
      <li className="relative pl-10">
        <div className={`absolute left-0 top-1 h-8 w-8 rounded-full border-2 border-bg flex items-center justify-center ${
          t.tone === "accent" ? "bg-accent-dim text-accent"
            : t.tone === "violet" ? "bg-violet-dim text-violet"
            : t.tone === "warn" ? "bg-warn-dim text-warn"
            : "bg-white/5 text-dim-2"
        }`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill tone={t.tone} label={t.label} />
            {item.matched_keyword && (
              <span className="text-tiny font-mono text-accent bg-accent-dim rounded px-1.5 py-0.5">
                {item.matched_keyword}
              </span>
            )}
            {item.rule_name && (
              <span className="text-tiny text-dim-2">· regra "{item.rule_name}"</span>
            )}
            <span className="text-tiny text-dim-2 font-mono ml-auto">
              {fmtRelative(item.at)}
            </span>
          </div>
          {item.comment_text && (
            <div className="text-sm text-dim-2 bg-bg-1 rounded-lg border border-line px-3 py-2">
              "{item.comment_text}"
            </div>
          )}
          <div className="flex gap-2 text-tiny flex-wrap">
            {item.dm_sent ? (
              <span className="inline-flex items-center gap-1 text-good">
                <Send className="h-3 w-3" /> DM enviada
              </span>
            ) : item.dm_error ? (
              <span className="inline-flex items-center gap-1 text-danger" title={item.dm_error}>
                <XCircle className="h-3 w-3" /> DM falhou
              </span>
            ) : null}
            {item.public_reply_sent && (
              <span className="inline-flex items-center gap-1 text-good">
                <MessageSquare className="h-3 w-3" /> reply público enviado
              </span>
            )}
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="relative pl-10">
      <div className="absolute left-0 top-1 h-8 w-8 rounded-full border-2 border-bg flex items-center justify-center bg-accent text-accent-ink">
        <MousePointerClick className="h-4 w-4" />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill tone="accent" label="clicou" pulse />
          <span className="text-sm font-medium">
            {item.button_title || "link"}
          </span>
          {item.rule_name && (
            <span className="text-tiny text-dim-2">· regra "{item.rule_name}"</span>
          )}
          <span className="text-tiny text-dim-2 font-mono ml-auto">
            {fmtRelative(item.at)}
          </span>
        </div>
        {item.target_url && (
          <a
            href={item.target_url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-tiny font-mono text-accent truncate block hover:underline"
          >
            → {item.target_url}
          </a>
        )}
      </div>
    </li>
  );
}
