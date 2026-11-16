"use client";

import { useActionState } from "react";

import { requestEarlyAccess } from "@/app/actions";
import { LogoMark } from "@/components/brand/logo";
import { ChevronDown } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TRAP_FIELD, type EarlyAccessState } from "@/lib/early-access";
import { EARLY_ACCESS } from "@/lib/marketing/content";
import { marketingField, marketingFieldControl, marketingFormLabel } from "@/lib/marketing/ui";
import { cn } from "@/lib/utils";

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

/** An answer. Chosen, it looks like a filled button: the same violets, top to bottom, with a white label. */
const choice =
  "flex min-h-11 cursor-pointer items-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-brand-500/50 hover:text-strong has-checked:border-[#3f1d9e]/40 has-checked:bg-gradient-to-b has-checked:from-[#8e6df6] has-checked:via-[#6838ef] has-checked:to-[#5126c7] has-checked:text-white has-checked:shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand-500";

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
      {EARLY_ACCESS.questions.map((question, index) => {
        const label = `${index + 1}. ${question.label}`;
        if ((EARLY_ACCESS.dropdowns as readonly string[]).includes(question.name)) {
          const id = `early-${question.name}`;
          return (
            <div key={question.name} className="grid min-w-0 gap-2">
              <label htmlFor={id} className={marketingFormLabel}>
                {label}
              </label>
              <div className={cn(marketingField, "relative")}>
                <select id={id} name={question.name} required defaultValue="" className={cn(marketingFieldControl, "appearance-none pr-10 invalid:text-muted-foreground")}>
                  <option value="" disabled>
                    {EARLY_ACCESS.choose}
                  </option>
                  {question.options.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              </div>
            </div>
          );
        }
        return (
          <fieldset key={question.name} className="min-w-0">
            <legend className={marketingFormLabel}>{label}</legend>
            <div className={`mt-2 grid grid-cols-1 gap-2 ${question.options.some(([, text]) => text.length > 24) ? "" : "sm:grid-cols-3"}`}>
              {question.options.map(([value, text]) => (
                <label key={value} className={choice}>
                  <input type="radio" name={question.name} value={value} required className="sr-only" />
                  {text}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}

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
          <Field id="early-phone" label={EARLY_ACCESS.fields.phone}>
            <input id="early-phone" name="phone" type="tel" required maxLength={40} autoComplete="tel" className={marketingFieldControl} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="early-page" label={EARLY_ACCESS.fields.website}>
              <input id="early-page" name="businessPage" inputMode="url" required maxLength={200} autoComplete="url" className={marketingFieldControl} />
            </Field>
          </div>
        </div>
        {/* Permission to text: its own box, unticked. It is the one thing here a person may leave out. */}
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
