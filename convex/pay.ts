/**
 * The pay page: a customer opens their invoice from a link, sees exactly what they owe and why, and pays
 * by card or bank through the company's own Stripe account. No sign-in; the link is the authorization
 * (convex/lib/finance/payLinks.ts). Nothing here shows another invoice, another customer or anything
 * about the company beyond its name.
 *
 * A payment is recorded as received only when Stripe says so. Until then the page says "processing".
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { payMutation, payQuery } from "./lib/builders";
import { userError } from "./lib/errors";
import { recordEvent } from "./lib/events";
import { amountRequested, depositOutstanding, inDepositStage, invoiceState, STATE_WORDS } from "./lib/finance/invoiceState";
import { invoiceRows } from "./lib/finance/ledger";
import { settingsOf, settingsRow, localDateKey } from "./lib/finance/settings";
import { stripeConfig } from "./lib/finance/stripe";
import { currentStripeAccount, stripeState } from "./lib/finance/stripeState";
import { allow } from "./lib/rateLimit";
import { cancelStartedPayments } from "./finance";

/** The smallest card payment Stripe accepts in US dollars. */
const MIN_CARD_CENTS = 50;

export const view = payQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.pay) return null;
    const { invoice, company } = ctx.pay;
    const now = Date.now();
    const tz = company.timezone;
    const customer = await ctx.db.get(invoice.customerId);
    const property = invoice.propertyId ? await ctx.db.get(invoice.propertyId) : null;
    const settings = settingsOf(await settingsRow(ctx, company._id));
    const stripe = await stripeState(ctx, company._id);
    const rows = await invoiceRows(ctx, invoice);
    const state = invoiceState(invoice, now);
    const requested = amountRequested(invoice);
    return {
      company: company.name,
      number: invoice.number ?? "Invoice",
      state,
      stateWords: STATE_WORDS[state],
      customer: customer?.name ?? null,
      serviceAddress: property ? `${property.address.line1}, ${property.address.city}` : null,
      issuedOn: invoice.issuedAt ? localDateKey(invoice.issuedAt, tz) : null,
      dueOn: invoice.dueAt ? localDateKey(invoice.dueAt, tz) : null,
      lines: invoice.lines.map((line) => ({ id: line.id, description: line.description, quantity: line.quantity, unitCents: line.unitCents, amountCents: line.amountCents, kind: line.kind })),
      taxLabel: invoice.taxLabel ?? "Sales tax",
      taxRateBps: invoice.taxRateBps,
      totals: invoice.totals,
      memo: invoice.memo ?? null,
      deposit: invoice.depositCents ? { cents: invoice.depositCents, outstandingCents: depositOutstanding(invoice), stage: inDepositStage(invoice) } : null,
      requestedCents: requested,
      // What the customer can see of their own payments: when, how much, how, and whether it cleared.
      payments: rows.payments
        .filter((p) => p.status === "succeeded" || p.status === "processing")
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((p) => ({ id: p._id, amountCents: p.amountCents, status: p.status, method: p.stripe?.methodLabel ?? (p.source === "manual" ? "Recorded by the company" : "Card"), on: localDateKey(p.succeededAt ?? p.createdAt, tz) })),
      credits: rows.credits.filter((c) => !c.reversed).map((c) => ({ amountCents: c.amountCents, reason: c.reason })),
      refundedCents: invoice.totals.refundedCents,
      voided: invoice.status === "void",
      canPayByCard: stripe.canPayByCard && invoice.status === "open" && requested >= MIN_CARD_CENTS,
      cardUnavailableReason: invoice.status !== "open" ? null : !stripe.canPayByCard ? `${company.name} doesn't take online payments yet. Please pay them directly.` : requested < MIN_CARD_CENTS && requested > 0 ? "The amount left is too small to pay by card. Please pay the company directly." : null,
      allowPartial: settings.allowPartialPayments && !inDepositStage(invoice),
      tips: await tipOffer(ctx, invoice, settings.tipsOn),
      testMode: stripe.testMode,
      minCents: MIN_CARD_CENTS,
    };
  },
});

/** Whether the pay page offers a tip: tips on, a job with a crew, the balance (not a deposit) being paid. */
async function tipOffer(ctx: QueryCtx, invoice: Doc<"invoices">, tipsOn: boolean) {
  if (!tipsOn || !invoice.jobId || invoice.status !== "open" || inDepositStage(invoice)) return null;
  const job = await ctx.db.get(invoice.jobId);
  if (!job || job.status !== "completed") return null;
  const crew = (
    await ctx.db
      .query("assignments")
      .withIndex("by_company_job", (q) => q.eq("companyId", invoice.companyId).eq("jobId", job._id))
      .take(50)
  ).filter((a) => a.status === "accepted");
  if (!crew.length) return null;
  const names = [];
  for (const a of crew) names.push(((await ctx.db.get(a.cleanerId))?.name ?? "").split(/\s+/)[0]);
  return { crew: names.filter(Boolean), maxCents: MAX_TIP_CENTS };
}

const MAX_TIP_CENTS = 50_000;

/** The customer starts paying. Makes one payment record per click (by the browser's key) and asks Stripe to prepare it. */
export const start = payMutation({
  args: { amountCents: v.number(), clientKey: v.string(), tipCents: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { invoice, company } = ctx;
    if (!/^[\w-]{8,80}$/.test(args.clientKey)) throw userError("Reload the page and try again.");
    const repeat = await ctx.db
      .query("payments")
      .withIndex("by_company_clientKey", (q) => q.eq("companyId", company._id).eq("clientKey", args.clientKey))
      .unique();
    if (repeat) {
      if (repeat.invoiceId !== invoice._id) throw userError("Reload the page and try again.");
      return { paymentId: repeat._id };
    }
    if (!(await allow(ctx, `pay-start:${invoice._id}`, 12, 15 * 60_000))) return { paymentId: null, problem: "Too many tries. Please wait a few minutes and try again." };
    if (invoice.status !== "open") throw userError(invoice.status === "paid" ? "This invoice is already paid. Thank you!" : "This invoice is no longer open.");
    const requested = amountRequested(invoice);
    const settings = settingsOf(await settingsRow(ctx, company._id));
    const partial = settings.allowPartialPayments && !inDepositStage(invoice);
    if (!Number.isInteger(args.amountCents) || args.amountCents < MIN_CARD_CENTS) throw userError("Enter at least $0.50.");
    if (args.amountCents > requested) throw userError("That's more than what's due right now.");
    if (!partial && args.amountCents !== requested) throw userError("Please pay the full amount due.");
    const tipCents = args.tipCents ?? 0;
    if (tipCents) {
      if (!Number.isSafeInteger(tipCents) || tipCents < 0 || tipCents > MAX_TIP_CENTS) throw userError("Enter a tip up to $500.");
      if (!(await tipOffer(ctx, invoice, settings.tipsOn))) throw userError("Tips can't be added to this payment.");
    }
    const config = stripeConfig();
    const account = await currentStripeAccount(ctx, company._id);
    if (!config || !account?.accountId || account.status !== "active" || account.livemode !== config.livemode || !config.publishableKey) throw userError(`${company.name} doesn't take online payments right now. Please pay them directly.`);
    const now = Date.now();
    const paymentId = await ctx.db.insert("payments", {
      companyId: company._id,
      invoiceId: invoice._id,
      customerId: invoice.customerId,
      amountCents: args.amountCents,
      method: "card",
      source: "stripe",
      status: "awaiting_customer",
      clientKey: args.clientKey,
      stripe: { accountId: account.accountId, livemode: account.livemode, createTries: 0 },
      refundedCents: 0,
      tipCents: tipCents || undefined,
      createdAt: now,
      updatedAt: now,
    });
    // Only one unfinished payment at a time, so a second tab can't take the same balance twice.
    await cancelStartedPayments(ctx, invoice._id, paymentId);
    await recordEvent(ctx, { companyId: company._id, type: "payment.started", actor: { kind: "system" }, subject: { table: "payments", id: paymentId }, data: { amountCents: args.amountCents } });
    await ctx.scheduler.runAfter(0, internal.financeStripe.createIntent, { paymentId });
    return { paymentId };
  },
});

const ATTEMPT_WORDS: Record<Doc<"payments">["status"], string> = {
  awaiting_customer: "Ready",
  processing: "Processing",
  succeeded: "Received",
  failed: "Didn't go through",
  canceled: "Canceled",
  checking: "Checking",
  voided: "Voided",
};

/** One payment the customer started, as the payment form needs it. Only for a payment on this invoice. */
export const attempt = payQuery({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    if (!ctx.pay) return null;
    const payment = await ctx.db.get(args.paymentId);
    if (!payment || payment.invoiceId !== ctx.pay.invoice._id || !payment.stripe) return null;
    const config = stripeConfig();
    const ready = payment.status === "awaiting_customer" && Boolean(payment.stripe.paymentIntentId && payment.stripe.clientSecret);
    return {
      status: payment.status,
      words: ATTEMPT_WORDS[payment.status],
      preparing: payment.status === "awaiting_customer" && !payment.stripe.paymentIntentId,
      amountCents: payment.amountCents,
      tipCents: payment.tipCents ?? 0,
      problem: payment.problem ?? null,
      clientSecret: ready ? payment.stripe.clientSecret! : null,
      publishableKey: ready ? (config?.publishableKey ?? null) : null,
      accountId: ready ? payment.stripe.accountId : null,
      methodLabel: payment.stripe.methodLabel ?? null,
    };
  },
});

/** Back from the payment form: ask Stripe now rather than waiting for its notification. */
export const returned = payMutation({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment || payment.invoiceId !== ctx.invoice._id || payment.source !== "stripe") return { ok: false };
    if (!(await allow(ctx, `pay-return:${payment._id}`, 10, 10 * 60_000))) return { ok: false };
    await ctx.scheduler.runAfter(0, internal.financeStripe.syncPayment, { paymentId: payment._id });
    return { ok: true };
  },
});
