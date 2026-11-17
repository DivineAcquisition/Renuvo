/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, dispatchJob, dispatchPlace, NOW, refusal, start, type T } from "../tests/harness";
import { fakeStripe } from "../tests/fakeStripe";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";
import { amountRequested, invoiceState } from "./lib/finance/invoiceState";
import { cleanLines, lineAmount, linesTotal, taxOn } from "./lib/finance/money";
import { payToken } from "./lib/finance/payLinks";
import { setStripeTransportForTests, signForTests } from "./lib/finance/stripe";

const SECRET = "test-only-secret-for-action-links-0123456789";
const WEBHOOK_SECRET = "whsec_test_only_secret";
const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);
/** Runs only what is already due now, not the retries it schedules for later. */
const runDue = async (t: T) => {
  vi.runOnlyPendingTimers();
  await t.finishInProgressScheduledFunctions();
};
const key = (n: number | string) => `client-key-${n}-0000`;

let stripe = fakeStripe();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  stripe = fakeStripe();
  setStripeTransportForTests(stripe.fetch);
  process.env.ACTION_LINK_SECRET = SECRET;
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_fake";
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.APP_ORIGIN = "https://app.selestial.test";
  process.env.LINK_ORIGIN = "https://link.selestial.test";
});
afterEach(() => {
  vi.useRealTimers();
  setStripeTransportForTests(null);
  for (const name of ["ACTION_LINK_SECRET", "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_CONNECT_WEBHOOK_SECRET", "APP_ORIGIN", "LINK_ORIGIN"]) delete process.env[name];
});

async function setup() {
  const t = start();
  const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
  const place = await dispatchPlace(as, companyId);
  const jobId = await dispatchJob(as, companyId, place, { priceCents: 24000 });
  // The visit happened: completed jobs are what invoices start from.
  await t.run(async (ctx) => ctx.db.patch(jobId, { status: "completed" }));
  return { t, as, companyId, place, jobId };
}

async function issued(s: Awaited<ReturnType<typeof setup>>, options: { depositCents?: number } = {}) {
  const { invoiceId } = await s.as.mutation(api.finance.createInvoice, { companyId: s.companyId, jobId: s.jobId });
  let detail = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId });
  if (options.depositCents) {
    await s.as.mutation(api.finance.saveDraft, { companyId: s.companyId, invoiceId, revision: detail.revision, lines: detail.lines, depositCents: options.depositCents, memo: null });
    detail = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId });
  }
  await s.as.mutation(api.finance.issueInvoice, { companyId: s.companyId, invoiceId, revision: detail.revision, dueDate: null });
  return invoiceId;
}

async function tokenOf(t: T, invoiceId: Id<"invoices">) {
  const invoice = await t.run(async (ctx) => ctx.db.get(invoiceId));
  return (await payToken(invoice!))!;
}

/** Connects the company's Stripe account and lets Stripe finish onboarding it. */
async function connectStripe(s: Awaited<ReturnType<typeof setup>>) {
  await s.as.mutation(api.financeStripe.connect, { companyId: s.companyId });
  await settle(s.t);
  const accountId = [...stripe.state.accounts.keys()][0];
  stripe.activate(accountId);
  await s.as.mutation(api.financeStripe.refreshAccount, { companyId: s.companyId });
  await settle(s.t);
  return accountId;
}

async function webhook(t: T, event: Record<string, unknown>) {
  const body = JSON.stringify(event);
  const signature = await signForTests(WEBHOOK_SECRET, body, Math.floor(Date.now() / 1000));
  return t.fetch("/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signature, "content-type": "application/json" }, body });
}

describe("invoice arithmetic", () => {
  it("rounds each line once, taxes only taxable lines after taxable discounts, and keeps discounts negative", () => {
    expect(lineAmount(2.5, 1999)).toBe(4998);
    expect(lineAmount(0.1, 3)).toBe(0);
    const lines = cleanLines([
      { id: "a", kind: "service", description: "Deep clean", quantity: 1, unitCents: 30000, amountCents: 0, taxable: true },
      { id: "b", kind: "item", description: "Oven add-on", quantity: 1, unitCents: 4500, amountCents: 0, taxable: false },
      { id: "c", kind: "discount", description: "First visit", quantity: 1, unitCents: -3000, amountCents: 0, taxable: true },
    ]);
    expect(taxOn(lines, 825)).toBe(2228); // 8.25% of $270.00 = $22.275 → $22.28
    expect(linesTotal(lines, 825)).toEqual({ subtotalCents: 34500, discountCents: 3000, taxCents: 2228, totalCents: 33728 });
    expect(() => cleanLines([{ id: "x", kind: "service", description: "Bad", quantity: 1, unitCents: -5, amountCents: 0, taxable: false }])).toThrow();
    expect(() => cleanLines([{ id: "x", kind: "service", description: "Bad", quantity: 1.234, unitCents: 5, amountCents: 0, taxable: false }])).toThrow();
  });
});

describe("Finance access", () => {
  it("is the Owner's alone, and one company's invoices are not found from another", async () => {
    const s = await setup();
    const manager = await addMember(s.t, s.as, s.companyId, "manager-a", "manager");
    expect(await refusal(manager.query(api.finance.overview, { companyId: s.companyId, period: "this_month" }))).toBe(NOT_ALLOWED);
    expect(await refusal(manager.mutation(api.finance.createInvoice, { companyId: s.companyId, jobId: s.jobId }))).toBe(NOT_ALLOWED);

    const invoiceId = await issued(s);
    const other = await company(s.t, "owner-b", "Beta Cleaning");
    expect(await refusal(other.as.query(api.finance.invoice, { companyId: other.companyId, invoiceId }))).toBe(NOT_FOUND);
    expect(await refusal(other.as.mutation(api.finance.recordPayment, { companyId: other.companyId, invoiceId, amountCents: 100, method: "cash", receivedOn: "2027-03-01", reference: null, note: null, confirmedReceived: true, clientKey: key(1) }))).toBe(NOT_FOUND);
  });
});

describe("an invoice from a completed visit, paid in part by hand", () => {
  it("starts as a draft from the visit, issues with a number and a pay link, and tracks a partial payment exactly", async () => {
    const s = await setup();
    const { invoiceId } = await s.as.mutation(api.finance.createInvoice, { companyId: s.companyId, jobId: s.jobId });
    // Asking again opens the same draft: one invoice per visit.
    expect((await s.as.mutation(api.finance.createInvoice, { companyId: s.companyId, jobId: s.jobId })).invoiceId).toBe(invoiceId);
    const draft = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId });
    expect(draft.state).toBe("draft");
    expect(draft.totals.totalCents).toBe(24000);
    expect(draft.payLink).toBeNull();

    // The customer has seen nothing yet; the overview still shows the completed visit as invoiced (a draft exists).
    await s.as.mutation(api.finance.issueInvoice, { companyId: s.companyId, invoiceId, revision: draft.revision, dueDate: null });
    const open = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId });
    expect(open.number).toBe("INV-1001");
    expect(open.state).toBe("requested");
    expect(open.payLink).toMatch(/^https:\/\/link\.selestial\.test\/c\/pay\/[\w-]+\.[\w-]+$/);
    // Issued lines are frozen.
    expect(await refusal(s.as.mutation(api.finance.saveDraft, { companyId: s.companyId, invoiceId, revision: open.revision, lines: open.lines, depositCents: null, memo: null }))).toMatch(/already issued/);

    const record = (amountCents: number, n: number) =>
      s.as.mutation(api.finance.recordPayment, { companyId: s.companyId, invoiceId, amountCents, method: "check", receivedOn: "2027-03-01", reference: "#1042", note: null, confirmedReceived: true, clientKey: key(n) });
    expect(await refusal(s.as.mutation(api.finance.recordPayment, { companyId: s.companyId, invoiceId, amountCents: 1000, method: "cash", receivedOn: "2027-03-01", reference: null, note: null, confirmedReceived: false, clientKey: key(9) }))).toMatch(/Confirm/);
    expect(await refusal(record(25000, 1))).toMatch(/more than the \$240\.00/);
    const first = await record(10000, 2);
    // The same click sent twice records one payment.
    expect((await record(10000, 2)).paymentId).toBe(first.paymentId);
    const partial = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId });
    expect(partial.state).toBe("partially_paid");
    expect(partial.totals).toMatchObject({ paidCents: 10000, balanceCents: 14000 });

    // A mistake is corrected with a reason and stays in the history.
    const preview = await s.as.query(api.finance.voidPaymentPreview, { companyId: s.companyId, paymentId: first.paymentId });
    expect(preview.blocked).toBeNull();
    await s.as.mutation(api.finance.voidPayment, { companyId: s.companyId, paymentId: first.paymentId, reason: "Entered on the wrong invoice", bindsTo: preview.bindsTo });
    const corrected = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId });
    expect(corrected.totals.balanceCents).toBe(24000);
    expect(corrected.payments[0]).toMatchObject({ status: "voided", voided: { reason: "Entered on the wrong invoice" } });

    await record(24000, 3);
    const paid = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId });
    expect(paid.state).toBe("paid");
    expect(paid.timeline.map((row) => row.title)).toEqual(expect.arrayContaining(["Invoice issued", "Payment recorded", "Recorded payment voided", "Invoice paid in full"]));
  });

  it("refuses a confirmation made against details that have since changed", async () => {
    const s = await setup();
    const invoiceId = await issued(s);
    const preview = await s.as.query(api.finance.creditPreview, { companyId: s.companyId, invoiceId, amountCents: 2000 });
    // Money arrives between the review and the confirmation.
    await s.as.mutation(api.finance.recordPayment, { companyId: s.companyId, invoiceId, amountCents: 23000, method: "cash", receivedOn: "2027-03-01", reference: null, note: null, confirmedReceived: true, clientKey: key(4) });
    expect(await refusal(s.as.mutation(api.finance.addCredit, { companyId: s.companyId, invoiceId, amountCents: 2000, reason: "Late arrival", bindsTo: preview.bindsTo }))).toMatch(/Something changed/);
    const again = await s.as.query(api.finance.creditPreview, { companyId: s.companyId, invoiceId, amountCents: 2000 });
    expect(again.blocked).toMatch(/up to the \$10\.00/);
    const fits = await s.as.query(api.finance.creditPreview, { companyId: s.companyId, invoiceId, amountCents: 1000 });
    await s.as.mutation(api.finance.addCredit, { companyId: s.companyId, invoiceId, amountCents: 1000, reason: "Late arrival", bindsTo: fits.bindsTo });
    expect((await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId })).state).toBe("paid");
  });

  it("won't void an invoice with money on it, and closes the pay link when voided", async () => {
    const s = await setup();
    const invoiceId = await issued(s);
    const token = await tokenOf(s.t, invoiceId);
    const { paymentId } = await s.as.mutation(api.finance.recordPayment, { companyId: s.companyId, invoiceId, amountCents: 5000, method: "cash", receivedOn: "2027-03-01", reference: null, note: null, confirmedReceived: true, clientKey: key(5) });
    expect((await s.as.query(api.finance.voidPreview, { companyId: s.companyId, invoiceId })).blocked).toMatch(/Refund it first/);
    const refund = await s.as.query(api.finance.refundPreview, { companyId: s.companyId, paymentId, amountCents: 5000, alsoCredit: false });
    await s.as.mutation(api.finance.requestRefund, { companyId: s.companyId, paymentId, amountCents: 5000, reason: "Customer cancelled", alsoCredit: false, bindsTo: refund.bindsTo, clientKey: key(6), confirmedReturned: true });
    const preview = await s.as.query(api.finance.voidPreview, { companyId: s.companyId, invoiceId });
    expect(preview.blocked).toBeNull();
    await s.as.mutation(api.finance.voidInvoice, { companyId: s.companyId, invoiceId, reason: "Customer cancelled", bindsTo: preview.bindsTo });
    const page = await s.t.query(api.pay.view, { token });
    expect(page?.voided).toBe(true);
    expect(page?.canPayByCard).toBe(false);
    expect(await refusal(s.t.mutation(api.pay.start, { token, amountCents: 24000, clientKey: key(7) }))).toMatch(/no longer open/);
  });
});

describe("a deposit, then the balance", () => {
  it("asks for the deposit first and the rest only once the balance is requested", async () => {
    const s = await setup();
    const invoiceId = await issued(s, { depositCents: 8000 });
    let detail = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId });
    expect(detail.state).toBe("deposit_requested");
    expect(detail.requestedCents).toBe(8000);
    await s.as.mutation(api.finance.recordPayment, { companyId: s.companyId, invoiceId, amountCents: 8000, method: "zelle", receivedOn: "2027-03-01", reference: null, note: null, confirmedReceived: true, clientKey: key(8) });
    detail = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId });
    expect(detail.state).toBe("deposit_paid");
    expect(detail.requestedCents).toBe(0);
    const overview = await s.as.query(api.finance.overview, { companyId: s.companyId, period: "this_month" });
    expect(overview.findings.map((f) => f.id)).toContain("balance");
    await s.as.mutation(api.finance.requestBalance, { companyId: s.companyId, invoiceId, dueDate: "2027-03-10" });
    detail = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId });
    expect(detail.state).toBe("partially_paid");
    expect(detail.requestedCents).toBe(16000);
    expect(detail.dueDate).toBe("2027-03-10");
  });
});

describe("paying by card on the pay page", () => {
  it("records the payment only when Stripe says it was received, and counts a repeated notification once", async () => {
    const s = await setup();
    const accountId = await connectStripe(s);
    const invoiceId = await issued(s);
    const token = await tokenOf(s.t, invoiceId);
    const page = await s.t.query(api.pay.view, { token });
    expect(page).toMatchObject({ company: "Alpha Cleaning", number: "INV-1001", requestedCents: 24000, canPayByCard: true });
    expect(await s.t.query(api.pay.view, { token: `${token}x` })).toBeNull();

    const { paymentId } = await s.t.mutation(api.pay.start, { token, amountCents: 24000, clientKey: key(10) });
    await settle(s.t);
    const attempt = await s.t.query(api.pay.attempt, { token, paymentId: paymentId! });
    expect(attempt).toMatchObject({ status: "awaiting_customer", accountId, publishableKey: "pk_test_fake" });
    expect(attempt?.clientSecret).toMatch(/_secret_/);
    const [intent] = stripe.intentsFor(paymentId!);
    expect(intent).toMatchObject({ account: accountId, amount: 24000 });

    // Bank payment clearing: processing first, never counted as paid.
    stripe.settle(intent.id, "processing");
    await webhook(s.t, { id: "evt_1", type: "payment_intent.processing", account: accountId, livemode: false, data: { object: { id: intent.id, object: "payment_intent" } } });
    await settle(s.t);
    let detail = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId });
    expect(detail.state).toBe("processing");
    expect(detail.totals).toMatchObject({ paidCents: 0, processingCents: 24000 });

    stripe.settle(intent.id, "succeeded", 726);
    const event = { id: "evt_2", type: "payment_intent.succeeded", account: accountId, livemode: false, data: { object: { id: intent.id, object: "payment_intent" } } };
    expect((await webhook(s.t, event)).status).toBe(200);
    await webhook(s.t, event);
    await settle(s.t);
    detail = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId });
    expect(detail.state).toBe("paid");
    expect(detail.totals.paidCents).toBe(24000);
    expect(detail.payments).toHaveLength(1);
    expect(detail.payments[0]).toMatchObject({ status: "succeeded", methodWords: "Visa ending 4242", feeCents: 726 });
    // The secret is gone once the payment settled.
    expect((await s.t.query(api.pay.attempt, { token, paymentId: paymentId! }))?.clientSecret).toBeNull();

    // An unsigned or stale notification changes nothing.
    const forged = await s.t.fetch("/webhooks/stripe", { method: "POST", headers: { "stripe-signature": "t=1,v1=00" }, body: JSON.stringify(event) });
    expect(forged.status).toBe(401);
  });

  it("finds out what happened after Stripe's answer is lost, and never creates the payment twice", async () => {
    const s = await setup();
    await connectStripe(s);
    const invoiceId = await issued(s);
    const token = await tokenOf(s.t, invoiceId);
    // Stripe makes the payment, then the connection drops before Selestial hears back.
    stripe.state.losses.push({ path: /^POST \/v1\/payment_intents$/, when: "after" });
    const { paymentId } = await s.t.mutation(api.pay.start, { token, amountCents: 24000, clientKey: key(11) });
    await runDue(s.t);
    const checking = await s.t.run(async (ctx) => ctx.db.get(paymentId!));
    expect(checking?.status).toBe("checking");
    expect((await s.t.query(api.pay.attempt, { token, paymentId: paymentId! }))?.clientSecret).toBeNull();
    await settle(s.t);
    // Asked again with the same request key: Stripe replayed its answer, so there is still one payment.
    const creates = stripe.state.calls.filter((c) => c.method === "POST" && c.path === "/v1/payment_intents");
    expect(creates.length).toBe(2);
    expect(new Set(creates.map((c) => c.key)).size).toBe(1);
    expect(stripe.intentsFor(paymentId!)).toHaveLength(1);
    expect((await s.t.query(api.pay.attempt, { token, paymentId: paymentId! }))?.status).toBe("awaiting_customer");
  });

  it("stops an unfinished payment when the invoice is paid another way", async () => {
    const s = await setup();
    await connectStripe(s);
    const invoiceId = await issued(s);
    const token = await tokenOf(s.t, invoiceId);
    const { paymentId } = await s.t.mutation(api.pay.start, { token, amountCents: 24000, clientKey: key(12) });
    await settle(s.t);
    await s.as.mutation(api.finance.recordPayment, { companyId: s.companyId, invoiceId, amountCents: 24000, method: "cash", receivedOn: "2027-03-01", reference: null, note: null, confirmedReceived: true, clientKey: key(13) });
    await settle(s.t);
    expect(stripe.intentsFor(paymentId!)[0].status).toBe("canceled");
    expect((await s.t.run(async (ctx) => ctx.db.get(paymentId!)))?.status).toBe("canceled");
  });

  it("reports a declined card as failed, keeps the invoice open, and lists it for the Owner", async () => {
    const s = await setup();
    const accountId = await connectStripe(s);
    const invoiceId = await issued(s);
    const token = await tokenOf(s.t, invoiceId);
    const { paymentId } = await s.t.mutation(api.pay.start, { token, amountCents: 24000, clientKey: key(14) });
    await settle(s.t);
    const [intent] = stripe.intentsFor(paymentId!);
    stripe.settle(intent.id, "declined");
    await webhook(s.t, { id: "evt_9", type: "payment_intent.payment_failed", account: accountId, livemode: false, data: { object: { id: intent.id, object: "payment_intent" } } });
    await settle(s.t);
    const detail = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId });
    expect(detail.state).toBe("requested");
    expect(detail.payments[0]).toMatchObject({ status: "failed", problem: "Your card was declined." });
    const overview = await s.as.query(api.finance.overview, { companyId: s.companyId, period: "this_month" });
    expect(overview.findings.find((f) => f.id === "failed")?.records).toHaveLength(1);
  });
});

describe("refunds through Stripe", () => {
  async function paidByCard() {
    const s = await setup();
    const accountId = await connectStripe(s);
    const invoiceId = await issued(s);
    const token = await tokenOf(s.t, invoiceId);
    const { paymentId } = await s.t.mutation(api.pay.start, { token, amountCents: 24000, clientKey: key(20) });
    await settle(s.t);
    stripe.settle(stripe.intentsFor(paymentId!)[0].id, "succeeded");
    await s.t.mutation(api.pay.returned, { token, paymentId: paymentId! });
    await settle(s.t);
    return { ...s, accountId, invoiceId, paymentId: paymentId! };
  }

  it("refunds with a credit so the customer owes nothing, after an uncertain first answer, exactly once", async () => {
    const s = await paidByCard();
    const preview = await s.as.query(api.finance.refundPreview, { companyId: s.companyId, paymentId: s.paymentId, amountCents: 4000, alsoCredit: true });
    expect(preview.blocked).toBeNull();
    expect(preview.lines[0]).toMatch(/Stripe returns \$40\.00 to Dana Whitfield's Visa ending 4242/);
    stripe.state.losses.push({ path: /^POST \/v1\/refunds$/, when: "after" });
    const { refundId } = await s.as.mutation(api.finance.requestRefund, { companyId: s.companyId, paymentId: s.paymentId, amountCents: 4000, reason: "Missed the oven", alsoCredit: true, bindsTo: preview.bindsTo, clientKey: key(21) });
    await runDue(s.t);
    expect((await s.t.run(async (ctx) => ctx.db.get(refundId)))?.status).toBe("checking");
    // Nothing is counted while it's unclear.
    expect((await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId: s.invoiceId })).totals.refundedCents).toBe(0);
    await settle(s.t);
    expect(stripe.state.refunds.size).toBe(1);
    const detail = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId: s.invoiceId });
    expect(detail.totals).toMatchObject({ refundedCents: 4000, creditedCents: 4000, balanceCents: 0 });
    expect(detail.state).toBe("paid");
    expect(detail.payments[0].refundableCents).toBe(20000);
    const statement = await s.as.query(api.finance.statement, { companyId: s.companyId, customerId: detail.customer.id });
    expect(statement.balanceCents).toBe(0);
    expect(statement.lines.map((l) => l.kind)).toEqual(["refund", "credit", "payment", "charge"]);
  });

  it("can't refund more than was received, or a refund twice from one click", async () => {
    const s = await paidByCard();
    const over = await s.as.query(api.finance.refundPreview, { companyId: s.companyId, paymentId: s.paymentId, amountCents: 30000, alsoCredit: false });
    expect(over.blocked).toMatch(/Up to \$240\.00/);
    const preview = await s.as.query(api.finance.refundPreview, { companyId: s.companyId, paymentId: s.paymentId, amountCents: 24000, alsoCredit: false });
    const one = await s.as.mutation(api.finance.requestRefund, { companyId: s.companyId, paymentId: s.paymentId, amountCents: 24000, reason: "Duplicate booking", alsoCredit: false, bindsTo: preview.bindsTo, clientKey: key(22) });
    const two = await s.as.mutation(api.finance.requestRefund, { companyId: s.companyId, paymentId: s.paymentId, amountCents: 24000, reason: "Duplicate booking", alsoCredit: false, bindsTo: preview.bindsTo, clientKey: key(22) });
    expect(two.refundId).toBe(one.refundId);
    await settle(s.t);
    // Without a credit, the customer owes the amount again.
    const detail = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId: s.invoiceId });
    expect(detail.state).toBe("requested");
    expect(detail.totals.balanceCents).toBe(24000);
  });
});

describe("connecting Stripe", () => {
  it("makes one account however many times setup is started, and says when Selestial's own Stripe isn't configured", async () => {
    const s = await setup();
    stripe.state.losses.push({ path: /^POST \/v1\/accounts$/, when: "after" });
    await s.as.mutation(api.financeStripe.connect, { companyId: s.companyId });
    await settle(s.t);
    let status = await s.as.query(api.finance.settings, { companyId: s.companyId });
    expect(status.stripe.onboarding?.state).toBe("failed");
    await s.as.mutation(api.financeStripe.connect, { companyId: s.companyId });
    await settle(s.t);
    status = await s.as.query(api.finance.settings, { companyId: s.companyId });
    expect(status.stripe.state).toBe("onboarding");
    expect(status.stripe.onboarding?.url).toMatch(/^https:\/\/connect\.stripe\.com\//);
    expect(stripe.state.accounts.size).toBe(1);

    delete process.env.STRIPE_SECRET_KEY;
    expect((await s.as.query(api.finance.settings, { companyId: s.companyId })).stripe.state).toBe("not_available");
    expect(await refusal(s.as.mutation(api.financeStripe.connect, { companyId: s.companyId }))).toMatch(/aren't available/);
  });
});

describe("the overview", () => {
  it("counts only money that arrived, keeps outstanding apart, and points at visits not invoiced", async () => {
    const s = await setup();
    let overview = await s.as.query(api.finance.overview, { companyId: s.companyId, period: "this_month" });
    expect(overview.findings.find((f) => f.id === "uninvoiced")?.records).toHaveLength(1);
    const invoiceId = await issued(s);
    await s.as.mutation(api.finance.recordPayment, { companyId: s.companyId, invoiceId, amountCents: 9000, method: "cash", receivedOn: "2027-03-01", reference: null, note: null, confirmedReceived: true, clientKey: key(30) });
    overview = await s.as.query(api.finance.overview, { companyId: s.companyId, period: "this_month" });
    expect(overview.metrics.collected.cents).toBe(9000);
    expect(overview.metrics.outstanding.cents).toBe(15000);
    expect(overview.metrics.invoiced.cents).toBe(24000);
    expect(overview.findings.find((f) => f.id === "uninvoiced")).toBeUndefined();
    expect(overview.trend).toHaveLength(8);
    expect(overview.trend.at(-1)?.collectedCents).toBe(9000);

    // A week later, past the 7-day terms, the same invoice is overdue.
    vi.setSystemTime(NOW + 9 * 86_400_000);
    overview = await s.as.query(api.finance.overview, { companyId: s.companyId, period: "this_month" });
    expect(overview.metrics.overdue).toEqual({ cents: 15000, count: 1 });
    const invoice = await s.t.run(async (ctx) => ctx.db.get(invoiceId));
    expect(invoiceState(invoice!, Date.now())).toBe("overdue");
    expect(amountRequested(invoice!)).toBe(15000);
  });
});

void internal;

describe("services from the Services & Pricing catalog", () => {
  it("lists the catalog's published services once the company moved to it, and taxes a visit made from one", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await t.run(async (ctx) => {
      const base = { companyId, category: "residential" as const, latestVersion: 1, origin: "manual" as const, createdBy: { kind: "system" as const }, createdAt: NOW, updatedAt: NOW };
      await ctx.db.insert("services", { ...base, key: "deep-clean", name: "Deep clean", status: "active", publishedVersion: 1, publishedAt: NOW });
      await ctx.db.insert("services", { ...base, key: "never-published", name: "Draft idea", status: "draft" });
      await ctx.db.insert("services", { ...base, key: "old", name: "Old service", status: "archived", publishedVersion: 1, publishedAt: NOW });
      await ctx.db.patch(companyId, { servicesMigratedAt: NOW });
    });
    const settings = await as.query(api.finance.settings, { companyId });
    expect(settings.services).toEqual([{ id: "deep-clean", name: "Deep clean" }]);
    await as.mutation(api.finance.saveSettings, { companyId, revision: settings.settings.revision, taxRateBps: 825, taxLabel: "Sales tax", taxableServiceIds: ["deep-clean", "old"], paymentTermsDays: 7, allowPartialPayments: false, invoiceNote: null, invoicePrefix: "INV" });
    expect((await as.query(api.finance.settings, { companyId })).settings.taxableServiceIds).toEqual(["deep-clean"]);
    const place = await dispatchPlace(as, companyId);
    const jobId = await dispatchJob(as, companyId, place, { priceCents: 20000 });
    await t.run(async (ctx) => ctx.db.patch(jobId, { status: "completed", serviceSnapshot: { serviceId: "deep-clean", name: "Deep clean", scope: "x", durationMinutes: 180, defaultCrew: 1, skills: [], capturedAt: NOW } }));
    const { invoiceId } = await as.mutation(api.finance.createInvoice, { companyId, jobId });
    const invoice = await t.run(async (ctx) => ctx.db.get(invoiceId));
    expect(invoice!.lines[0]).toMatchObject({ taxable: true, serviceId: "deep-clean" });
    expect(invoice!.totals.taxCents).toBe(1650);
  });
});
