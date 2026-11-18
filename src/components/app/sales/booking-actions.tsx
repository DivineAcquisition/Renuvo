"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, messageOf } from "@/components/app/form";
import { MoneyInput } from "@/components/app/services/shared";
import { FileText } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/app/format";

import { api } from "../../../../convex/_generated/api";
import type { DraftBody } from "../../../../convex/lib/sales/draft";
import { fieldClass, FormSection } from "./kit";
import { NeedsList } from "./summary";
import type { DraftData, Working } from "./use-draft";

type Summary = FunctionReturnType<typeof api.sales.price>;

/** One explicit action, with what it creates and what stays pending, in words. */
export function ActionCard({ title, creates, pending, children }: { title: string; creates: string; pending?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <p className="text-sm font-medium text-strong">{title}</p>
      <p className="text-xs text-muted-foreground">{creates}</p>
      {pending ? <p className="text-xs text-muted-foreground">Still pending after: {pending}</p> : null}
      <div className="mt-auto pt-1">{children}</div>
    </div>
  );
}

export function BookingActions({ n, data, working, setBody, summary, flush, revision, saving, children }: { n: number; data: DraftData; working: Working; setBody: (change: (body: DraftBody) => DraftBody) => void; summary: Summary | undefined; flush: () => Promise<void>; revision: () => number; saving: boolean; children?: React.ReactNode }) {
  const { companyId } = useCompany();
  const saveQuote = useMutation(api.sales.saveQuoteFromDraft);
  const request = useMutation(api.bookings.request);
  const confirmNow = useMutation(api.bookings.confirmNow);
  const sendAgreement = useMutation(api.bookings.sendAgreement);
  const resend = useMutation(api.bookings.resend);
  const cancel = useMutation(api.bookings.cancel);
  const existing = useQuery(api.bookings.forDraft, { companyId, draftId: data.draft._id });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const booking = summary?.mode === "booking" ? summary : null;
  const override = working.body.override;
  const priced = booking && booking.firstCents !== null && (booking.visit?.outcome === "firm" || booking.visit?.outcome === "estimate");
  const blocking = booking ? booking.needs.filter((n) => n.blocking && n.key !== "capacity") : [];
  const canRequest = Boolean(priced && blocking.length === 0 && (booking?.capacity?.state !== "full" || working.body.schedule?.proposed));
  const manager = data.role === "owner" || data.role === "manager";
  const linkPolicy = working.body.payment?.policy === "deposit" || working.body.payment?.policy === "full";

  const run = (work: () => Promise<string>) => {
    setError(null);
    setDone(null);
    setBusy(true);
    void flush()
      .then(work)
      .then(setDone)
      .catch((caught: unknown) => setError(messageOf(caught)))
      .finally(() => setBusy(false));
  };

  return (
    <FormSection n={n} id="review" title="Review" lead="Check exactly what the customer gets, then choose what to do.">
      <details className="rounded-xl border border-border px-3 py-2" open={override?.priceCents !== undefined}>
        <summary className="cursor-pointer text-sm font-medium text-strong">Change the price</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <MoneyInput label={working.bookingKind === "recurring" ? "First visit price" : "Price"} unit="instead of the calculated price" cents={override?.priceCents ?? null} onCents={(priceCents) => setBody((b) => ({ ...b, override: priceCents === null ? undefined : { ...b.override, priceCents } }))} hint={booking?.override?.referenceCents ? `Calculated: ${money(booking.override.referenceCents)}` : undefined} />
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-strong">Reason</span>
            <input className={fieldClass()} value={override?.reason ?? ""} disabled={override?.priceCents === undefined} onChange={(e) => setBody((b) => ({ ...b, override: { ...b.override, reason: e.target.value } }))} placeholder="For example: price matched for a returning customer" />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{data.role === "owner" ? "As the Owner, your change applies when you book." : "The Owner approves a changed price before anything is sent. Telling them afterward doesn't count as approval."}</p>
      </details>
      {booking ? <NeedsList needs={booking.needs} /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <ActionCard title="Save a quote" creates="Saves this price with its exact answers and the published service version, held for 14 days. Nothing is booked and no time is held." pending="Booking, time, payment and agreement.">
          <Button
            variant="outline"
            disabled={busy || saving || !priced || Boolean(override)}
            onClick={() =>
              run(async () => {
                const result = await saveQuote({ companyId, draftId: data.draft._id, revision: revision() });
                return `Quote saved. It's held until ${new Date(result.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`;
              })
            }
          >
            <FileText aria-hidden className="size-4" /> Save quote
          </Button>
        </ActionCard>
        {!existing || existing.status === "cancelled" ? (
          <>
            <ActionCard
              title="Send booking request"
              creates={`Creates the booking${working.body.schedule?.proposed ? " with a proposed time (nothing held)" : " and holds crew for the time"}${linkPolicy ? (manager ? ", issues the invoice and sends the customer the secure payment link" : ", and asks an Owner or Manager to send the payment link") : ""}${working.body.agreement?.required ? ", and starts the agreement for review" : ""}.`}
              pending="Confirmation, once payment, signature and an approved price (if changed) are in."
            >
              <Button
                disabled={busy || saving || !canRequest}
                onClick={() =>
                  run(async () => {
                    await request({ companyId, draftId: data.draft._id, revision: revision(), sendLinks: true });
                    return "Booking requested. Its status is below.";
                  })
                }
              >
                Send booking request
              </Button>
            </ActionCard>
            <ActionCard title="Book and confirm now" creates="Creates the booking and confirms it straight away when nothing is outstanding (for example pay after service, no agreement). The visit goes to Dispatch to staff." pending="Staffing, which Dispatch handles.">
              <Button
                variant="outline"
                disabled={busy || saving || !canRequest || linkPolicy || working.body.agreement?.required === true || Boolean(override) || working.body.schedule?.proposed === true}
                onClick={() =>
                  run(async () => {
                    const { bookingId } = await request({ companyId, draftId: data.draft._id, revision: revision(), sendLinks: false });
                    await confirmNow({ companyId, bookingId });
                    return "Booked and confirmed. Dispatch is staffing the visit.";
                  })
                }
              >
                Confirm booking
              </Button>
            </ActionCard>
          </>
        ) : null}
        {children}
      </div>
      {existing && existing.status !== "cancelled" ? (
        <div className="grid gap-3 rounded-xl border border-brand-500/30 bg-brand-500/4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-strong">Booking {existing.status === "confirmed" ? "confirmed" : "requested"}</p>
            {existing.status === "confirmed" ? (
              <span className="text-xs text-success-foreground">{existing.handoff.state === "done" ? "Handed to Dispatch" : existing.handoff.state === "failed" ? `Handoff will be retried: ${existing.handoff.problem ?? ""}` : "Handing to Dispatch…"}</span>
            ) : null}
          </div>
          <ul className="grid gap-1.5 text-sm">
            <li className="flex justify-between gap-2">
              <span className="text-muted-foreground">Schedule</span>
              <span className="text-strong">{existing.schedule.words}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-muted-foreground">Payment</span>
              <span className="text-strong">
                {existing.payment.words}
                {existing.payment.number ? ` · invoice ${existing.payment.number}` : ""}
                {existing.payment.paidCents ? ` · ${money(existing.payment.paidCents)} paid` : ""}
              </span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-muted-foreground">Agreement</span>
              <span className="text-strong">{existing.agreement.words}</span>
            </li>
            {existing.override ? (
              <li className="flex justify-between gap-2">
                <span className="text-muted-foreground">Changed price</span>
                <span className="text-strong">{existing.override.state === "approved" ? "Approved" : existing.override.state === "waiting" ? "Waiting for the Owner" : "Declined"}</span>
              </li>
            ) : null}
          </ul>
          {existing.problem ? <p className="text-sm text-destructive-foreground">{existing.problem}</p> : null}
          {existing.status !== "confirmed" && existing.blockers.length ? (
            <p className="text-xs text-muted-foreground">Confirms when: {existing.blockers.join(" ")}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {existing.status !== "confirmed" ? (
              <Button size="sm" disabled={busy || existing.blockers.length > 0} onClick={() => run(async () => (await confirmNow({ companyId, bookingId: existing._id }), "Confirmed. Dispatch is staffing the visit."))}>
                Confirm booking
              </Button>
            ) : null}
            {existing.agreement.id && existing.agreement.state === "to_send" ? (
              existing.agreement.workflow === "approved" ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => (await sendAgreement({ companyId, bookingId: existing._id }), "Agreement sent for signature."))}>
                  Send agreement to sign
                </Button>
              ) : (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/app/agreements/${existing.agreement.id}`}>Review the agreement</Link>
                </Button>
              )
            ) : null}
            {existing.status !== "confirmed" && (existing.payment.state === "awaiting" || (existing.payment.state === "link_needed" && manager)) ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => (await resend({ companyId, bookingId: existing._id }), "The payment link was sent."))}>
                {existing.payment.state === "link_needed" ? "Send payment link" : "Send reminder"}
              </Button>
            ) : null}
            {existing.planId ? (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/app/agents/sales/plans/${existing.planId}`}>Open recurring plan</Link>
              </Button>
            ) : null}
            {existing.jobId ? (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/app/agents/dispatch/schedule?open=job:${existing.jobId}`}>Open in Dispatch</Link>
              </Button>
            ) : null}
            {existing.status !== "confirmed" ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt("Why is this booking cancelled?");
                  if (!reason) return;
                  run(async () => {
                    const result = await cancel({ companyId, bookingId: existing._id, reason });
                    return result && result.invoiceStillOpen ? `Cancelled. The invoice is still open${result.paidCents ? ` with ${money(result.paidCents)} paid` : ""}: void or refund it in Finance.` : "Cancelled.";
                  });
                }}
              >
                Cancel booking
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {done ? (
        <p role="status" className="rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-sm text-success-foreground">
          {done}
        </p>
      ) : null}
      <FormError message={error} />
    </FormSection>
  );
}
