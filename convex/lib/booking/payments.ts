/**
 * Taking a booking's payment through Finance (docs/finance/00-plan.md), never beside it.
 *
 * The booking becomes an ordinary Finance invoice for the customer: the engine's lines, the company's tax
 * rate, and a deposit when the policy asks for one. The payment is an ordinary `payments` row on the
 * company's own connected Stripe account, created with the payment's id as Stripe's idempotency key
 * (convex/financeStripe.ts). The amount is the server's: the page never names one. Whether money arrived
 * is only ever Stripe's answer, read by a verified webhook or by asking Stripe; a redirect or a query
 * parameter proves nothing. When Finance records a change, `bookingPaymentChanged` tells the booking.
 *
 * This is the company's customer money. Selestial's own subscription and credits are elsewhere and never
 * touch these rows.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { cancelStartedPayments } from "../../finance";
import { userError } from "../errors";
import { recordEvent } from "../events";
import { amountRequested } from "../finance/invoiceState";
import { recompute } from "../finance/ledger";
import { emptyTotals } from "../finance/ledger";
import { cleanLines } from "../finance/money";
import { newPublicId } from "../finance/payLinks";
import { invoiceNumber, settingsOf, settingsRow } from "../finance/settings";
import { stripeConfig } from "../finance/stripe";
import { currentStripeAccount } from "../finance/stripeState";
import type { InvoiceLine } from "../finance/schema";
import { allow } from "../rateLimit";
import { ensureCustomer, ensureProperty } from "./handoff";
import { funnel } from "./funnel";
import { load } from "./session";

const MIN_CARD_CENTS = 50;
const MINUTE = 60_000;

const KIND: Record<Doc<"bookingExperiences">["kind"], Doc<"customers">["kind"]> = { residential: "home", recurring: "home", campaign: "home", commercial: "commercial", short_term_rental: "short_term_rental" };

/** The engine's lines as invoice lines. A line that takes money off is a discount line, as Finance requires. */
export function invoiceLines(quote: NonNullable<Doc<"bookingSessions">["quote"]>, serviceName: string, taxable: boolean): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  let i = 0;
  for (const line of quote.lines) {
    if (line.kind === "billed_later" || line.amountCents === 0) continue;
    i += 1;
    const discount = line.amountCents < 0;
    const label = line.kind === "base" ? `${serviceName}${line.detail ? ` — ${line.detail}` : ""}` : line.label;
    lines.push({ id: `bk${i}`, kind: discount ? "discount" : line.kind === "add_on" ? "item" : "service", description: label.slice(0, 190), quantity: 1, unitCents: line.amountCents, amountCents: line.amountCents, taxable, ...(line.kind === "base" ? { serviceId: quote.serviceKey } : {}) });
  }
  return cleanLines(lines);
}

/**
 * Starts the customer's payment for exactly what they accepted. Everything else must already be done:
 * a firm, accepted price, a live hold on the time, a signed agreement when one is required, and (unless
 * the experience takes details after payment) every required detail.
 */
export async function startBookingPayment(ctx: MutationCtx, session: Doc<"bookingSessions">, clientKey: string): Promise<{ paymentId: Id<"payments"> } | { refused: string }> {
  if (!/^[\w-]{8,80}$/.test(clientKey)) throw userError("Reload the page and try again.");
  const repeat = await ctx.db
    .query("payments")
    .withIndex("by_company_clientKey", (q) => q.eq("companyId", session.companyId).eq("clientKey", clientKey))
    .unique();
  if (repeat) {
    if (repeat.invoiceId !== session.invoiceId) throw userError("Reload the page and try again.");
    return { paymentId: repeat._id };
  }
  if (!(await allow(ctx, `booking-pay:${session._id}`, 10, 15 * MINUTE))) return { refused: "Too many tries. Please wait a few minutes and try again." };
  if (session.test) throw userError("A test booking never takes a real payment.");
  const company = (await ctx.db.get(session.companyId))!;
  const L = await load(ctx, session, company);
  const quote = session.quote;
  if (!quote || quote.outcome !== "firm" || quote.grandTotalCents === null) throw userError("There's no firm price to pay yet.");
  if (!session.accepted || session.accepted.inputHash !== quote.inputHash || session.accepted.grandTotalCents !== quote.grandTotalCents) throw userError(`The price is now $${(quote.grandTotalCents / 100).toFixed(2)}. Please review it before paying.`);
  if (quote.dueNowCents < MIN_CARD_CENTS) throw userError("Nothing needs to be paid now.");
  if (session.capacityState !== "held") throw userError(session.capacityState === "expired" ? "The time you chose is no longer held. Please choose a time again." : "Choose a time first.");
  if (session.agreementState === "pending") throw userError("Please sign the agreement first.");
  if (L.def.behavior.detailsTiming === "before_payment" && session.answersState !== "complete") throw userError("Please finish the property details first.");
  if (!L.eligible.ok) throw userError(L.eligible.why ?? "This company isn't taking online bookings right now.");
  const config = stripeConfig();
  const account = await currentStripeAccount(ctx, company._id);
  if (!config || !account?.accountId || account.status !== "active" || account.livemode !== config.livemode || !config.publishableKey) throw userError(`${L.settings.profile.displayName || company.name} can't take card payments right now. Please contact them directly.`);

  const kind = KIND[L.experience.kind];
  const customerId = await ensureCustomer(ctx, session, kind);
  const propertyId = await ensureProperty(ctx, session, customerId, kind);
  const fresh = (await ctx.db.get(session._id))!;
  const now = Date.now();

  // The invoice: reused while it still says exactly this; otherwise a new one (the old one voided with a reason).
  let invoice = fresh.invoiceId ? await ctx.db.get(fresh.invoiceId) : null;
  const deposit = quote.dueNowCents < quote.grandTotalCents ? quote.dueNowCents : undefined;
  if (invoice && (invoice.status !== "open" || invoice.totals.totalCents !== quote.grandTotalCents || invoice.depositCents !== deposit)) {
    if (invoice.status === "open" && invoice.totals.paidCents === 0 && invoice.totals.processingCents === 0) {
      await cancelStartedPayments(ctx, invoice._id);
      await ctx.db.patch(invoice._id, { status: "void", voided: { at: now, reason: "The booking's price changed before payment." }, updatedAt: now });
    }
    invoice = null;
  }
  if (!invoice) {
    const row = L.offered.find((r) => r.service.key === quote.serviceKey)!;
    const fin = settingsOf(await settingsRow(ctx, company._id));
    const taxable = fin.taxableServiceIds.includes(quote.serviceKey) && (fin.taxRateBps ?? 0) > 0;
    const lines = invoiceLines(quote, row.spec.name, taxable);
    const finRow = await settingsRow(ctx, company._id);
    const number = invoiceNumber(fin);
    if (finRow) await ctx.db.patch(finRow._id, { nextInvoiceNumber: fin.nextInvoiceNumber + 1 });
    else await ctx.db.insert("financeSettings", { companyId: company._id, taxableServiceIds: [], paymentTermsDays: fin.paymentTermsDays, allowPartialPayments: fin.allowPartialPayments, nextInvoiceNumber: fin.nextInvoiceNumber + 1, invoicePrefix: fin.invoicePrefix, revision: 0, updatedAt: now });
    const invoiceId = await ctx.db.insert("invoices", {
      companyId: company._id,
      customerId,
      ...(propertyId ? { propertyId } : {}),
      number,
      status: "open",
      lines,
      taxRateBps: taxable ? (fin.taxRateBps ?? 0) : 0,
      ...(taxable ? { taxLabel: fin.taxLabel } : {}),
      totals: emptyTotals(),
      ...(deposit !== undefined ? { depositCents: deposit } : {}),
      dueAt: fresh.schedule?.startsAt ?? now,
      memo: `Online booking${fresh.schedule ? ` for ${new Intl.DateTimeFormat("en-US", { timeZone: company.timezone, month: "long", day: "numeric", year: "numeric" }).format(new Date(fresh.schedule.startsAt))}` : ""}.${quote.policy?.balanceTerms && deposit !== undefined ? ` ${quote.policy.balanceTerms}` : ""}`.slice(0, 500),
      revision: 1,
      publicId: newPublicId(),
      issuedAt: now,
      bookingSessionId: session._id,
      createdAt: now,
      updatedAt: now,
    });
    invoice = await recompute(ctx, invoiceId);
    // Never charge a different amount than the customer accepted.
    if (invoice.totals.totalCents !== quote.grandTotalCents || amountRequested(invoice) !== quote.dueNowCents) {
      await ctx.db.patch(invoiceId, { status: "void", voided: { at: now, reason: "The invoice didn't match the booking's accepted price." }, updatedAt: now });
      throw userError("The price couldn't be confirmed. Nothing was charged. Please reload and try again.");
    }
    await recordEvent(ctx, { companyId: company._id, type: "invoice.issued", actor: { kind: "system" }, subject: { table: "invoices", id: invoiceId }, data: { amountCents: invoice.totals.totalCents, number, depositCents: deposit ?? null, source: "booking" } });
    await ctx.db.patch(session._id, { invoiceId });
  }

  const paymentId = await ctx.db.insert("payments", {
    companyId: company._id,
    invoiceId: invoice._id,
    customerId,
    amountCents: quote.dueNowCents,
    method: "card",
    source: "stripe",
    status: "awaiting_customer",
    clientKey,
    stripe: { accountId: account.accountId, livemode: account.livemode, createTries: 0 },
    refundedCents: 0,
    createdAt: now,
    updatedAt: now,
  });
  await cancelStartedPayments(ctx, invoice._id, paymentId);
  await recordEvent(ctx, { companyId: company._id, type: "payment.started", actor: { kind: "system" }, subject: { table: "payments", id: paymentId }, data: { amountCents: quote.dueNowCents, source: "booking" } });
  // The time stays held while the customer is paying.
  const holdId = fresh.schedule?.holdId;
  if (holdId) {
    const hold = await ctx.db.get(holdId);
    if (hold && hold.status === "held") await ctx.db.patch(holdId, { expiresAt: Math.max(hold.expiresAt, now + 20 * MINUTE), updatedAt: now });
  }
  await ctx.db.patch(session._id, { paymentId, paymentState: "started", updatedAt: now });
  await funnel(ctx, (await ctx.db.get(session._id))!, "payment_started", { amountCents: quote.dueNowCents });
  await ctx.scheduler.runAfter(0, internal.financeStripe.createIntent, { paymentId });
  return { paymentId };
}

/**
 * Finance recorded a change to a payment on a booking's invoice. The booking follows the money: a
 * succeeded payment is finalized (in its own step, so this never slows the payment record down).
 */
export async function bookingPaymentChanged(ctx: MutationCtx, payment: Doc<"payments">): Promise<void> {
  const invoice = await ctx.db.get(payment.invoiceId);
  if (!invoice?.bookingSessionId) return;
  const session = await ctx.db.get(invoice.bookingSessionId);
  if (!session || session.companyId !== payment.companyId) return;
  const now = Date.now();
  if (payment.status === "succeeded") {
    if (session.paymentState !== "succeeded") {
      await ctx.db.patch(session._id, { paymentState: "succeeded", paymentId: payment._id, updatedAt: now });
      await funnel(ctx, (await ctx.db.get(session._id))!, "payment_verified", { amountCents: payment.amountCents });
      await recordEvent(ctx, { companyId: session.companyId, type: "booking.payment_received", actor: { kind: "system" }, subject: { table: "bookingSessions", id: session._id }, data: { amountCents: payment.amountCents } });
    }
    await ctx.scheduler.runAfter(0, internal.bookingOps.finalize, { sessionId: session._id });
  } else if (session.paymentId === payment._id && session.status === "active") {
    const state = payment.status === "processing" ? "processing" : payment.status === "failed" || payment.status === "canceled" ? "failed" : session.paymentState;
    if (state !== session.paymentState) await ctx.db.patch(session._id, { paymentState: state, updatedAt: now });
  }
}
