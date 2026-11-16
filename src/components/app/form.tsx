"use client";

import { cloneElement, isValidElement, useId, useState } from "react";

import { cn } from "@/lib/utils";

/** The words a refused request carries. Messages meant for a person travel as ConvexError data. */
export function messageOf(error: unknown): string {
  const data = (error as { data?: { message?: unknown } } | null)?.data;
  if (data && typeof data.message === "string") return data.message;
  return "That did not go through. Please try again.";
}

/** Runs one request at a time and keeps what went wrong in words. */
export function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (caught) {
      setError(messageOf(caught));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}

const control =
  "block w-full min-h-10 rounded-lg border border-border bg-card px-3 py-2 text-sm text-strong placeholder:text-muted-foreground/70 focus-visible:border-brand-500/60 focus-visible:outline-2 focus-visible:outline-brand-500/30 aria-invalid:border-destructive/60 disabled:cursor-not-allowed disabled:bg-muted/50 disabled:text-muted-foreground";

/**
 * A labelled control. A hint and an error are tied to the control with aria-describedby, and an error
 * marks it invalid, so a screen reader announces the problem with the field it belongs to.
 */
export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string | null; children: React.ReactNode; className?: string }) {
  const id = useId();
  const described = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  const linked = isValidElement<Record<string, unknown>>(children) ? cloneElement(children, { "aria-describedby": described, ...(error ? { "aria-invalid": true } : {}) }) : children;
  return (
    <label className={cn("grid content-start gap-1.5 text-sm", className)}>
      <span className="font-medium text-strong">{label}</span>
      {linked}
      {error ? (
        <span id={`${id}-error`} className="text-xs font-medium text-destructive-foreground">
          {error}
        </span>
      ) : null}
      {hint ? (
        <span id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(control, props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cn(control, "min-h-20", props.className)} />;
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(control, "cursor-pointer", props.className)} />;
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
      {message}
    </p>
  );
}
