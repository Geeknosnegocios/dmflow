/**
 * Cohort analysis: groups users by week of first contact,
 * returns retention % at 7/14/30 days based on click/return events.
 */
export type CohortRow = {
  week: string; // "YYYY-Www" label
  week_start: string; // ISO
  size: number;
  clicked_d7: number;
  clicked_d14: number;
  clicked_d30: number;
};

function startOfWeek(d: Date): Date {
  const dow = d.getDay(); // 0 Sun..6 Sat
  const diff = (dow + 6) % 7; // days since Monday
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() - diff);
  return m;
}

function weekLabel(d: Date): string {
  const year = d.getFullYear();
  const firstThursday = new Date(year, 0, 4);
  const firstWeekStart = startOfWeek(firstThursday);
  const weekNum =
    Math.floor((d.getTime() - firstWeekStart.getTime()) / (7 * 86400000)) + 1;
  return `${year}-W${String(weekNum).padStart(2, "0")}`;
}

export function buildCohorts(
  events: Array<{ ig_user_id: string | null; created_at: string }>,
  clicksByUser: Map<string, number[]>
): CohortRow[] {
  // first-seen per user
  const firstByUser = new Map<string, Date>();
  for (const e of events) {
    if (!e.ig_user_id) continue;
    const t = new Date(e.created_at);
    const prev = firstByUser.get(e.ig_user_id);
    if (!prev || t < prev) firstByUser.set(e.ig_user_id, t);
  }

  const cohortMap = new Map<
    string,
    { week_start: Date; users: Set<string> }
  >();

  for (const [userId, firstDate] of firstByUser.entries()) {
    const wStart = startOfWeek(firstDate);
    const key = wStart.toISOString().slice(0, 10);
    const row = cohortMap.get(key) ?? { week_start: wStart, users: new Set() };
    row.users.add(userId);
    cohortMap.set(key, row);
  }

  const rows: CohortRow[] = [];
  for (const [_key, row] of cohortMap.entries()) {
    let d7 = 0,
      d14 = 0,
      d30 = 0;
    for (const userId of row.users) {
      const firstTs = firstByUser.get(userId)!.getTime();
      const userClicks = clicksByUser.get(userId) ?? [];
      for (const ct of userClicks) {
        const diffDays = (ct - firstTs) / 86400000;
        if (diffDays >= 0 && diffDays <= 7) d7++;
        if (diffDays >= 0 && diffDays <= 14) d14++;
        if (diffDays >= 0 && diffDays <= 30) d30++;
      }
    }
    rows.push({
      week: weekLabel(row.week_start),
      week_start: row.week_start.toISOString().slice(0, 10),
      size: row.users.size,
      clicked_d7: d7,
      clicked_d14: d14,
      clicked_d30: d30,
    });
  }

  rows.sort((a, b) => a.week_start.localeCompare(b.week_start));
  return rows.slice(-12); // últimas 12 semanas
}

/**
 * Simple linear regression forecast.
 * Given series of last N periods, extrapolates next M periods.
 */
export function forecastLinear(
  series: number[],
  periodsAhead: number
): number[] {
  const n = series.length;
  if (n < 2) return new Array(periodsAhead).fill(series[0] ?? 0);

  // mean x, y
  const xs = series.map((_, i) => i);
  const ys = series;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;

  const out: number[] = [];
  for (let i = 0; i < periodsAhead; i++) {
    const x = n + i;
    const y = intercept + slope * x;
    out.push(Math.max(0, Math.round(y)));
  }
  return out;
}

/**
 * Period comparison. Given a target period and its previous equivalent,
 * returns { current, previous, delta_abs, delta_pct }.
 */
export function compareTotals(current: number, previous: number) {
  const deltaAbs = current - previous;
  const deltaPct =
    previous === 0
      ? current === 0
        ? 0
        : 100
      : (deltaAbs / previous) * 100;
  return {
    current,
    previous,
    delta_abs: deltaAbs,
    delta_pct: deltaPct,
  };
}
