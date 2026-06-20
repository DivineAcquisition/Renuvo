"use client";

import { useId } from "react";

/** Tiny inline SVG line that draws itself on mount. Decorative trend cue. */
export function Sparkline({
  points,
  className,
  width = 96,
  height = 28,
}: {
  points: number[];
  className?: string;
  width?: number;
  height?: number;
}) {
  const id = useId();
  if (!points || points.length < 2) return null;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * step;
    const y = height - 4 - ((p - min) / range) * (height - 8);
    return [x, y] as const;
  });

  const d = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      fill="none"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#9A8CFF" />
          <stop offset="100%" stopColor="#4F38FF" />
        </linearGradient>
      </defs>
      <path
        d={d}
        stroke={`url(#spark-${id})`}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        className="draw-line"
      />
    </svg>
  );
}
