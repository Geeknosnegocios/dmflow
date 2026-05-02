"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard error]", error);
  }, [error]);

  return (
    <div className="rounded-xl border border-danger/30 bg-danger/[0.03] p-8 text-center">
      <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-danger/40 bg-danger/10 text-danger">
        !
      </div>
      <h2 className="text-lg font-semibold mb-1">Algo quebrou carregando essa página</h2>
      <p className="text-dim-2 text-sm mb-5 max-w-md mx-auto">
        {error.message || "Erro desconhecido no servidor."}
        {error.digest && (
          <span className="block mt-1 text-tiny font-mono text-dim">
            ref: {error.digest}
          </span>
        )}
      </p>
      <div className="flex gap-2 justify-center">
        <button
          onClick={reset}
          className="rounded-lg bg-accent hover:bg-accent/90 text-accent-ink font-semibold px-4 py-2 text-sm transition-colors"
        >
          Tentar de novo
        </button>
        <a
          href="/dashboard"
          className="rounded-lg border border-line-2 px-4 py-2 text-sm hover:bg-white/5 transition-colors"
        >
          Voltar pro início
        </a>
      </div>
    </div>
  );
}
