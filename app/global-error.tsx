"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body style={{ background: "#0a0b10", color: "#e7e9ef", fontFamily: "system-ui, sans-serif", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <div style={{ maxWidth: 520, textAlign: "center" }}>
          <div style={{ marginBottom: 12, fontSize: 32 }}>⚠</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            Algo deu ruim
          </h1>
          <p style={{ color: "#9aa1ad", fontSize: 14, marginBottom: 20 }}>
            {error.message || "Falha crítica na aplicação."}
          </p>
          <button
            onClick={reset}
            style={{
              background: "#22d3ee",
              color: "#0a0b10",
              border: 0,
              borderRadius: 8,
              padding: "10px 20px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Recarregar
          </button>
        </div>
      </body>
    </html>
  );
}
