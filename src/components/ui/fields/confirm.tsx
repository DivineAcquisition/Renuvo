"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useCallback, useRef, useState } from "react";

import { TriangleAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConfirmOptions = {
  /** A specific question: "Leave without saving?", not "Are you sure?". */
  title: string;
  /** What happens, in a sentence or two. */
  body: React.ReactNode;
  /** The record it is about, as label and value pairs. */
  details?: readonly { label: string; value: React.ReactNode }[];
  /** The action, named for what it does: "Remove Dana", "Set remaining rows aside". */
  confirmLabel: string;
  /** The way back, named too: "Keep editing", "Continue reviewing". */
  cancelLabel?: string;
  tone?: "default" | "danger";
  /**
   * The work the confirmation starts. While it runs the dialog shows it is busy and cannot be closed;
   * if it fails the reason is shown in the dialog and nothing is retried on its own.
   */
  action?: () => Promise<unknown>;
  /** Shown with a failure: what was kept and what to do next. */
  failureNote?: string;
  /**
   * Whether trying again is safe. Leave it on for an edit the server checks (removing, archiving). Turn
   * it off for anything that reaches outside Selestial (a payment, a message): after a failure the person
   * is told to check what happened instead of being offered to send it again.
   */
  retryable?: boolean;
};

function messageOf(error: unknown): string {
  const data = (error as { data?: { message?: unknown } } | null)?.data;
  if (data && typeof data.message === "string") return data.message;
  return "That did not go through. Nothing was changed. Please try again.";
}

/**
 * The branded replacement for window.confirm. `ask` opens the dialog and resolves true when the person
 * confirms (after `action`, if given, succeeds) and false when they back out. Render `element` once in
 * the component that asks.
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const finish = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
    setError(null);
    setBusy(false);
  }, []);

  const ask = useCallback((next: ConfirmOptions) => {
    resolver.current?.(false);
    setError(null);
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const confirm = async () => {
    if (!options || busy) return;
    if (!options.action) return finish(true);
    setBusy(true);
    setError(null);
    try {
      await options.action();
      finish(true);
    } catch (caught) {
      setBusy(false);
      setError(messageOf(caught));
    }
  };

  const element = <ConfirmDialog open={options !== null} options={options} busy={busy} error={error} onConfirm={() => void confirm()} onCancel={() => (busy ? undefined : finish(false))} />;
  return { ask, element };
}

/** The dialog itself, for a caller that manages its own state. */
export function ConfirmDialog({ open, options, busy = false, error = null, onConfirm, onCancel }: { open: boolean; options: ConfirmOptions | null; busy?: boolean; error?: string | null; onConfirm: () => void; onCancel: () => void }) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(next: boolean) => (next ? undefined : onCancel())}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-[90] bg-black/40 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-[91] grid w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-xl outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none sm:p-6">
          {options ? (
            <>
              <div className="grid gap-1.5">
                <AlertDialog.Title className="font-heading text-lg leading-snug text-strong">{options.title}</AlertDialog.Title>
                <AlertDialog.Description render={<div />} className="text-sm leading-relaxed text-muted-foreground">
                  {options.body}
                </AlertDialog.Description>
              </div>
              {options.details?.length ? (
                <dl className="grid gap-1 rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-sm">
                  {options.details.map((row) => (
                    <div key={row.label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
                      <dt className="text-muted-foreground">{row.label}</dt>
                      <dd className="min-w-0 break-words text-strong">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {error ? (
                <p role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    {error}
                    {options.failureNote ? <span className="block text-muted-foreground">{options.failureNote}</span> : null}
                  </span>
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <AlertDialog.Close render={<Button variant="ghost" size="sm" disabled={busy} />}>{options.cancelLabel ?? "Cancel"}</AlertDialog.Close>
                {error && options.retryable === false ? null : (
                  <Button variant={options.tone === "danger" ? "destructive" : "primary"} size="sm" loading={busy} onClick={onConfirm} className={cn(options.tone === "danger" && "text-white")}>
                    {error && options.action ? "Try again" : options.confirmLabel}
                  </Button>
                )}
              </div>
            </>
          ) : null}
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
