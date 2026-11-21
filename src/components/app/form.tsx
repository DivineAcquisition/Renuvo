"use client";

import { cloneElement, isValidElement, useId, useState } from "react";

import { FieldControlContext, isComposite, joinIds } from "@/components/ui/selection/field-context";
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
 *
 * A native input, select or textarea is wrapped in the label and given the description directly. A
 * composite control from the selection system (Select, SearchableSelect, MultiSelect, RadioGroup) is
 * not: its focusable element is inside it, so it reads the ids from context and names itself. `aside`
 * sits under the control, outside the label, for a source chip or a suggestion with its own buttons.
 */
export function Field({ label, hint, error, children, className, aside, required }: { label: string; hint?: string; error?: string | null; children: React.ReactNode; className?: string; aside?: React.ReactNode; required?: boolean }) {
  const id = useId();
  const described = joinIds(error ? `${id}-error` : null, hint ? `${id}-hint` : null);
  const context = { controlId: `${id}-control`, labelId: `${id}-label`, describedBy: described, invalid: Boolean(error), required };
  const composite = isValidElement(children) && isComposite(children.type);
  const words = (
    <>
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
    </>
  );
  const title = (
    <>
      {label}
      {required ? (
        <span className="ml-0.5 text-muted-foreground" aria-hidden>
          *
        </span>
      ) : null}
    </>
  );
  if (composite) {
    return (
      <FieldControlContext.Provider value={context}>
        <div className={cn("grid content-start gap-1.5 text-sm", className)}>
          <label id={context.labelId} htmlFor={context.controlId} className="font-medium text-strong">
            {title}
          </label>
          {children}
          {words}
          {aside}
        </div>
      </FieldControlContext.Provider>
    );
  }
  const linked = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, { "aria-describedby": joinIds(children.props["aria-describedby"] as string | undefined, described), ...(error ? { "aria-invalid": true } : {}), ...(required ? { required: true } : {}) })
    : children;
  // Without an aside the markup is exactly what it always was: one label around the control.
  if (!aside) {
    return (
      <FieldControlContext.Provider value={context}>
        <label className={cn("grid content-start gap-1.5 text-sm", className)}>
          <span className="font-medium text-strong">{title}</span>
          {linked}
          {words}
        </label>
      </FieldControlContext.Provider>
    );
  }
  return (
    <FieldControlContext.Provider value={context}>
      <div className={cn("grid content-start gap-1.5 text-sm", className)}>
        <label className="grid content-start gap-1.5">
          <span className="font-medium text-strong">{title}</span>
          {linked}
          {words}
        </label>
        {aside}
      </div>
    </FieldControlContext.Provider>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(control, props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cn(control, "min-h-20", props.className)} />;
}

/**
 * The native select, kept for short lists where the platform picker is the right tool (it is the best
 * picker on phones) and for screens whose handlers read `event.target.value`. It shares the selection
 * system's chevron, height and focus so it sits beside a Select without looking different. For long
 * lists, descriptions or search, use Select or SearchableSelect from "@/components/ui/selection".
 */
const nativeSelect = "select-native cursor-pointer pr-9";

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(control, nativeSelect, props.className)} />;
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
      {message}
    </p>
  );
}
