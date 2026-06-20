"use client";

import { useId } from "react";

type Point = { label: string; value: number };

/** Catmull-Rom → cubic bezier smoothing for a pleasant, hand-built curve. */
function smoothPath(coords: [number, number][]): string {
  if (coords.length < 2)
    return coords.map(([x, y]) => `M${x},${y}`).join(" ");
  let d = `M${coords[0][0]},${coords[0][1]}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i - 1] ?? coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] ?? p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export function AreaChart({
  data,
  height = 240,
}: {
  data: Point[];
  height?: number;
}) {
  const id = useId();
  const width = 640;
  const padX = 8;
  const padY = 16;

  if (!data || data.length === 0)
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No data yet.
      </p>
    );

  const max = Math.max(...data.map((d) => d.value), 1);
  const stepX = (width - padX * 2) / Math.max(data.length - 1, 1);
  const coords: [number, number][] = data.map((d, i) => {
    const x = padX + i * stepX;
    const y = height - padY - (d.value / max) * (height - padY * 2);
    return [x, y];
  });

  const line = smoothPath(coords);
  const area = `${line} L${coords[coords.length - 1][0]},${height - padY} L${coords[0][0]},${height - padY} Z`;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        preserveAspectRatio="none"
        fill="none"
      >
        <defs>
          <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6A57FF" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#4F38FF" stopOpacity={0} />
          </linearGradient>
          <linearGradient id={`stroke-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#9A8CFF" />
            <stop offset="100%" stopColor="#4F38FF" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#fill-${id})`} className="draw-fill" />
        <path
          d={line}
          stroke={`url(#stroke-${id})`}
          strokeWidth={2.5}
          strokeLinecap="round"
          pathLength={1}
          className="draw-line"
        />
        {coords.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={3} fill="#4F38FF" className="draw-fill" />
        ))}
      </svg>
      <div className="mt-2 flex justify-between px-1 text-xs text-muted-foreground">
        {data.map((d, i) => (
          <span key={i}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}
