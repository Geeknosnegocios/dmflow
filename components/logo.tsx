import React from "react";

/**
 * Paper plane logo — minimal origami triangle with 3 folds.
 * Gradient cyan → violet to match system accent.
 * Scales with `size` prop. Keep crisp at any resolution (viewBox 32).
 */
export function Logo({
  size = 32,
  className = "",
  withGlow = false,
}: {
  size?: number;
  className?: string;
  withGlow?: boolean;
}) {
  const id = React.useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="DMFlow logo"
    >
      <defs>
        <linearGradient id={`${id}-grad`} x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
        <linearGradient id={`${id}-shadow`} x1="16" y1="16" x2="28" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0ea5b8" />
          <stop offset="100%" stopColor="#7c5fe6" />
        </linearGradient>
        {withGlow && (
          <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>
      <g filter={withGlow ? `url(#${id}-glow)` : undefined}>
        {/* Main top face — leading edge of the plane */}
        <path
          d="M 27 5 L 5 16 L 14 18 Z"
          fill={`url(#${id}-grad)`}
        />
        {/* Right lower face — the fuselage fold */}
        <path
          d="M 27 5 L 14 18 L 17 27 Z"
          fill={`url(#${id}-shadow)`}
        />
        {/* Inner fold highlight */}
        <path
          d="M 27 5 L 14 18 L 17 22 Z"
          fill={`url(#${id}-grad)`}
          opacity="0.55"
        />
        {/* Crease line */}
        <path
          d="M 27 5 L 14 18"
          stroke="rgba(255,255,255,0.45)"
          strokeWidth="0.5"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/** Compact lockup — logo + wordmark for headers */
export function LogoLockup({
  tag = "v0.3",
  size = 28,
}: {
  tag?: string;
  size?: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Logo size={size} />
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-semibold tracking-tight">DMFlow</span>
        {tag && <span className="text-tiny text-dim-2 font-mono">{tag}</span>}
      </div>
    </div>
  );
}
