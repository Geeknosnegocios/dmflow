"use client";

import React, { useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";

type Suggestion = {
  keyword: string;
  rationale: string;
  suggested_cta: string;
};

export function KeywordSuggestions() {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    analyzed: number;
    current: string[];
  } | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/suggest-keywords");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "falha");
      setItems(json.suggestions ?? []);
      setMeta({
        analyzed: json.comments_analyzed ?? 0,
        current: json.keywords_in_use ?? [],
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface shadow-card overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-line">
        <div>
          <div className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Sugestões IA de keywords
          </div>
          <div className="text-tiny text-dim-2 mt-0.5">
            Analisa comentários recentes e propõe CTAs novos (Groq + Llama 3.3)
          </div>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="text-tiny rounded-lg border border-accent/30 bg-accent-dim text-accent hover:bg-accent/20 px-3 py-2 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 min-h-[36px]"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
          {loading ? "analisando…" : items ? "atualizar" : "gerar"}
        </button>
      </div>

      <div className="p-5">
        {!items && !loading && !error && (
          <div className="text-center text-dim-2 text-sm py-6">
            Clica em "gerar" pra IA sugerir CTAs baseado nos teus últimos comentários.
          </div>
        )}

        {loading && (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-16 rounded-lg bg-white/[0.04] animate-pulse"
              />
            ))}
          </div>
        )}

        {error && (
          <div className="text-sm text-danger text-center py-4">
            Erro: {error}
          </div>
        )}

        {items && items.length > 0 && (
          <div className="space-y-2">
            {items.map((s) => (
              <div
                key={s.keyword}
                className="rounded-lg border border-line bg-bg-1 p-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-block rounded-md bg-accent-dim text-accent px-2 py-0.5 text-sm font-mono font-semibold">
                    {s.keyword}
                  </span>
                  <span className="text-tiny text-dim-2 italic">
                    {s.rationale}
                  </span>
                </div>
                <div className="text-sm text-dim-2 leading-snug">
                  <span className="text-tiny uppercase text-accent mr-1">
                    cta:
                  </span>
                  {s.suggested_cta}
                </div>
              </div>
            ))}
          </div>
        )}

        {items && items.length === 0 && meta && (
          <div className="text-sm text-dim-2 text-center py-4">
            Sem comentários suficientes. Publica um post com CTA e volta.
          </div>
        )}

        {meta && (
          <div className="mt-3 text-tiny text-dim-2 font-mono">
            {meta.analyzed} comentários analisados · em uso:{" "}
            {meta.current.slice(0, 5).join(", ") || "—"}
          </div>
        )}
      </div>
    </div>
  );
}
