"use client";

import React, { useEffect, useState } from "react";
import type { Flash } from "@/lib/flash";

export function Toaster({ flash }: { flash: Flash | null }) {
  const [visible, setVisible] = useState(!!flash);
  const [current, setCurrent] = useState<Flash | null>(flash);

  useEffect(() => {
    if (!flash) return;
    setCurrent(flash);
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  if (!current) return null;

  const tones: Record<Flash["kind"], string> = {
    success: "border-good/40 bg-good-dim text-good",
    error: "border-danger/40 bg-danger-dim text-danger",
    info: "border-accent/40 bg-accent-dim text-accent",
    warn: "border-warn/40 bg-warn-dim text-warn",
  };

  const icons: Record<Flash["kind"], string> = {
    success: "✓",
    error: "✕",
    info: "i",
    warn: "!",
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 right-4 z-[60] pointer-events-auto transition-all ${
        visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-2 pointer-events-none"
      }`}
    >
      <div
        className={`flex items-center gap-3 rounded-xl border ${tones[current.kind]} bg-surface shadow-2xl px-4 py-3 min-w-[260px] max-w-sm`}
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-current/10 font-bold text-sm">
          {icons[current.kind]}
        </span>
        <span className="text-sm flex-1">{current.message}</span>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="text-dim-2 hover:text-fg"
          aria-label="Fechar"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
