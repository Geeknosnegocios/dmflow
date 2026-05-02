import React from "react";
import { compareTotals } from "@/lib/analytics";
import { fmtCompact } from "@/lib/format";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type CompareRow = {
  label: string;
  current: number;
  previous: number;
  invertGood?: boolean; // true = lower is better (e.g. errors)
};

export function CompareCard({
  rows,
  currentLabel,
  previousLabel,
}: {
  rows: CompareRow[];
  currentLabel: string;
  previousLabel: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface shadow-card overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-line">
        <div>
          <div className="text-sm font-semibold">
            Comparar períodos
          </div>
          <div className="text-tiny text-dim-2 font-mono">
            {currentLabel} vs {previousLabel}
          </div>
        </div>
      </div>
      <div className="divide-y divide-line">
        {rows.map((row) => {
          const c = compareTotals(row.current, row.previous);
          const isPositive = row.invertGood ? c.delta_abs < 0 : c.delta_abs > 0;
          const isZero = c.delta_abs === 0;
          const tone = isZero
            ? "text-dim-2"
            : isPositive
            ? "text-good"
            : "text-danger";
          const Icon = isZero
            ? Minus
            : isPositive
            ? TrendingUp
            : TrendingDown;
          return (
            <div
              key={row.label}
              className="flex items-center justify-between gap-4 px-5 py-3"
            >
              <div className="text-sm text-dim-2 flex-1">{row.label}</div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <div className="text-tiny text-dim-2">atual</div>
                  <div className="mono-num text-lg font-semibold">
                    {fmtCompact(c.current)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-tiny text-dim-2">anterior</div>
                  <div className="mono-num text-lg text-dim-2">
                    {fmtCompact(c.previous)}
                  </div>
                </div>
                <div
                  className={`text-right min-w-[80px] ${tone}`}
                  title={`${c.delta_abs > 0 ? "+" : ""}${c.delta_abs} · ${c.delta_pct.toFixed(1)}%`}
                >
                  <div className="flex items-center justify-end gap-1 text-sm font-semibold mono-num">
                    <Icon className="h-3.5 w-3.5" />
                    {Math.abs(c.delta_pct).toFixed(0)}%
                  </div>
                  <div className="text-tiny mono-num">
                    {c.delta_abs > 0 ? "+" : ""}
                    {c.delta_abs}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
