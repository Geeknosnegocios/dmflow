import React from "react";

/* =========================================================
   Sparkline — tiny SVG line chart for KPI cards
   ========================================================= */
export function Sparkline({
  data,
  width = 96,
  height = 28,
  strokeWidth = 1.5,
  color = "currentColor",
}: {
  data: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  color?: string;
}) {
  const lastVal = data?.[data.length - 1];
  const label =
    data && data.length >= 2
      ? `Tendência últimos ${data.length} períodos, valor atual ${lastVal}`
      : "Sem dados históricos";

  if (!data || data.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        className="opacity-30"
        role="img"
        aria-label={label}
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray="2,3"
        />
      </svg>
    );
  }
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = data[data.length - 1];
  const lastX = (data.length - 1) * step;
  const lastY = height - ((last - min) / range) * height;
  return (
    <svg
      width={width}
      height={height}
      className="overflow-visible"
      role="img"
      aria-label={label}
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  );
}

/* =========================================================
   Status Pill
   ========================================================= */
export function StatusPill({
  tone,
  label,
  pulse,
}: {
  tone: "good" | "warn" | "danger" | "violet" | "accent" | "dim";
  label: string;
  pulse?: boolean;
}) {
  const classes: Record<string, string> = {
    good: "bg-good-dim text-good",
    warn: "bg-warn-dim text-warn",
    danger: "bg-danger-dim text-danger",
    violet: "bg-violet-dim text-violet",
    accent: "bg-accent-dim text-accent",
    dim: "bg-white/5 text-dim-2",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-tiny font-medium uppercase tracking-wider ${classes[tone]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full bg-current ${
          pulse ? "pulse-dot" : ""
        }`}
      />
      {label}
    </span>
  );
}

/* =========================================================
   Funnel — horizontal bars with retention %
   ========================================================= */
export function Funnel({
  steps,
}: {
  steps: { label: string; value: number; sublabel?: string }[];
}) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="space-y-2.5">
      {steps.map((step, i) => {
        const pct = (step.value / max) * 100;
        const rawRatio =
          i === 0
            ? 1
            : steps[i - 1].value > 0
            ? step.value / steps[i - 1].value
            : 0;
        // Se ratio > 1, mostra como multiplicador (ex: 1.3x cliques por DM)
        const overOne = rawRatio > 1;
        const fromPrevDisplay = overOne
          ? `×${rawRatio.toFixed(2)}`
          : `${(rawRatio * 100).toFixed(0)}%`;
        const toneClass = overOne
          ? "text-accent"
          : rawRatio >= 0.4
          ? "text-good"
          : rawRatio >= 0.15
          ? "text-warn"
          : "text-danger";
        return (
          <div
            key={step.label}
            className="fade-up"
            style={{ animationDelay: `${i * 60}ms` } as React.CSSProperties}
          >
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-dim-2">{step.label}</span>
              <span className="flex items-center gap-2">
                <span className="mono-num text-fg">{step.value.toLocaleString("pt-BR")}</span>
                {i > 0 && (
                  <span
                    className={`mono-num text-tiny ${toneClass}`}
                    title={overOne ? "Média de cliques por DM enviada" : "Conversão do passo anterior"}
                  >
                    {fromPrevDisplay}
                  </span>
                )}
              </span>
            </div>
            <div className="h-8 rounded-lg bg-white/[0.03] overflow-hidden relative">
              <div
                className="h-full bg-gradient-to-r from-accent/40 to-accent/10 border-r border-accent/40 transition-all"
                style={{ width: `${pct}%` }}
              />
              {step.sublabel && (
                <div className="absolute inset-0 flex items-center px-3 text-tiny text-dim-2">
                  {step.sublabel}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* =========================================================
   Heatmap — 24h x 7d activity grid
   ========================================================= */
export function Heatmap({
  data,
}: {
  data: number[][]; // [dayOfWeek][hour] = count; dayOfWeek 0=Mon..6=Sun
}) {
  const days = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const max = Math.max(1, ...data.flat());

  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-[3px]" style={{ gridTemplateColumns: "auto repeat(24, 12px)" }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div
            key={h}
            className="text-tiny text-dim-2 text-center mono-num"
            style={{ visibility: h % 3 === 0 ? "visible" : "hidden" }}
          >
            {h}
          </div>
        ))}
        {days.map((d, row) => (
          <React.Fragment key={d}>
            <div className="text-tiny text-dim-2 pr-2 leading-none flex items-center">{d}</div>
            {Array.from({ length: 24 }, (_, h) => {
              const v = data[row]?.[h] ?? 0;
              const intensity = v === 0 ? 0 : Math.max(0.15, v / max);
              return (
                <div
                  key={`${d}-${h}`}
                  title={`${d} ${h}h — ${v} eventos`}
                  className="h-[12px] rounded-[2px]"
                  style={{
                    background:
                      v === 0
                        ? "rgba(255,255,255,0.04)"
                        : `rgba(34,211,238,${intensity.toFixed(3)})`,
                  }}
                />
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/* =========================================================
   Delta — +n -n indicator
   ========================================================= */
export function Delta({ value }: { value: number }) {
  if (value === 0)
    return <span className="text-tiny text-dim-2 mono-num">±0</span>;
  const positive = value > 0;
  return (
    <span
      className={`text-tiny mono-num ${
        positive ? "text-good" : "text-danger"
      }`}
    >
      {positive ? "▲" : "▼"} {Math.abs(value)}
    </span>
  );
}

/* =========================================================
   Empty state — clean illustration + CTA
   ========================================================= */
export function EmptyState({
  title,
  message,
  cta,
}: {
  title: string;
  message: string;
  cta?: { label: string; href: string };
}) {
  return (
    <div className="rounded-xl border border-line bg-surface/50 py-12 px-6 text-center">
      <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-line-2 bg-bg-1">
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          className="text-accent"
        >
          <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 3" opacity="0.5" />
        </svg>
      </div>
      <div className="font-semibold text-fg mb-1">{title}</div>
      <div className="text-dim-2 text-sm mb-4 max-w-md mx-auto">{message}</div>
      {cta && (
        <a
          href={cta.href}
          className="inline-flex items-center gap-1.5 text-xs font-medium rounded-lg border border-accent/30 bg-accent-dim text-accent px-3 py-2 hover:bg-accent/20 transition-colors"
        >
          {cta.label} →
        </a>
      )}
    </div>
  );
}

/* =========================================================
   Card primitive
   ========================================================= */
export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-line bg-surface shadow-card ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-line">
      <div>
        <div className="text-sm font-semibold text-fg">{title}</div>
        {subtitle && <div className="text-tiny text-dim-2 mt-0.5">{subtitle}</div>}
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}
