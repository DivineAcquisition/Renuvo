"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MANUAL_METHODS, clientKey, moneyInput, parseMoney, todayKey, usd } from "@/lib/app/finance";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Checkbox } from "@/components/ui/selection";
import { MoneyField } from "@/components/ui/fields";

/**
 * The confirmations behind every money action. Each one shows, before anything runs, exactly what will
 * happen: the amount, the customer and the records it touches. The server checks the same facts again
 * when the person confirms, and refuses if anything changed in between.
 */

function Consequences({ lines, blocked }: { lines: string[] | undefined; blocked?: string | null }) {
  if (!lines) return <Skeleton className="h-20 rounded-xl" />;
  return (
    <div className="grid gap-2">
      {blocked ? <FormError message={blocked} /> : null}
      <ul className="grid gap-1.5 rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-sm text-strong">
        {lines.map((line) => (
          <li key={line} className="flex gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Footer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="mt-1 flex flex-wrap justify-end gap-2">
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      {children}
    </div>
  );
}

// ── Record a payment received outside Stripe ─────────────────────────────────────────────────────

export function RecordPaymentDialog({ invoiceId, number, owedCents, open, onClose }: { invoiceId: Id<"invoices">; number: string; owedCents: number; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Record a payment" description={`Money you received for ${number} outside Selestial: cash, a check, a transfer or another app.`}>
      <RecordPaymentForm invoiceId={invoiceId} owedCents={owedCents} onDone={onClose} />
    </Modal>
  );
}

function RecordPaymentForm({ invoiceId, owedCents, onDone }: { invoiceId: Id<"invoices">; owedCents: number; onDone: () => void }) {
  const { companyId, timezone } = useCompany();
  const record = useMutation(api.finance.recordPayment);
  const { busy, error, run } = useRun();
  const [amount, setAmount] = useState(moneyInput(owedCents));
  const [method, setMethod] = useState<(typeof MANUAL_METHODS)[number]["id"]>("check");
  const [receivedOn, setReceivedOn] = useState(todayKey(timezone));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [key] = useState(clientKey);
  const cents = parseMoney(amount);
  const amountError = amount && cents === null ? "Enter an amount like 120.00" : cents !== null && cents > owedCents ? `That's more than the ${usd(owedCents)} owed.` : null;
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (cents === null || amountError) return;
        void run(async () => {
          await record({ companyId, invoiceId, amountCents: cents, method, receivedOn, reference: reference || null, note: note || null, confirmedReceived: confirmed, clientKey: key });
          onDone();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount received" error={amountError} hint={`${usd(owedCents)} is still owed`}>
          <MoneyField value={amount} onChange={(text) => setAmount(text)} autoFocus />
        </Field>
        <Field label="How you were paid">
          <SelectInput value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {MANUAL_METHODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Date received">
          <TextInput type="date" value={receivedOn} max={todayKey(timezone)} onChange={(e) => setReceivedOn(e.target.value)} />
        </Field>
        <Field label="Reference" hint="Check number or confirmation, optional">
          <TextInput value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
      <Field label="Note" hint="Only you see this">
        <TextArea value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <label className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-sm text-strong">
        <Checkbox checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked)} className="mt-0.5" />
        <span>I received this money. It isn&apos;t a promise to pay or a check I haven&apos;t been given yet.</span>
      </label>
      <FormError message={error} />
      <Footer onClose={onDone}>
        <Button type="submit" variant="default" disabled={busy || !confirmed || cents === null || cents <= 0 || Boolean(amountError)}>
          Record {cents ? usd(cents) : "payment"}
        </Button>
      </Footer>
    </form>
  );
}

// ── Credit ───────────────────────────────────────────────────────────────────────────────────────

export function CreditDialog({ invoiceId, open, onClose }: { invoiceId: Id<"invoices">; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Add a credit" description="Lower what the customer owes on this invoice. No money moves.">
      <CreditForm invoiceId={invoiceId} onDone={onClose} />
    </Modal>
  );
}

function CreditForm({ invoiceId, onDone }: { invoiceId: Id<"invoices">; onDone: () => void }) {
  const { companyId } = useCompany();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const cents = parseMoney(amount) ?? 0;
  const preview = useQuery(api.finance.creditPreview, cents > 0 ? { companyId, invoiceId, amountCents: cents } : "skip");
  const add = useMutation(api.finance.addCredit);
  const { busy, error, run } = useRun();
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!preview || preview.blocked) return;
        void run(async () => {
          await add({ companyId, invoiceId, amountCents: cents, reason, bindsTo: preview.bindsTo });
          onDone();
        });
      }}
    >
      <Field label="Amount to credit">
        <MoneyField value={amount} onChange={(text) => setAmount(text)} placeholder="25.00" autoFocus />
      </Field>
      <Field label="Reason" hint="Shown on the customer's statement">
        <TextInput value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Arrived late, 20 minutes" />
      </Field>
      {cents > 0 ? <Consequences lines={preview?.lines} blocked={preview?.blocked} /> : null}
      <FormError message={error} />
      <Footer onClose={onDone}>
        <Button type="submit" variant="default" disabled={busy || !preview || Boolean(preview.blocked) || !reason.trim()}>
          Credit {cents ? usd(cents) : ""}
        </Button>
      </Footer>
    </form>
  );
}

// ── Refund ───────────────────────────────────────────────────────────────────────────────────────

export function RefundDialog({ paymentId, refundableCents, open, onClose }: { paymentId: Id<"payments">; refundableCents: number; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Refund a payment" description="Review exactly what happens before you confirm. A refund can't be undone.">
      <RefundForm paymentId={paymentId} refundableCents={refundableCents} onDone={onClose} />
    </Modal>
  );
}

function RefundForm({ paymentId, refundableCents, onDone }: { paymentId: Id<"payments">; refundableCents: number; onDone: () => void }) {
  const { companyId } = useCompany();
  const [amount, setAmount] = useState(moneyInput(refundableCents));
  const [alsoCredit, setAlsoCredit] = useState(true);
  const [reason, setReason] = useState("");
  const [returned, setReturned] = useState(false);
  const [key] = useState(clientKey);
  const cents = parseMoney(amount) ?? 0;
  const preview = useQuery(api.finance.refundPreview, cents > 0 ? { companyId, paymentId, amountCents: cents, alsoCredit } : "skip");
  const refund = useMutation(api.finance.requestRefund);
  const { busy, error, run } = useRun();
  const manual = preview?.source === "manual";
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!preview || preview.blocked) return;
        void run(async () => {
          await refund({ companyId, paymentId, amountCents: cents, reason, alsoCredit, bindsTo: preview.bindsTo, clientKey: key, confirmedReturned: manual ? returned : undefined });
          onDone();
        });
      }}
    >
      <Field label="Amount to refund" hint={`Up to ${usd(refundableCents)} from this payment`}>
        <MoneyField value={amount} onChange={(text) => setAmount(text)} autoFocus />
      </Field>
      <Field label="Reason" hint="Kept with the refund and shown on the customer's statement">
        <TextInput value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Oven wasn't cleaned" />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium text-strong">What the customer owes afterwards</legend>
        <label className="flex items-start gap-2.5 text-sm text-strong">
          <input type="radio" name="credit" checked={alsoCredit} onChange={() => setAlsoCredit(true)} className="mt-0.5 size-4 accent-brand-500" />
          <span>
            They no longer owe it <span className="block text-xs text-muted-foreground">For a problem with the service. The invoice is credited the same amount.</span>
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-sm text-strong">
          <input type="radio" name="credit" checked={!alsoCredit} onChange={() => setAlsoCredit(false)} className="mt-0.5 size-4 accent-brand-500" />
          <span>
            They still owe it <span className="block text-xs text-muted-foreground">For example, they paid twice, or will pay another way.</span>
          </span>
        </label>
      </fieldset>
      {cents > 0 ? <Consequences lines={preview?.lines} blocked={preview?.blocked} /> : null}
      {manual ? (
        <label className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-sm text-strong">
          <Checkbox checked={returned} onCheckedChange={(checked) => setReturned(checked)} className="mt-0.5" />
          <span>I returned this money to the customer myself.</span>
        </label>
      ) : null}
      <FormError message={error} />
      <Footer onClose={onDone}>
        <Button type="submit" variant="destructive" disabled={busy || !preview || Boolean(preview.blocked) || !reason.trim() || (manual && !returned)}>
          {manual ? "Record refund" : `Refund ${cents ? usd(cents) : ""}`}
        </Button>
      </Footer>
    </form>
  );
}

// ── Void an invoice, void a recorded payment ─────────────────────────────────────────────────────

export function VoidInvoiceDialog({ invoiceId, draft, open, onClose }: { invoiceId: Id<"invoices">; draft: boolean; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={draft ? "Discard this draft" : "Void this invoice"} description={draft ? "The customer never saw it. It stays in the history." : "Use this when the customer no longer owes it at all."}>
      <VoidInvoiceForm invoiceId={invoiceId} draft={draft} onDone={onClose} />
    </Modal>
  );
}

function VoidInvoiceForm({ invoiceId, draft, onDone }: { invoiceId: Id<"invoices">; draft: boolean; onDone: () => void }) {
  const { companyId } = useCompany();
  const preview = useQuery(api.finance.voidPreview, { companyId, invoiceId });
  const voidIt = useMutation(api.finance.voidInvoice);
  const [reason, setReason] = useState(draft ? "Not needed" : "");
  const { busy, error, run } = useRun();
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!preview || preview.blocked) return;
        void run(async () => {
          await voidIt({ companyId, invoiceId, reason, bindsTo: preview.bindsTo });
          onDone();
        });
      }}
    >
      <Consequences lines={preview?.lines} blocked={preview?.blocked} />
      <Field label="Reason">
        <TextInput value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Visit cancelled by the customer" autoFocus />
      </Field>
      <FormError message={error} />
      <Footer onClose={onDone}>
        <Button type="submit" variant="destructive" disabled={busy || !preview || Boolean(preview.blocked) || !reason.trim()}>
          {draft ? "Discard draft" : "Void invoice"}
        </Button>
      </Footer>
    </form>
  );
}

export function VoidPaymentDialog({ paymentId, open, onClose }: { paymentId: Id<"payments">; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Void a recorded payment" description="For a payment entered by mistake. To give money back, refund it instead.">
      <VoidPaymentForm paymentId={paymentId} onDone={onClose} />
    </Modal>
  );
}

function VoidPaymentForm({ paymentId, onDone }: { paymentId: Id<"payments">; onDone: () => void }) {
  const { companyId } = useCompany();
  const preview = useQuery(api.finance.voidPaymentPreview, { companyId, paymentId });
  const voidIt = useMutation(api.finance.voidPayment);
  const [reason, setReason] = useState("");
  const { busy, error, run } = useRun();
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!preview || preview.blocked) return;
        void run(async () => {
          await voidIt({ companyId, paymentId, reason, bindsTo: preview.bindsTo });
          onDone();
        });
      }}
    >
      <Consequences lines={preview?.lines} blocked={preview?.blocked} />
      <Field label="Reason">
        <TextInput value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Recorded on the wrong invoice" autoFocus />
      </Field>
      <FormError message={error} />
      <Footer onClose={onDone}>
        <Button type="submit" variant="destructive" disabled={busy || !preview || Boolean(preview.blocked) || !reason.trim()}>
          Void payment
        </Button>
      </Footer>
    </form>
  );
}

// ── Issue a draft, request the balance ───────────────────────────────────────────────────────────

export function IssueDialog({ invoiceId, revision, totalCents, depositCents, customer, termsDueDate, open, onClose, onIssued }: { invoiceId: Id<"invoices">; revision: number; totalCents: number; depositCents: number | null; customer: string; termsDueDate: string; open: boolean; onClose: () => void; onIssued: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Issue this invoice" description="It gets a number and a pay link, and its lines can no longer change.">
      <IssueForm invoiceId={invoiceId} revision={revision} totalCents={totalCents} depositCents={depositCents} customer={customer} termsDueDate={termsDueDate} onDone={onClose} onIssued={onIssued} />
    </Modal>
  );
}

function IssueForm({ invoiceId, revision, totalCents, depositCents, customer, termsDueDate, onDone, onIssued }: { invoiceId: Id<"invoices">; revision: number; totalCents: number; depositCents: number | null; customer: string; termsDueDate: string; onDone: () => void; onIssued: () => void }) {
  const { companyId, timezone } = useCompany();
  const issue = useMutation(api.finance.issueInvoice);
  const [due, setDue] = useState(termsDueDate);
  const { busy, error, run } = useRun();
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await issue({ companyId, invoiceId, revision, dueDate: due || null });
          onIssued();
          onDone();
        });
      }}
    >
      <Field label={depositCents ? "Deposit due" : "Due date"}>
        <TextInput type="date" value={due} min={todayKey(timezone)} onChange={(e) => setDue(e.target.value)} />
      </Field>
      <Consequences
        lines={[
          depositCents ? `${customer} is asked for a ${usd(depositCents)} deposit now, of ${usd(totalCents)} in total. You request the rest after the visit.` : `${customer} is asked for ${usd(totalCents)}.`,
          "Nothing is sent yet. Next, send it by email or text from the invoice (you approve the exact message), or copy the pay link.",
          "To change it after this, add a credit or void it.",
        ]}
      />
      <FormError message={error} />
      <Footer onClose={onDone}>
        <Button type="submit" variant="default" disabled={busy}>
          Issue invoice
        </Button>
      </Footer>
    </form>
  );
}

export function RequestBalanceDialog({ invoiceId, balanceCents, customer, termsDueDate, open, onClose }: { invoiceId: Id<"invoices">; balanceCents: number; customer: string; termsDueDate: string; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Request the balance" description="After the visit: the pay link asks for the rest instead of the deposit.">
      <RequestBalanceForm invoiceId={invoiceId} balanceCents={balanceCents} customer={customer} termsDueDate={termsDueDate} onDone={onClose} />
    </Modal>
  );
}

function RequestBalanceForm({ invoiceId, balanceCents, customer, termsDueDate, onDone }: { invoiceId: Id<"invoices">; balanceCents: number; customer: string; termsDueDate: string; onDone: () => void }) {
  const { companyId, timezone } = useCompany();
  const request = useMutation(api.finance.requestBalance);
  const [due, setDue] = useState(termsDueDate);
  const { busy, error, run } = useRun();
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await request({ companyId, invoiceId, dueDate: due || null });
          onDone();
        });
      }}
    >
      <Field label="Balance due">
        <TextInput type="date" value={due} min={todayKey(timezone)} onChange={(e) => setDue(e.target.value)} />
      </Field>
      <Consequences lines={[`${customer}'s pay link will ask for the remaining ${usd(balanceCents)}.`, "Nothing is sent by this. Selestial prepares a message for you to approve when it's due, or send one from the invoice now."]} />
      <FormError message={error} />
      <Footer onClose={onDone}>
        <Button type="submit" variant="default" disabled={busy}>
          Request {usd(balanceCents)}
        </Button>
      </Footer>
    </form>
  );
}
