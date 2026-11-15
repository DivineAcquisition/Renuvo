"use client";

import { useActionState } from "react";

import { joinWaitlist, type WaitlistState } from "@/app/actions";
import { CheckCircle2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { WAITLIST } from "@/lib/marketing/content";
import { marketingField, marketingFieldControl, marketingFieldSelect, marketingFormLabel } from "@/lib/marketing/ui";
import { cn } from "@/lib/utils";

const INITIAL: WaitlistState = { status: "idle" };

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

export function WaitlistForm() {
  const [state, action, pending] = useActionState(joinWaitlist, INITIAL);

  if (state.status === "done") {
    return (
      <div className="live-enter flex items-start gap-3 rounded-xl border border-success/40 bg-success/10 p-5" role="status">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <div>
          <p className="font-medium text-strong">{WAITLIST.done.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{WAITLIST.done.body}</p>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4 text-left">
      <h3 className="font-heading text-lg tracking-tight text-strong">{WAITLIST.title}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="waitlist-name" label={WAITLIST.fields.name}>
          <input id="waitlist-name" name="name" required maxLength={120} autoComplete="name" className={marketingFieldControl} />
        </Field>
        <Field id="waitlist-company" label={WAITLIST.fields.company}>
          <input id="waitlist-company" name="company" required maxLength={160} autoComplete="organization" className={marketingFieldControl} />
        </Field>
        <Field id="waitlist-email" label={WAITLIST.fields.email}>
          <input id="waitlist-email" name="email" type="email" required maxLength={200} autoComplete="email" className={marketingFieldControl} />
        </Field>
        <Field id="waitlist-size" label={WAITLIST.fields.size}>
          <select id="waitlist-size" name="size" required defaultValue="" className={marketingFieldSelect}>
            <option value="" disabled>
              Choose one
            </option>
            {WAITLIST.sizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {/* Hidden from people and from screen readers. */}
      <div className="hidden" aria-hidden>
        <label htmlFor="waitlist-website">Website</label>
        <input id="waitlist-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {state.status === "error" ? (
        <p role="alert" className="text-sm text-flag-critical">
          {state.message}
        </p>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" variant="outline" size="xl" disabled={pending} className={cn("h-12! rounded-[8px]! border-border bg-card before:rounded-[7px]! hover:bg-muted")}>
          {pending ? WAITLIST.sending : WAITLIST.submit}
        </Button>
        <p className="text-xs text-muted-foreground">{WAITLIST.consent}</p>
      </div>
    </form>
  );
}
