import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
        }}
      >
        <svg
          width="64"
          height="64"
          viewBox="3 3 26 26"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="g" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#a78bfa" />
            </linearGradient>
            <linearGradient id="s" x1="16" y1="16" x2="28" y2="26" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#0ea5b8" />
              <stop offset="100%" stopColor="#7c5fe6" />
            </linearGradient>
          </defs>
          <path d="M 27 5 L 5 16 L 14 18 Z" fill="url(#g)" />
          <path d="M 27 5 L 14 18 L 17 27 Z" fill="url(#s)" />
          <path d="M 27 5 L 14 18 L 17 22 Z" fill="url(#g)" opacity="0.55" />
          <path
            d="M 27 5 L 14 18"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth="0.6"
            strokeLinecap="round"
          />
        </svg>
      </div>
    ),
    size
  );
}
