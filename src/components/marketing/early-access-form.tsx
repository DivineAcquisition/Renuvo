"use client";

import { useActionState } from "react";

import { requestEarlyAccess, type EarlyAccessState } from "@/app/actions";
import { CheckCircle2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EARLY_ACCESS } from "@/lib/marketing/content";
import { marketingField, marketingFieldControl, marketingFormLabel } from "@/lib/marketing/ui";

const INITIAL: EarlyAccessState = { status: "idle" };

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className={marketingFormLabel}>
        {label}
      </label>
      <div className={marketingField}>{children}</div>
    </div>
  );
}

export function EarlyAccessForm() {
  const [state, action, pending] = useActionState(requestEarlyAccess, INITIAL);

  if (state.status === "done") {
    return (
      <div className="live-enter flex items-start gap-3 rounded-xl border border-success/40 bg-success/10 p-5" role="status">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <div>
          <p className="font-medium text-strong">{EARLY_ACCESS.done.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{EARLY_ACCESS.done.body}</p>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-5 text-left">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="early-name" label={EARLY_ACCESS.fields.name}>
          <input id="early-name" name="name" required maxLength={120} autoComplete="name" className={marketingFieldControl} />
        </Field>
        <Field id="early-email" label={EARLY_ACCESS.fields.email}>
          <input id="early-email" name="email" type="email" required maxLength={200} autoComplete="email" className={marketingFieldControl} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="early-company" label={EARLY_ACCESS.fields.company}>
            <input id="early-company" name="company" required maxLength={160} autoComplete="organization" className={marketingFieldControl} />
          </Field>
        </div>
      </div>

      <fieldset>
        <legend className={marketingFormLabel}>{EARLY_ACCESS.fields.focus}</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {EARLY_ACCESS.focusOptions.map((option) => (
            <label
              key={option}
              className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-strong has-checked:border-brand-500/60 has-checked:bg-brand-500/10 has-checked:text-strong has-focus-visible:outline-2 has-focus-visible:outline-brand-500"
            >
              <input type="radio" name="focus" value={option} required className="sr-only" />
              {option}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Hidden from people and from screen readers. */}
      <div className="hidden" aria-hidden>
        <label htmlFor="early-website">Website</label>
        <input id="early-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-flag-critical">
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" variant="gradient" size="xl" disabled={pending} className="h-12! rounded-[8px]! before:rounded-[7px]!">
          {pending ? EARLY_ACCESS.sending : EARLY_ACCESS.submit}
        </Button>
        <p className="text-xs text-muted-foreground">{EARLY_ACCESS.consent}</p>
      </div>
    </form>
  );
}
