"use client";

import type { FunctionReturnType } from "convex/server";

import { MoneyInput } from "@/components/app/services/shared";
import { money } from "@/lib/app/format";

import type { api } from "../../../../convex/_generated/api";
import type { DraftBody } from "../../../../convex/lib/sales/draft";
import type { PaymentPolicy } from "../../../../convex/lib/sales/schema";
import { ChoiceCard, fieldClass, FormSection } from "./kit";
import type { Working } from "./use-draft";

type Summary = FunctionReturnType<typeof api.sales.price>;

const POLICIES: { id: PaymentPolicy; title: string; detail: string }[] = [
  { id: "deposit", title: "Deposit now", detail: "A secure link asks for a deposit; the rest is due after service." },
  { id: "full", title: "Pay in full now", detail: "A secure link asks for the first visit's full price." },
  { id: "invoice_terms", title: "Invoice on terms", detail: "Invoiced with the company's payment terms." },
  { id: "after_service", title: "Pay after service", detail: "Invoiced when the visit is complete." },
  { id: "external", title: "Paid outside Selestial", detail: "Cash, check or another method. Recorded when received, never assumed." },
];

export const AGREEMENT_TYPES: { id: string; label: string; segments: Working["segment"][] }[] = [
  { id: "one_time_residential", label: "One-time residential cleaning", segments: ["residential"] },
  { id: "recurring_residential", label: "Recurring residential cleaning", segments: ["residential"] },
  { id: "deep_cleaning", label: "Deep cleaning", segments: ["residential"] },
  { id: "move_in_out", label: "Move-in / move-out", segments: ["residential"] },
  { id: "commercial_msa", label: "Commercial master service agreement", segments: ["commercial"] },
  { id: "office_janitorial", label: "Office / janitorial cleaning", segments: ["office", "commercial"] },
  { id: "str_turnover", label: "Short-term rental turnover", segments: ["str"] },
];

export function PaymentSection({ n, working, setBody, summary, done }: { n: number; working: Working; setBody: (change: (body: DraftBody) => DraftBody) => void; summary: Summary | undefined; done: boolean }) {
  const payment = working.body.payment ?? {};
  const agreement = working.body.agreement ?? {};
  const recurring = working.bookingKind === "recurring";
  const booking = summary?.mode === "booking" ? summary : null;
  const firstCents = booking?.firstCents ?? null;
  const types = AGREEMENT_TYPES.filter((t) => t.segments.includes(working.segment));
  return (
    <FormSection n={n} id="payment" title="Payment & agreement" lead="How the customer pays, and what they sign. Links go out from Review." done={done}>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium text-strong">{recurring ? "First visit payment" : "Payment"}</legend>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {POLICIES.map((policy) => (
            <ChoiceCard key={policy.id} name="payment" value={policy.id} checked={payment.policy === policy.id} onChange={() => setBody((b) => ({ ...b, payment: { ...b.payment, policy: policy.id } }))} title={policy.title} detail={policy.detail} />
          ))}
        </div>
      </fieldset>
      {payment.policy === "deposit" ? (
        <div className="grid max-w-md gap-1">
          <MoneyInput label="Deposit" unit="due now" cents={payment.depositCents ?? null} onCents={(depositCents) => setBody((b) => ({ ...b, payment: { ...b.payment, depositCents: depositCents ?? undefined } }))} hint={firstCents !== null ? `First visit ${money(firstCents)}. The deposit must be less.` : undefined} />
          {payment.depositCents !== undefined && firstCents !== null && payment.depositCents >= firstCents ? <p className="text-sm text-destructive-foreground">A deposit must be less than the first visit. Choose "Pay in full now" instead.</p> : null}
        </div>
      ) : null}
      {payment.policy === "external" ? <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">Selestial won't mark anything paid because of this choice. When the money arrives, record it on the invoice in Finance.</p> : null}
      {recurring ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium text-strong">Billing for later visits</legend>
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
            <ChoiceCard name="billing" value="per_visit" checked={(working.body.recurring?.billing ?? "per_visit") === "per_visit"} onChange={() => setBody((b) => ({ ...b, recurring: { ...b.recurring, billing: "per_visit" } }))} title="Invoice each visit" detail="Each completed visit is invoiced at its own price." />
            <ChoiceCard name="billing" value="monthly_consolidated" checked={working.body.recurring?.billing === "monthly_consolidated"} onChange={() => setBody((b) => ({ ...b, recurring: { ...b.recurring, billing: "monthly_consolidated" } }))} title="One invoice a month" detail="Completed visits in a calendar month are invoiced together. Not a subscription." />
          </div>
          <p className="text-xs text-muted-foreground">How often the crew comes and how often you invoice are separate. Nothing is prepaid or charged automatically.</p>
        </fieldset>
      ) : null}
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium text-strong">Service agreement</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 accent-brand-500" checked={agreement.required === true} onChange={(e) => setBody((b) => ({ ...b, agreement: { ...b.agreement, required: e.target.checked, docType: b.agreement?.docType ?? types[recurring ? 1 : 0]?.id ?? types[0]?.id } }))} />
          <span>
            <span className="font-medium text-strong">The customer signs an agreement before service</span>
            <span className="block text-xs text-muted-foreground">Sent as a secure link. Saying the terms were discussed on the phone doesn't count as a signature.</span>
          </span>
        </label>
        {agreement.required ? (
          <label className="grid max-w-md gap-1.5 text-sm">
            <span className="font-medium text-strong">Agreement</span>
            <select className={fieldClass()} value={agreement.docType ?? ""} onChange={(e) => setBody((b) => ({ ...b, agreement: { ...b.agreement, docType: e.target.value } }))}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </fieldset>
    </FormSection>
  );
}
