"use client";

import React from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  className = "",
  pendingLabel,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  return (
    <button
      {...rest}
      type="submit"
      disabled={pending || rest.disabled}
      className={`${className} ${
        pending ? "opacity-60 cursor-wait" : ""
      } inline-flex items-center gap-2`}
      aria-busy={pending || undefined}
    >
      {pending && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          className="animate-spin"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" fill="none" />
          <path
            d="M 12 7 A 5 5 0 0 0 7 2"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      )}
      <span>{pending ? pendingLabel ?? "Processando…" : children}</span>
    </button>
  );
}
