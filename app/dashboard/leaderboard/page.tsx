import { supabaseAdmin } from "@/lib/supabase";
import { Card, CardHeader, EmptyState, StatusPill } from "@/components/viz";
import { fmtCompact, fmtPct } from "@/lib/format";
import type { Account } from "@/types/db";
import { Trophy, ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

type Media = {
  id: string;
  caption: string;
  permalink: string;
  thumbnail: string;
  media_type: string;
  timestamp: string;
};

async function fetchMediaMap(account: Account): Promise<Map<string, Media>> {
  const map = new Map<string, Media>();
  try {
    const url =
      "https://graph.instagram.com/v25.0/me/media?fields=id,caption,permalink,thumbnail_url,media_url,media_type,timestamp&limit=100";
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${account.ig_access_token}` },
      cache: "no-store",
    });
    if (!res.ok) return map;
    const json: any = await res.json();
    for (const m of json.data ?? []) {
      map.set(m.id, {
        id: m.id,
        caption: m.caption ?? "",
        permalink: m.permalink,
        thumbnail: m.thumbnail_url ?? m.media_url,
        media_type: m.media_type,
        timestamp: m.timestamp,
      });
    }
  } catch {}
  return map;
}

async function load() {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();

  const [accountRes, eventsRes, linksRes] = await Promise.all([
    sb
      .from("accounts")
      .select("*")
      .eq("active", true)
      .limit(1)
      .maybeSingle<Account>(),
    sb
      .from("events")
      .select("ig_media_id, dm_sent, ig_user_id")
      .gte("created_at", since)
      .not("ig_media_id", "is", null),
    sb
      .from("tracked_links")
      .select("event_id, click_count")
      .gt("click_count", 0),
  ]);

  const account = accountRes.data;
  if (!account) return { account: null, rows: [] };

  const events = (eventsRes.data ?? []) as any[];
  const links = (linksRes.data ?? []) as any[];

  // click count per event_id
  const clicksByEvent = new Map<string, number>();
  for (const l of links) {
    if (!l.event_id) continue;
    clicksByEvent.set(l.event_id, (clicksByEvent.get(l.event_id) ?? 0) + (l.click_count ?? 0));
  }

  // Aggregate per media
  type Agg = {
    media_id: string;
    events: number;
    dms: number;
    unique_users: Set<string>;
    clicks: number;
  };
  const agg = new Map<string, Agg>();
  for (const e of events) {
    const key = e.ig_media_id as string;
    const row =
      agg.get(key) ??
      { media_id: key, events: 0, dms: 0, unique_users: new Set(), clicks: 0 };
    row.events++;
    if (e.dm_sent) row.dms++;
    if (e.ig_user_id) row.unique_users.add(e.ig_user_id);
    agg.set(key, row);
  }

  // link clicks: need to join via event_id → media_id. We need events+links joined.
  // For simplicity, fetch events w/ id + media
  const { data: eventsFull } = await sb
    .from("events")
    .select("id, ig_media_id")
    .gte("created_at", since)
    .not("ig_media_id", "is", null);

  const eventToMedia = new Map<string, string>();
  for (const ef of (eventsFull ?? []) as any[]) {
    eventToMedia.set(ef.id, ef.ig_media_id);
  }
  for (const [eventId, count] of clicksByEvent.entries()) {
    const mediaId = eventToMedia.get(eventId);
    if (!mediaId) continue;
    const row = agg.get(mediaId);
    if (row) row.clicks += count;
  }

  const mediaMap = await fetchMediaMap(account);

  const rows = Array.from(agg.values())
    .map((r) => ({
      ...r,
      unique_users_count: r.unique_users.size,
      media: mediaMap.get(r.media_id) ?? null,
    }))
    .sort((a, b) => b.events - a.events)
    .slice(0, 20);

  return { account, rows };
}

export default async function LeaderboardPage() {
  const { account, rows } = await load();

  if (!account) {
    return (
      <div className="space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">Leaderboard</h1>
        <EmptyState
          title="Sem conta conectada"
          message="Conecte uma conta pra ver leaderboard."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-4xl font-bold tracking-tight flex items-center gap-2">
          <Trophy className="h-8 w-8 text-warn" />
          Leaderboard
        </h1>
        <p className="text-dim-2 text-sm">
          Posts que mais geraram leads nos últimos 30 dias
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          title="Sem dados suficientes"
          message="Quando posts receberem eventos, aparecem aqui ordenados por volume."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((r, idx) => (
            <Card key={r.media_id} className="overflow-hidden group">
              <div className="aspect-square bg-black relative overflow-hidden">
                {r.media?.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.media.thumbnail}
                    alt=""
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-dim-2 text-tiny">
                    sem preview
                  </div>
                )}

                {/* rank badge */}
                <div
                  className={`absolute top-3 left-3 h-10 w-10 rounded-full flex items-center justify-center font-bold mono-num text-lg ${
                    idx === 0
                      ? "bg-warn text-black"
                      : idx === 1
                      ? "bg-dim-2 text-black"
                      : idx === 2
                      ? "bg-[#cd7f32] text-black"
                      : "bg-bg/80 text-fg backdrop-blur"
                  }`}
                >
                  {idx + 1}
                </div>

                {r.media?.permalink && (
                  <a
                    href={r.media.permalink}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="absolute top-3 right-3 h-8 w-8 rounded-full bg-black/60 backdrop-blur flex items-center justify-center text-white/80 hover:text-white hover:bg-black/80 transition-all"
                    title="Abrir no Instagram"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}

                {r.media?.media_type && (
                  <div className="absolute bottom-3 left-3">
                    <StatusPill
                      tone={r.media.media_type === "VIDEO" ? "violet" : "accent"}
                      label={r.media.media_type}
                    />
                  </div>
                )}
              </div>

              <div className="p-4 space-y-3">
                <div className="text-xs line-clamp-2 leading-snug min-h-[32px]">
                  {r.media?.caption || (
                    <span className="text-dim-2 italic">sem legenda</span>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2 text-center">
                  <Metric label="events" value={r.events} tone="accent" />
                  <Metric label="DMs" value={r.dms} tone="good" />
                  <Metric label="users" value={r.unique_users_count} />
                  <Metric label="clicks" value={r.clicks} tone="violet" />
                </div>

                <div className="text-tiny text-dim-2 mono-num flex justify-between">
                  <span>
                    conv {fmtPct(r.clicks, r.dms)}
                  </span>
                  <span className="truncate max-w-[50%]" title={r.media_id}>
                    {r.media_id.slice(0, 16)}…
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "violet" | "accent";
}) {
  const color =
    tone === "good"
      ? "text-good"
      : tone === "violet"
      ? "text-violet"
      : tone === "accent"
      ? "text-accent"
      : "text-fg";
  return (
    <div>
      <div className={`text-sm font-semibold mono-num ${color}`}>
        {fmtCompact(value)}
      </div>
      <div className="text-tiny text-dim-2 uppercase tracking-wider">{label}</div>
    </div>
  );
}
