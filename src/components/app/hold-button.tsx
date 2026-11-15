"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Hand, Loader2 } from "@/components/icons";
import { cn } from "@/lib/utils";

const HOLD_MS = 900;

/**
 * A decision moves only when a person holds the button. A stray click or tap approves nothing.
 * Works with a pointer, and with Space or Enter held down.
 */
export function HoldButton({ label, holdingLabel, onConfirm, disabled, busy, className }: { label: string; holdingLabel: string; onConfirm: () => void; disabled?: boolean; busy?: boolean; className?: string }) {
  const [progress, setProgress] = useState(0);
  const frame = useRef<number | null>(null);
  const started = useRef<number | null>(null);
  const confirm = useRef(onConfirm);
  useEffect(() => {
    confirm.current = onConfirm;
  }, [onConfirm]);

  const stop = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
    started.current = null;
    setProgress(0);
  }, []);

  const start = useCallback(() => {
    if (disabled || busy || started.current !== null) return;
    started.current = performance.now();
    const tick = (now: number) => {
      const value = Math.min(1, (now - (started.current ?? now)) / HOLD_MS);
      setProgress(value);
      if (value >= 1) {
        frame.current = null;
        started.current = null;
        setProgress(0);
        confirm.current();
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [busy, disabled]);

  useEffect(() => () => stop(), [stop]);

  return (
    <button
      type="button"
      disabled={disabled || busy}
      title="Press and hold"
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
      className={cn(
        "relative inline-flex h-9 touch-none items-center justify-center gap-2 overflow-hidden rounded-lg border border-brand-400/60 bg-brand-500 px-4 text-sm font-semibold text-white select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-60",
        className,
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 bg-brand-300/40" style={{ width: `${progress * 100}%` }} />
      <span className="relative inline-flex items-center gap-2">
        {busy || progress > 0 ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Hand className="size-4" aria-hidden />}
        {progress > 0 ? holdingLabel : label}
      </span>
    </button>
  );
}
