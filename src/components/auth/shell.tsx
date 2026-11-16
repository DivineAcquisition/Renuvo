"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { Logo, LogoMark } from "@/components/brand/logo";
import { BorderBeam } from "@/components/ui/border-beam";
import { Check, Hand, X } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Where one step of the work stands. "needs_you" is a step waiting on the person at the keyboard. */
export type TraceState = "todo" | "active" | "done" | "needs_you" | "failed";
export type TraceStep = { key: string; label: string; detail: string; state: TraceState };
export type TraceEvent = { at: number; text: string };

/** The running list of what actually happened on this screen, newest last. */
export function useEvents() {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const note = useCallback((text: string) => {
    setEvents((rows) => (rows.length > 0 && rows[rows.length - 1].text === text ? rows : [...rows.slice(-5), { at: Date.now(), text }]));
  }, []);
  return { events, note };
}

const WORD: Record<TraceState, string> = { todo: "Not reached", active: "Working", done: "Done", needs_you: "Waiting on you", failed: "Stopped here" };

function Mark({ state, index, dark }: { state: TraceState; index: number; dark?: boolean }) {
  const look = dark
    ? {
        done: "border-emerald-300/50 bg-emerald-400/15 text-emerald-200",
        active: "border-[#b39eff]/70 bg-[#6838ef]/40 text-white",
        needs_you: "border-amber-300/60 bg-amber-400/15 text-amber-200",
        failed: "border-red-300/60 bg-red-400/15 text-red-200",
        todo: "border-dashed border-white/20 text-white/45",
      }[state]
    : {
        done: "border-emerald-600/40 bg-emerald-50 text-emerald-700",
        active: "border-[#6838ef]/50 bg-[#eee8ff] text-[#5126c7]",
        needs_you: "border-amber-600/40 bg-amber-50 text-amber-700",
        failed: "border-red-600/40 bg-red-50 text-red-700",
        todo: "border-dashed border-[#d5dae5] text-[#667085]",
      }[state];
  return (
    <span className={cn("relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums", look)}>
      <span className="sr-only">{WORD[state]}: </span>
      {state === "done" ? (
        <Check className="size-3.5" aria-hidden />
      ) : state === "failed" ? (
        <X className="size-3.5" aria-hidden />
      ) : state === "needs_you" ? (
        <Hand className="size-3.5" aria-hidden />
      ) : state === "active" ? (
        <span className="auth-dot relative size-1.5 rounded-full bg-current" aria-hidden />
      ) : (
        <span aria-hidden>{index + 1}</span>
      )}
    </span>
  );
}

/** Which step speaks for the screen right now: a stop first, then work under way, then whatever waits on the person. */
function current(steps: TraceStep[]): { step: TraceStep | null; allDone: boolean } {
  const step = steps.find((row) => row.state === "failed") ?? steps.find((row) => row.state === "active") ?? steps.find((row) => row.state === "needs_you") ?? null;
  return { step, allDone: steps.length > 0 && steps.every((row) => row.state === "done") };
}

/**
 * The agent's line at the top of every card: who is working, on what, and whether it is waiting on
 * the person. It is read from the same steps as the panel, so it can never say something the
 * screen is not doing. The state is a word and a mark, not only a colour.
 */
function AgentLine({ steps }: { steps: TraceStep[] }) {
  const { step, allDone } = current(steps);
  const state: TraceState | "ready" = allDone ? "done" : (step?.state ?? "ready");
  const chip = {
    active: { word: "Working", look: "border-[#d9cfff] bg-[#eee8ff] text-[#5126c7]" },
    needs_you: { word: "Waiting on you", look: "border-amber-200 bg-amber-50 text-amber-800" },
    failed: { word: "Stopped here", look: "border-red-200 bg-red-50 text-red-800" },
    done: { word: "Done", look: "border-emerald-200 bg-emerald-50 text-emerald-800" },
    todo: { word: "Ready", look: "border-[#e4e7ef] bg-[#f8f9fc] text-[#667085]" },
    ready: { word: "Ready", look: "border-[#e4e7ef] bg-[#f8f9fc] text-[#667085]" },
  }[state];
  const sentence = allDone ? "Everything on this screen is finished." : step ? `${step.label}${step.state === "active" ? "…" : ""}` : "Ready when you are.";
  return (
    <div className="mb-5 flex items-center gap-3 border-b border-[#e4e7ef] pb-4" role="status" aria-live="polite">
      <span className={cn("relative flex size-9 shrink-0 items-center justify-center rounded-[10px]", state === "active" && "agent-avatar-working")}>
        <LogoMark className="size-9" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-[#667085] uppercase">Selestial</p>
        <p key={sentence} className={cn("auth-rise text-sm leading-snug font-medium", state === "active" ? "agent-line-working" : "text-[#211a35]")}>
          {sentence}
        </p>
      </div>
      <span className={cn("flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold tracking-wide uppercase", chip.look)}>
        <span className={cn("relative size-1.5 rounded-full bg-current", state === "active" && "auth-dot")} aria-hidden />
        {chip.word}
      </span>
    </div>
  );
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

/** The dark panel beside the form: the steps of this screen's real work, and a console of what has happened so far. */
function AgentPanel({ steps, events }: { steps: TraceStep[]; events: TraceEvent[] }) {
  const { step, allDone } = current(steps);
  const done = steps.filter((row) => row.state === "done").length;
  return (
    <aside className="auth-panel hidden w-[44%] max-w-[560px] shrink-0 flex-col justify-between p-10 lg:flex xl:p-12" aria-label="Progress">
      <div className="grid gap-5">
        <div className="auth-glass rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-white/55 uppercase">The plan</p>
            <p className="font-mono text-[11px] text-white/55 tabular-nums">
              {done} of {steps.length} done
            </p>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
            <div className="h-full rounded-full bg-gradient-to-r from-[#b39eff] to-white transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${steps.length === 0 ? 0 : (done / steps.length) * 100}%` }} />
          </div>
          <ol className="mt-5 grid">
            {steps.map((row, index) => (
              <li key={row.key} className="relative flex gap-3 pb-5 last:pb-0">
                {index < steps.length - 1 ? <span className={cn("absolute top-6 left-[11px] h-[calc(100%-1.5rem)] w-px", row.state === "done" ? "bg-emerald-300/40" : "bg-white/15")} aria-hidden /> : null}
                <Mark state={row.state} index={index} dark />
                <div className="min-w-0 pt-0.5">
                  <p className={cn("text-sm font-medium", row.state === "active" ? "auth-working" : row.state === "todo" ? "text-white/55" : "text-white")}>{row.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-white/60">{row.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="auth-glass rounded-2xl p-5">
          <div className="flex items-center gap-2">
            <span className="flex gap-1" aria-hidden>
              <span className="size-2 rounded-full bg-white/20" />
              <span className="size-2 rounded-full bg-white/20" />
              <span className="size-2 rounded-full bg-white/20" />
            </span>
            <p className="text-[11px] font-semibold tracking-[0.16em] text-white/55 uppercase">Activity</p>
          </div>
          <ol className="mt-3 grid gap-1.5 font-mono text-xs" aria-live="off">
            {events.map((event) => (
              <li key={`${event.at}-${event.text}`} className="auth-rise flex gap-3">
                <span className="shrink-0 text-white/40 tabular-nums">{clock(event.at)}</span>
                <span className="text-white/80">{event.text}</span>
              </li>
            ))}
            {/* The last line is what is happening now, with a cursor: working, waiting on the person, or stopped. */}
            <li className="flex gap-3">
              <span className="shrink-0 text-[#b39eff]" aria-hidden>
                ›
              </span>
              <span className={cn(step?.state === "failed" ? "text-red-200" : step?.state === "active" ? "text-white" : "text-white/60")}>
                {allDone ? "done" : step?.state === "active" ? `${step.label.toLowerCase()}…` : step?.state === "failed" ? "stopped. try again when ready" : step?.state === "needs_you" ? "waiting on you" : "ready"}
                {step?.state === "failed" || allDone ? null : <span className="auth-caret ml-1 text-[#b39eff]" aria-hidden />}
              </span>
            </li>
          </ol>
        </div>
      </div>
      <div className="mt-10">
        <p className="font-heading text-2xl leading-snug tracking-tight text-white">Your business shouldn’t wait on you for everything.</p>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/65">You set the standards. Your team starts on review: nothing reaches a customer or a cleaner until you approve it.</p>
      </div>
    </aside>
  );
}

/** The same steps as a row of marks, inside the card, for screens too narrow for the panel. */
function CompactTrace({ steps }: { steps: TraceStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="mb-5 flex items-center lg:hidden" aria-label="Progress">
      {steps.map((step, index) => (
        <li key={step.key} className="flex flex-1 items-center last:flex-none">
          <Mark state={step.state} index={index} />
          <span className="sr-only">{step.label}</span>
          {index < steps.length - 1 ? <span className={cn("h-px flex-1", step.state === "done" ? "bg-emerald-600/40" : "bg-[#e4e7ef]")} aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * The frame every sign-in screen sits in: the wordmark, one focused card, and the progress panel.
 * Nothing here is decoration. The agent's line, the plan and the activity list all come from what
 * this screen is doing, and a light runs round the card only while a request is really under way.
 */
export function AuthShell({ eyebrow, title, lead, steps, events, children, below }: { eyebrow: string; title: string; lead?: React.ReactNode; steps: TraceStep[]; events: TraceEvent[]; children: React.ReactNode; below?: React.ReactNode }) {
  const working = steps.some((step) => step.state === "active");
  return (
    <div className="auth-page flex min-h-dvh text-[#211a35]">
      <div className="flex min-w-0 flex-1 flex-col px-5 py-6 sm:px-10 sm:py-8">
        <header className="flex items-center justify-between">
          <Link href="/" aria-label="Selestial home" className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6838ef]">
            <Logo />
          </Link>
        </header>
        <main id="content" className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center py-8 sm:py-12">
          <div className="auth-card auth-rise relative overflow-hidden p-6 sm:p-8">
            {working ? <BorderBeam size={90} duration={4} borderWidth={2} colorFrom="#6838ef" colorTo="#b39eff" /> : null}
            <AgentLine steps={steps} />
            <CompactTrace steps={steps} />
            <p className="text-[11px] font-semibold tracking-[0.16em] text-[#5126c7] uppercase">{eyebrow}</p>
            <h1 className="mt-2 font-heading text-[1.65rem] leading-tight tracking-tight text-[#211a35]">{title}</h1>
            {lead ? <p className="mt-2 text-sm leading-relaxed text-[#667085]">{lead}</p> : null}
            <div className="mt-6">{children}</div>
          </div>
          {below ? <div className="mt-5 text-center text-sm text-[#667085]">{below}</div> : null}
        </main>
        <footer className="text-xs text-[#667085]">© {new Date().getFullYear()} Selestial</footer>
      </div>
      <AgentPanel steps={steps} events={events} />
    </div>
  );
}

/** A text link in the sign-in screens. Deep Violet on white is 8.6:1, and it is underlined on hover and focus. */
export function AuthLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("rounded font-medium text-[#5126c7] underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6838ef]", className)}>
      {children}
    </Link>
  );
}
