import { Check, Hand, Hourglass, X } from "@/components/icons";
import { cn } from "@/lib/utils";

import type { RunStep } from "../../../convex/lib/dispatch/run";

const LOOK: Record<RunStep["state"], { ring: string; text: string; word: string }> = {
  done: { ring: "border-success/50 bg-success/10 text-success", text: "text-strong", word: "Done" },
  waiting: { ring: "border-info/50 bg-info/10 text-info", text: "text-strong", word: "Waiting on an answer" },
  needs_you: { ring: "border-warning/60 bg-warning/15 text-warning", text: "text-strong", word: "Waiting on you" },
  blocked: { ring: "border-destructive/50 bg-destructive/10 text-destructive", text: "text-strong", word: "Stopped here" },
  todo: { ring: "border-dashed border-border bg-background text-muted-foreground", text: "text-muted-foreground", word: "Not reached" },
};

function Mark({ state, index }: { state: RunStep["state"]; index: number }) {
  const live = state === "waiting" || state === "needs_you";
  return (
    <span className={cn("relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums", LOOK[state].ring)} aria-label={LOOK[state].word}>
      {state === "done" ? <Check className="size-3.5" aria-hidden /> : state === "waiting" ? <Hourglass className="size-3.5" aria-hidden /> : state === "needs_you" ? <Hand className="size-3.5" aria-hidden /> : state === "blocked" ? <X className="size-3.5" aria-hidden /> : index + 1}
      {live ? <span className={cn("live-pulse absolute -inset-1 -z-10 rounded-full", state === "needs_you" ? "bg-warning/25" : "bg-info/25")} aria-hidden /> : null}
    </span>
  );
}

/**
 * An agent's work on one thing, as the steps it took and where it stopped. The steps come from the
 * record, so the trace is something a person can check, not a description of intent.
 */
export function RunTrace({ steps, compact }: { steps: RunStep[]; compact?: boolean }) {
  if (steps.length === 0) return null;
  if (compact) {
    const at = steps.find((step) => step.state !== "done") ?? steps[steps.length - 1];
    return (
      <div>
        <ol className="flex items-center" aria-label="Steps so far">
          {steps.map((step, index) => (
            <li key={step.key} className="flex flex-1 items-center last:flex-none" title={`${step.label}: ${step.detail}`}>
              <Mark state={step.state} index={index} />
              {index < steps.length - 1 ? <span className={cn("h-0.5 flex-1", step.state === "done" ? "bg-success/50" : "bg-border")} aria-hidden /> : null}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-strong">{at.label}.</span> {at.detail}
        </p>
      </div>
    );
  }
  return (
    <ol className="grid">
      {steps.map((step, index) => (
        <li key={step.key} className="relative flex gap-3 pb-4 last:pb-0">
          {index < steps.length - 1 ? <span className={cn("absolute left-[11px] top-6 h-[calc(100%-1.5rem)] w-0.5", step.state === "done" ? "bg-success/40" : "bg-border")} aria-hidden /> : null}
          <Mark state={step.state} index={index} />
          <div className="min-w-0 pt-0.5">
            <p className={cn("text-sm font-medium", LOOK[step.state].text)}>{step.label}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
