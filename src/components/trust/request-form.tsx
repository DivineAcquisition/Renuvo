"use client";

import { startTransition, useActionState, useId } from "react";

import { AlertTriangle, CircleCheckIcon, Loader } from "@/components/icons";
import type { RequestState } from "@/lib/trust/requests";
import { cn } from "@/lib/utils";

type FieldBase = { name: string; label: string; required?: boolean; hint?: string; /** Shown after an unrequired label instead of "(optional)". */ optionalLabel?: string };
export type FieldSpec =
  | (FieldBase & { kind: "text" | "email"; autoComplete?: string; max?: number })
  | (FieldBase & { kind: "textarea"; max?: number; rows?: number })
  | (FieldBase & { kind: "select"; options: { value: string; label: string }[] });

const control = "block w-full rounded-xl border border-[#d5dae5] bg-white px-3.5 text-[15px] text-[#211a35] placeholder:text-[#98a1b3] hover:border-[#b9c0cf] focus-visible:border-[#6838ef] focus-visible:shadow-[0_0_0_3px_rgba(104,56,239,0.22)] focus-visible:outline-none aria-[invalid=true]:border-red-600";

/**
 * A public request form. It reports success only when the record says the request was saved, gives
 * the reference to quote, and keeps what was typed when something fails. A hidden field catches bots.
 */
export function RequestForm({ action, fields, submitLabel, consentNote }: { action: (state: RequestState, form: FormData) => Promise<RequestState>; fields: FieldSpec[]; submitLabel: string; consentNote?: string }) {
  const [state, run, pending] = useActionState(action, { status: "idle" } as RequestState);
  const base = useId();
  if (state.status === "saved") {
    return (
      <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
        <p className="flex items-center gap-2 font-semibold">
          <CircleCheckIcon className="size-5" aria-hidden />
          Received
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          Your request is saved under reference <span className="font-mono font-semibold">{state.reference}</span>. Keep it if you write to us about this. We reply to the email address you gave.
        </p>
      </div>
    );
  }
  const values = state.status === "invalid" || state.status === "failed" || state.status === "limited" ? state.values : {};
  return (
    <form
      className="grid gap-5"
      noValidate
      // Submitted by hand rather than through `action`, so React does not reset the form afterwards:
      // whatever the person typed stays in the fields when a field is refused or saving fails.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => run(data));
      }}
    >
      {fields.map((field) => {
        const id = `${base}-${field.name}`;
        const error = state.status === "invalid" && state.field === field.name ? state.message : null;
        const described = [error ? `${id}-error` : null, field.hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
        const common = { id, name: field.name, required: field.required, "aria-invalid": error ? true : undefined, "aria-describedby": described, defaultValue: values[field.name] ?? "" };
        return (
          <div key={field.name} className="grid gap-1.5">
            <label htmlFor={id} className="text-sm font-medium text-[#211a35]">
              {field.label}
              {field.required ? null : <span className="font-normal text-[#667085]"> {field.optionalLabel ?? "(optional)"}</span>}
            </label>
            {field.kind === "textarea" ? (
              <textarea {...common} rows={field.rows ?? 5} maxLength={field.max} className={cn(control, "py-2.5")} />
            ) : field.kind === "select" ? (
              <select {...common} className={cn(control, "h-11 cursor-pointer")}>
                <option value="">Choose one</option>
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input {...common} type={field.kind} autoComplete={field.autoComplete} maxLength={field.max} inputMode={field.kind === "email" ? "email" : undefined} className={cn(control, "h-11")} />
            )}
            {field.hint ? (
              <p id={`${id}-hint`} className="text-xs leading-relaxed text-[#667085]">
                {field.hint}
              </p>
            ) : null}
            {error ? (
              <p id={`${id}-error`} role="alert" className="flex items-start gap-1.5 text-xs font-medium text-red-700">
                <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
      {/* People never see this. A filled-in value means a bot, and the request is dropped. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      {state.status === "failed" || state.status === "limited" ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {state.message}
        </p>
      ) : null}
      {consentNote ? <p className="text-xs leading-relaxed text-[#667085]">{consentNote}</p> : null}
      <div>
        <button type="submit" disabled={pending} aria-busy={pending} className="icon-gradient inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#5126c7]/40 px-5 text-[15px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6838ef] disabled:cursor-not-allowed">
          {pending ? <Loader className="size-4 animate-spin" aria-hidden /> : null}
          {pending ? "Sending" : submitLabel}
        </button>
      </div>
    </form>
  );
}
