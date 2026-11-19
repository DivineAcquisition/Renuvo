"use client";

/**
 * Shared pictures of an agent at work, used by the in-app coming-soon pages and the public agent pages:
 * a worked example that plays in a loop (what comes in, the agent working it, what you get), and small
 * wordless sketches of the screens an agent works in. Decoration and demonstration only: every word is
 * also in the page, and with reduced motion everything is shown at once.
 */
import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useState } from "react";

import { agentPortrait } from "@/components/app/agent";
import { CheckCircle2, ShieldCheck } from "@/components/icons";
import { cn } from "@/lib/utils";

export type MockKind = "photos" | "checklist" | "chat" | "calendar" | "bars" | "offer" | "list" | "week" | "progress" | "rank" | "pipeline";
export type SceneSpec = { trigger: { title: string; detail: string }; work: string[]; outcomes: { title: string; detail: string }[] };

// ── The worked example ─────────────────────────────────────────────────────────────────────────────

const STEP_MS = 1100;

/**
 * Something arrives, the agent works it step by step, and what it produces appears: played in a loop. With
 * reduced motion every step is shown at once. The words are all in the page, so nothing depends on motion.
 */
export function AgentScene({ agent, footer }: { agent: { id: string; name: string; scene: SceneSpec }; footer?: React.ReactNode }) {
  const reduce = useReducedMotion();
  const total = 1 + agent.scene.work.length + agent.scene.outcomes.length;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const timer = setInterval(() => setTick((value) => (value + 1) % (total + 3)), STEP_MS);
    return () => clearInterval(timer);
  }, [reduce, total]);
  const shown = reduce ? total : Math.min(tick + 1, total);
  const workShown = Math.max(0, Math.min(agent.scene.work.length, shown - 1));
  const outShown = Math.max(0, shown - 1 - agent.scene.work.length);
  const working = !reduce && shown > 1 && workShown < agent.scene.work.length + 1 && outShown === 0;
  return (
    <section aria-labelledby="scene" className="overflow-hidden rounded-2xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <h2 id="scene" className="font-heading text-base tracking-tight text-strong">
          Watch it work
        </h2>
        <span className="text-xs text-muted-foreground">An example. Names and numbers are made up.</span>
      </header>
      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[1fr_auto_1.2fr_auto_1fr] lg:items-start">
        {/* What arrives */}
        <Stage label="Comes in">
          <motion.div initial={false} animate={{ opacity: shown >= 1 ? 1 : 0.3, y: shown >= 1 ? 0 : 6 }} transition={{ duration: 0.4 }} className="rounded-xl border border-brand-500/30 bg-brand-500/[0.07] p-3">
            <p className="text-sm font-medium text-strong">{agent.scene.trigger.title}</p>
            <p className="text-xs text-muted-foreground">{agent.scene.trigger.detail}</p>
          </motion.div>
        </Stage>
        <Flow active={shown > 1} />
        {/* The agent working */}
        <Stage label={`${agent.name} works on it`}>
          <div className="rounded-xl border border-border bg-background p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="relative">
                <Image src={agentPortrait(agent.id)} alt="" width={56} height={56} className="size-7 rounded-full object-cover ring-1 ring-brand-500/40" />
                {working ? <span aria-hidden className="live-pulse absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-brand-400" /> : null}
              </span>
              <span className="text-xs font-medium text-strong">{working ? "Working…" : outShown > 0 ? "Done" : "Waiting"}</span>
            </div>
            <ol className="grid gap-1.5">
              {agent.scene.work.map((step, index) => {
                const on = index < workShown;
                return (
                  <motion.li key={step} initial={false} animate={{ opacity: on ? 1 : 0.35 }} transition={{ duration: 0.3 }} className="flex items-start gap-2 text-xs">
                    <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border", on ? "border-brand-400 bg-brand-500 text-white" : "border-border text-transparent")}>
                      <CheckCircle2 aria-hidden className="size-3" />
                    </span>
                    <span className={on ? "text-strong" : "text-muted-foreground"}>{step}</span>
                  </motion.li>
                );
              })}
            </ol>
          </div>
        </Stage>
        <Flow active={outShown > 0} />
        {/* What comes out */}
        <Stage label="What you get">
          <ul className="grid gap-2">
            {agent.scene.outcomes.map((outcome, index) => {
              const on = index < outShown;
              return (
                <motion.li
                  key={outcome.title}
                  initial={false}
                  animate={{ opacity: on ? 1 : 0.25, x: on ? 0 : 8 }}
                  transition={{ duration: 0.35 }}
                  className={cn("rounded-xl border p-2.5", on ? "border-success/40 bg-success/[0.07]" : "border-dashed border-border")}
                >
                  <p className="flex items-center gap-1.5 text-sm font-medium text-strong">
                    <CheckCircle2 aria-hidden className={cn("size-3.5 shrink-0", on ? "text-success-foreground" : "text-muted-foreground")} />
                    {outcome.title}
                  </p>
                  <p className="pl-5 text-xs text-muted-foreground">{outcome.detail}</p>
                </motion.li>
              );
            })}
          </ul>
        </Stage>
      </div>
      {footer ? (
        <p className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
          <ShieldCheck aria-hidden className="size-4 shrink-0 text-brand-300" />
          {footer}
        </p>
      ) : null}
    </section>
  );
}

function Stage({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-2">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      {children}
    </div>
  );
}

/** The connector between stages: a line with a dot travelling along it while work flows (down on phones, across on wide screens). */
function Flow({ active }: { active: boolean }) {
  const reduce = useReducedMotion();
  const moving = active && !reduce;
  return (
    <div aria-hidden className="relative mx-auto h-8 w-px lg:mt-16 lg:h-px lg:w-14">
      <div className={cn("absolute inset-0 rounded-full", active ? "bg-brand-500/60" : "bg-border")} />
      {moving ? (
        <>
          <motion.span className="absolute left-[-3.5px] size-2 rounded-full bg-brand-300 shadow-[0_0_10px_var(--color-brand-400)] lg:hidden" animate={{ top: ["0%", "100%"] }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }} />
          <motion.span className="absolute top-[-3.5px] hidden size-2 rounded-full bg-brand-300 shadow-[0_0_10px_var(--color-brand-400)] lg:block" animate={{ left: ["0%", "100%"] }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }} />
        </>
      ) : null}
    </div>
  );
}

const bar = "rounded-full bg-muted";

/** A small, wordless sketch of the screen a capability will have. Decorative only. */
export function Mock({ kind }: { kind: MockKind }) {
  switch (kind) {
    case "photos":
      return (
        <div className="grid h-full grid-cols-3 gap-1.5">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={cn("relative rounded-md", i === 4 ? "bg-warning/20 ring-1 ring-warning/60" : "bg-gradient-to-br from-brand-500/25 to-brand-500/5")}>
              <span className={cn("absolute right-1 bottom-1 size-2.5 rounded-full", i === 4 ? "bg-warning" : "bg-success")} />
            </div>
          ))}
        </div>
      );
    case "checklist":
      return (
        <ul className="grid gap-2">
          {[1, 1, 1, 0].map((done, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className={cn("grid size-4 place-items-center rounded border", done ? "border-success bg-success/80" : "border-border")} />
              <span className={cn(bar, "h-2", ["w-3/4", "w-1/2", "w-2/3", "w-3/5"][i])} />
            </li>
          ))}
        </ul>
      );
    case "chat":
      return (
        <div className="grid h-full content-center gap-1.5">
          <span className="h-5 w-3/5 rounded-xl rounded-bl-sm bg-muted" />
          <span className="ml-auto h-5 w-2/3 rounded-xl rounded-br-sm bg-brand-500/60" />
          <span className="h-5 w-1/2 rounded-xl rounded-bl-sm bg-muted" />
          <span className="ml-auto h-5 w-2/5 rounded-xl rounded-br-sm bg-brand-500/60" />
        </div>
      );
    case "calendar":
      return (
        <div className="grid h-full grid-cols-7 gap-1">
          {Array.from({ length: 21 }, (_, i) => (
            <span key={i} className={cn("rounded-sm", [3, 9, 10, 16].includes(i) ? "bg-brand-500/70" : [5, 12].includes(i) ? "bg-success/50" : "bg-muted")} />
          ))}
        </div>
      );
    case "bars":
      return (
        <div className="flex h-full items-end gap-2">
          {[40, 72, 55, 90, 30].map((height, i) => (
            <span key={i} className={cn("flex-1 rounded-t-md", i === 3 ? "bg-brand-500" : "bg-brand-500/35")} style={{ height: `${height}%` }} />
          ))}
        </div>
      );
    case "offer":
      return (
        <div className="grid h-full content-center gap-2 rounded-lg border border-dashed border-brand-500/50 bg-brand-500/[0.06] p-3">
          <span className="h-3 w-1/2 rounded-full bg-brand-500/70" />
          <span className={cn(bar, "h-2 w-4/5")} />
          <span className={cn(bar, "h-2 w-3/5")} />
          <span className="mt-1 h-5 w-20 rounded-md bg-brand-500" />
        </div>
      );
    case "list":
      return (
        <ul className="grid gap-2">
          {["bg-warning", "bg-brand-400", "bg-success", "bg-brand-400"].map((dot, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
              <span className={cn("size-2 shrink-0 rounded-full", dot)} />
              <span className={cn(bar, "h-2", ["w-2/3", "w-1/2", "w-3/4", "w-2/5"][i])} />
            </li>
          ))}
        </ul>
      );
    case "week":
      return (
        <div className="grid h-full grid-cols-5 gap-1.5">
          {[0, 1, 2, 3, 4].map((day) => (
            <div key={day} className="grid content-start gap-1">
              <span className={cn(bar, "h-1.5 w-full")} />
              {[0, 1, 2].map((slot) => (
                <span key={slot} className={cn("h-4 rounded-sm", (day + slot) % 3 === 0 ? "bg-brand-500/60" : (day + slot) % 4 === 1 ? "bg-success/40" : "bg-muted")} />
              ))}
            </div>
          ))}
        </div>
      );
    case "rank":
      return (
        <ol className="grid gap-1.5">
          {[0, 1, 2].map((i) => (
            <li key={i} className={cn("flex items-center gap-2 rounded-md border px-2 py-1.5", i === 0 ? "border-brand-500/50 bg-brand-500/10" : "border-border")}>
              <span className={cn("grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-semibold", i === 0 ? "bg-brand-500 text-white" : "bg-muted text-muted-foreground")}>{i + 1}</span>
              <span className={cn(bar, "h-2", ["w-1/2", "w-2/5", "w-1/3"][i])} />
              <span className={cn("ml-auto h-2 w-8 rounded-full", i === 0 ? "bg-success" : "bg-muted")} />
            </li>
          ))}
        </ol>
      );
    case "pipeline":
      return (
        <div className="grid h-full grid-cols-4 gap-1.5">
          {[3, 2, 2, 1].map((cards, column) => (
            <div key={column} className="grid content-start gap-1 rounded-md bg-muted/60 p-1">
              <span className={cn(bar, "mb-0.5 h-1.5 w-2/3 bg-border")} />
              {Array.from({ length: cards }, (_, i) => (
                <span key={i} className={cn("h-4 rounded-sm border", column === 3 ? "border-success/50 bg-success/20" : "border-border bg-background")} />
              ))}
            </div>
          ))}
        </div>
      );
    case "progress":
      return (
        <div className="grid h-full content-center gap-3">
          {[100, 70, 35].map((value, i) => (
            <div key={i} className="grid gap-1">
              <span className={cn(bar, "h-1.5", ["w-1/3", "w-1/2", "w-2/5"][i])} />
              <span className="h-2 overflow-hidden rounded-full bg-muted">
                <span className={cn("block h-full rounded-full", value === 100 ? "bg-success" : "bg-brand-500")} style={{ width: `${value}%` }} />
              </span>
            </div>
          ))}
        </div>
      );
  }
}

