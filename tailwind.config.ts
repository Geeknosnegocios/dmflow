import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces
        bg: "#0a0b10",
        "bg-1": "#0e1016",
        "bg-2": "#14161f",
        surface: "#12141c",
        "surface-2": "#181a24",
        // Text
        fg: "#e7e9ef",
        dim: "#6b7280",
        "dim-2": "#9aa1ad",
        // Lines
        line: "rgba(255,255,255,0.06)",
        "line-2": "rgba(255,255,255,0.10)",
        // Accent (cyan tech)
        accent: "#22d3ee",
        "accent-dim": "rgba(34,211,238,0.12)",
        "accent-ink": "#0a0b10",
        // Status
        good: "#34d399",
        "good-dim": "rgba(52,211,153,0.12)",
        warn: "#fbbf24",
        "warn-dim": "rgba(251,191,36,0.12)",
        danger: "#f87171",
        "danger-dim": "rgba(248,113,113,0.12)",
        violet: "#a78bfa",
        "violet-dim": "rgba(167,139,250,0.12)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "monospace"],
      },
      fontSize: {
        tiny: ["10.5px", { lineHeight: "14px", letterSpacing: "0.02em" }],
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 40px -20px rgba(0,0,0,0.7)",
        glow: "0 0 0 1px rgba(34,211,238,0.35), 0 0 24px -4px rgba(34,211,238,0.35)",
      },
      backgroundImage: {
        "grid-dot":
          "radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)",
      },
      backgroundSize: {
        "grid-24": "24px 24px",
      },
    },
  },
  plugins: [],
};
export default config;
