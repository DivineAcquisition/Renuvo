"use client";

/**
 * A client's billing, from Finance's own records, for the Owner. Each amount says what it is: invoiced,
 * collected, processing, overdue, owed but not yet due, credited, and an estimate from booked visits that
 * is not an invoice. Changes (issuing, recording a payment, refunds, credits) are made in Finance, where
 * the exact effect is shown first.
 */
import { useQuery } from "convex/react";
import Link from "next/link";

import { useCompany } from "@/components/app/company";
import { ArrowUpRight, Lock } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import { Card, EmptyState, money } from "./bits";
import type { Profile } from "./profile";

type Billing = NonNullable<ReturnType<typeof useQuery<typeof api.clientBilling.summary>>>;

const STATE_TONE: Record<string, "success" | "warning" | "error" | "outline" | "info"> = { paid: "success", overpaid: "info", overdue: "error", processing: "info", partially_paid: "warning", requested: "outline", deposit_requested: "outline", deposit_paid: "info", draft: "outline", void: "outline" };

export function BillingTab({ profile }: { profile: Profile }) {
  const { companyId } = useCompany();
  const billing = useQuery(api.clientBilling.summary, { companyId, customerId: profile.id });
  if (billing === undefined) return <Skeleton className="h-80 rounded-2xl" />;
  return (
    <div className="grid min-w-0 gap-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3.5" aria-hidden /> Only the Owner sees this tab. Billing changes are made in Finance.
      </p>
      <Amounts billing={billing} />
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card
          title="Invoices"
          action={
            <Link href={`/app/finance?customer=${profile.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-300 underline-offset-4 hover:underline">
              Statement in Finance <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          }
        >
          {billing.invoices.length === 0 ? (
            <EmptyState title="No invoices yet">Invoices for {profile.name} are created in Finance from completed visits.</EmptyState>
          ) : (
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-1 py-2 font-medium">Invoice</th>
                    <th className="px-1 py-2 font-medium">State</th>
                    <th className="px-1 py-2 font-medium">Issued</th>
                    <th className="px-1 py-2 font-medium">Due</th>
                    <th className="px-1 py-2 text-right font-medium">Total</th>
                    <th className="px-1 py-2 text-right font-medium">Still owed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {billing.invoices.map((i) => (
                    <tr key={i.id}>
                      <td className="px-1 py-2">
                        <Link href={`/app/finance?invoice=${i.id}`} className="font-medium text-strong underline-offset-4 hover:underline">
                          {i.number ?? "Draft"}
                        </Link>
                      </td>
                      <td className="px-1 py-2">
                        <Badge variant={STATE_TONE[i.state] ?? "outline"} size="sm">
                          {i.stateWords}
                        </Badge>
                      </td>
                      <td className="px-1 py-2 text-muted-foreground">{i.issuedOn ?? "Not issued"}</td>
                      <td className="px-1 py-2 text-muted-foreground">{i.dueOn ?? "—"}</td>
                      <td className="px-1 py-2 text-right tabular-nums">{money(i.totalCents)}</td>
                      <td className="px-1 py-2 text-right tabular-nums">{i.balanceCents > 0 ? money(i.balanceCents) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {billing.drafts ? <p className="mt-3 text-xs text-muted-foreground">{billing.drafts} draft {billing.drafts === 1 ? "invoice is" : "invoices are"} not issued yet and not counted above.</p> : null}
        </Card>
        <div className="grid content-start gap-4">
          <Card title="Billing details">
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Invoices go to</dt>
                <dd className="text-strong">
                  {billing.billingContacts.length ? billing.billingContacts.map((c) => `${c.name}${c.email ? ` (${c.email})` : ""}`).join(", ") : (billing.billingEmail ?? "No billing email on file")}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Payment terms</dt>
                <dd className="text-strong">Due {billing.termsDays} days after issue (the company&apos;s terms)</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Paid by</dt>
                <dd className="text-strong">{billing.methods.length ? billing.methods.join(", ") : "No payments yet"}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">Card and bank details are never shown here. They stay with the payment provider.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Amounts({ billing }: { billing: Billing }) {
  const a = billing.amounts;
  const tiles: { label: string; cents: number; detail: string; tone?: "error" | "warning" | "muted" }[] = [
    { label: "Invoiced", cents: a.invoicedCents, detail: "Issued invoices, all time. Voided ones are not counted." },
    { label: "Collected", cents: a.collectedCents, detail: a.refundedCents ? `Payments received, less ${money(a.refundedCents)} refunded.` : "Payments received." },
    { label: "Overdue", cents: a.overdueCents, detail: "Owed on invoices past their due date.", tone: a.overdueCents ? "error" : undefined },
    { label: "Owed, not yet due", cents: a.dueCents, detail: "Owed on invoices still inside their terms." },
    { label: "Processing", cents: a.processingCents, detail: "Payments started that have not cleared yet.", tone: a.processingCents ? "warning" : undefined },
    { label: "Estimated, not invoiced", cents: a.estimatedCents, detail: `${a.estimatedVisits} booked ${a.estimatedVisits === 1 ? "visit" : "visits"} in the next ${billing.estimateDays} days, at their booked price.${a.unpricedVisits ? ` ${a.unpricedVisits} more have no price yet.` : ""} Not money owed.`, tone: "muted" },
  ];
  return (
    <section aria-label="Amounts" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tiles.map((t) => (
        <div key={t.label} className={cn("rounded-2xl border bg-card px-4 py-3", t.tone === "error" ? "border-destructive/30" : t.tone === "warning" ? "border-warning/30" : "border-border", t.tone === "muted" && "border-dashed")}>
          <p className="text-xs font-medium text-muted-foreground">{t.label}</p>
          <p className={cn("mt-1 text-xl font-semibold tabular-nums", t.tone === "error" ? "text-destructive-foreground" : "text-strong", t.tone === "muted" && "text-muted-foreground")}>{money(t.cents)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.detail}</p>
        </div>
      ))}
      {a.notInvoicedVisits ? (
        <p className="rounded-2xl border border-warning/30 bg-warning/[0.06] px-4 py-3 text-sm text-strong sm:col-span-2 xl:col-span-3">
          {a.notInvoicedVisits} completed {a.notInvoicedVisits === 1 ? "visit has" : "visits have"} no invoice yet{a.notInvoicedCents ? ` (${money(a.notInvoicedCents)} at booked prices)` : ""}. Create {a.notInvoicedVisits === 1 ? "it" : "them"} in Finance.
        </p>
      ) : null}
    </section>
  );
}
