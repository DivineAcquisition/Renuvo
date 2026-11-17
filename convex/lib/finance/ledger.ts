/**
 * The one place an invoice's totals are written. Every change to a payment, refund or credit calls
 * `recompute`, which adds the invoice up again from its rows, so the totals can never drift from the
 * records they summarize.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { totalsFor } from "./money";
import type { InvoiceTotals } from "./schema";

/** Refunds that took money back out: done by Stripe, or recorded by the Owner. */
export const REFUND_COUNTS: readonly Doc<"refunds">["status"][] = ["succeeded", "recorded"];
/** Refunds that may still take money back out. Shown, never counted. */
export const REFUND_IN_FLIGHT: readonly Doc<"refunds">["status"][] = ["sending", "pending", "checking"];

export async function invoiceRows(ctx: QueryCtx | MutationCtx, invoice: Pick<Doc<"invoices">, "_id" | "companyId">) {
  const [payments, refunds, credits] = await Promise.all([
    ctx.db
      .query("payments")
      .withIndex("by_company_invoice", (q) => q.eq("companyId", invoice.companyId).eq("invoiceId", invoice._id))
      .take(200),
    ctx.db
      .query("refunds")
      .withIndex("by_company_invoice", (q) => q.eq("companyId", invoice.companyId).eq("invoiceId", invoice._id))
      .take(200),
    ctx.db
      .query("invoiceCredits")
      .withIndex("by_company_invoice", (q) => q.eq("companyId", invoice.companyId).eq("invoiceId", invoice._id))
      .take(200),
  ]);
  return { payments, refunds, credits };
}

export function sums(rows: { payments: Doc<"payments">[]; refunds: Doc<"refunds">[]; credits: Doc<"invoiceCredits">[] }) {
  const paidCents = rows.payments.filter((p) => p.status === "succeeded").reduce((sum, p) => sum + p.amountCents, 0);
  // A card payment in flight. A started payment the customer has not finished is not money on its way.
  const processingCents = rows.payments.filter((p) => p.status === "processing").reduce((sum, p) => sum + p.amountCents, 0);
  const refundedCents = rows.refunds.filter((r) => REFUND_COUNTS.includes(r.status)).reduce((sum, r) => sum + r.amountCents, 0);
  const creditedCents = rows.credits.filter((c) => !c.reversed).reduce((sum, c) => sum + c.amountCents, 0);
  return { paidCents, processingCents, refundedCents, creditedCents };
}

/** Adds the invoice up again from its rows and moves it between open and paid. Drafts and voids keep their status. */
export async function recompute(ctx: MutationCtx, invoiceId: Id<"invoices">): Promise<Doc<"invoices">> {
  const invoice = (await ctx.db.get(invoiceId))!;
  const totals: InvoiceTotals = totalsFor({ lines: invoice.lines, taxRateBps: invoice.taxRateBps, ...sums(await invoiceRows(ctx, invoice)) });
  const now = Date.now();
  let status = invoice.status;
  let paidAt = invoice.paidAt;
  if (invoice.status === "open" && totals.balanceCents <= 0) {
    status = "paid";
    paidAt = now;
  } else if (invoice.status === "paid" && totals.balanceCents > 0) {
    // A refund or a reversed credit means money is owed again.
    status = "open";
    paidAt = undefined;
  }
  await ctx.db.patch(invoiceId, { totals, status, paidAt, updatedAt: now });
  return (await ctx.db.get(invoiceId))!;
}

export function emptyTotals(): InvoiceTotals {
  return { subtotalCents: 0, discountCents: 0, taxCents: 0, totalCents: 0, paidCents: 0, refundedCents: 0, creditedCents: 0, balanceCents: 0, processingCents: 0 };
}
