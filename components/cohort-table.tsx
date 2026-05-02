import React from "react";
import type { CohortRow } from "@/lib/analytics";

export function CohortTable({ rows }: { rows: CohortRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="p-8 text-center text-dim-2 text-sm">
        Sem dados de cohort — precisa pelo menos 2 semanas de eventos.
      </div>
    );
  }

  const maxSize = Math.max(...rows.map((r) => r.size), 1);

  const cellColor = (num: number, denom: number) => {
    if (denom === 0) return { bg: "rgba(255,255,255,0.03)", txt: "text-dim-2" };
    const rate = num / denom;
    if (rate >= 0.4) return { bg: "rgba(52,211,153,0.20)", txt: "text-good" };
    if (rate >= 0.15) return { bg: "rgba(251,191,36,0.16)", txt: "text-warn" };
    if (rate > 0) return { bg: "rgba(34,211,238,0.12)", txt: "text-accent" };
    return { bg: "rgba(255,255,255,0.03)", txt: "text-dim-2" };
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-tiny text-dim-2 uppercase tracking-wider">
            <th className="px-3 py-2 text-left font-medium">Coorte (semana)</th>
            <th className="px-3 py-2 text-right font-medium">Tamanho</th>
            <th className="px-3 py-2 text-center font-medium">D+7</th>
            <th className="px-3 py-2 text-center font-medium">D+14</th>
            <th className="px-3 py-2 text-center font-medium">D+30</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sizeBar = (r.size / maxSize) * 100;
            return (
              <tr key={r.week} className="border-t border-line">
                <td className="px-3 py-2">
                  <div className="font-mono text-tiny text-dim-2">{r.week}</div>
                  <div className="text-tiny text-dim">desde {r.week_start}</div>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center gap-2 justify-end">
                    <div className="flex-1 h-1 rounded-full bg-white/5 max-w-[80px] overflow-hidden">
                      <div
                        className="h-full bg-accent/40"
                        style={{ width: `${sizeBar}%` }}
                      />
                    </div>
                    <span className="mono-num w-8 text-right">{r.size}</span>
                  </div>
                </td>
                {(
                  [
                    [r.clicked_d7, r.size],
                    [r.clicked_d14, r.size],
                    [r.clicked_d30, r.size],
                  ] as Array<[number, number]>
                ).map(([num, denom], i) => {
                  const c = cellColor(num, denom);
                  const pct =
                    denom === 0 ? 0 : Math.round((num / denom) * 100);
                  return (
                    <td
                      key={i}
                      className="px-3 py-2 text-center"
                      style={{ background: c.bg }}
                    >
                      <div className={`mono-num ${c.txt} text-sm font-semibold`}>
                        {pct}%
                      </div>
                      <div className="text-tiny text-dim-2">
                        {num}/{denom}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
