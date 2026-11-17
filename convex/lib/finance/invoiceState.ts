/**
 * What an invoice is, in words a person reads, worked out from the stored invoice and the clock. The
 * stored status is only draft, open, paid or void; everything else here is derived so it can never
 * disagree with the money.
 *
 *  draft            not issued; the customer has seen nothing
 *  deposit_requested  issued with a deposit, and less than the deposit has been paid
 *  deposit_paid     the deposit is in, the rest has not been asked for yet
 *  requested        issued and nothing has been paid
 *  partially_paid   some paid, some still owed
 *  processing       a payment is on its way and has not cleared; never counted as paid
 *  overdue          what was asked for is past its due date
 *  paid             nothing is owed
 *  overpaid         the customer paid more than they owe; the difference can be refunded
 *  void             cancelled, with the reason kept
 */
import type { Doc } from "../../_generated/dataModel";

export type InvoiceState =
  | "draft"
  | "deposit_requested"
  | "deposit_paid"
  | "requested"
  | "partially_paid"
  | "processing"
  | "overdue"
  | "paid"
  | "overpaid"
  | "void";

export const STATE_WORDS: Record<InvoiceState, string> = {
  draft: "Draft",
  deposit_requested: "Deposit requested",
  deposit_paid: "Deposit paid",
  requested: "Requested",
  partially_paid: "Partially paid",
  processing: "Processing",
  overdue: "Overdue",
  paid: "Paid",
  overpaid: "Overpaid",
  void: "Void",
};

type InvoiceLike = Pick<Doc<"invoices">, "status" | "totals" | "depositCents" | "balanceRequestedAt" | "dueAt">;

/** The deposit still to come in, while the invoice is asking for the deposit only. Zero otherwise. */
export function depositOutstanding(invoice: InvoiceLike): number {
  if (!invoice.depositCents || invoice.balanceRequestedAt !== undefined) return 0;
  const net = invoice.totals.paidCents - invoice.totals.refundedCents;
  return Math.max(0, Math.min(invoice.depositCents, invoice.totals.totalCents - invoice.totals.creditedCents) - net);
}

/** Whether the invoice is still asking for its deposit only. */
export function inDepositStage(invoice: InvoiceLike): boolean {
  return invoice.depositCents !== undefined && invoice.depositCents > 0 && invoice.balanceRequestedAt === undefined;
}

/** What the pay page asks for right now: the deposit while in the deposit stage, then the balance. */
export function amountRequested(invoice: InvoiceLike): number {
  if (invoice.status !== "open") return 0;
  const owed = Math.max(0, invoice.totals.balanceCents - invoice.totals.processingCents);
  return inDepositStage(invoice) ? Math.min(owed, Math.max(0, depositOutstanding(invoice) - invoice.totals.processingCents)) : owed;
}

export function invoiceState(invoice: InvoiceLike, now: number): InvoiceState {
  if (invoice.status === "draft") return "draft";
  if (invoice.status === "void") return "void";
  const { balanceCents, processingCents, paidCents, refundedCents } = invoice.totals;
  if (balanceCents < 0) return "overpaid";
  if (invoice.status === "paid" || balanceCents === 0) return "paid";
  // Everything still owed is already on its way: nothing is late, it just has not cleared.
  if (processingCents > 0 && balanceCents - processingCents <= 0) return "processing";
  const late = invoice.dueAt !== undefined && invoice.dueAt < now;
  if (inDepositStage(invoice)) {
    const deposit = depositOutstanding(invoice);
    if (deposit <= 0) return "deposit_paid";
    if (processingCents > 0 && deposit - processingCents <= 0) return "processing";
    return late ? "overdue" : "deposit_requested";
  }
  if (late) return "overdue";
  if (processingCents > 0) return "processing";
  return paidCents - refundedCents > 0 ? "partially_paid" : "requested";
}

/** Tone for the badge: the same word always gets the same color, and the word is always shown. */
export const STATE_TONE: Record<InvoiceState, "neutral" | "info" | "warning" | "danger" | "success" | "muted"> = {
  draft: "muted",
  deposit_requested: "info",
  deposit_paid: "info",
  requested: "info",
  partially_paid: "warning",
  processing: "neutral",
  overdue: "danger",
  paid: "success",
  overpaid: "warning",
  void: "muted",
};
