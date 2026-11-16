"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { Logo, LogoGlyph } from "@/components/brand/logo";
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

/** The one-line status at the top of the panel: who is working and on what. */
function StatusLine({ steps }: { steps: TraceStep[] }) {
  const at = steps.find((step) => step.state === "failed") ?? steps.find((step) => step.state === "active") ?? steps.find((step) => step.state === "needs_you");
  const allDone = steps.length > 0 && steps.every((step) => step.state === "done");
  const tone = allDone ? "text-emerald-300" : at?.state === "failed" ? "text-red-300" : at?.state === "needs_you" ? "text-amber-300" : "text-[#b39eff]";
  const word = allDone ? "Done" : at ? WORD[at.state] : "Ready";
  return (
    <div className="auth-glass flex items-center gap-3 rounded-2xl px-3.5 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10">
        <LogoGlyph className="h-5 [&_path]:fill-white" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-white">Selestial</p>
        <p className="truncate text-xs text-white/65">{allDone ? "Everything on this screen is finished." : at ? at.label : "Ready when you are."}</p>
      </div>
      <span className={cn("flex shrink-0 items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase", tone)}>
        <span className={cn("relative size-1.5 rounded-full bg-current", at?.state === "active" && "auth-dot")} aria-hidden />
        {word}
      </span>
    </div>
  );
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

/** The dark panel beside the form: the steps of this screen's real work, and what has happened so far. */
function AgentPanel({ steps, events }: { steps: TraceStep[]; events: TraceEvent[] }) {
  return (
    <aside className="auth-panel hidden w-[44%] max-w-[560px] shrink-0 flex-col justify-between p-10 lg:flex xl:p-12" aria-label="Progress">
      <div className="grid gap-5">
        <StatusLine steps={steps} />
        <div className="auth-glass rounded-2xl p-5">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-white/55 uppercase">What happens here</p>
          <ol className="mt-4 grid">
            {steps.map((step, index) => (
              <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0">
                {index < steps.length - 1 ? <span className={cn("absolute top-6 left-[11px] h-[calc(100%-1.5rem)] w-px", step.state === "done" ? "bg-emerald-300/40" : "bg-white/15")} aria-hidden /> : null}
                <Mark state={step.state} index={index} dark />
                <div className="min-w-0 pt-0.5">
                  <p className={cn("text-sm font-medium", step.state === "active" ? "auth-working" : step.state === "todo" ? "text-white/55" : "text-white")}>{step.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-white/60">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="auth-glass rounded-2xl p-5">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-white/55 uppercase">Activity</p>
          {events.length === 0 ? (
            <p className="mt-3 font-mono text-xs text-white/45">Nothing yet. This fills in as you go.</p>
          ) : (
            <ol className="mt-3 grid gap-1.5" aria-live="off">
              {events.map((event) => (
                <li key={`${event.at}-${event.text}`} className="auth-rise flex gap-3 font-mono text-xs">
                  <span className="shrink-0 text-white/40 tabular-nums">{clock(event.at)}</span>
                  <span className="text-white/80">{event.text}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      <div className="mt-10">
        <p className="font-heading text-2xl leading-snug tracking-tight text-white">Your business shouldn’t wait on you for everything.</p>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/65">You set the standards. Your team starts on review: nothing reaches a customer or a cleaner until you approve it.</p>
      </div>
    </aside>
  );
}

/** The same steps, folded into one line for a phone. */
function CompactTrace({ steps }: { steps: TraceStep[] }) {
  if (steps.length === 0) return null;
  const at = steps.find((step) => step.state !== "done") ?? steps[steps.length - 1];
  return (
    <div className="mb-5 rounded-2xl border border-[#e4e7ef] bg-white/70 px-3.5 py-3 lg:hidden">
      <ol className="flex items-center" aria-label="Progress">
        {steps.map((step, index) => (
          <li key={step.key} className="flex flex-1 items-center last:flex-none">
            <Mark state={step.state} index={index} />
            <span className="sr-only">{step.label}</span>
            {index < steps.length - 1 ? <span className={cn("h-px flex-1", step.state === "done" ? "bg-emerald-600/40" : "bg-[#e4e7ef]")} aria-hidden /> : null}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs leading-relaxed text-[#667085]">
        <span className="font-semibold text-[#211a35]">{at.label}.</span> {at.detail}
      </p>
    </div>
  );
}

/**
 * The frame every sign-in screen sits in: the wordmark, one focused card, and the progress panel.
 * The panel is not decoration. Its steps and its activity list come from what this screen is doing.
 */
export function AuthShell({ eyebrow, title, lead, steps, events, children, below }: { eyebrow: string; title: string; lead?: React.ReactNode; steps: TraceStep[]; events: TraceEvent[]; children: React.ReactNode; below?: React.ReactNode }) {
  return (
    <div className="auth-page flex min-h-dvh text-[#211a35]">
      <div className="flex min-w-0 flex-1 flex-col px-5 py-6 sm:px-10 sm:py-8">
        <header className="flex items-center justify-between">
          <Link href="/" aria-label="Selestial home" className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6838ef]">
            <Logo />
          </Link>
        </header>
        <main id="content" className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center py-8 sm:py-12">
          <CompactTrace steps={steps} />
          <div className="auth-card p-6 sm:p-8">
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
