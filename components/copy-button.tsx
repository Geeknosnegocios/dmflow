"use client";
import { useState } from "react";

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="rounded-lg bg-good/20 hover:bg-good/30 text-good text-xs font-semibold px-3 py-2 transition-colors whitespace-nowrap"
    >
      {copied ? "Copiado ✓" : "Copiar"}
    </button>
  );
}
