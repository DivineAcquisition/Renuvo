"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { CheckCircle2, Circle, Clock, Hand, ListChecks, Loader2, RotateCcw, ScrollTextIcon, SendIcon, ShieldCheck, TriangleAlert, Users, type LucideIcon } from "@/components/icons";
import { useInViewSequence } from "@/components/marketing/motion";
import { Badge } from "@/components/ui/badge";
import { HERO, RUN } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

const eyebrow = "text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase";
const APPROVAL = RUN.approval;
const HOLD_MS = 1200;

type Step = (typeof RUN.steps)[number];
type Shown = "queued" | "running" | Step["state"];

const STEP_ICON: Record<Step["id"], LucideIcon> = { read: ListChecks, list: Users, rank: ShieldCheck, offer: SendIcon, gap: Clock, ask: Hand };
const GUARD_ICON: Record<(typeof RUN.guards)[number]["id"], LucideIcon> = { rules: ShieldCheck, setting: ListChecks, person: Hand, record: ScrollTextIcon };

function StateBadge({ state }: { state: Shown }) {
  const label = RUN.stateLabel[state];
  if (state === "done") return <Badge variant="success" size="sm"><CheckCircle2 aria-hidden />{label}</Badge>;
  if (state === "blocked") return <Badge variant="warning" size="sm"><TriangleAlert aria-hidden />{label}</Badge>;
  if (state === "waiting") return <Badge variant="info" size="sm"><Clock aria-hidden />{label}</Badge>;
  if (state === "running") return <Badge variant="outline" size="sm"><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />{label}</Badge>;
  return <Badge variant="outline" size="sm" className="text-muted-foreground"><Circle aria-hidden />{label}</Badge>;
}

/** A decision that only moves when a person holds the button. `children` gets whether it is approved. */
function HoldToApprove({ children, onChange }: { children?: (approved: boolean) => ReactNode; onChange?: (approved: boolean) => void }) {
  const [progress, setProgress] = useState(0);
  const [approved, setApproved] = useState(false);
  const frame = useRef<number | null>(null);
  const started = useRef<number | null>(null);

  useEffect(() => {
    onChange?.(approved);
  }, [approved, onChange]);

  const stop = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
    started.current = null;
    setProgress((current) => (current >= 1 ? current : 0));
  }, []);

  const start = useCallback(() => {
    if (approved || started.current !== null) return;
    started.current = performance.now();
    const tick = (now: number) => {
      const value = Math.min(1, (now - (started.current ?? now)) / HOLD_MS);
      setProgress(value);
      if (value >= 1) {
        frame.current = null;
        started.current = null;
        setApproved(true);
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [approved]);

  useEffect(() => () => stop(), [stop]);

  const reset = () => {
    stop();
    setProgress(0);
    setApproved(false);
  };

  return (
    <div className="space-y-3">
      {children?.(approved)}
      <div aria-live="polite" className="sr-only">
        {approved ? `${APPROVAL.approvedTitle}. ${APPROVAL.approvedBody}` : ""}
      </div>
      {approved ? (
        <div className="live-enter flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/40 bg-success/10 px-3 py-2.5">
          <span className="flex items-center gap-2 text-sm text-strong">
            <CheckCircle2 className="size-4 text-success" aria-hidden />
            <span>
              <span className="font-medium">{APPROVAL.approvedTitle}.</span> {APPROVAL.approvedBody}
            </span>
          </span>
          <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500">
            <RotateCcw className="size-3.5" aria-hidden />
            {APPROVAL.reset}
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <button
            type="button"
            aria-describedby="hold-to-approve-hint"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              start();
            }}
            onPointerUp={stop}
            onPointerCancel={stop}
            onLostPointerCapture={stop}
            onKeyDown={(event) => {
              if ((event.key === " " || event.key === "Enter") && !event.repeat) {
                event.preventDefault();
                start();
              }
            }}
            onKeyUp={(event) => {
              if (event.key === " " || event.key === "Enter") stop();
            }}
            onBlur={stop}
            onContextMenu={(event) => event.preventDefault()}
            className="relative inline-flex h-10 w-full touch-none items-center justify-center gap-2 overflow-hidden rounded-lg border border-brand-500/50 bg-background text-sm font-medium text-strong select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 sm:w-auto sm:px-5"
          >
            <span aria-hidden className="absolute inset-y-0 left-0 bg-gradient-to-r from-brand-400/35 to-brand-600/35" style={{ width: `${progress * 100}%` }} />
            <span className="relative inline-flex items-center gap-2">
              {progress > 0 ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Hand className="size-4" aria-hidden />}
              {progress > 0 ? APPROVAL.holding : APPROVAL.hold}
            </span>
          </button>
          <p id="hold-to-approve-hint" className="text-xs text-muted-foreground">
            {APPROVAL.hint}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Control, shown as a run: each step Atlas takes to staff one job, the rule it will not break, and
 * the stop for a person. The guardrails beside it light up as the run reaches them, and the activity
 * record fills in. With reduced motion the finished run is shown at once.
 */
export function GuardedRun() {
  const ref = useRef<HTMLDivElement>(null);
  const reached = useInViewSequence(ref, RUN.steps.length, 1100);
  const [approved, setApproved] = useState(false);

  const finished = reached >= RUN.steps.length;
  const shownState = (index: number): Shown => (index < reached ? RUN.steps[index].state : index === reached ? "running" : "queued");
  const seen = new Set<string>(RUN.steps.slice(0, reached).map((step) => step.guard));
  if (reached > 0) seen.add("record");
  const record = RUN.record.filter((line) => reached >= line.afterStep);

  return (
    <div ref={ref} className="grid items-start gap-4 lg:grid-cols-[1.25fr_0.75fr]">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_24px_60px_-36px_rgba(var(--brand-rgb),0.7)]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className={eyebrow}>
              {RUN.agent} · {HERO.exampleLabel}
            </p>
            <p className="mt-0.5 text-sm font-medium text-strong">{RUN.skill}</p>
          </div>
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-strong">{RUN.company}</span>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <ol className="relative space-y-2">
            {RUN.steps.map((step, index) => {
              const state = shownState(index);
              const Icon = STEP_ICON[step.id];
              const live = state !== "queued";
              const settled = index < reached;
              return (
                <li
                  key={step.id}
                  className={cn(
                    "rounded-lg border px-3.5 py-3 transition-colors duration-500 motion-reduce:transition-none",
                    !live && "border-dashed border-border bg-transparent",
                    live && state !== "blocked" && "border-border bg-muted",
                    state === "blocked" && "border-flag-warning/40 bg-flag-warning/10",
                    state === "waiting" && "border-brand-500/40 bg-brand-500/10",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-card", !live && "opacity-50")} aria-hidden>
                        <Icon className={cn("size-3.5", state === "blocked" ? "text-flag-warning" : "text-brand-300")} />
                      </span>
                      <span className="min-w-0">
                        <span className={cn("block text-sm font-medium", live ? "text-strong" : "text-muted-foreground")}>{step.tool}</span>
                        <span className="block truncate text-xs text-muted-foreground">{step.target}</span>
                      </span>
                    </span>
                    <StateBadge state={state} />
                  </div>
                  {/* The result keeps its place before the step finishes, so the panel does not jump as the run plays. */}
                  <p className={cn("mt-2 pl-[2.375rem] text-xs leading-relaxed text-muted-foreground", settled ? "live-enter" : "invisible", state === "blocked" && "text-strong")} aria-hidden={settled ? undefined : true}>
                    {step.result}
                  </p>
                </li>
              );
            })}
          </ol>

          <div className={cn("rounded-lg border border-brand-500/40 bg-background p-4", finished ? "live-enter" : "invisible")} inert={!finished}>
            <HoldToApprove onChange={setApproved}>
              {(done) => (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-strong">{RUN.decision.title}</p>
                    <p className="text-xs text-muted-foreground">{RUN.decision.meta}</p>
                  </div>
                  <Badge variant={done ? "success" : "warning"} size="sm">
                    {done ? APPROVAL.approved : APPROVAL.waiting}
                  </Badge>
                </div>
              )}
            </HoldToApprove>
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <h3 className={eyebrow}>{RUN.guardsTitle}</h3>
          <ul className="mt-3 grid gap-1">
            {RUN.guards.map((guard) => {
              const on = seen.has(guard.id);
              const Icon = GUARD_ICON[guard.id];
              return (
                <li key={guard.id} className={cn("flex gap-3 rounded-lg px-2.5 py-2.5 transition-colors duration-500 motion-reduce:transition-none", on && "bg-brand-500/10")}>
                  <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors duration-500 motion-reduce:transition-none", on ? "border-brand-500/50 bg-card text-brand-300" : "border-border bg-muted text-muted-foreground")} aria-hidden>
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm font-medium text-strong">{guard.title}</span>
                      <span className={cn("text-[10px] font-semibold tracking-[0.1em] uppercase", on ? "text-flag-good" : "text-muted-foreground")}>{on ? RUN.guardOn : RUN.guardWaiting}</span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{guard.body}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-xl border border-border bg-muted p-4 sm:p-5">
          <h3 className={cn(eyebrow, "flex items-center gap-2")}>
            <ScrollTextIcon className="size-3.5" aria-hidden />
            {RUN.recordTitle}
          </h3>
          <ol className="mt-3 min-h-[7.5rem] space-y-1.5 font-mono text-xs" aria-live="off">
            {record.map((line) => (
              <li key={line.text} className="live-enter flex gap-3 text-muted-foreground">
                <span className="shrink-0 tabular-nums">{line.time}</span>
                <span className="text-strong">{line.text}</span>
              </li>
            ))}
            {approved ? (
              <li className="live-enter flex gap-3 text-muted-foreground">
                <span className="shrink-0 tabular-nums">{RUN.recordApproved.time}</span>
                <span className="font-medium text-flag-good">{RUN.recordApproved.text}</span>
              </li>
            ) : null}
          </ol>
        </div>
      </div>
    </div>
  );
}
