"use client";

import React, { useEffect, useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";

type Item = { label: string; href: string; hint?: string };

export function CommandPalette({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      lastFocusRef.current = document.activeElement as HTMLElement;
      setQ("");
      setIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      lastFocusRef.current?.focus?.();
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (!q) return items;
    const needle = q.toLowerCase();
    return items.filter((it) => it.label.toLowerCase().includes(needle));
  }, [q, items]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, filtered.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    }
    if (e.key === "Enter" && filtered[idx]) {
      e.preventDefault();
      const href = filtered[idx].href;
      setOpen(false);
      if (href.startsWith("/api")) {
        window.location.href = href;
      } else {
        router.push(href);
      }
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden md:inline-flex items-center gap-2 rounded-lg border border-line-2 bg-surface hover:bg-surface-2 px-3 py-1.5 text-tiny text-dim-2 transition-colors"
        aria-label="Abrir busca"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 8 L11 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span>Buscar…</span>
        <kbd className="ml-2 text-[10px] font-mono bg-white/5 border border-line rounded px-1 py-0.5">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            aria-hidden="true"
          />
          <div
            className="relative w-full max-w-lg rounded-xl border border-line-2 bg-surface shadow-2xl overflow-hidden fade-up"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cmdk-title"
          >
            <h2 id="cmdk-title" className="sr-only">
              Paleta de comandos
            </h2>
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
                <path d="M11 11 L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
              </svg>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setIdx(0);
                }}
                onKeyDown={handleKey}
                placeholder="Buscar páginas, ações…"
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-dim-2"
              />
              <kbd className="text-[10px] font-mono bg-white/5 border border-line rounded px-1.5 py-0.5 text-dim-2">
                esc
              </kbd>
            </div>
            <div className="max-h-80 overflow-y-auto py-2">
              {filtered.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-dim-2">
                  Nada encontrado pra "{q}"
                </div>
              ) : (
                filtered.map((item, i) => (
                  <button
                    key={item.href}
                    onMouseEnter={() => setIdx(i)}
                    onClick={() => {
                      setOpen(false);
                      if (item.href.startsWith("/api")) {
                        window.location.href = item.href;
                      } else {
                        router.push(item.href);
                      }
                    }}
                    className={`flex items-center justify-between w-full px-4 py-2 text-sm text-left transition-colors ${
                      i === idx
                        ? "bg-accent-dim text-fg"
                        : "text-dim-2 hover:bg-white/5"
                    }`}
                  >
                    <span>{item.label}</span>
                    {item.hint && (
                      <kbd className="text-[10px] font-mono text-dim-2">
                        {item.hint}
                      </kbd>
                    )}
                  </button>
                ))
              )}
            </div>
            <div className="border-t border-line px-4 py-2 flex items-center gap-3 text-tiny text-dim-2">
              <span className="flex items-center gap-1">
                <kbd className="font-mono bg-white/5 border border-line rounded px-1">↑↓</kbd>
                navegar
              </span>
              <span className="flex items-center gap-1">
                <kbd className="font-mono bg-white/5 border border-line rounded px-1">↵</kbd>
                abrir
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
