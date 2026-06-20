"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export type CountUpFormat = "money" | "pct" | "int";

function formatValue(v: number, format: CountUpFormat): string {
  if (format === "money")
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "usd",
      maximumFractionDigits: 0,
    }).format(v);
  if (format === "pct") return `${v.toFixed(1)}%`;
  return Math.round(v).toLocaleString("en-US");
}

export function CountUp({
  value,
  format = "int",
  durationMs = 1400,
  className,
}: {
  value: number;
  format?: CountUpFormat;
  durationMs?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out-cubic
      setDisplay(value * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value, durationMs, reduce]);

  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {formatValue(display, format)}
    </span>
  );
}
