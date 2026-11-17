"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo, useState } from "react";

import { useOfferChatContext } from "@/components/app/chat/chat-context";
import { useCompany } from "@/components/app/company";
import { FormError, useRun } from "@/components/app/form";
import { Check, Copy, ExternalLink, FileText, HistoryIcon, MapPin, Minus, Plus, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { calendarDate, moment, moneyInput, parseMoney, usd, type InvoiceStateId } from "@/lib/app/finance";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { InvoiceMessages } from "./messages";
import { CreditDialog, IssueDialog, RecordPaymentDialog, RefundDialog, RequestBalanceDialog, VoidInvoiceDialog, VoidPaymentDialog } from "./actions";
import { Chip, Notice, StateBadge, eyebrow } from "./kit";

type Detail = FunctionReturnType<typeof api.finance.invoice>;

/** One invoice, in a drawer over the list, so the list keeps its place. */
export function InvoiceSheet({ invoiceId, onClose, onOpenStatement }: { invoiceId: Id<"invoices"> | null; onClose: () => void; onOpenStatement: (id: Id<"customers">) => void }) {
  return (
    <Sheet open={invoiceId !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetPopup side="right" className="max-w-2xl bg-card">
        <SheetTitle className="sr-only">Invoice</SheetTitle>
        <ScrollArea className="min-h-0 flex-1">{invoiceId ? <Body key={invoiceId} invoiceId={invoiceId} onOpenStatement={onOpenStatement} /> : null}</ScrollArea>
      </SheetPopup>
    </Sheet>
  );
}

function Body({ invoiceId, onOpenStatement }: { invoiceId: Id<"invoices">; onOpenStatement: (id: Id<"customers">) => void }) {
  const { companyId } = useCompany();
  const detail = useQuery(api.finance.invoice, { companyId, invoiceId });
  // The chat panel may use this customer as context: the same record, not a copy.
  useOfferChatContext(detail ? [{ table: "invoices", id: detail.id }, { table: "customers", id: detail.customer.id }] : null);
  if (detail === undefined) {
    return (
      <div className="grid gap-3 p-6">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 px-5 pt-6 pb-10 sm:px-7">
      <Header detail={detail} onOpenStatement={onOpenStatement} />
      {detail.status === "draft" ? <DraftEditor detail={detail} /> : <Issued detail={detail} />}
      <Timeline detail={detail} />
    </div>
  );
}

function Header({ detail, onOpenStatement }: { detail: Detail; onOpenStatement: (id: Id<"customers">) => void }) {
  return (
    <header className="grid gap-3 pr-10">
      <div className="flex flex-wrap items-center gap-2">
        <span className={eyebrow}>{detail.number ? `Invoice ${detail.number}` : "Draft invoice"}</span>
        <StateBadge state={detail.state as InvoiceStateId} words={detail.stateWords} />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-heading text-2xl tracking-tight text-strong">{detail.customer.name}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {detail.job ? <span>{detail.job.label}</span> : null}
            {detail.property ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {detail.property.address}
              </span>
            ) : null}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => onOpenStatement(detail.customer.id)}>
          <FileText aria-hidden />
          Customer statement
        </Button>
      </div>
    </header>
  );
}

// ── An issued invoice ────────────────────────────────────────────────────────────────────────────

function Issued({ detail }: { detail: Detail }) {
  const { timezone } = useCompany();
  const [dialog, setDialog] = useState<null | "record" | "credit" | "void" | "balance" | { refund: Id<"payments">; cents: number } | { voidPayment: Id<"payments"> }>(null);
  const close = () => setDialog(null);
  const t = detail.totals;
  const open = detail.status === "open";
  const owed = Math.max(0, t.balanceCents - t.processingCents);
  return (
    <>
      <Summary detail={detail} />
      {detail.voided ? (
        <Notice tone="info" title={`Voided ${moment(detail.voided.at, timezone)}`}>
          {detail.voided.reason}
        </Notice>
      ) : null}
      {open ? <PayLink detail={detail} /> : null}
      {detail.status !== "draft" ? <InvoiceMessages invoiceId={detail.id} /> : null}
      {open ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="default" onClick={() => setDialog("record")} disabled={owed <= 0}>
            <Plus aria-hidden />
            Record payment
          </Button>
          {detail.state === "deposit_paid" ? (
            <Button variant="outline" onClick={() => setDialog("balance")}>
              Request balance
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setDialog("credit")} disabled={owed <= 0}>
            <Minus aria-hidden />
            Add credit
          </Button>
          <Button variant="ghost" className="sm:ml-auto" onClick={() => setDialog("void")}>
            Void
          </Button>
        </div>
      ) : null}
      <Lines detail={detail} />
      <Payments detail={detail} onRefund={(id, cents) => setDialog({ refund: id, cents })} onVoid={(id) => setDialog({ voidPayment: id })} />
      <RecordPaymentDialog invoiceId={detail.id} number={detail.number ?? "this invoice"} owedCents={owed} open={dialog === "record"} onClose={close} />
      <CreditDialog invoiceId={detail.id} open={dialog === "credit"} onClose={close} />
      <VoidInvoiceDialog invoiceId={detail.id} draft={false} open={dialog === "void"} onClose={close} />
      <RequestBalanceDialog invoiceId={detail.id} balanceCents={t.balanceCents} customer={detail.customer.name} termsDueDate={detail.termsDueDate} open={dialog === "balance"} onClose={close} />
      {dialog && typeof dialog === "object" && "refund" in dialog ? <RefundDialog paymentId={dialog.refund} refundableCents={dialog.cents} open onClose={close} /> : null}
      {dialog && typeof dialog === "object" && "voidPayment" in dialog ? <VoidPaymentDialog paymentId={dialog.voidPayment} open onClose={close} /> : null}
    </>
  );
}

/** Where the money stands, as one bar: paid, on its way, credited, still owed. */
function Summary({ detail }: { detail: Detail }) {
  const { timezone } = useCompany();
  const t = detail.totals;
  const net = Math.max(0, t.paidCents - t.refundedCents);
  const base = Math.max(1, t.totalCents);
  const parts = [
    { key: "paid", cents: net, label: "Paid", className: "bg-success" },
    { key: "processing", cents: t.processingCents, label: "Processing", className: "bg-[repeating-linear-gradient(135deg,var(--color-brand-500)_0_4px,color-mix(in_oklab,var(--color-brand-500)_45%,transparent)_4px_8px)]" },
    { key: "credited", cents: t.creditedCents, label: "Credited", className: "bg-muted-foreground/35" },
  ].filter((p) => p.cents > 0);
  const headline = detail.status === "void" ? { label: "Voided", cents: t.totalCents } : t.balanceCents < 0 ? { label: "Overpaid by", cents: -t.balanceCents } : detail.requestedCents > 0 ? { label: detail.inDepositStage ? "Deposit requested" : "Requested now", cents: detail.requestedCents } : { label: "Balance", cents: Math.max(0, t.balanceCents) };
  return (
    <section aria-label="Amounts" className="rounded-2xl border border-border bg-muted/30 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={eyebrow}>{headline.label}</p>
          <p className="mt-1 font-heading text-4xl leading-none tracking-tight text-strong tabular-nums">{usd(headline.cents)}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Total</dt>
          <dd className="text-right tabular-nums text-strong">{usd(t.totalCents)}</dd>
          {detail.state === "deposit_paid" ? (
            <>
              <dt className="text-muted-foreground">Balance due</dt>
              <dd className="text-right text-strong">Not requested yet</dd>
            </>
          ) : detail.dueAt && detail.status === "open" ? (
            <>
              <dt className="text-muted-foreground">{detail.inDepositStage ? "Deposit due" : "Due"}</dt>
              <dd className={cn("text-right tabular-nums", detail.state === "overdue" ? "font-medium text-destructive-foreground" : "text-strong")}>{moment(detail.dueAt, timezone)}</dd>
            </>
          ) : detail.paidAt ? (
            <>
              <dt className="text-muted-foreground">Paid</dt>
              <dd className="text-right tabular-nums text-strong">{moment(detail.paidAt, timezone)}</dd>
            </>
          ) : null}
          {detail.depositCents ? (
            <>
              <dt className="text-muted-foreground">Deposit</dt>
              <dd className="text-right tabular-nums text-strong">{usd(detail.depositCents)}</dd>
            </>
          ) : null}
        </dl>
      </div>
      {detail.status !== "void" ? (
        <>
          <div className="mt-4 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-border/70" role="img" aria-label={`${usd(net)} paid, ${usd(t.processingCents)} processing, ${usd(t.creditedCents)} credited, ${usd(Math.max(0, t.balanceCents - t.processingCents))} still owed, of ${usd(t.totalCents)}`}>
            {parts.map((part) => (
              <span key={part.key} className={cn("h-full first:rounded-l-full", part.className)} style={{ width: `${Math.min(100, (part.cents / base) * 100)}%` }} />
            ))}
          </div>
          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {parts.map((part) => (
              <li key={part.key} className="inline-flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", part.className)} aria-hidden />
                {part.label} <span className="tabular-nums text-strong">{usd(part.cents)}</span>
              </li>
            ))}
            <li className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-border" aria-hidden />
              Owed <span className="tabular-nums text-strong">{usd(Math.max(0, t.balanceCents - t.processingCents))}</span>
            </li>
            {t.refundedCents ? <li>Refunded <span className="tabular-nums text-strong">{usd(t.refundedCents)}</span></li> : null}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function PayLink({ detail }: { detail: Detail }) {
  const { companyId, timezone } = useCompany();
  const share = useMutation(api.finance.markShared);
  const [copied, setCopied] = useState(false);
  const { error, run } = useRun();
  if (!detail.payLink) {
    return (
      <Notice tone="warning" title="No pay link yet">
        {detail.payLinksConfigured ? "This invoice has no link." : "Pay links aren't switched on for this deployment yet. You can still record payments you receive."}
      </Notice>
    );
  }
  const link = detail.payLink;
  return (
    <section aria-label="Pay link" className="rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-strong">Pay link</p>
          <p className="text-xs text-muted-foreground">
            {detail.shared ? (detail.shared.how === "marked_sent" ? `You sent it ${moment(detail.shared.at, timezone)}` : `Copied ${moment(detail.shared.at, timezone)}, not marked sent`) : "Not shared yet. Send it below, or copy the link."}
            {detail.cardPayments ? " · Card and bank payments on" : " · Card payments off until Stripe is set up"}
          </p>
        </div>
        <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-info-foreground underline-offset-4 hover:underline">
          Preview <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{link}</code>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            run(async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
              await share({ companyId, invoiceId: detail.id, how: "link_copied" });
            })
          }
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        {detail.shared?.how !== "marked_sent" ? (
          <Button size="sm" variant="ghost" onClick={() => run(() => share({ companyId, invoiceId: detail.id, how: "marked_sent" }))}>
            I sent it
          </Button>
        ) : null}
      </div>
      <FormError message={error} />
    </section>
  );
}

function Lines({ detail }: { detail: Detail }) {
  const t = detail.totals;
  return (
    <section aria-label="Lines">
      <h3 className="mb-2 text-sm font-semibold text-strong">What it&apos;s for</h3>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Description</th>
              <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">Qty</th>
              <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">Price</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {detail.lines.map((line) => (
              <tr key={line.id}>
                <td className="px-3 py-2.5 text-strong">
                  {line.description}
                  {line.taxable && detail.taxRateBps ? <span className="ml-1.5 text-[11px] text-muted-foreground">taxed</span> : null}
                  <span className="block text-xs text-muted-foreground sm:hidden">
                    {line.quantity} × {usd(line.unitCents)}
                  </span>
                </td>
                <td className="hidden px-3 py-2.5 text-right tabular-nums text-muted-foreground sm:table-cell">{line.quantity}</td>
                <td className="hidden px-3 py-2.5 text-right tabular-nums text-muted-foreground sm:table-cell">{usd(line.unitCents)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-strong">{usd(line.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-t border-border bg-muted/20 px-3 py-2.5 text-sm">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="text-right tabular-nums">{usd(t.subtotalCents)}</dd>
          {t.discountCents ? (
            <>
              <dt className="text-muted-foreground">Discounts</dt>
              <dd className="text-right tabular-nums">{usd(-t.discountCents)}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">
            {detail.taxLabel}
            {detail.taxRateBps ? ` (${detail.taxRateWords})` : ""}
          </dt>
          <dd className="text-right tabular-nums">{detail.taxRateBps ? usd(t.taxCents) : "None"}</dd>
          <dt className="font-medium text-strong">Total</dt>
          <dd className="text-right font-semibold tabular-nums text-strong">{usd(t.totalCents)}</dd>
        </dl>
      </div>
      {detail.memo ? <p className="mt-2 text-sm whitespace-pre-line text-muted-foreground">{detail.memo}</p> : null}
    </section>
  );
}

const PAYMENT_TONE: Record<string, "success" | "progress" | "danger" | "muted" | "warning"> = { succeeded: "success", processing: "progress", failed: "danger", checking: "warning", voided: "muted", canceled: "muted", awaiting_customer: "muted" };

function Payments({ detail, onRefund, onVoid }: { detail: Detail; onRefund: (id: Id<"payments">, cents: number) => void; onVoid: (id: Id<"payments">) => void }) {
  const { timezone } = useCompany();
  if (!detail.payments.length && !detail.refunds.length && !detail.credits.length) return null;
  return (
    <section aria-label="Payments, refunds and credits" className="grid gap-2">
      <h3 className="text-sm font-semibold text-strong">Payments, refunds and credits</h3>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {detail.payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm text-strong">
                <span className="font-medium tabular-nums">{usd(p.amountCents)}</span>
                <span className="text-muted-foreground">{p.methodWords}</span>
                <Chip tone={PAYMENT_TONE[p.status] ?? "muted"}>{p.statusWords}</Chip>
                {p.dispute ? <Chip tone="danger">Disputed</Chip> : null}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {p.receivedOn ? `Received ${calendarDate(p.receivedOn)}` : `Started ${moment(p.createdAt, timezone, true)}`}
                {p.reference ? ` · ${p.reference}` : ""}
                {p.feeCents !== null ? ` · Stripe fee ${usd(p.feeCents)}` : p.source === "stripe" && p.status === "succeeded" ? " · Stripe fee not reported yet" : ""}
                {p.refundedCents ? ` · ${usd(p.refundedCents)} refunded` : ""}
                {p.livemode === false ? " · test mode" : ""}
              </p>
              {p.problem ? <p className="mt-1 text-xs text-destructive-foreground">{p.problem}</p> : null}
              {p.voided ? <p className="mt-1 text-xs text-muted-foreground">Voided: {p.voided.reason}</p> : null}
            </div>
            <div className="flex gap-1.5">
              {p.refundableCents > 0 && !p.dispute ? (
                <Button size="xs" variant="outline" onClick={() => onRefund(p.id, p.refundableCents)}>
                  Refund
                </Button>
              ) : null}
              {p.source === "manual" && p.status === "succeeded" && p.refundedCents === 0 ? (
                <Button size="xs" variant="ghost" onClick={() => onVoid(p.id)}>
                  Void
                </Button>
              ) : null}
            </div>
          </li>
        ))}
        {detail.refunds.map((r) => (
          <li key={r.id} className="px-3.5 py-3">
            <p className="flex flex-wrap items-center gap-2 text-sm text-strong">
              <span className="font-medium tabular-nums">{usd(-r.amountCents)}</span>
              <span className="text-muted-foreground">Refund</span>
              <Chip tone={r.status === "succeeded" || r.status === "recorded" ? "success" : r.status === "failed" ? "danger" : r.inFlight ? "progress" : "muted"}>{r.statusWords}</Chip>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {r.reason} · {moment(r.createdAt, timezone, true)}
            </p>
            {r.problem ? <p className="mt-1 text-xs text-destructive-foreground">{r.problem}</p> : null}
          </li>
        ))}
        {detail.credits.map((c) => (
          <li key={c.id} className="px-3.5 py-3">
            <p className="flex flex-wrap items-center gap-2 text-sm text-strong">
              <span className="font-medium tabular-nums">{usd(-c.amountCents)}</span>
              <span className="text-muted-foreground">Credit{c.fromRefund ? " with refund" : ""}</span>
              {c.reversed ? <Chip tone="muted">Reversed</Chip> : null}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {c.reason} · {moment(c.at, timezone)}
              {c.reversed ? ` · reversed: ${c.reversed.reason}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Timeline({ detail }: { detail: Detail }) {
  const { timezone } = useCompany();
  if (!detail.timeline.length) return null;
  return (
    <section aria-label="History">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-strong">
        <HistoryIcon className="size-4 text-muted-foreground" aria-hidden />
        History
      </h3>
      <ol className="relative ml-1.5 grid gap-3 border-l border-border pl-4">
        {detail.timeline.map((row) => (
          <li key={row.id} className="relative text-sm">
            <span className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full border-2 border-card bg-brand-500" aria-hidden />
            <span className="text-strong">{row.title}</span>
            {row.amountCents !== null ? <span className="text-muted-foreground"> · {usd(row.amountCents)}</span> : null}
            <span className="block text-xs text-muted-foreground">
              {row.by} · {moment(row.at, timezone, true)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ── A draft ──────────────────────────────────────────────────────────────────────────────────────

type DraftLine = Detail["lines"][number] & { priceText: string; qtyText: string };

function lineId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const round = (value: number) => (value < 0 ? -Math.round(-value) : Math.round(value));

/** The same arithmetic as the server (convex/lib/finance/money.ts), for showing totals while typing. The server works them out again. */
function computeLine(line: DraftLine): number | null {
  const qty = Number(line.qtyText);
  const unit = parseMoney(line.priceText.replace(/^-/, ""));
  if (!Number.isFinite(qty) || qty <= 0 || unit === null) return null;
  const signed = line.kind === "discount" ? -unit : unit;
  return round((Math.round(qty * 100) * signed) / 100);
}

function DraftEditor({ detail }: { detail: Detail }) {
  const { companyId } = useCompany();
  const save = useMutation(api.finance.saveDraft);
  const { busy, error, run } = useRun();
  const toDraft = (line: Detail["lines"][number]): DraftLine => ({ ...line, priceText: moneyInput(Math.abs(line.unitCents)), qtyText: String(line.quantity) });
  const [lines, setLines] = useState<DraftLine[]>(() => detail.lines.map(toDraft));
  const [deposit, setDeposit] = useState(detail.depositCents ? moneyInput(detail.depositCents) : "");
  const [depositOn, setDepositOn] = useState(detail.depositCents !== null);
  const [memo, setMemo] = useState(detail.memo ?? "");
  const [dirty, setDirty] = useState(false);
  const [dialog, setDialog] = useState<null | "issue" | "discard">(null);
  const [useCurrentTax, setUseCurrentTax] = useState(false);
  // The revision this editor's changes were made against. A save elsewhere moves the record on; saving
  // then is refused instead of overwriting it. With nothing unsaved, the editor follows the record.
  const [base, setBase] = useState(detail.revision);
  const revision = dirty ? base : detail.revision;
  const touch = () => {
    if (!dirty) setBase(detail.revision);
    setDirty(true);
  };

  const taxRate = useCurrentTax ? (detail.taxSettings.rateBps ?? 0) : detail.taxRateBps;
  const totals = useMemo(() => {
    const amounts = lines.map((line) => ({ line, amount: computeLine(line) }));
    const subtotal = amounts.filter((a) => a.line.kind !== "discount").reduce((s, a) => s + (a.amount ?? 0), 0);
    const discount = -amounts.filter((a) => a.line.kind === "discount").reduce((s, a) => s + (a.amount ?? 0), 0);
    const taxable = amounts.filter((a) => a.line.taxable).reduce((s, a) => s + (a.amount ?? 0), 0);
    const tax = taxable > 0 && taxRate > 0 ? round((taxable * taxRate) / 10_000) : 0;
    return { subtotal, discount, tax, total: subtotal - discount + tax, invalid: amounts.some((a) => a.amount === null || !a.line.description.trim()) };
  }, [lines, taxRate]);
  const depositCents = depositOn ? parseMoney(deposit) : null;

  const update = (id: string, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
    touch();
  };
  const add = (kind: "item" | "discount") => {
    setLines((current) => [...current, { id: lineId(), kind, description: kind === "discount" ? "Discount" : "", quantity: 1, unitCents: 0, amountCents: 0, taxable: kind === "discount" ? current.some((l) => l.taxable) : false, priceText: "", qtyText: "1" }]);
    touch();
  };

  async function persist() {
    const payload = lines.map((line) => {
      const unit = parseMoney(line.priceText.replace(/^-/, "")) ?? 0;
      return { id: line.id, kind: line.kind, description: line.description, quantity: Number(line.qtyText), unitCents: line.kind === "discount" ? -unit : unit, amountCents: 0, taxable: line.taxable, serviceId: line.serviceId };
    });
    const result = await save({ companyId, invoiceId: detail.id, revision, lines: payload, depositCents: depositOn ? (depositCents ?? -1) : null, memo: memo || null, useCurrentTaxRate: useCurrentTax || undefined });
    setBase(result.revision);
    setDirty(false);
    setUseCurrentTax(false);
    return result.revision;
  }

  const taxDiffers = detail.taxSettings.rateBps !== null && detail.taxSettings.rateBps !== detail.taxRateBps;
  return (
    <>
      <Notice tone="info" title="Draft — the customer hasn't seen this">
        Change anything you like. Issuing it gives it a number and a pay link.
      </Notice>
      <section aria-label="Lines" className="grid gap-2">
        <h3 className="text-sm font-semibold text-strong">Lines</h3>
        <ul className="grid gap-2">
          {lines.map((line) => {
            const amount = computeLine(line);
            return (
              <li key={line.id} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[minmax(0,1fr)_4.5rem_6.5rem_6rem_auto] sm:items-center">
                <label className="grid gap-1">
                  <span className="sr-only">Description</span>
                  <input value={line.description} maxLength={200} onChange={(e) => update(line.id, { description: e.target.value })} placeholder={line.kind === "discount" ? "Discount" : "What was done"} className="h-9 w-full min-w-0 rounded-lg border border-border bg-card px-2.5 text-sm text-strong focus-visible:outline-2 focus-visible:outline-brand-500/40" />
                </label>
                <div className="grid grid-cols-3 gap-2 sm:contents">
                  <label className="grid gap-1">
                    <span className="text-[11px] text-muted-foreground sm:sr-only">Qty</span>
                    <input value={line.qtyText} inputMode="decimal" onChange={(e) => update(line.id, { qtyText: e.target.value })} className="h-9 w-full min-w-0 rounded-lg border border-border bg-card px-2.5 text-right text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-brand-500/40" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] text-muted-foreground sm:sr-only">{line.kind === "discount" ? "Amount off" : "Price"}</span>
                    <input value={line.priceText} inputMode="decimal" placeholder="0.00" onChange={(e) => update(line.id, { priceText: e.target.value })} className="h-9 w-full min-w-0 rounded-lg border border-border bg-card px-2.5 text-right text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-brand-500/40" />
                  </label>
                  <span className="grid gap-1">
                    <span className="text-[11px] text-muted-foreground sm:sr-only">Amount</span>
                    <span className={cn("flex h-9 items-center justify-end text-sm font-medium tabular-nums", amount !== null ? "text-strong" : line.priceText.trim() ? "text-destructive-foreground" : "text-muted-foreground")}>{amount !== null ? usd(amount) : line.priceText.trim() ? "Check amount" : "—"}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 sm:justify-end">
                  <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input type="checkbox" checked={line.taxable} onChange={(e) => update(line.id, { taxable: e.target.checked })} className="size-3.5 accent-brand-500" />
                    Taxed
                  </label>
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove ${line.description || "line"}`} onClick={() => (setLines((c) => c.filter((l) => l.id !== line.id)), touch())}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => add("item")}>
            <Plus aria-hidden />
            Add line
          </Button>
          <Button size="sm" variant="ghost" onClick={() => add("discount")}>
            <Minus aria-hidden />
            Add discount
          </Button>
        </div>
      </section>

      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="text-right tabular-nums">{usd(totals.subtotal)}</dd>
        {totals.discount ? (
          <>
            <dt className="text-muted-foreground">Discounts</dt>
            <dd className="text-right tabular-nums">{usd(-totals.discount)}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">
          {detail.taxLabel} {taxRate ? `(${(taxRate / 100).toFixed(2).replace(/\.?0+$/, "")}%)` : "(not set)"}
        </dt>
        <dd className="text-right tabular-nums">{usd(totals.tax)}</dd>
        <dt className="font-medium text-strong">Total</dt>
        <dd className="text-right font-semibold tabular-nums text-strong">{usd(totals.total)}</dd>
      </dl>
      {taxDiffers && !useCurrentTax ? (
        <Notice tone="info" title={`Your tax rate is now ${((detail.taxSettings.rateBps ?? 0) / 100).toFixed(2).replace(/\.?0+$/, "")}%`} action={<Button size="xs" variant="outline" onClick={() => (setUseCurrentTax(true), touch())}>Use it</Button>}>
          This draft was made with {detail.taxRateWords}.
        </Notice>
      ) : null}

      <section aria-label="Deposit and note" className="grid gap-3">
        <label className="flex items-start gap-2.5 text-sm text-strong">
          <input type="checkbox" checked={depositOn} onChange={(e) => (setDepositOn(e.target.checked), touch())} className="mt-0.5 size-4 accent-brand-500" />
          <span>
            Ask for a deposit first
            <span className="block text-xs text-muted-foreground">The pay link asks for the deposit now; you request the rest after the visit.</span>
          </span>
        </label>
        {depositOn ? (
          <label className="grid max-w-48 gap-1 text-sm">
            <span className="font-medium text-strong">Deposit</span>
            <input value={deposit} inputMode="decimal" placeholder="50.00" onChange={(e) => (setDeposit(e.target.value), touch())} className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-brand-500/40" />
          </label>
        ) : null}
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-strong">Note on the invoice</span>
          <textarea value={memo} maxLength={1000} rows={2} onChange={(e) => (setMemo(e.target.value), touch())} placeholder="Thank you! Checks payable to…" className="rounded-lg border border-border bg-card px-2.5 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand-500/40" />
        </label>
      </section>

      <FormError message={error} />
      <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center gap-2 border-t border-border bg-card/95 px-5 py-3 backdrop-blur sm:-mx-7 sm:px-7">
        <span className="text-xs text-muted-foreground" role="status">
          {dirty ? "Unsaved changes" : "Saved"}
        </span>
        <Button variant="ghost" className="ml-auto" onClick={() => setDialog("discard")}>
          Discard
        </Button>
        <Button variant="outline" disabled={busy || !dirty || totals.invalid} onClick={() => run(persist)}>
          Save draft
        </Button>
        <Button
          variant="default"
          disabled={busy || totals.invalid || lines.length === 0 || totals.total <= 0 || (depositOn && (depositCents === null || depositCents <= 0 || depositCents >= totals.total))}
          onClick={() =>
            run(async () => {
              if (dirty) await persist();
              setDialog("issue");
            })
          }
        >
          Review and issue
        </Button>
      </div>
      <IssueDialog invoiceId={detail.id} revision={revision} totalCents={totals.total} depositCents={depositOn ? depositCents : null} customer={detail.customer.name} termsDueDate={detail.termsDueDate} open={dialog === "issue"} onClose={() => setDialog(null)} onIssued={() => undefined} />
      <VoidInvoiceDialog invoiceId={detail.id} draft open={dialog === "discard"} onClose={() => setDialog(null)} />
    </>
  );
}
