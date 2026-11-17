"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useState } from "react";

import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, XCircle } from "@/components/icons";
import { cn } from "@/lib/utils";

import { formatCents } from "../../../../convex/lib/services/words";
import { InfoTip } from "./shared";

/**
 * A price that rolls to its new value when an edit moves it, so cause and effect are seen rather than
 * read. Screen readers get the final amount only, never the frames in between; with reduced motion
 * it simply changes.
 */
export function AnimatedMoney({ cents, className }: { cents: number; className?: string }) {
  const reduce = useReducedMotion();
  const value = useMotionValue(cents);
  const text = useTransform(value, (v) => formatCents(Math.round(v)));
  useEffect(() => {
    if (reduce) {
      value.jump(cents);
      return;
    }
    const controls = animate(value, cents, { duration: 0.5, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [cents, reduce, value]);
  return (
    <span className={className}>
      <span className="sr-only">{formatCents(cents)}</span>
      <motion.span aria-hidden>{text}</motion.span>
    </span>
  );
}

/**
 * How much the last edit moved the price: "+$12.00" with an arrow, fading after a moment. It is a
 * visual cue; the amount itself is announced by the price.
 */
export function PriceChange({ cents }: { cents: number | null }) {
  const reduce = useReducedMotion();
  const [seen, setSeen] = useState({ cents, delta: 0, n: 0 });
  if (seen.cents !== cents) setSeen({ cents, delta: cents !== null && seen.cents !== null ? cents - seen.cents : 0, n: seen.n + 1 });
  if (!seen.delta) return null;
  const up = seen.delta > 0;
  return (
    <motion.span
      key={seen.n}
      aria-hidden
      initial={{ opacity: 0, y: reduce ? 0 : 4 }}
      animate={reduce ? { opacity: 1 } : { opacity: [0, 1, 1, 0], y: [4, 0, 0, -2] }}
      transition={reduce ? { duration: 0 } : { duration: 2.6, times: [0, 0.08, 0.8, 1] }}
      className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums", up ? "bg-brand-500/10 text-brand-300" : "bg-success/10 text-success-foreground")}
    >
      {up ? <ArrowUpRight aria-hidden className="size-3.5" /> : <ArrowDownRight aria-hidden className="size-3.5" />}
      {up ? "+" : ""}
      {formatCents(seen.delta)}
    </motion.span>
  );
}

/**
 * One whole split into a few parts: a thin bar with a 2px surface gap between parts, and the names and
 * amounts listed beside it so color never carries the meaning alone. Colors were checked for
 * color-blind separation in the order they are drawn (direct costs, overhead, what remains).
 */
export const SPLIT_COLORS = { costs: "#eb6834", overhead: "#1baf7a", remains: "#6838ef" } as const;

export type SplitPart = { key: string; label: string; cents: number; color: string };

export function SplitBar({ parts, label }: { parts: SplitPart[]; label: string }) {
  const shown = parts.filter((p) => p.cents > 0);
  const whole = shown.reduce((sum, p) => sum + p.cents, 0);
  if (whole <= 0) return null;
  const share = (cents: number) => Math.round((cents / whole) * 1000) / 10;
  const name = `${label}: ${shown.map((p) => `${p.label} ${formatCents(p.cents)} (${share(p.cents)}%)`).join(", ")}`;
  return (
    <div className="grid grid-cols-1 gap-2.5">
      <div role="img" aria-label={name} className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
        {shown.map((p) => (
          <span key={p.key} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.cents / whole) * 100}%`, background: p.color }} />
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-1 text-sm">
        {parts.map((p) => (
          <li key={p.key} className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 items-start gap-2 text-strong">
              <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="min-w-0">{p.label}</span>
            </span>
            <span className="shrink-0 tabular-nums text-strong">
              {formatCents(p.cents)}
              <span className="ml-1.5 inline-block w-12 text-right text-xs text-muted-foreground">{p.cents > 0 ? `${share(p.cents)}%` : ""}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Standing = { tone: "good" | "warning" | "critical" | "none"; words: string };

/** Where a margin stands against the Owner's floor and target, in words with an icon, never by color alone. */
export function marginStanding(percent: number | null, floor: number | null, target: number | null): Standing {
  if (percent === null) return { tone: "none", words: "No price to measure" };
  if (percent < 0) return { tone: "critical", words: "Costs are more than the price" };
  if (floor !== null && percent < floor) return { tone: "critical", words: `Below your ${floor}% floor` };
  if (target !== null && percent < target) return { tone: "warning", words: `Under your ${target}% target` };
  if (target !== null) return { tone: "good", words: `At or above your ${target}% target` };
  return { tone: "none", words: "No target margin set" };
}

const STANDING_STYLE = {
  good: { fill: "var(--color-brand-500)", Icon: CheckCircle2, text: "text-strong" },
  warning: { fill: "#fab219", Icon: AlertTriangle, text: "text-strong" },
  critical: { fill: "#d03b3b", Icon: XCircle, text: "text-destructive-foreground" },
  none: { fill: "var(--color-brand-500)", Icon: null, text: "text-muted-foreground" },
} as const;

/**
 * The margin as a meter from 0 to 100%, with ticks where the floor and target sit. The fill carries
 * the standing (brand, then warning, then critical); the track is a light step of the brand.
 */
export function MarginMeter({ percent, floor, target, tip }: { percent: number | null; floor: number | null; target: number | null; tip?: string }) {
  const standing = marginStanding(percent, floor, target);
  const style = STANDING_STYLE[standing.tone];
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const fill = percent === null ? 0 : clamp(percent);
  return (
    <div className="grid grid-cols-1 gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-0.5 text-sm font-medium text-strong">
          Margin
          {tip ? <InfoTip label="Margin">{tip}</InfoTip> : null}
        </span>
        <span className="font-heading text-2xl tracking-tight text-strong">{percent === null ? "—" : `${percent}%`}</span>
      </div>
      <div role="meter" aria-label="Margin" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent === null ? undefined : clamp(percent)} aria-valuetext={percent === null ? "No price to measure" : `${percent}%. ${standing.words}.`} className="relative h-2 w-full rounded-full bg-brand-500/15">
        <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${fill}%`, background: style.fill }} />
        {floor !== null ? <span aria-hidden title={`Floor ${floor}%`} className="absolute -top-1 h-4 w-0.5 rounded-full bg-strong/70" style={{ left: `calc(${clamp(floor)}% - 1px)` }} /> : null}
        {target !== null ? <span aria-hidden title={`Target ${target}%`} className="absolute -top-1 h-4 w-0.5 rounded-full bg-strong" style={{ left: `calc(${clamp(target)}% - 1px)` }} /> : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className={cn("inline-flex items-center gap-1", style.text)}>
          {style.Icon ? <style.Icon aria-hidden className="size-3.5" /> : null}
          {standing.words}
        </span>
        {floor !== null || target !== null ? (
          <span className="text-muted-foreground">{[floor !== null ? `Floor ${floor}%` : null, target !== null ? `Target ${target}%` : null].filter(Boolean).join(" · ")}</span>
        ) : null}
      </div>
    </div>
  );
}
