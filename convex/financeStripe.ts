/**
 * Finance's Stripe work: connecting the company's own Stripe account, creating card payments for the pay
 * page, sending refunds, and reading back what Stripe says (docs/finance/00-plan.md).
 *
 * The rule for every call that moves money: one request key per record, kept for every try. If Stripe's
 * answer is unclear, the record is marked "checking" and the same request is asked again (Stripe
 * replays the original answer for 24 hours) or the object is looked up. A new key is never used to try
 * again, so an unclear answer can never become a second charge or a second refund.
 *
 * Webhooks only say which object changed. The object itself is always read back from Stripe, so an
 * event arriving late, twice or out of order can never move a record backwards.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { ownerMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent, type Actor } from "./lib/events";
import { requireFinance } from "./lib/finance/authority";
import { recompute } from "./lib/finance/ledger";
import {
  accountFacts,
  cancelPaymentIntent,
  createAccount,
  createAccountLink,
  createPaymentIntent,
  createRefund,
  listRefunds,
  paymentFacts,
  refundFacts,
  retrieveAccount,
  retrievePaymentIntent,
  retrieveRefund,
  searchPaymentIntents,
  stripeConfig,
  type RawPaymentIntent,
  type StripeEvent,
} from "./lib/finance/stripe";
import { currentStripeAccount } from "./lib/finance/stripeState";
import { appOrigin } from "./lib/invitations";
import { allow } from "./lib/rateLimit";
import { addRefundCredit, cancelStartedPayments } from "./finance";

const SYSTEM: Actor = { kind: "system" };
const MINUTE = 60_000;
/** Stripe replays an answer for the same request key for 24 hours. After that, look the object up. */
const REPLAY_WINDOW = 23 * 60 * MINUTE;
/** Waits between asking again after an unclear answer. */
const BACKOFF = [30_000, 2 * MINUTE, 10 * MINUTE, 30 * MINUTE];

// ── Connecting the company's Stripe account ──────────────────────────────────────────────────────

/** The Owner starts (or continues) Stripe's own onboarding for the company's account. */
export const connect = ownerMutation({
  args: {},
  handler: async (ctx) => {
    requireFinance(ctx, "edit");
    const config = stripeConfig();
    if (!config) throw userError("Card payments aren't available on Selestial yet. You can still record payments you receive.");
    if (!(await allow(ctx, `stripe-connect:${ctx.companyId}`, 10, 10 * MINUTE))) return { ok: false as const, problem: "Too many tries. Wait a few minutes and try again." };
    const now = Date.now();
    let row = await currentStripeAccount(ctx, ctx.companyId);
    if (!row || row.status === "disconnected" || row.livemode !== config.livemode) {
      const id = await ctx.db.insert("stripeAccounts", {
        companyId: ctx.companyId,
        livemode: config.livemode,
        status: "onboarding",
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        requirementsDue: 0,
        createAttempt: 1,
        connectedBy: ctx.member._id,
        createdAt: now,
        updatedAt: now,
      });
      row = (await ctx.db.get(id))!;
    }
    await ctx.db.patch(row._id, { onboarding: { state: "working", requestedBy: ctx.member._id, requestedAt: now }, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "stripe.connect_started", actor: byMember(ctx), subject: { table: "stripeAccounts", id: row._id } });
    await ctx.scheduler.runAfter(0, internal.financeStripe.onboard, { rowId: row._id, email: ctx.identity.email ?? "" });
    return { ok: true as const };
  },
});

/** Back from Stripe, or the Owner asked: read the account again. */
export const refreshAccount = ownerMutation({
  args: {},
  handler: async (ctx) => {
    requireFinance(ctx, "read");
    const row = await currentStripeAccount(ctx, ctx.companyId);
    if (!row?.accountId || row.status === "disconnected") return { ok: false };
    if (!(await allow(ctx, `stripe-refresh:${ctx.companyId}`, 20, 10 * MINUTE))) return { ok: false };
    await ctx.scheduler.runAfter(0, internal.financeStripe.syncAccount, { rowId: row._id });
    return { ok: true };
  },
});

export const rowFor = internalQuery({
  args: { rowId: v.id("stripeAccounts") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rowId);
    const company = row ? await ctx.db.get(row.companyId) : null;
    return row && company ? { row, companyName: company.name } : null;
  },
});

export const onboard = internalAction({
  args: { rowId: v.id("stripeAccounts"), email: v.string() },
  handler: async (ctx, args) => {
    const found = await ctx.runQuery(internal.financeStripe.rowFor, { rowId: args.rowId });
    if (!found) return;
    const { row } = found;
    let accountId = row.accountId;
    if (!accountId) {
      const created = await createAccount({ companyId: row.companyId, email: args.email, businessName: found.companyName, attempt: row.createAttempt });
      if (created.kind !== "ok") {
        // Unclear or refused: nothing is assumed. Asking again uses the same request key, so at most one account is made.
        await ctx.runMutation(internal.financeStripe.onboardingFailed, { rowId: row._id, problem: created.kind === "refused" ? `Stripe didn't create the account: ${created.message}` : "Stripe didn't answer. Try again in a minute." });
        return;
      }
      accountId = created.data.id;
      await ctx.runMutation(internal.financeStripe.accountCreated, { rowId: row._id, accountId, facts: accountFacts(created.data) });
    }
    const origin = appOrigin();
    if (!origin) {
      await ctx.runMutation(internal.financeStripe.onboardingFailed, { rowId: row._id, problem: "Selestial's app address isn't set on this deployment, so Stripe has nowhere to send you back." });
      return;
    }
    const link = await createAccountLink({ accountId, refreshUrl: `${origin}/app/finance/setup?stripe=refresh`, returnUrl: `${origin}/app/finance/setup?stripe=returned` });
    if (link.kind !== "ok") {
      await ctx.runMutation(internal.financeStripe.onboardingFailed, { rowId: row._id, problem: link.kind === "refused" ? `Stripe refused: ${link.message}` : "Stripe didn't answer. Try again in a minute." });
      return;
    }
    await ctx.runMutation(internal.financeStripe.onboardingReady, { rowId: row._id, url: link.data.url, expiresAt: link.data.expires_at * 1000 });
  },
});

const factsValidator = v.object({
  chargesEnabled: v.boolean(),
  payoutsEnabled: v.boolean(),
  detailsSubmitted: v.boolean(),
  requirementsDue: v.number(),
  problem: v.optional(v.string()),
  businessName: v.optional(v.string()),
  status: v.union(v.literal("active"), v.literal("restricted"), v.literal("onboarding")),
});

async function applyAccount(ctx: MutationCtx, row: Doc<"stripeAccounts">, facts: typeof factsValidator.type) {
  const now = Date.now();
  await ctx.db.patch(row._id, { ...facts, problem: facts.problem, checkedAt: now, updatedAt: now });
  if (row.status !== facts.status) {
    await recordEvent(ctx, { companyId: row.companyId, type: facts.status === "active" && row.status !== "restricted" ? "stripe.connected" : "stripe.updated", actor: SYSTEM, subject: { table: "stripeAccounts", id: row._id }, data: { status: facts.status } });
  }
}

export const accountCreated = internalMutation({
  args: { rowId: v.id("stripeAccounts"), accountId: v.string(), facts: factsValidator },
  handler: async (ctx, args) => {
    const row = (await ctx.db.get(args.rowId))!;
    if (row.accountId && row.accountId !== args.accountId) return;
    await ctx.db.patch(row._id, { accountId: args.accountId });
    await applyAccount(ctx, { ...row, accountId: args.accountId }, args.facts);
  },
});

export const onboardingFailed = internalMutation({
  args: { rowId: v.id("stripeAccounts"), problem: v.string() },
  handler: async (ctx, args) => {
    const row = (await ctx.db.get(args.rowId))!;
    if (!row.onboarding) return;
    await ctx.db.patch(row._id, { onboarding: { ...row.onboarding, state: "failed", problem: args.problem.slice(0, 300), url: undefined }, updatedAt: Date.now() });
  },
});

export const onboardingReady = internalMutation({
  args: { rowId: v.id("stripeAccounts"), url: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const row = (await ctx.db.get(args.rowId))!;
    if (!row.onboarding || !args.url.startsWith("https://connect.stripe.com/")) return;
    await ctx.db.patch(row._id, { onboarding: { ...row.onboarding, state: "ready", url: args.url, expiresAt: args.expiresAt, problem: undefined }, updatedAt: Date.now() });
  },
});

export const syncAccount = internalAction({
  args: { rowId: v.id("stripeAccounts") },
  handler: async (ctx, args) => {
    const found = await ctx.runQuery(internal.financeStripe.rowFor, { rowId: args.rowId });
    if (!found?.row.accountId) return;
    const answer = await retrieveAccount(found.row.accountId);
    if (answer.kind === "ok") await ctx.runMutation(internal.financeStripe.accountRead, { rowId: args.rowId, facts: accountFacts(answer.data) });
    else if (answer.kind === "refused" && (answer.status === 403 || answer.status === 401)) await ctx.runMutation(internal.financeStripe.accountLost, { rowId: args.rowId });
  },
});

export const accountRead = internalMutation({
  args: { rowId: v.id("stripeAccounts"), facts: factsValidator },
  handler: async (ctx, args) => {
    const row = (await ctx.db.get(args.rowId))!;
    if (row.status === "disconnected") return;
    await applyAccount(ctx, row, args.facts);
  },
});

/** Stripe says Selestial can no longer reach the account: the company disconnected it from Stripe's side. */
export const accountLost = internalMutation({
  args: { rowId: v.id("stripeAccounts") },
  handler: async (ctx, args) => {
    const row = (await ctx.db.get(args.rowId))!;
    if (row.status === "disconnected") return;
    const now = Date.now();
    await ctx.db.patch(row._id, { status: "disconnected", chargesEnabled: false, disconnectedAt: now, problem: "This Stripe account was disconnected from Selestial.", updatedAt: now });
    await recordEvent(ctx, { companyId: row.companyId, type: "stripe.updated", actor: SYSTEM, subject: { table: "stripeAccounts", id: row._id }, data: { status: "disconnected" } });
  },
});

// ── Card payments from the pay page ──────────────────────────────────────────────────────────────

export const paymentFor = internalQuery({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) return null;
    const invoice = (await ctx.db.get(payment.invoiceId))!;
    const customer = await ctx.db.get(payment.customerId);
    const company = (await ctx.db.get(payment.companyId))!;
    return { payment, invoice, customerEmail: customer?.email ?? null, companyName: company.name };
  },
});

/** Asks Stripe to create the payment the customer started. Every try uses the payment's own request key. */
export const createIntent = internalAction({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    const found = await ctx.runQuery(internal.financeStripe.paymentFor, { paymentId: args.paymentId });
    if (!found?.payment.stripe || found.payment.stripe.paymentIntentId) return;
    const { payment, invoice } = found;
    const stripe = payment.stripe!;
    if (payment.status === "canceled") return;
    if (Date.now() - payment.createdAt > REPLAY_WINDOW) {
      // Stripe no longer replays the first answer: look for the payment instead of creating it again.
      const search = await searchPaymentIntents(stripe.accountId, payment._id);
      if (search.kind === "ok") {
        const intent = search.data.data.find((pi) => pi.metadata?.selestial_payment === payment._id);
        if (intent) await ctx.runMutation(internal.financeStripe.intentCreated, { paymentId: payment._id, intentId: intent.id, clientSecret: intent.client_secret ?? null, facts: paymentFacts(intent) });
        else await ctx.runMutation(internal.financeStripe.intentRefused, { paymentId: payment._id, problem: "Stripe has no record of this payment, so nothing was charged. The customer can try again." });
      }
      return;
    }
    await ctx.runMutation(internal.financeStripe.noteTry, { paymentId: payment._id });
    const answer = await createPaymentIntent({
      accountId: stripe.accountId,
      paymentId: payment._id,
      invoiceId: invoice._id,
      companyId: payment.companyId,
      amountCents: payment.amountCents,
      description: `${invoice.number ?? "Invoice"} · ${found.companyName}`.slice(0, 200),
      receiptEmail: found.customerEmail ?? undefined,
    });
    if (answer.kind === "ok") {
      await ctx.runMutation(internal.financeStripe.intentCreated, { paymentId: payment._id, intentId: answer.data.id, clientSecret: answer.data.client_secret ?? null, facts: paymentFacts(answer.data) });
    } else if (answer.kind === "refused") {
      await ctx.runMutation(internal.financeStripe.intentRefused, { paymentId: payment._id, problem: answer.code === "account_invalid" || answer.status === 403 ? "This business can't take card payments right now." : "Card payment couldn't be started. Nothing was charged." });
    } else {
      await ctx.runMutation(internal.financeStripe.intentUnclear, { paymentId: payment._id });
    }
  },
});

export const noteTry = internalMutation({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    const payment = (await ctx.db.get(args.paymentId))!;
    if (!payment.stripe) return;
    await ctx.db.patch(payment._id, { stripe: { ...payment.stripe, createTries: payment.stripe.createTries + 1 }, checkedAt: Date.now() });
  },
});

const paymentFactsValidator = v.object({
  status: v.union(v.literal("awaiting_customer"), v.literal("processing"), v.literal("succeeded"), v.literal("failed"), v.literal("canceled")),
  receivedCents: v.number(),
  feeCents: v.optional(v.number()),
  methodLabel: v.optional(v.string()),
  method: v.union(v.literal("card"), v.literal("bank_debit")),
  problem: v.optional(v.string()),
  disputed: v.boolean(),
});

export const intentCreated = internalMutation({
  args: { paymentId: v.id("payments"), intentId: v.string(), clientSecret: v.union(v.string(), v.null()), facts: paymentFactsValidator },
  handler: async (ctx, args) => {
    const payment = (await ctx.db.get(args.paymentId))!;
    if (!payment.stripe) return;
    const canceledMeanwhile = payment.status === "canceled";
    await ctx.db.patch(payment._id, { stripe: { ...payment.stripe, paymentIntentId: args.intentId, clientSecret: canceledMeanwhile ? undefined : (args.clientSecret ?? undefined) }, updatedAt: Date.now() });
    // The invoice was settled while Stripe was answering: stop this payment before the customer can use it.
    if (canceledMeanwhile) {
      await ctx.scheduler.runAfter(0, internal.financeStripe.cancelStarted, { paymentId: payment._id });
      return;
    }
    await applyPayment(ctx, payment._id, args.facts);
  },
});

export const intentRefused = internalMutation({
  args: { paymentId: v.id("payments"), problem: v.string() },
  handler: async (ctx, args) => {
    const payment = (await ctx.db.get(args.paymentId))!;
    if (payment.status === "succeeded" || payment.status === "processing") return;
    await ctx.db.patch(payment._id, { status: "failed", problem: args.problem, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: payment.companyId, type: "payment.failed", actor: SYSTEM, subject: { table: "payments", id: payment._id }, data: { amountCents: payment.amountCents } });
  },
});

/** Stripe's answer to "create" was lost. Mark it checking and ask again later with the same request key. */
export const intentUnclear = internalMutation({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    const payment = (await ctx.db.get(args.paymentId))!;
    if (!payment.stripe || payment.stripe.paymentIntentId) return;
    const first = payment.status !== "checking";
    await ctx.db.patch(payment._id, { status: "checking", problem: "Stripe didn't answer clearly. Selestial is checking before anything is tried again.", updatedAt: Date.now() });
    if (first) await recordEvent(ctx, { companyId: payment.companyId, type: "payment.checking", actor: SYSTEM, subject: { table: "payments", id: payment._id }, data: { amountCents: payment.amountCents } });
    const wait = BACKOFF[Math.min(payment.stripe.createTries - 1, BACKOFF.length - 1)] ?? BACKOFF[0];
    await ctx.scheduler.runAfter(wait, internal.financeStripe.createIntent, { paymentId: payment._id });
  },
});

/** Reads a card payment back from Stripe. */
export const syncPayment = internalAction({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    const found = await ctx.runQuery(internal.financeStripe.paymentFor, { paymentId: args.paymentId });
    const stripe = found?.payment.stripe;
    if (!found || !stripe) return;
    if (!stripe.paymentIntentId) {
      // Never created as far as Selestial knows: finish the creation with the same request key.
      if (found.payment.status === "checking") await ctx.runAction(internal.financeStripe.createIntent, { paymentId: args.paymentId });
      return;
    }
    const answer = await retrievePaymentIntent(stripe.accountId, stripe.paymentIntentId);
    if (answer.kind === "ok") await ctx.runMutation(internal.financeStripe.paymentRead, { paymentId: args.paymentId, facts: paymentFacts(answer.data as RawPaymentIntent) });
    else await ctx.runMutation(internal.financeStripe.noteChecked, { paymentId: args.paymentId });
  },
});

export const noteChecked = internalMutation({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paymentId, { checkedAt: Date.now() });
  },
});

export const paymentRead = internalMutation({
  args: { paymentId: v.id("payments"), facts: paymentFactsValidator },
  handler: async (ctx, args) => applyPayment(ctx, args.paymentId, args.facts),
});

const EVENT_FOR: Partial<Record<Doc<"payments">["status"], string>> = { processing: "payment.processing", succeeded: "payment.succeeded", failed: "payment.failed" };

/** Writes what Stripe says about a payment. Stripe's current answer is the truth; a voided or refunded record keeps its history. */
async function applyPayment(ctx: MutationCtx, paymentId: Id<"payments">, facts: typeof paymentFactsValidator.type) {
  const payment = (await ctx.db.get(paymentId))!;
  if (!payment.stripe) return;
  const now = Date.now();
  // Once received, a payment is only changed by refunds and disputes, never moved back by a late event.
  const status = payment.status === "succeeded" ? "succeeded" : facts.status;
  const settled = status !== "awaiting_customer";
  await ctx.db.patch(payment._id, {
    status,
    method: facts.method,
    amountCents: status === "succeeded" && facts.receivedCents > 0 ? facts.receivedCents : payment.amountCents,
    problem: status === "failed" ? (facts.problem ?? "The payment was declined.") : undefined,
    stripe: { ...payment.stripe, feeCents: facts.feeCents ?? payment.stripe.feeCents, methodLabel: facts.methodLabel ?? payment.stripe.methodLabel, clientSecret: settled ? undefined : payment.stripe.clientSecret },
    succeededAt: status === "succeeded" ? (payment.succeededAt ?? now) : payment.succeededAt,
    checkedAt: now,
    updatedAt: now,
  });
  if (status !== payment.status && EVENT_FOR[status]) {
    await recordEvent(ctx, { companyId: payment.companyId, type: EVENT_FOR[status]!, actor: SYSTEM, subject: { table: "payments", id: payment._id }, data: { amountCents: payment.amountCents } });
  }
  const before = (await ctx.db.get(payment.invoiceId))!;
  const after = await recompute(ctx, payment.invoiceId);
  if (before.status !== "paid" && after.status === "paid") {
    await recordEvent(ctx, { companyId: payment.companyId, type: "invoice.paid", actor: SYSTEM, subject: { table: "invoices", id: after._id }, data: { amountCents: after.totals.totalCents } });
    await cancelStartedPayments(ctx, after._id, payment._id);
  }
}

/** Stops a payment the customer started and did not finish. If it already went through, reads it instead. */
export const cancelStarted = internalAction({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    const found = await ctx.runQuery(internal.financeStripe.paymentFor, { paymentId: args.paymentId });
    const stripe = found?.payment.stripe;
    if (!found || !stripe) return;
    if (!stripe.paymentIntentId) {
      await ctx.runMutation(internal.financeStripe.markCanceled, { paymentId: args.paymentId });
      return;
    }
    const answer = await cancelPaymentIntent(stripe.accountId, stripe.paymentIntentId, found.payment._id);
    if (answer.kind === "ok") await ctx.runMutation(internal.financeStripe.paymentRead, { paymentId: args.paymentId, facts: paymentFacts(answer.data) });
    else await ctx.runAction(internal.financeStripe.syncPayment, { paymentId: args.paymentId });
  },
});

export const markCanceled = internalMutation({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    const payment = (await ctx.db.get(args.paymentId))!;
    if (payment.status !== "awaiting_customer") return;
    await ctx.db.patch(payment._id, { status: "canceled", updatedAt: Date.now(), stripe: payment.stripe ? { ...payment.stripe, clientSecret: undefined } : undefined });
  },
});

// ── Refunds ──────────────────────────────────────────────────────────────────────────────────────

export const refundFor = internalQuery({
  args: { refundId: v.id("refunds") },
  handler: async (ctx, args) => {
    const refund = await ctx.db.get(args.refundId);
    const payment = refund ? await ctx.db.get(refund.paymentId) : null;
    return refund && payment ? { refund, payment } : null;
  },
});

/** Sends a confirmed refund to Stripe, under the refund's own request key on every try. */
export const sendRefund = internalAction({
  args: { refundId: v.id("refunds") },
  handler: async (ctx, args) => {
    const found = await ctx.runQuery(internal.financeStripe.refundFor, { refundId: args.refundId });
    const stripe = found?.payment.stripe;
    if (!found || !stripe?.paymentIntentId || found.refund.stripeRefundId) return;
    if (!["sending", "checking"].includes(found.refund.status)) return;
    if (Date.now() - found.refund.createdAt > REPLAY_WINDOW) {
      const list = await listRefunds(stripe.accountId, stripe.paymentIntentId);
      if (list.kind === "ok") {
        const match = list.data.data.find((r) => r.metadata?.selestial_refund === found.refund._id);
        if (match) await ctx.runMutation(internal.financeStripe.refundRead, { refundId: args.refundId, stripeRefundId: match.id, facts: refundFacts(match) });
        else await ctx.runMutation(internal.financeStripe.refundRefused, { refundId: args.refundId, problem: "Stripe has no record of this refund, so no money was returned. Start it again if it's still needed." });
      }
      return;
    }
    await ctx.runMutation(internal.financeStripe.refundTry, { refundId: args.refundId });
    const answer = await createRefund({ accountId: stripe.accountId, paymentIntentId: stripe.paymentIntentId, refundId: found.refund._id, amountCents: found.refund.amountCents });
    if (answer.kind === "ok") await ctx.runMutation(internal.financeStripe.refundRead, { refundId: args.refundId, stripeRefundId: answer.data.id, facts: refundFacts(answer.data) });
    else if (answer.kind === "refused") await ctx.runMutation(internal.financeStripe.refundRefused, { refundId: args.refundId, problem: `Stripe didn't refund it: ${answer.message}` });
    else await ctx.runMutation(internal.financeStripe.refundUnclear, { refundId: args.refundId });
  },
});

export const refundTry = internalMutation({
  args: { refundId: v.id("refunds") },
  handler: async (ctx, args) => {
    const refund = (await ctx.db.get(args.refundId))!;
    await ctx.db.patch(refund._id, { tries: refund.tries + 1, updatedAt: Date.now() });
  },
});

export const refundRefused = internalMutation({
  args: { refundId: v.id("refunds"), problem: v.string() },
  handler: async (ctx, args) => {
    const refund = (await ctx.db.get(args.refundId))!;
    if (refund.status === "succeeded") return;
    await ctx.db.patch(refund._id, { status: "failed", problem: args.problem.slice(0, 300), updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: refund.companyId, type: "refund.failed", actor: SYSTEM, subject: { table: "refunds", id: refund._id }, data: { amountCents: refund.amountCents } });
  },
});

export const refundUnclear = internalMutation({
  args: { refundId: v.id("refunds") },
  handler: async (ctx, args) => {
    const refund = (await ctx.db.get(args.refundId))!;
    if (refund.stripeRefundId) return;
    await ctx.db.patch(refund._id, { status: "checking", problem: "Stripe didn't answer clearly. Selestial is checking before anything is tried again.", updatedAt: Date.now() });
    const wait = BACKOFF[Math.min(refund.tries - 1, BACKOFF.length - 1)] ?? BACKOFF[0];
    await ctx.scheduler.runAfter(wait, internal.financeStripe.sendRefund, { refundId: refund._id });
  },
});

const refundFactsValidator = v.object({ status: v.union(v.literal("pending"), v.literal("succeeded"), v.literal("failed"), v.literal("canceled")), problem: v.optional(v.string()) });

export const refundRead = internalMutation({
  args: { refundId: v.id("refunds"), stripeRefundId: v.string(), facts: refundFactsValidator },
  handler: async (ctx, args) => {
    const refund = (await ctx.db.get(args.refundId))!;
    if (refund.stripeRefundId && refund.stripeRefundId !== args.stripeRefundId) return;
    const now = Date.now();
    const wasDone = refund.status === "succeeded";
    // A refund that went through is only changed by Stripe reporting it failed afterwards (rare, bank-side).
    const status = args.facts.status;
    await ctx.db.patch(refund._id, { stripeRefundId: args.stripeRefundId, status, problem: args.facts.problem, settledAt: status === "succeeded" ? (refund.settledAt ?? now) : refund.settledAt, updatedAt: now });
    const payment = (await ctx.db.get(refund.paymentId))!;
    if (!wasDone && status === "succeeded") {
      await ctx.db.patch(payment._id, { refundedCents: payment.refundedCents + refund.amountCents, updatedAt: now });
      if (refund.alsoCredit) await addRefundCredit(ctx, refund._id);
      await recordEvent(ctx, { companyId: refund.companyId, type: "refund.succeeded", actor: SYSTEM, subject: { table: "refunds", id: refund._id }, data: { amountCents: refund.amountCents } });
    } else if (wasDone && status !== "succeeded") {
      await ctx.db.patch(payment._id, { refundedCents: Math.max(0, payment.refundedCents - refund.amountCents), updatedAt: now });
      await recordEvent(ctx, { companyId: refund.companyId, type: "refund.failed", actor: SYSTEM, subject: { table: "refunds", id: refund._id }, data: { amountCents: refund.amountCents } });
    } else if (status === "failed" && refund.status !== "failed") {
      await recordEvent(ctx, { companyId: refund.companyId, type: "refund.failed", actor: SYSTEM, subject: { table: "refunds", id: refund._id }, data: { amountCents: refund.amountCents } });
    }
    await recompute(ctx, refund.invoiceId);
  },
});

export const syncRefund = internalAction({
  args: { refundId: v.id("refunds") },
  handler: async (ctx, args) => {
    const found = await ctx.runQuery(internal.financeStripe.refundFor, { refundId: args.refundId });
    const stripe = found?.payment.stripe;
    if (!found || !stripe) return;
    if (!found.refund.stripeRefundId) {
      await ctx.runAction(internal.financeStripe.sendRefund, { refundId: args.refundId });
      return;
    }
    const answer = await retrieveRefund(stripe.accountId, found.refund.stripeRefundId);
    if (answer.kind === "ok") await ctx.runMutation(internal.financeStripe.refundRead, { refundId: args.refundId, stripeRefundId: answer.data.id, facts: refundFacts(answer.data) });
  },
});

// ── Webhooks ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A verified Connect event. Recorded once by its id, so a repeat changes nothing; then the object it
 * names is read back from Stripe. Events for accounts Selestial doesn't know are ignored.
 */
export const webhookReceived = internalMutation({
  args: {
    event: v.object({
      id: v.string(),
      type: v.string(),
      account: v.union(v.string(), v.null()),
      livemode: v.boolean(),
      objectId: v.union(v.string(), v.null()),
      objectType: v.union(v.string(), v.null()),
      paymentIntentId: v.union(v.string(), v.null()),
      disputeStatus: v.union(v.string(), v.null()),
      amount: v.union(v.number(), v.null()),
    }),
  },
  handler: async (ctx, { event }: { event: StripeEvent }) => {
    const seen = await ctx.db
      .query("providerReceipts")
      .withIndex("by_provider_event", (q) => q.eq("provider", "stripe").eq("eventId", event.id))
      .unique();
    if (seen) return { handled: false };
    await ctx.db.insert("providerReceipts", { provider: "stripe", eventId: event.id, receivedAt: Date.now() });
    if (!event.account) return { handled: false };
    const row = await ctx.db
      .query("stripeAccounts")
      .withIndex("by_account", (q) => q.eq("accountId", event.account!))
      .first();
    if (!row) return { handled: false };

    if (event.type === "account.updated") {
      await ctx.scheduler.runAfter(0, internal.financeStripe.syncAccount, { rowId: row._id });
      return { handled: true };
    }
    if (event.type === "account.application.deauthorized") {
      await ctx.scheduler.runAfter(0, internal.financeStripe.syncAccount, { rowId: row._id });
      return { handled: true };
    }

    const intentId = event.objectType === "payment_intent" ? event.objectId : event.paymentIntentId;
    const payment = intentId
      ? await ctx.db
          .query("payments")
          .withIndex("by_intent", (q) => q.eq("stripe.paymentIntentId", intentId))
          .first()
      : null;
    if (payment && payment.companyId !== row.companyId) return { handled: false };

    if (event.objectType === "dispute" && payment) {
      const now = Date.now();
      await ctx.db.patch(payment._id, { dispute: { status: event.disputeStatus ?? "needs_response", amountCents: event.amount ?? payment.amountCents, at: now }, updatedAt: now });
      if (event.type === "charge.dispute.created") await recordEvent(ctx, { companyId: payment.companyId, type: "payment.disputed", actor: SYSTEM, subject: { table: "payments", id: payment._id }, data: { amountCents: event.amount ?? payment.amountCents } });
      return { handled: true };
    }
    if (event.objectType === "refund" && event.objectId) {
      const refund = await ctx.db
        .query("refunds")
        .withIndex("by_stripe_refund", (q) => q.eq("stripeRefundId", event.objectId!))
        .first();
      if (refund && refund.companyId === row.companyId) await ctx.scheduler.runAfter(0, internal.financeStripe.syncRefund, { refundId: refund._id });
      return { handled: Boolean(refund) };
    }
    if (payment) {
      await ctx.scheduler.runAfter(0, internal.financeStripe.syncPayment, { paymentId: payment._id });
      if (event.type === "charge.refunded") {
        const refunds = await ctx.db
          .query("refunds")
          .withIndex("by_company_payment", (q) => q.eq("companyId", payment.companyId).eq("paymentId", payment._id))
          .take(50);
        for (const refund of refunds) if (refund.status !== "succeeded" && refund.status !== "recorded") await ctx.scheduler.runAfter(0, internal.financeStripe.syncRefund, { refundId: refund._id });
      }
      return { handled: true };
    }
    return { handled: false };
  },
});

// ── Keeping records true when a webhook is late or missing ───────────────────────────────────────

/** Every few minutes: read back anything still in flight, and stop payments customers abandoned. */
export const reconcile = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = async (status: Doc<"payments">["status"], olderThan: number, limit = 50) =>
      ctx.db
        .query("payments")
        .withIndex("by_status_updated", (q) => q.eq("status", status).lt("updatedAt", now - olderThan))
        .take(limit);
    for (const payment of await due("processing", 20 * MINUTE)) {
      if (!payment.checkedAt || now - payment.checkedAt > 20 * MINUTE) await ctx.scheduler.runAfter(0, internal.financeStripe.syncPayment, { paymentId: payment._id });
    }
    for (const payment of await due("checking", 30 * MINUTE)) await ctx.scheduler.runAfter(0, internal.financeStripe.syncPayment, { paymentId: payment._id });
    for (const payment of await due("awaiting_customer", 24 * 60 * MINUTE)) await ctx.scheduler.runAfter(0, internal.financeStripe.cancelStarted, { paymentId: payment._id });
    for (const status of ["pending", "checking", "sending"] as const) {
      const rows = await ctx.db
        .query("refunds")
        .withIndex("by_status_updated", (q) => q.eq("status", status).lt("updatedAt", now - 15 * MINUTE))
        .take(50);
      for (const refund of rows) await ctx.scheduler.runAfter(0, internal.financeStripe.syncRefund, { refundId: refund._id });
    }
  },
});
