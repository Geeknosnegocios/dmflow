"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Series = { label: string; data: number[]; color: string };

export function LineChart({
  series,
  labels,
  height = 180,
  showLegend = true,
}: {
  series: Series[];
  labels: string[];
  height?: number;
  showLegend?: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const padX = 32;
  const padY = 20;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.max(320, Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxVal = Math.max(
    1,
    ...series.flatMap((s) => s.data)
  );
  const pointsFor = (data: number[]) => {
    if (data.length < 2) return "";
    const step = (width - padX * 2) / (data.length - 1);
    return data
      .map((v, i) => {
        const x = padX + i * step;
        const y = padY + (1 - v / maxVal) * (height - padY * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };

  const areaPath = (data: number[]) => {
    if (data.length < 2) return "";
    const step = (width - padX * 2) / (data.length - 1);
    const pts = data.map((v, i) => {
      const x = padX + i * step;
      const y = padY + (1 - v / maxVal) * (height - padY * 2);
      return [x, y] as const;
    });
    const start = pts[0];
    const end = pts[pts.length - 1];
    return [
      `M ${start[0]} ${height - padY}`,
      ...pts.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`),
      `L ${end[0]} ${height - padY}`,
      "Z",
    ].join(" ");
  };

  const yGrid = useMemo(() => {
    const lines = [];
    for (let i = 0; i <= 4; i++) {
      const y = padY + (i / 4) * (height - padY * 2);
      const v = Math.round(maxVal * (1 - i / 4));
      lines.push({ y, v });
    }
    return lines;
  }, [maxVal, height]);

  const hoverX = (idx: number) => {
    if (!labels.length) return 0;
    const step = (width - padX * 2) / Math.max(1, labels.length - 1);
    return padX + idx * step;
  };

  return (
    <div className="space-y-3">
      {showLegend && (
        <div className="flex gap-4 flex-wrap">
          {series.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5 text-tiny text-dim-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: s.color }}
              />
              {s.label}
              {hoverIdx !== null && s.data[hoverIdx] !== undefined && (
                <span className="mono-num text-fg">
                  · {s.data[hoverIdx]}
                </span>
              )}
            </div>
          ))}
          {hoverIdx !== null && labels[hoverIdx] && (
            <span className="text-tiny font-mono text-dim-2 ml-auto">
              {labels[hoverIdx]}
            </span>
          )}
        </div>
      )}
      <div className="relative" ref={containerRef}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          preserveAspectRatio="xMidYMid meet"
          style={{ height, display: "block" }}
          role="img"
          aria-label={`Gráfico de linha: ${series.map((s) => s.label).join(", ")} ao longo de ${labels.length} períodos`}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <title>Tendência {labels.length} dias</title>
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
                x={padX - 4}
                y={g.y + 3}
                textAnchor="end"
                className="fill-dim-2"
                style={{ fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
              >
                {g.v}
              </text>
            </g>
          ))}

          {/* series areas */}
          {series.map((s, i) => (
            <path
              key={`area-${i}`}
              d={areaPath(s.data)}
              fill={s.color}
              opacity={0.08}
            />
          ))}

          {/* series lines */}
          {series.map((s, i) => (
            <polyline
              key={`line-${i}`}
              points={pointsFor(s.data)}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* hover hit zones */}
          {labels.map((_, i) => {
            const step = (width - padX * 2) / Math.max(1, labels.length - 1);
            const x = padX + i * step;
            return (
              <rect
                key={i}
                x={x - step / 2}
                y={0}
                width={step}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
              />
            );
          })}

          {/* hover line */}
          {hoverIdx !== null && (
            <>
              <line
                x1={hoverX(hoverIdx)}
                y1={padY}
                x2={hoverX(hoverIdx)}
                y2={height - padY}
                stroke="rgba(255,255,255,0.15)"
                strokeDasharray="3,3"
              />
              {series.map((s, i) =>
                s.data[hoverIdx] !== undefined ? (
                  <circle
                    key={`hdot-${i}`}
                    cx={hoverX(hoverIdx)}
                    cy={
                      padY +
                      (1 - s.data[hoverIdx] / maxVal) * (height - padY * 2)
                    }
                    r="4"
                    fill={s.color}
                    stroke="#0a0b10"
                    strokeWidth="2"
                  />
                ) : null
              )}
            </>
          )}
        </svg>
      </div>
    </div>
  );
}
