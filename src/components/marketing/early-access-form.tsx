"use client";

import { useActionState } from "react";

import { requestEarlyAccess } from "@/app/actions";
import { CheckCircle2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TRAP_FIELD, type EarlyAccessState } from "@/lib/early-access";
import { EARLY_ACCESS } from "@/lib/marketing/content";
import { marketingField, marketingFieldControl, marketingFormLabel } from "@/lib/marketing/ui";

const INITIAL: EarlyAccessState = { status: "idle" };

function Field({ id, label, optional = false, children }: { id: string; label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className={marketingFormLabel}>
        {label}
        {optional ? <span className="font-normal text-muted-foreground"> ({EARLY_ACCESS.optional})</span> : null}
      </label>
      <div className={marketingField}>{children}</div>
    </div>
  );
}

const choice =
  "flex min-h-11 cursor-pointer items-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-strong has-checked:border-brand-500/60 has-checked:bg-brand-500/10 has-checked:text-strong has-focus-visible:outline-2 has-focus-visible:outline-brand-500";

/** The operations assessment: seven questions and how to reach the person. Nothing is kept until it is submitted. */
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
    <form action={action} className="grid gap-7 text-left">
      {EARLY_ACCESS.questions.map((question, index) => (
        <fieldset key={question.name}>
          <legend className={marketingFormLabel}>
            {index + 1}. {question.label}
          </legend>
          <div className={`mt-2 grid gap-2 ${question.options.some(([, label]) => label.length > 24) ? "" : "sm:grid-cols-2"}`}>
            {question.options.map(([value, label]) => (
              <label key={value} className={choice}>
                <input type="radio" name={question.name} value={value} required className="sr-only" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <fieldset className="grid gap-4">
        <legend className={marketingFormLabel}>{EARLY_ACCESS.contactTitle}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <Field id="early-name" label={EARLY_ACCESS.fields.name}>
            <input id="early-name" name="name" required maxLength={120} autoComplete="name" className={marketingFieldControl} />
          </Field>
          <Field id="early-company" label={EARLY_ACCESS.fields.company}>
            <input id="early-company" name="company" required maxLength={160} autoComplete="organization" className={marketingFieldControl} />
          </Field>
          <Field id="early-email" label={EARLY_ACCESS.fields.email}>
            <input id="early-email" name="email" type="email" required maxLength={200} autoComplete="email" className={marketingFieldControl} />
          </Field>
          <Field id="early-phone" label={EARLY_ACCESS.fields.phone} optional>
            <input id="early-phone" name="phone" type="tel" maxLength={40} autoComplete="tel" className={marketingFieldControl} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="early-page" label={EARLY_ACCESS.fields.website} optional>
              <input id="early-page" name="businessPage" inputMode="url" maxLength={200} autoComplete="url" className={marketingFieldControl} />
            </Field>
          </div>
        </div>
        {/* Separate from submitting, unticked, and never required. */}
        <label className="flex cursor-pointer items-start gap-3 text-sm text-muted-foreground">
          <input type="checkbox" name="smsConsent" value="yes" className="mt-0.5 size-4 shrink-0 accent-brand-500" />
          <span>{EARLY_ACCESS.smsConsent}</span>
        </label>
      </fieldset>

      {/* Hidden from people and from screen readers. */}
      <div className="hidden" aria-hidden>
        <label htmlFor="early-fax">Fax</label>
        <input id="early-fax" name={TRAP_FIELD} tabIndex={-1} autoComplete="off" />
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
