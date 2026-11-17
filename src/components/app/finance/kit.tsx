"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId, useState } from "react";

import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash, Clock, Loader2, NotebookPenIcon, Plus, type LucideIcon } from "@/components/icons";
import { STATE_LOOK, usd, usdShort, type InvoiceStateId } from "@/lib/app/finance";
import { cn } from "@/lib/utils";

/**
 * The pieces every Finance screen is drawn from: status badges, money figures, sections and the trend
 * chart. A state is always a word with an icon; color only repeats what the word says.
 */

const TONE: Record<(typeof STATE_LOOK)[InvoiceStateId]["tone"], string> = {
  muted: "border-border bg-muted/60 text-muted-foreground",
  info: "border-info/25 bg-info/8 text-info-foreground",
  warning: "border-warning/30 bg-warning/10 text-warning-foreground",
  danger: "border-destructive/30 bg-destructive/8 text-destructive-foreground",
  success: "border-success/30 bg-success/10 text-success-foreground",
  progress: "border-brand-500/30 bg-brand-500/8 text-info-foreground",
};

const ICON = { draft: NotebookPenIcon, clock: Clock, half: CircleDashed, spin: Loader2, alert: AlertTriangle, check: CheckCircle2, slash: CircleSlash, plus: Plus };

export function StateBadge({ state, words, className }: { state: InvoiceStateId; words: string; className?: string }) {
  const look = STATE_LOOK[state];
  const Icon = ICON[look.icon];
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs font-medium whitespace-nowrap", TONE[look.tone], className)}>
      <Icon className={cn("size-3.5", look.icon === "spin" && "motion-safe:animate-spin")} aria-hidden />
      {words}
    </span>
  );
}

/** A small status chip for a payment or refund line, using the same tones. */
export function Chip({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return <span className={cn("inline-flex h-5.5 items-center rounded-md border px-1.5 text-[11px] font-medium whitespace-nowrap", TONE[tone])}>{children}</span>;
}

export function Amount({ cents, className, muted }: { cents: number; className?: string; muted?: boolean }) {
  return <span className={cn("tabular-nums", muted ? "text-muted-foreground" : "text-strong", className)}>{usd(cents)}</span>;
}

export const eyebrow = "text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase";

export function Section({ title, description, action, children, className, flush }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card", className)}>
      <header className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="font-heading text-base tracking-tight text-strong">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </header>
      <div className={flush ? "pt-3" : "p-4 pt-3 sm:p-5 sm:pt-3"}>{children}</div>
    </section>
  );
}

export function Empty({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <span className="grid size-11 place-items-center rounded-2xl border border-border bg-muted/60 text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-semibold text-strong">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** A notice in words: the kind of thing a person should know before acting. */
export function Notice({ tone = "info", title, children, action }: { tone?: "info" | "warning" | "danger" | "success"; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  const look = { info: "border-border bg-muted/40", warning: "border-warning/35 bg-warning/8", danger: "border-destructive/35 bg-destructive/6", success: "border-success/35 bg-success/8" }[tone];
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Clock : AlertTriangle;
  return (
    <div role={tone === "danger" || tone === "warning" ? "alert" : "status"} className={cn("flex flex-wrap items-start gap-3 rounded-xl border px-3.5 py-3", look)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "success" ? "text-success-foreground" : tone === "info" ? "text-muted-foreground" : tone === "warning" ? "text-warning-foreground" : "text-destructive-foreground")} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-strong">{title}</p>
        {children ? <div className="mt-0.5 text-sm text-muted-foreground">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// ── The trend chart ──────────────────────────────────────────────────────────────────────────────

type Week = { from: number; label: string; collectedCents: number; invoicedCents: number };

const H = 180;
const PAD = { top: 12, right: 8, bottom: 26, left: 52 };

function niceMax(value: number): number {
  if (value <= 0) return 10_000;
  const exp = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * exp >= value / 4)! * exp;
  return Math.ceil(value / step) * step;
}

/**
 * Money invoiced and money collected each week, in US dollars. One hue: collected is a solid bar,
 * invoiced an outlined one, so the two read apart without relying on color. Every value is in the
 * tooltip and in the table that follows the chart for screen readers.
 */
export function TrendChart({ weeks }: { weeks: Week[] }) {
  const reduced = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const max = niceMax(Math.max(...weeks.flatMap((w) => [w.collectedCents, w.invoicedCents])));
  const W = 640;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / weeks.length;
  const bar = Math.min(18, (band - 14) / 2);
  const y = (cents: number) => PAD.top + plotH - (cents / max) * plotH;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const empty = weeks.every((w) => w.collectedCents === 0 && w.invoicedCents === 0);
  const active = hover !== null ? weeks[hover] : null;
  return (
    <div className="[--fin-chart:#6838ef] dark:[--fin-chart:#8e6df6]">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-[var(--fin-chart)]" /> Collected
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] border-[1.5px] border-[var(--fin-chart)] bg-[color-mix(in_oklab,var(--fin-chart)_12%,transparent)]" /> Invoiced
        </span>
        <span className="ml-auto">US dollars per week, Monday to Sunday</span>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-labelledby={titleId} onMouseLeave={() => setHover(null)}>
          <title id={titleId}>Invoiced and collected per week for the last eight weeks</title>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {usdShort(tick)}
              </text>
            </g>
          ))}
          {weeks.map((week, i) => {
            const cx = PAD.left + band * i + band / 2;
            const inv = Math.max(0, y(0) - y(week.invoicedCents));
            const col = Math.max(0, y(0) - y(week.collectedCents));
            const radius = (h: number) => Math.min(4, h / 2);
            const path = (x: number, h: number) => {
              const r = radius(h);
              const top = y(0) - h;
              return `M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + bar - r} Q${x + bar},${top} ${x + bar},${top + r} V${y(0)} Z`;
            };
            return (
              <g key={week.from} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`Week of ${week.label}: invoiced ${usd(week.invoicedCents)}, collected ${usd(week.collectedCents)}`} className="outline-none">
                <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} className={cn("fill-transparent", hover === i && "fill-muted/60")} />
                {inv > 0 ? (
                  <motion.path d={path(cx - bar - 1, inv)} fill="color-mix(in oklab, var(--fin-chart) 12%, transparent)" stroke="var(--fin-chart)" strokeWidth={1.5} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: i * 0.03 }} />
                ) : null}
                {col > 0 ? <motion.path d={path(cx + 1, col)} fill="var(--fin-chart)" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: i * 0.03 + 0.05 }} /> : null}
                <text x={cx} y={H - 6} textAnchor="middle" className={cn("text-[11px]", hover === i ? "fill-foreground" : "fill-muted-foreground")}>
                  {week.label}
                </text>
              </g>
            );
          })}
          <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className="stroke-foreground/30" strokeWidth={1} />
        </svg>
        {active && hover !== null ? (
          <div
            className="pointer-events-none absolute top-0 z-10 w-44 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg"
            style={{ left: `clamp(0px, calc(${((PAD.left + band * hover + band / 2) / W) * 100}% - 5.5rem), calc(100% - 11rem))` }}
          >
            <p className="font-medium text-strong">Week of {active.label}</p>
            <p className="mt-1 flex justify-between text-muted-foreground">
              Invoiced <span className="tabular-nums text-strong">{usd(active.invoicedCents)}</span>
            </p>
            <p className="flex justify-between text-muted-foreground">
              Collected <span className="tabular-nums text-strong">{usd(active.collectedCents)}</span>
            </p>
          </div>
        ) : null}
        {empty ? <p className="absolute inset-x-0 top-1/3 text-center text-sm text-muted-foreground">No money invoiced or collected in these eight weeks yet.</p> : null}
      </div>
      <table className="sr-only">
        <caption>Invoiced and collected per week, US dollars</caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">Invoiced</th>
            <th scope="col">Collected</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.from}>
              <th scope="row">{week.label}</th>
              <td>{usd(week.invoicedCents)}</td>
              <td>{usd(week.collectedCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
