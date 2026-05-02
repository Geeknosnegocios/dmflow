import React from "react";
import type { Rule } from "@/types/db";
import { variantStats } from "@/lib/variant-picker";
import { StatusPill } from "@/components/viz";
import { Trophy } from "lucide-react";

export function ABCard({ rule }: { rule: Rule }) {
  const stats = variantStats(rule);
  if (!stats) return null;

  const totalHits = stats.reduce((a, s) => a + s.hits, 0);
  const hasData = totalHits > 0;

  return (
    <div className="rounded-xl border border-line bg-surface shadow-card p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="font-semibold text-sm">{rule.name}</div>
          <div className="text-tiny text-dim-2 font-mono">
            {stats.length} variantes · {totalHits} envios
          </div>
        </div>
        {hasData && stats.some((s) => s.is_leader) && (
          <StatusPill tone="good" label="ganhador identificado" />
        )}
      </div>
      <div className="space-y-2">
        {stats.map((v) => (
          <div
            key={v.index}
            className={`rounded-lg border ${
              v.is_leader ? "border-good/40 bg-good-dim" : "border-line"
            } p-3`}
          >
            <div className="flex items-center justify-between gap-2 mb-1 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="mono-num font-semibold">
                  V{String.fromCharCode(65 + v.index)}
                </span>
                {v.is_leader && <Trophy className="h-3 w-3 text-good" />}
              </div>
              <div className="flex items-center gap-3 text-tiny text-dim-2 mono-num">
                <span>{v.hits} hits</span>
                <span>{v.conversions} clicks</span>
                <span className={v.is_leader ? "text-good font-semibold" : ""}>
                  {(v.rate * 100).toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="text-xs text-dim-2 line-clamp-2">
              {v.message_preview || "(variante sem mensagem)"}
            </div>
            {v.hits > 0 && (
              <div className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden">
                <div
                  className={`h-full ${
                    v.is_leader ? "bg-good" : "bg-accent/50"
                  }`}
                  style={{ width: `${v.rate * 100}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
