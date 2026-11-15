"use client";

import { useActionState } from "react";

import { requestEarlyAccess } from "@/app/actions";
import { LogoMark } from "@/components/brand/logo";
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

/** An answer. Chosen, it takes the icon tile's colours: Selestial Violet to Deep Violet, corner to corner, white on top. */
const choice =
  "flex min-h-11 cursor-pointer items-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-brand-500/50 hover:text-strong has-checked:border-[#5126c7]/40 has-checked:bg-gradient-to-br has-checked:from-[#6838ef] has-checked:to-[#5126c7] has-checked:text-white has-checked:shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand-500";

/** The operations assessment: seven questions and how to reach the person. Nothing is kept until it is submitted. */
export function EarlyAccessForm() {
  const [state, action, pending] = useActionState(requestEarlyAccess, INITIAL);

  if (state.status === "done") {
    return (
      <div className="live-enter flex items-start gap-4 rounded-xl border border-brand-500/30 bg-brand-50 p-5" role="status">
        <LogoMark className="size-10 shrink-0" />
        <div>
          <p className="font-medium text-strong">{EARLY_ACCESS.done.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{EARLY_ACCESS.done.body}</p>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="grid grid-cols-1 gap-7 text-left">
      {EARLY_ACCESS.questions.map((question, index) => (
        <fieldset key={question.name} className="min-w-0">
          <legend className={marketingFormLabel}>
            {index + 1}. {question.label}
          </legend>
          <div className={`mt-2 grid grid-cols-1 gap-2 ${question.options.some(([, label]) => label.length > 24) ? "" : "sm:grid-cols-2"}`}>
            {question.options.map(([value, label]) => (
              <label key={value} className={choice}>
                <input type="radio" name={question.name} value={value} required className="sr-only" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <fieldset className="grid min-w-0 gap-4">
        <legend className={marketingFormLabel}>{EARLY_ACCESS.contactTitle}</legend>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
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
