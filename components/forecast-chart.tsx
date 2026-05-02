"use client";

import React, { useEffect, useRef, useState } from "react";

/**
 * Chart with actual (solid) + forecast (dashed) line.
 */
export function ForecastChart({
  actual,
  actualLabels,
  forecast,
  forecastLabels,
  height = 220,
  color = "#22d3ee",
  forecastColor = "#a78bfa",
}: {
  actual: number[];
  actualLabels: string[];
  forecast: number[];
  forecastLabels: string[];
  height?: number;
  color?: string;
  forecastColor?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const padX = 36;
  const padY = 22;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => {
      const w = e[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.max(320, Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const all = [...actual, ...forecast];
  const max = Math.max(...all, 1);
  const total = all.length;

  const pointsFor = (data: number[], startIdx: number): string => {
    if (data.length === 0) return "";
    const step = (width - padX * 2) / Math.max(1, total - 1);
    return data
      .map((v, i) => {
        const x = padX + (startIdx + i) * step;
        const y = padY + (1 - v / max) * (height - padY * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };

  const yGrid = [0, 1, 2, 3, 4].map((i) => {
    const y = padY + (i / 4) * (height - padY * 2);
    const v = Math.round(max * (1 - i / 4));
    return { y, v };
  });

  const forecastStartX =
    padX + (actual.length - 1) * ((width - padX * 2) / Math.max(1, total - 1));

  const bridgePoints = `${
    pointsFor([actual[actual.length - 1]], actual.length - 1) || "0,0"
  } ${pointsFor([forecast[0]], actual.length) || "0,0"}`;

  return (
    <div ref={containerRef} className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ height, display: "block" }}
        role="img"
        aria-label={`Previsão próximos ${forecast.length} períodos`}
      >
        <title>Tendência + previsão</title>

        {/* grid */}
        {yGrid.map((g, i) => (
          <g key={i}>
            <line
              x1={padX}
              y1={g.y}
              x2={width - padX}
              y2={g.y}
              stroke="rgba(255,255,255,0.04)"
              strokeWidth="1"
            />
            <text
              x={padX - 6}
              y={g.y + 3}
              textAnchor="end"
              className="fill-dim-2"
              style={{ fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
            >
              {g.v}
            </text>
          </g>
        ))}

        {/* forecast zone background */}
        <rect
          x={forecastStartX}
          y={padY}
          width={width - padX - forecastStartX}
          height={height - padY * 2}
          fill={forecastColor}
          opacity="0.05"
        />
        <text
          x={forecastStartX + 8}
          y={padY + 14}
          className="fill-dim-2"
          style={{ fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
        >
          previsão
        </text>

        {/* actual line */}
        <polyline
          points={pointsFor(actual, 0)}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* bridge (last actual → first forecast) as dashed faded */}
        <polyline
          points={bridgePoints}
          fill="none"
          stroke={forecastColor}
          strokeWidth="1.5"
          strokeDasharray="4 3"
          opacity="0.6"
        />

        {/* forecast line (dashed) */}
        <polyline
          points={pointsFor(forecast, actual.length)}
          fill="none"
          stroke={forecastColor}
          strokeWidth="2"
          strokeDasharray="4 3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* forecast points */}
        {forecast.map((v, i) => {
          const step = (width - padX * 2) / Math.max(1, total - 1);
          const x = padX + (actual.length + i) * step;
          const y = padY + (1 - v / max) * (height - padY * 2);
          return <circle key={i} cx={x} cy={y} r={3} fill={forecastColor} />;
        })}
      </svg>

      {/* legend */}
      <div className="flex gap-4 mt-2 text-tiny text-dim-2">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-6"
            style={{ background: color }}
          />
          Histórico ({actualLabels.length} períodos)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-6 border-t-2 border-dashed"
            style={{ borderColor: forecastColor }}
          />
          Previsão ({forecast.length} períodos)
        </span>
      </div>
    </div>
  );
}
