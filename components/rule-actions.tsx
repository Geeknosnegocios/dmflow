"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function TestRuleButton({ ruleId }: { ruleId: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function run() {
    if (state === "sending") return;
    setState("sending");
    setErrorMsg(null);
    try {
      const fd = new FormData();
      fd.append("rule_id", ruleId);
      const res = await fetch("/api/admin/test-rule", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setState("error");
        setErrorMsg(json.error || "Falha");
        setTimeout(() => setState("idle"), 3000);
      } else {
        setState("sent");
        setTimeout(() => setState("idle"), 3000);
      }
    } catch (e) {
      setState("error");
      setErrorMsg((e as Error).message);
      setTimeout(() => setState("idle"), 3000);
    }
  }

  const labels = {
    idle: "Testar",
    sending: "Enviando…",
    sent: "✓ enviada",
    error: "✕ falhou",
  };
  const cls = {
    idle: "border-line-2 text-dim-2 hover:border-accent/40 hover:text-accent",
    sending: "border-accent/40 text-accent cursor-wait",
    sent: "border-good/50 bg-good/10 text-good",
    error: "border-danger/50 bg-danger/10 text-danger",
  };

  return (
    <button
      type="button"
      onClick={run}
      title={errorMsg ?? "Envia DM de teste pra tua própria conta"}
      className={`text-tiny rounded-md border min-h-[32px] inline-flex items-center justify-center px-2.5 py-1 transition-colors ${cls[state]}`}
    >
      {labels[state]}
    </button>
  );
}

export function DuplicateRuleButton({ ruleId }: { ruleId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      action={async () => {
        const fd = new FormData();
        fd.append("rule_id", ruleId);
        start(async () => {
          await fetch("/api/admin/duplicate-rule", { method: "POST", body: fd });
          router.refresh();
        });
      }}
    >
      <button
        type="submit"
        disabled={pending}
        className="text-tiny rounded-md border min-h-[32px] inline-flex items-center justify-center border-line-2 hover:border-accent/40 px-2.5 py-1 text-dim-2 hover:text-accent transition-colors disabled:opacity-50"
      >
        {pending ? "…" : "duplicar"}
      </button>
    </form>
  );
}
