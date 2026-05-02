import React from "react";

function base(className = "") {
  return `animate-pulse rounded-lg bg-white/[0.04] ${className}`;
}

export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={base(className)} style={style} />;
}

export function KpiSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-surface shadow-card p-4 flex items-start justify-between">
      <div className="space-y-2 flex-1">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-7 w-24" />
    </div>
  );
}

export function CardSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface shadow-card overflow-hidden">
      <div className="border-b border-line p-4 space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
      <div className="p-5">
        <Skeleton style={{ height }} className="w-full" />
      </div>
    </div>
  );
}

export function TableRowSkeleton({ cols = 5 }: { cols?: number }) {
  return (
    <div className="flex gap-3 items-center px-5 py-3 border-t border-line">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-4"
          style={{ flex: i === 0 ? 2 : 1 } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
