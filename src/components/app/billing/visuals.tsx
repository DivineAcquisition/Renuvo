"use client";

import { MotionConfig, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useId } from "react";

import { AgentAvatar, STATE } from "@/components/app/agent";
import type { LucideIcon } from "@/components/icons";
import type { AgentId as NavAgentId } from "@/lib/app/navigation";
import { cn } from "@/lib/utils";

/**
 * The visual pieces of Plan & Usage: a credit ring, segmented tabs, an agent roster and feature cards.
 * Motion is decoration only: every number is also written in text, and everything holds still for
 * people who ask their system for reduced motion.
 */
export function Motion({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

const RING = 54;
const CIRCUMFERENCE = 2 * Math.PI * RING;
const EASE = [0.22, 1, 0.36, 1] as const;

/** How much of this cycle's credits are left, as a ring that fills in and glows. The number inside is the real one. */
export function CreditRing({ left, total, low, empty, size = "lg" }: { left: number | null; total: number; low?: boolean; empty?: boolean; size?: "md" | "lg" }) {
  const reduced = useReducedMotion();
  const gradient = useId();
  const known = left !== null;
  const share = known && total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  const tone = empty ? "var(--color-destructive)" : low ? "var(--color-warning)" : `url(#${gradient})`;
  return (
    <div
      role="img"
      aria-label={known ? `${left.toLocaleString("en-US")} credits left${total > 0 ? `, ${Math.round(share * 100)}% of this cycle's credits` : ""}` : "Balance is updating"}
      className={cn("relative mx-auto shrink-0", size === "lg" ? "size-40 sm:size-44" : "size-28")}
    >
      <motion.div
        aria-hidden
        className={cn("absolute inset-4 rounded-full blur-2xl", empty ? "bg-destructive/25" : low ? "bg-warning/25" : "bg-brand-500/30")}
        initial={{ opacity: 0.6 }}
        animate={reduced ? { opacity: 0.6 } : { opacity: [0.4, 0.85, 0.4] }}
        transition={reduced ? { duration: 0 } : { duration: 5, repeat: Infinity, ease: "easeInOut" }}
      />
      <svg viewBox="0 0 128 128" className="relative size-full -rotate-90">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#b39eff" />
            <stop offset="100%" stopColor="var(--color-brand-500)" />
          </linearGradient>
        </defs>
        <circle cx="64" cy="64" r={RING} fill="none" stroke="var(--color-muted)" strokeWidth="10" />
        <motion.circle
          cx="64"
          cy="64"
          r={RING}
          fill="none"
          stroke={tone}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          initial={{ strokeDashoffset: CIRCUMFERENCE }}
          animate={{ strokeDashoffset: CIRCUMFERENCE * (1 - share) }}
          transition={{ duration: 1.2, ease: EASE }}
          style={{ filter: "drop-shadow(0 0 6px color-mix(in oklab, var(--color-brand-500) 55%, transparent))" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <span className={cn("font-heading tracking-tight text-strong tabular-nums", size === "lg" ? "text-3xl" : "text-xl")}>{known ? left.toLocaleString("en-US") : "…"}</span>
        <span className="text-xs text-muted-foreground">{known ? "credits left" : "updating"}</span>
      </div>
    </div>
  );
}

/** Tabs drawn as a segmented control, each a real link so the browser's back button and bookmarks work. */
export function SegmentedTabs<T extends string>({ label, tabs, active }: { label: string; tabs: readonly { id: T; label: string; href: string; icon: LucideIcon }[]; active: T }) {
  return (
    <nav aria-label={label} className="w-full overflow-x-auto">
      <div className="inline-flex min-w-full gap-1 rounded-xl border border-border bg-muted/60 p-1 sm:min-w-0">
        {tabs.map((tab) => {
          const on = tab.id === active;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              aria-current={on ? "page" : undefined}
              className={cn(
                "relative inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-brand-500 sm:flex-none",
                on ? "text-strong" : "text-muted-foreground hover:text-strong",
              )}
            >
              {on ? <motion.span layoutId={`${label}-pill`} className="absolute inset-0 rounded-lg bg-card shadow-sm ring-1 ring-border" transition={{ type: "spring", bounce: 0.2, duration: 0.45 }} /> : null}
              <Icon aria-hidden className={cn("relative size-4", on ? "text-brand-600" : "")} />
              <span className="relative font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** A labelled number, used in the heroes. */
export function HeroStat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warning" | "danger" }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-lg font-semibold tracking-tight tabular-nums", tone === "danger" ? "text-destructive-foreground" : tone === "warning" ? "text-warning-foreground" : "text-strong")}>{value}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

/** The tinted band and soft glow every hero card shares. */
export function HeroCard({ children, className, glow = true }: { children: React.ReactNode; className?: string; glow?: boolean }) {
  return (
    <section className={cn("relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6", className)}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-brand-500/10 to-transparent" />
      {glow ? <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-brand-500/10 blur-3xl" /> : null}
      <div className="relative">{children}</div>
    </section>
  );
}

export type RosterRow = {
  key: string;
  label: string;
  /** An agent's face is shown for real agents; Company Chat and Creative Studio get an icon. */
  agent?: NavAgentId | null;
  icon?: LucideIcon;
  state?: keyof typeof STATE;
  credits: number;
  units: number;
  share: number;
  color: string;
};

/** Who did the work this cycle: one row per agent with its live state and a bar for its share of credits. */
export function AgentRoster({ rows }: { rows: readonly RosterRow[] }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No AI work has been done this cycle yet.</p>;
  return (
    <ul className="grid gap-2">
      {rows.map((row, index) => {
        const Icon = row.icon;
        return (
          <li key={row.key} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
            {row.agent ? (
              <AgentAvatar agent={row.agent} state={row.state} size="md" />
            ) : (
              <span aria-hidden className="grid size-9 place-content-center rounded-full bg-brand-500/10 text-brand-600 ring-1 ring-brand-500/20">
                {Icon ? <Icon className="size-4.5" /> : null}
              </span>
            )}
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-2 text-sm">
                <span className="font-medium text-strong">{row.label}</span>
                {row.state ? <span className="text-xs text-muted-foreground">{STATE[row.state].label}</span> : null}
              </p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: row.color, boxShadow: `0 0 8px ${row.color}` }}
                  initial={{ width: 0 }}
                  animate={{ width: `${row.share}%` }}
                  transition={{ duration: 0.8, delay: Math.min(index * 0.06, 0.4), ease: EASE }}
                />
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-strong tabular-nums">{row.credits.toLocaleString("en-US")}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {row.share}% · {row.units.toLocaleString("en-US")} done
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** A row of agent faces, overlapping, for a plan card. */
export function AvatarStack({ agents }: { agents: readonly { id: string; label: string }[] }) {
  return (
    <div className="flex items-center">
      {agents.map((agent, index) => (
        <span key={agent.id} title={agent.label} className={cn("rounded-full ring-2 ring-card", index > 0 && "-ml-2")}>
          <AgentAvatar agent={agent.id as NavAgentId} size="sm" />
        </span>
      ))}
    </div>
  );
}
