"use client";

import { Check } from "@/components/icons";
import { cn } from "@/lib/utils";
import { focusWithin, markBase, markOff, markOn, restingSurface, selectedSurface } from "@/components/ui/selection/tokens";

/**
 * Building blocks of the booking and proposal workspace: numbered sections, selectable cards, summary
 * rows and readiness chips. Every state has words as well as a color.
 */
export function FormSection({ n, id, title, lead, done, children, aside }: { n: number; id: string; title: string; lead?: string; done?: boolean; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-28 rounded-2xl border border-border bg-card shadow-xs">
      <header className="flex items-start gap-3 border-b border-border/70 px-4 py-3.5 sm:px-5">
        <span aria-hidden className={cn("grid size-8 shrink-0 place-content-center rounded-xl text-sm font-semibold tabular-nums", done ? "bg-success/12 text-success-foreground ring-1 ring-success/30" : "bg-brand-500 text-white shadow-[0_6px_16px_-8px_var(--color-brand-500)]")}>
          {done ? <Check className="size-4" /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-title`} className="font-heading text-base tracking-tight text-strong">
            <span className="sr-only">Step {n}: </span>
            {title}
            {done ? <span className="sr-only"> (complete)</span> : null}
          </h2>
          {lead ? <p className="mt-0.5 text-xs text-muted-foreground">{lead}</p> : null}
        </div>
        {aside}
      </header>
      <div className="grid gap-4 px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

/** A large radio-style card. Uses a real radio so arrow keys and screen readers work. */
/** A sales choice as a card. Native radio underneath (form-friendly, arrow keys), drawn with the shared selection look. */
export function ChoiceCard({ name, value, checked, onChange, title, detail, meta, disabled }: { name: string; value: string; checked: boolean; onChange: () => void; title: string; detail?: React.ReactNode; meta?: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("relative flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-sm transition-colors motion-reduce:transition-none", focusWithin, checked ? selectedSurface : restingSurface, disabled && "cursor-not-allowed opacity-60")}>
      <input type="radio" className="sr-only" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled} />
      <span className="flex items-start justify-between gap-2">
        <span className="font-medium text-strong">{title}</span>
        <span aria-hidden className={cn(markBase, "rounded-full", checked ? markOn : markOff)}>{checked ? <span className="block size-1.5 rounded-full bg-white" /> : null}</span>
      </span>
      {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
      {meta ? <span className="text-xs font-medium text-strong tabular-nums">{meta}</span> : null}
    </label>
  );
}

export function SummaryRow({ label, value, muted, strong }: { label: React.ReactNode; value: React.ReactNode; muted?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className={cn("min-w-0 truncate", muted ? "text-muted-foreground" : "text-strong")}>{label}</dt>
      <dd className={cn("shrink-0 tabular-nums", strong ? "font-semibold text-strong" : muted ? "text-muted-foreground" : "text-strong")}>{value}</dd>
    </div>
  );
}

export type Readiness = "done" | "waiting" | "blocked" | "not_needed" | "unknown";

const READY_STYLE: Record<Readiness, { dot: string; word: string }> = {
  done: { dot: "bg-success", word: "Ready" },
  waiting: { dot: "bg-warning", word: "Waiting" },
  blocked: { dot: "bg-destructive", word: "Blocked" },
  not_needed: { dot: "bg-muted-foreground/40", word: "Not needed" },
  unknown: { dot: "bg-muted-foreground/40", word: "Not checked" },
};

/** One readiness line: what, its state in words, and why. */
export function ReadyLine({ label, state, detail }: { label: string; state: Readiness; detail?: string | null }) {
  const style = READY_STYLE[state];
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", style.dot)} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-strong">{label}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{style.word}</span>
        </span>
        {detail ? <span className="block text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </li>
  );
}

export function Chip({ tone = "neutral", children }: { tone?: "neutral" | "brand" | "success" | "warning" | "danger"; children: React.ReactNode }) {
  const styles = {
    neutral: "border-border bg-muted text-muted-foreground",
    brand: "border-brand-500/30 bg-brand-500/8 text-brand-700 dark:text-brand-300",
    success: "border-success/30 bg-success/8 text-success-foreground",
    warning: "border-warning/30 bg-warning/10 text-warning-foreground",
    danger: "border-destructive/30 bg-destructive/8 text-destructive-foreground",
  } as const;
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium whitespace-nowrap", styles[tone])}>{children}</span>;
}

export function fieldClass(extra?: string) {
  return cn("min-h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-strong placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 disabled:opacity-60", extra);
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function minutesToTime(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function hoursWords(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}
