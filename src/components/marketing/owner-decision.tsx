"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CheckCircle2, Hand, Loader2, RotateCcw } from "@/components/icons";
import { AgentMark } from "@/components/marketing/agent-mark";
import { Badge } from "@/components/ui/badge";
import { CONTROL, EXAMPLE_LABEL } from "@/lib/marketing/content";

const DECISION = CONTROL.decision;
const HOLD_MS = 1200;

/**
 * One decision brought to the owner. It only moves when a person holds the button, which is the
 * point: above the limit the owner set, the agent proposes and waits. It changes nothing.
 */
export function OwnerDecision() {
  const [progress, setProgress] = useState(0);
  const [approved, setApproved] = useState(false);
  const frame = useRef<number | null>(null);
  const started = useRef<number | null>(null);

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
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase">{DECISION.title}</h3>
        <Badge variant="outline" size="sm">
          {EXAMPLE_LABEL}
        </Badge>
      </div>

      <div className="mt-4 rounded-lg border border-brand-500/40 bg-background p-4">
        <div className="flex items-start gap-3">
          <AgentMark id="retention" size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm font-medium text-strong">{DECISION.request}</p>
              <Badge variant={approved ? "success" : "warning"} size="sm">
                {approved ? DECISION.approved : DECISION.waiting}
              </Badge>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{DECISION.meta}</p>
          </div>
        </div>

        <div aria-live="polite" className="sr-only">
          {approved ? `${DECISION.approvedTitle}. ${DECISION.approvedBody}` : ""}
        </div>

        <div className="mt-4">
          {approved ? (
            <div className="live-enter flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/40 bg-success/10 px-3 py-2.5">
              <span className="flex items-center gap-2 text-sm text-strong">
                <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
                <span>
                  <span className="font-medium">{DECISION.approvedTitle}.</span> {DECISION.approvedBody}
                </span>
              </span>
              <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500">
                <RotateCcw className="size-3.5" aria-hidden />
                {DECISION.reset}
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
                  {progress > 0 ? DECISION.holding : DECISION.hold}
                </span>
              </button>
              <p id="hold-to-approve-hint" className="text-xs text-muted-foreground">
                {DECISION.hint}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
