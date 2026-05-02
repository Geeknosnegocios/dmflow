export function fmtRelative(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return "agora";
  if (diff < hour) return `${Math.floor(diff / min)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

export function fmtCompact(n: number): string {
  if (n < 1000) return n.toLocaleString("pt-BR");
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  return (n / 1_000_000).toFixed(1) + "M";
}

export function fmtPct(num: number, denom: number): string {
  if (!denom) return "0%";
  return `${((num / denom) * 100).toFixed(num / denom >= 0.1 ? 0 : 1)}%`;
}

/**
 * Build 7-day sparkline buckets (oldest → newest)
 * Each bucket = count of items with created_at in that day.
 */
export function bucket7Days(dates: string[]): number[] {
  const buckets = [0, 0, 0, 0, 0, 0, 0];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = today.getTime() - 6 * 86400000;
  for (const d of dates) {
    const t = new Date(d).getTime();
    if (t < start) continue;
    const idx = Math.floor((t - start) / 86400000);
    if (idx >= 0 && idx < 7) buckets[idx]++;
  }
  return buckets;
}

/**
 * Build heatmap matrix [day_of_week_0_mon..6_sun][hour_0..23]
 */
export function heatmapMatrix(dates: string[]): number[][] {
  const m: number[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0)
  );
  for (const d of dates) {
    const dt = new Date(d);
    // JS: 0=Sun..6=Sat  →  convert to 0=Mon..6=Sun
    const jsDow = dt.getDay();
    const row = (jsDow + 6) % 7;
    const col = dt.getHours();
    m[row][col]++;
  }
  return m;
}
