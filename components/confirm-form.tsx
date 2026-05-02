"use client";

import React, { useState } from "react";

/**
 * Wraps a form and makes the submit a 2-step click.
 * First click arms the button (shows confirmation), second click submits.
 * Resets after 3 seconds if not confirmed.
 */
export function ConfirmForm({
  action,
  label,
  confirmLabel,
  className = "",
  tone = "danger",
  hiddenFields,
}: {
  action: (fd: FormData) => void | Promise<void>;
  label: string;
  confirmLabel?: string;
  className?: string;
  tone?: "danger" | "warn";
  hiddenFields: Record<string, string>;
}) {
  const [armed, setArmed] = useState(false);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const baseCls =
    "text-tiny rounded-md border min-h-[32px] inline-flex items-center justify-center px-2.5 py-1 transition-colors";
  const toneCls = armed
    ? tone === "danger"
      ? "border-danger/50 bg-danger/10 text-danger hover:bg-danger/20"
      : "border-warn/50 bg-warn/10 text-warn hover:bg-warn/20"
    : "border-line-2 text-dim-2 hover:border-accent/40 hover:text-accent";

  function arm(e: React.MouseEvent) {
    if (!armed) {
      e.preventDefault();
      setArmed(true);
      if (timer) clearTimeout(timer);
      setTimer(setTimeout(() => setArmed(false), 3000));
    }
  }

  return (
    <form
      action={action}
      className={className}
      onSubmit={() => {
        if (timer) clearTimeout(timer);
      }}
    >
      {Object.entries(hiddenFields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" className={`${baseCls} ${toneCls}`} onClick={arm}>
        {armed ? confirmLabel ?? `Confirmar ${label.toLowerCase()}` : label}
      </button>
    </form>
  );
}
