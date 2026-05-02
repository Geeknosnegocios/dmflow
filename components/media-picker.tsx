"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Media = {
  id: string;
  caption: string;
  permalink: string;
  thumbnail: string;
  media_type: string;
  product_type?: string;
  timestamp: string;
  likes: number;
  comments: number;
};

function fmtRelativeSimple(iso: string) {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const day = 86400000;
  if (diff < day) return "hoje";
  if (diff < 2 * day) return "ontem";
  if (diff < 7 * day) return `há ${Math.floor(diff / day)}d`;
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

export function MediaPicker({
  name,
  defaultValue,
  placeholder = "Escolha um post (opcional · vazio = todos)",
  accountId,
}: {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  accountId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<Media[] | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Media | null>(null);
  const [rawId, setRawId] = useState(defaultValue ?? "");
  const lastFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || media) return;
    setLoading(true);
    setError(null);
    const qs = accountId ? `?account_id=${accountId}` : "";
    fetch(`/api/admin/media${qs}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setMedia(json.media ?? []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, media, accountId]);

  useEffect(() => {
    if (open) {
      lastFocusRef.current = document.activeElement as HTMLElement;
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      lastFocusRef.current?.focus?.();
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape" && open) setOpen(false);
    }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open]);

  const filtered = useMemo(() => {
    if (!media) return [];
    if (!q) return media;
    const needle = q.toLowerCase();
    return media.filter(
      (m) =>
        m.caption.toLowerCase().includes(needle) ||
        m.id.includes(q) ||
        m.media_type.toLowerCase().includes(needle)
    );
  }, [media, q]);

  function pick(m: Media) {
    setSelected(m);
    setRawId(m.id);
    setOpen(false);
  }
  function clear() {
    setSelected(null);
    setRawId("");
  }

  const displayLabel = selected
    ? truncate(selected.caption || "(sem legenda)", 50)
    : rawId
    ? `ID: ${rawId}`
    : placeholder;

  return (
    <>
      <input type="hidden" name={name} value={rawId} />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex-1 flex items-center gap-2 text-left bg-bg-1 border border-line-2 rounded-lg px-3 py-2 text-sm hover:border-accent/40 transition-colors min-h-[40px]"
        >
          {selected?.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selected.thumbnail}
              alt=""
              className="h-7 w-7 rounded object-cover border border-line-2 flex-shrink-0"
            />
          )}
          <span className={`flex-1 truncate ${rawId ? "text-fg" : "text-dim-2"}`}>
            {displayLabel}
          </span>
          <span className="text-tiny text-dim-2 font-mono">escolher</span>
        </button>
        {rawId && (
          <button
            type="button"
            onClick={clear}
            className="text-tiny rounded-lg border border-line-2 px-2.5 text-dim-2 hover:text-danger hover:border-danger/40 transition-colors"
            aria-label="Limpar seleção"
            title="Limpar"
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] px-4"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="media-picker-title"
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-3xl rounded-xl border border-line-2 bg-surface shadow-2xl overflow-hidden fade-up flex flex-col max-h-[84vh]"
          >
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <h2 id="media-picker-title" className="text-sm font-semibold flex-shrink-0">
                Escolher publicação
              </h2>
              <input
                autoFocus
                placeholder="Buscar por legenda, tipo ou ID…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="flex-1 bg-bg-1 border border-line-2 rounded-lg px-3 py-1.5 text-sm placeholder:text-dim-2"
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-tiny rounded-md border border-line-2 px-2.5 py-1 text-dim-2 hover:text-fg"
              >
                Fechar
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loading && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="aspect-square rounded-lg bg-white/[0.04] animate-pulse"
                    />
                  ))}
                </div>
              )}

              {error && (
                <div className="p-6 text-center text-danger text-sm">
                  Erro: {error}
                </div>
              )}

              {!loading && !error && filtered.length === 0 && (
                <div className="p-12 text-center text-dim-2 text-sm">
                  Nenhuma publicação encontrada{q ? ` pra "${q}"` : ""}.
                </div>
              )}

              {!loading && filtered.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      clear();
                      setOpen(false);
                    }}
                    className="w-full mb-3 rounded-lg border border-accent/30 bg-accent-dim hover:bg-accent/20 text-accent text-sm font-medium px-3 py-2.5 text-center transition-colors"
                  >
                    ⚡ Valer pra TODAS as publicações
                  </button>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {filtered.map((m) => (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() => pick(m)}
                        className="text-left group rounded-lg border border-line bg-bg-1 overflow-hidden hover:border-accent/40 transition-colors"
                      >
                        <div className="aspect-square bg-black relative">
                          {m.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={m.thumbnail}
                              alt=""
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-dim-2 text-tiny">
                              sem preview
                            </div>
                          )}
                          <div className="absolute top-2 left-2 text-tiny font-mono bg-black/60 text-white px-1.5 py-0.5 rounded">
                            {m.product_type ?? m.media_type}
                          </div>
                          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-2 flex justify-between text-tiny text-white/80 font-mono">
                            <span>❤ {m.likes}</span>
                            <span>💬 {m.comments}</span>
                          </div>
                        </div>
                        <div className="p-2.5 space-y-1">
                          <div className="text-xs line-clamp-2 leading-snug">
                            {m.caption || (
                              <span className="text-dim-2 italic">sem legenda</span>
                            )}
                          </div>
                          <div className="text-tiny text-dim-2 font-mono">
                            {fmtRelativeSimple(m.timestamp)}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="border-t border-line px-4 py-2 flex items-center justify-between text-tiny text-dim-2">
              <span>{filtered.length} publicação(ões)</span>
              <span className="flex items-center gap-1">
                <kbd className="font-mono bg-white/5 border border-line rounded px-1">esc</kbd>
                fechar
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
