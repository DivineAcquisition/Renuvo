/**
 * Company → Finance: invoices, payments, credits and refunds, and the overview that reads them
 * (docs/finance/00-plan.md). The Owner only (navigation.ts; the owner's decision of November 15, 2026),
 * and each call also names the finance capability it uses (convex/lib/finance/authority.ts).
 *
 * Stripe calls happen in convex/financeStripe.ts; this file only records what a person decided and
 * schedules the call, so a page always shows the true state of the call while it runs.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { ownerMutation, ownerQuery, type MemberAccess } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { requireFinance } from "./lib/finance/authority";
import { bindsTo, requireSame } from "./lib/finance/confirm";
import { findings } from "./lib/finance/findings";
import { amountRequested, depositOutstanding, inDepositStage, invoiceState, STATE_WORDS } from "./lib/finance/invoiceState";
import { emptyTotals, invoiceRows, recompute, REFUND_COUNTS, REFUND_IN_FLIGHT } from "./lib/finance/ledger";
import { cleanLines, dollars, LIMITS, linesTotal, percentLabel } from "./lib/finance/money";
import { newPublicId, payLinksConfigured, payToken, payUrl } from "./lib/finance/payLinks";
import { invoiceLineValidator, MANUAL_METHODS, paymentMethodValidator, type InvoiceLine, type PaymentMethod } from "./lib/finance/schema";
import { dueAfterDays, endOfLocalDate, invoiceNumber, localDateKey, settingsOf, settingsRow } from "./lib/finance/settings";
import { stripeConfig } from "./lib/finance/stripe";
import { stripeState } from "./lib/finance/stripeState";
import { businessSettingsOf } from "./lib/settings/business";
import { addLocalDays, startOfLocalDay } from "./lib/time";

type Ctx = (QueryCtx | MutationCtx) & MemberAccess;

const DAY = 86_400_000;

const METHOD_WORDS: Record<PaymentMethod, string> = {
  card: "Card",
  bank_debit: "Bank debit",
  cash: "Cash",
  check: "Check",
  bank_transfer: "Bank transfer",
  zelle: "Zelle",
  venmo: "Venmo",
  other: "Other",
};

const PAYMENT_WORDS: Record<Doc<"payments">["status"], string> = {
  awaiting_customer: "Started by customer",
  processing: "Processing",
  succeeded: "Received",
  failed: "Failed",
  canceled: "Canceled",
  checking: "Checking with Stripe",
  voided: "Voided",
};

const REFUND_WORDS: Record<Doc<"refunds">["status"], string> = {
  sending: "Sending to Stripe",
  pending: "Pending at the bank",
  succeeded: "Refunded",
  failed: "Failed",
  canceled: "Canceled",
  checking: "Checking with Stripe",
  recorded: "Recorded by you",
};

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────

async function namesFor(ctx: QueryCtx, ids: Iterable<Id<"customers">>): Promise<Map<Id<"customers">, string>> {
  const names = new Map<Id<"customers">, string>();
  for (const id of new Set(ids)) {
    const row = await ctx.db.get(id);
    names.set(id, row?.name ?? "Customer");
  }
  return names;
}

function jobLabel(job: Doc<"jobs">, timezone: string): string {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric" }).format(new Date(job.startsAt));
  return `${job.serviceSnapshot?.name ?? job.serviceType} · ${day}`;
}

function invoiceRow(invoice: Doc<"invoices">, customer: string, now: number) {
  const state = invoiceState(invoice, now);
  return {
    id: invoice._id,
    number: invoice.number ?? null,
    customerId: invoice.customerId,
    customer,
    jobId: invoice.jobId ?? null,
    state,
    stateWords: STATE_WORDS[state],
    totalCents: invoice.totals.totalCents,
    balanceCents: invoice.totals.balanceCents,
    processingCents: invoice.totals.processingCents,
    requestedCents: amountRequested(invoice),
    dueAt: invoice.dueAt ?? null,
    issuedAt: invoice.issuedAt ?? null,
    createdAt: invoice.createdAt,
    hasDeposit: (invoice.depositCents ?? 0) > 0,
  };
}

async function companyInvoices(ctx: QueryCtx, companyId: Id<"companies">, limit = 500): Promise<Doc<"invoices">[]> {
  return ctx.db
    .query("invoices")
    .withIndex("by_company_created", (q) => q.eq("companyId", companyId))
    .order("desc")
    .take(limit);
}

/** Completed visits with a price that have no invoice yet (or only void ones), most recent first. */
async function uninvoicedJobs(ctx: QueryCtx, companyId: Id<"companies">, now: number) {
  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_company_status_start", (q) => q.eq("companyId", companyId).eq("status", "completed").gte("startsAt", now - 60 * DAY))
    .order("desc")
    .take(200);
  const out: Doc<"jobs">[] = [];
  for (const job of jobs) {
    if (job.priceCents === undefined) continue;
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_company_job", (q) => q.eq("companyId", companyId).eq("jobId", job._id))
      .take(10);
    if (!invoices.some((invoice) => invoice.status !== "void")) out.push(job);
  }
  return out;
}

const PERIODS = ["this_month", "last_month", "last_90_days", "this_year"] as const;
type Period = (typeof PERIODS)[number];
const periodValidator = v.union(...PERIODS.map((p) => v.literal(p)));

function periodRange(period: Period, now: number, timezone: string): { from: number; to: number; label: string } {
  const today = localDateKey(now, timezone);
  const [y, m] = today.split("-").map(Number);
  const startOf = (date: string) => startOfLocalDay(endOfLocalDate(date, timezone), timezone);
  const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}-01`;
  const name = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 15)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  switch (period) {
    case "this_month":
      return { from: startOf(monthKey(y, m)), to: now, label: name(y, m) };
    case "last_month": {
      const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return { from: startOf(monthKey(py, pm)), to: startOf(monthKey(y, m)) - 1, label: name(py, pm) };
    }
    case "last_90_days":
      return { from: addLocalDays(startOfLocalDay(now, timezone), -89, timezone), to: now, label: "Last 90 days" };
    case "this_year":
      return { from: startOf(`${y}-01-01`), to: now, label: String(y) };
  }
}

/** The overview: where the money stands, what changed in the period and what needs the Owner. */
export const overview = ownerQuery({
  args: { period: periodValidator },
  handler: async (ctx, args) => {
    requireFinance(ctx, "read");
    const now = Date.now();
    const tz = ctx.company.timezone;
    const range = periodRange(args.period, now, tz);

    const invoices = await companyInvoices(ctx, ctx.companyId);
    const names = await namesFor(ctx, invoices.map((invoice) => invoice.customerId));
    const name = (id: Id<"customers">) => names.get(id) ?? "Customer";
    const open = invoices.filter((invoice) => invoice.status === "open");

    // Money in during the period: payments that succeeded, by the day they arrived.
    const received = await ctx.db
      .query("payments")
      .withIndex("by_company_succeeded", (q) => q.eq("companyId", ctx.companyId).gte("succeededAt", range.from).lte("succeededAt", range.to))
      .take(2000);
    const counted = received.filter((p) => p.status === "succeeded");
    const refundRows = await ctx.db
      .query("refunds")
      .withIndex("by_company_settled", (q) => q.eq("companyId", ctx.companyId).gte("settledAt", range.from).lte("settledAt", range.to))
      .take(2000);
    const refunded = refundRows.filter((r) => REFUND_COUNTS.includes(r.status));
    const issued = await ctx.db
      .query("invoices")
      .withIndex("by_company_issued", (q) => q.eq("companyId", ctx.companyId).gte("issuedAt", range.from).lte("issuedAt", range.to))
      .take(2000);
    const invoicedRows = issued.filter((invoice) => invoice.status !== "void" && invoice.status !== "draft");

    const outstanding = open.filter((invoice) => invoice.totals.balanceCents > 0);
    const overdue = open.filter((invoice) => invoiceState(invoice, now) === "overdue");
    const feeKnown = counted.filter((p) => p.source === "stripe");

    // Eight weeks, Monday to Sunday on the company's clock, ending with this week.
    const todayStart = startOfLocalDay(now, tz);
    const weekday = (new Date(todayStart + 12 * 3_600_000).getUTCDay() + 6) % 7;
    const thisWeek = addLocalDays(todayStart, -weekday, tz);
    const weeks = Array.from({ length: 8 }, (_, i) => {
      const from = addLocalDays(thisWeek, (i - 7) * 7, tz);
      return { from, to: addLocalDays(from, 7, tz) - 1 };
    });
    const trendPayments = await ctx.db
      .query("payments")
      .withIndex("by_company_succeeded", (q) => q.eq("companyId", ctx.companyId).gte("succeededAt", weeks[0].from))
      .take(4000);
    const trendIssued = await ctx.db
      .query("invoices")
      .withIndex("by_company_issued", (q) => q.eq("companyId", ctx.companyId).gte("issuedAt", weeks[0].from))
      .take(4000);
    const trend = weeks.map((week) => ({
      from: week.from,
      label: new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(week.from)),
      collectedCents: trendPayments.filter((p) => p.status === "succeeded" && p.succeededAt! >= week.from && p.succeededAt! <= week.to).reduce((s, p) => s + p.amountCents, 0),
      invoicedCents: trendIssued.filter((invoice) => invoice.status !== "void" && invoice.issuedAt! >= week.from && invoice.issuedAt! <= week.to).reduce((s, invoice) => s + invoice.totals.totalCents, 0),
    }));

    const upcoming = open
      .filter((invoice) => invoice.dueAt !== undefined && invoice.dueAt >= now && invoice.dueAt <= now + 14 * DAY && amountRequested(invoice) > 0)
      .sort((a, b) => a.dueAt! - b.dueAt!)
      .slice(0, 6)
      .map((invoice) => invoiceRow(invoice, name(invoice.customerId), now));

    const troubled = (
      await Promise.all(
        (["failed", "checking", "succeeded"] as const).map((status) =>
          ctx.db
            .query("payments")
            .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", status).gte("updatedAt", now - 30 * DAY))
            .take(300),
        ),
      )
    )
      .flat()
      .filter((p) => (p.status === "succeeded" ? p.dispute !== undefined : true))
      .filter((p) => p.status !== "failed" || open.some((invoice) => invoice._id === p.invoiceId));
    // A failed attempt that was followed by a successful one is not a problem any more.
    const failedStill = troubled.filter((p) => p.status !== "failed" || !received.some((r) => r.invoiceId === p.invoiceId && r.createdAt > p.createdAt));

    const jobs = await uninvoicedJobs(ctx, ctx.companyId, now);
    const jobNames = await namesFor(ctx, jobs.map((job) => job.customerId));
    const stripe = await stripeState(ctx, ctx.companyId);
    const found = findings({
      now,
      invoices,
      customerName: name,
      uninvoicedJobs: jobs.map((job) => ({ job, customer: jobNames.get(job.customerId) ?? "Customer", label: jobLabel(job, tz) })),
      troubledPayments: failedStill,
      stripe: { state: stripe.state, problem: stripe.problem },
      money: dollars,
    });

    const events = await ctx.db
      .query("events")
      .withIndex("by_company_at", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(400);
    const activity = events.filter((event) => FINANCE_EVENT.test(event.type)).slice(0, 12);
    const activityRows = [];
    for (const event of activity) activityRows.push(await activityRow(ctx, event));

    return {
      period: { id: args.period, label: range.label, from: range.from, to: range.to },
      metrics: {
        collected: { cents: counted.reduce((s, p) => s + p.amountCents, 0), count: counted.length, feesCents: feeKnown.reduce((s, p) => s + (p.stripe?.feeCents ?? 0), 0), feesMissing: feeKnown.filter((p) => p.stripe?.feeCents === undefined).length },
        refunded: { cents: refunded.reduce((s, r) => s + r.amountCents, 0), count: refunded.length },
        invoiced: { cents: invoicedRows.reduce((s, invoice) => s + invoice.totals.totalCents, 0), count: invoicedRows.length },
        outstanding: { cents: outstanding.reduce((s, invoice) => s + invoice.totals.balanceCents, 0), count: outstanding.length, processingCents: open.reduce((s, invoice) => s + invoice.totals.processingCents, 0) },
        overdue: { cents: overdue.reduce((s, invoice) => s + amountRequested(invoice), 0), count: overdue.length },
      },
      trend,
      upcoming,
      findings: found,
      activity: activityRows,
      stripe,
      checkedAt: now,
      hasInvoices: invoices.length > 0,
    };
  },
});

const FINANCE_EVENT = /^(invoice|payment|refund|credit|stripe|finance_settings)\./;

const EVENT_WORDS: Record<string, string> = {
  "invoice.created": "Draft invoice created",
  "invoice.issued": "Invoice issued",
  "invoice.shared": "Pay link shared",
  "invoice.balance_requested": "Balance requested",
  "invoice.voided": "Invoice voided",
  "invoice.discarded": "Draft discarded",
  "invoice.paid": "Invoice paid in full",
  "payment.recorded": "Payment recorded",
  "payment.started": "Customer started a card payment",
  "payment.processing": "Payment processing",
  "payment.succeeded": "Payment received",
  "payment.failed": "Payment failed",
  "payment.checking": "Checking a payment with Stripe",
  "payment.voided": "Recorded payment voided",
  "payment.disputed": "Payment disputed",
  "refund.requested": "Refund requested",
  "refund.succeeded": "Refund completed",
  "refund.failed": "Refund failed",
  "refund.recorded": "Refund recorded",
  "credit.added": "Credit added",
  "credit.reversed": "Credit reversed",
  "stripe.connect_started": "Stripe setup started",
  "stripe.connected": "Stripe connected",
  "stripe.updated": "Stripe account updated",
  "finance_settings.saved": "Invoice settings changed",
};

async function activityRow(ctx: QueryCtx, event: Doc<"events">) {
  let invoiceId: Id<"invoices"> | null = null;
  if (event.subject.table === "invoices") invoiceId = event.subject.id;
  if (event.subject.table === "payments" || event.subject.table === "refunds" || event.subject.table === "invoiceCredits") {
    const row = (await ctx.db.get(event.subject.id)) as { invoiceId?: Id<"invoices"> } | null;
    invoiceId = row?.invoiceId ?? null;
  }
  const invoice = invoiceId ? await ctx.db.get(invoiceId) : null;
  const customer = invoice ? await ctx.db.get(invoice.customerId) : null;
  const amount = typeof event.data?.amountCents === "number" ? event.data.amountCents : null;
  const by = event.actor.kind === "member" ? "You" : event.actor.kind === "system" ? "Stripe" : "Selestial";
  return { id: event._id, at: event.at, title: EVENT_WORDS[event.type] ?? "Finance updated", invoiceId, invoiceNumber: invoice?.number ?? null, customer: customer?.name ?? null, amountCents: amount, by };
}

/** The invoice list, with the filters the Invoices & Payments tab offers. */
export const invoices = ownerQuery({
  args: { filter: v.union(v.literal("all"), v.literal("outstanding"), v.literal("overdue"), v.literal("drafts"), v.literal("paid"), v.literal("void")) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "read");
    const now = Date.now();
    const all = await companyInvoices(ctx, ctx.companyId, 1000);
    const names = await namesFor(ctx, all.map((invoice) => invoice.customerId));
    const rows = all.map((invoice) => invoiceRow(invoice, names.get(invoice.customerId) ?? "Customer", now));
    const keep: Record<typeof args.filter, (row: (typeof rows)[number]) => boolean> = {
      all: (row) => row.state !== "void",
      outstanding: (row) => !["draft", "void", "paid"].includes(row.state),
      overdue: (row) => row.state === "overdue",
      drafts: (row) => row.state === "draft",
      paid: (row) => row.state === "paid" || row.state === "overpaid",
      void: (row) => row.state === "void",
    };
    const counts = {
      all: rows.filter(keep.all).length,
      outstanding: rows.filter(keep.outstanding).length,
      overdue: rows.filter(keep.overdue).length,
      drafts: rows.filter(keep.drafts).length,
      paid: rows.filter(keep.paid).length,
      void: rows.filter(keep.void).length,
    };
    return { rows: rows.filter(keep[args.filter]), counts, stripe: await stripeState(ctx, ctx.companyId) };
  },
});

function paymentView(payment: Doc<"payments">, timezone: string) {
  const refundable = payment.status === "succeeded" ? payment.amountCents - payment.refundedCents : 0;
  return {
    id: payment._id,
    amountCents: payment.amountCents,
    status: payment.status,
    statusWords: PAYMENT_WORDS[payment.status],
    method: payment.method,
    methodWords: payment.stripe?.methodLabel ?? METHOD_WORDS[payment.method],
    source: payment.source,
    receivedOn: payment.manual?.receivedOn ?? (payment.succeededAt ? localDateKey(payment.succeededAt, timezone) : null),
    reference: payment.manual?.reference ?? null,
    note: payment.manual?.note ?? null,
    feeCents: payment.stripe?.feeCents ?? null,
    problem: payment.problem ?? null,
    refundedCents: payment.refundedCents,
    refundableCents: Math.max(0, refundable),
    dispute: payment.dispute ?? null,
    voided: payment.voided ? { at: payment.voided.at, reason: payment.voided.reason } : null,
    createdAt: payment.createdAt,
    succeededAt: payment.succeededAt ?? null,
    livemode: payment.stripe?.livemode ?? null,
  };
}

/** One invoice with everything that happened to it, for the invoice drawer. */
export const invoice = ownerQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    requireFinance(ctx, "read");
    const invoice = await owned(ctx, args.invoiceId);
    const now = Date.now();
    const tz = ctx.company.timezone;
    const customer = await owned(ctx, invoice.customerId);
    const property = invoice.propertyId ? await ctx.db.get(invoice.propertyId) : null;
    const job = invoice.jobId ? await ctx.db.get(invoice.jobId) : null;
    const rows = await invoiceRows(ctx, invoice);
    const settings = settingsOf(await settingsRow(ctx, ctx.companyId));
    const token = invoice.status !== "draft" && invoice.status !== "void" ? await payToken(invoice) : null;
    const history = await ctx.db
      .query("events")
      .withIndex("by_company_subject_at", (q) => q.eq("companyId", ctx.companyId).eq("subjectId", invoice._id))
      .order("desc")
      .take(50);
    const childIds = new Set<string>([...rows.payments.map((p) => p._id), ...rows.refunds.map((r) => r._id), ...rows.credits.map((c) => c._id)]);
    const childEvents = [];
    for (const id of childIds) {
      childEvents.push(
        ...(await ctx.db
          .query("events")
          .withIndex("by_company_subject_at", (q) => q.eq("companyId", ctx.companyId).eq("subjectId", id))
          .take(20)),
      );
    }
    const timeline = [...history, ...childEvents]
      .sort((a, b) => b.at - a.at)
      .slice(0, 40)
      .map((event) => ({ id: event._id, at: event.at, title: EVENT_WORDS[event.type] ?? "Updated", amountCents: typeof event.data?.amountCents === "number" ? event.data.amountCents : null, by: event.actor.kind === "member" ? "You" : event.actor.kind === "system" ? "Stripe" : "Selestial" }));
    const state = invoiceState(invoice, now);
    const stripe = await stripeState(ctx, ctx.companyId);
    return {
      id: invoice._id,
      number: invoice.number ?? null,
      status: invoice.status,
      state,
      stateWords: STATE_WORDS[state],
      revision: invoice.revision,
      customer: { id: customer._id, name: customer.name, email: customer.email ?? null, phone: customer.phone ?? null },
      property: property ? { id: property._id, label: property.label ?? null, address: `${property.address.line1}, ${property.address.city}` } : null,
      job: job ? { id: job._id, label: jobLabel(job, tz), status: job.status, priceCents: job.priceCents ?? null } : null,
      lines: invoice.lines,
      taxRateBps: invoice.taxRateBps,
      taxLabel: invoice.taxLabel ?? "Sales tax",
      taxRateWords: percentLabel(invoice.taxRateBps),
      totals: invoice.totals,
      depositCents: invoice.depositCents ?? null,
      depositOutstandingCents: depositOutstanding(invoice),
      inDepositStage: inDepositStage(invoice),
      balanceRequestedAt: invoice.balanceRequestedAt ?? null,
      requestedCents: amountRequested(invoice),
      dueAt: invoice.dueAt ?? null,
      dueDate: invoice.dueAt ? localDateKey(invoice.dueAt, tz) : null,
      memo: invoice.memo ?? null,
      issuedAt: invoice.issuedAt ?? null,
      shared: invoice.shared ? { how: invoice.shared.how, at: invoice.shared.at } : null,
      voided: invoice.voided ? { at: invoice.voided.at, reason: invoice.voided.reason } : null,
      paidAt: invoice.paidAt ?? null,
      createdAt: invoice.createdAt,
      payLink: token ? payUrl(token) : null,
      payLinksConfigured: payLinksConfigured(),
      payments: rows.payments.filter((p) => p.status !== "awaiting_customer" && p.status !== "canceled").sort((a, b) => b.createdAt - a.createdAt).map((p) => paymentView(p, tz)),
      refunds: rows.refunds.sort((a, b) => b.createdAt - a.createdAt).map((r) => ({ id: r._id, paymentId: r.paymentId, amountCents: r.amountCents, reason: r.reason, status: r.status, statusWords: REFUND_WORDS[r.status], problem: r.problem ?? null, createdAt: r.createdAt, settledAt: r.settledAt ?? null, inFlight: REFUND_IN_FLIGHT.includes(r.status) })),
      credits: rows.credits.sort((a, b) => b.at - a.at).map((c) => ({ id: c._id, amountCents: c.amountCents, reason: c.reason, at: c.at, reversed: c.reversed ? { at: c.reversed.at, reason: c.reversed.reason } : null, fromRefund: c.refundId !== undefined })),
      timeline,
      taxSettings: { rateBps: settings.taxRateBps, label: settings.taxLabel },
      termsDueDate: localDateKey(dueAfterDays(now, settings.paymentTermsDays, tz), tz),
      taxableServiceIds: settings.taxableServiceIds,
      cardPayments: stripe.state === "active",
      stripe,
      today: localDateKey(now, tz),
    };
  },
});

/** Everything a customer was charged, paid, refunded and credited, with the running balance. */
export const statement = ownerQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    requireFinance(ctx, "read");
    const customer = await owned(ctx, args.customerId);
    const tz = ctx.company.timezone;
    const invoices = (
      await ctx.db
        .query("invoices")
        .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
        .take(500)
    ).filter((invoice) => invoice.status !== "draft");
    type Entry = { at: number; kind: "charge" | "payment" | "refund" | "credit" | "void"; label: string; invoiceId: Id<"invoices">; chargeCents: number; paidCents: number; pending: boolean };
    const entries: Entry[] = [];
    for (const invoice of invoices) {
      const number = invoice.number ?? "Invoice";
      entries.push({ at: invoice.issuedAt ?? invoice.createdAt, kind: "charge", label: `${number} issued`, invoiceId: invoice._id, chargeCents: linesTotal(invoice.lines, invoice.taxRateBps).totalCents, paidCents: 0, pending: false });
      if (invoice.voided) entries.push({ at: invoice.voided.at, kind: "void", label: `${number} voided`, invoiceId: invoice._id, chargeCents: -linesTotal(invoice.lines, invoice.taxRateBps).totalCents, paidCents: 0, pending: false });
      const rows = await invoiceRows(ctx, invoice);
      for (const p of rows.payments) {
        if (p.status === "succeeded") entries.push({ at: p.succeededAt ?? p.createdAt, kind: "payment", label: `Payment · ${p.stripe?.methodLabel ?? METHOD_WORDS[p.method]} · ${number}`, invoiceId: invoice._id, chargeCents: 0, paidCents: p.amountCents, pending: false });
        if (p.status === "processing") entries.push({ at: p.createdAt, kind: "payment", label: `Payment processing · ${number}`, invoiceId: invoice._id, chargeCents: 0, paidCents: 0, pending: true });
      }
      for (const r of rows.refunds) {
        if (REFUND_COUNTS.includes(r.status)) entries.push({ at: r.settledAt ?? r.createdAt, kind: "refund", label: `Refund · ${number}`, invoiceId: invoice._id, chargeCents: 0, paidCents: -r.amountCents, pending: false });
      }
      for (const c of rows.credits) {
        entries.push({ at: c.at, kind: "credit", label: `Credit · ${number}`, invoiceId: invoice._id, chargeCents: -c.amountCents, paidCents: 0, pending: false });
        if (c.reversed) entries.push({ at: c.reversed.at, kind: "credit", label: `Credit reversed · ${number}`, invoiceId: invoice._id, chargeCents: c.amountCents, paidCents: 0, pending: false });
      }
    }
    // Oldest first; on the same moment a charge comes before what paid it.
    const order = { charge: 0, payment: 1, credit: 2, refund: 3, void: 4 } as const;
    entries.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
    let balance = 0;
    const lines = entries.map((entry) => {
      balance += entry.chargeCents - entry.paidCents;
      return { ...entry, date: localDateKey(entry.at, tz), balanceCents: balance };
    });
    const open = invoices.filter((invoice) => invoice.status === "open");
    return {
      customer: { id: customer._id, name: customer.name, email: customer.email ?? null },
      company: ctx.company.name,
      lines: lines.reverse(),
      balanceCents: balance,
      openCount: open.length,
      processingCents: open.reduce((s, invoice) => s + invoice.totals.processingCents, 0),
      asOf: localDateKey(Date.now(), tz),
    };
  },
});

/** What the Owner picks from when starting an invoice: customers with properties, and visits not invoiced yet. */
export const invoiceSources = ownerQuery({
  args: {},
  handler: async (ctx) => {
    requireFinance(ctx, "read");
    const now = Date.now();
    const customers = await ctx.db
      .query("customers")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "active"))
      .take(500);
    const jobs = await uninvoicedJobs(ctx, ctx.companyId, now);
    const names = await namesFor(ctx, jobs.map((job) => job.customerId));
    return {
      customers: customers.map((c) => ({ id: c._id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
      jobs: jobs.map((job) => ({ id: job._id, customerId: job.customerId, customer: names.get(job.customerId) ?? "Customer", label: jobLabel(job, ctx.company.timezone), priceCents: job.priceCents ?? null, startsAt: job.startsAt })),
    };
  },
});

export const settings = ownerQuery({
  args: {},
  handler: async (ctx) => {
    requireFinance(ctx, "read");
    const services = businessSettingsOf(ctx.company).services.filter((s) => s.status === "active").map((s) => ({ id: s.id, name: s.name, startingPriceCents: s.startingPriceCents ?? null }));
    return { settings: settingsOf(await settingsRow(ctx, ctx.companyId)), services, stripe: await stripeState(ctx, ctx.companyId), payLinksConfigured: payLinksConfigured(), cardsConfigured: stripeConfig() !== null };
  },
});

// ── Settings ─────────────────────────────────────────────────────────────────────────────────────

export const saveSettings = ownerMutation({
  args: {
    revision: v.number(),
    taxRateBps: v.union(v.number(), v.null()),
    taxLabel: v.string(),
    taxableServiceIds: v.array(v.string()),
    paymentTermsDays: v.number(),
    allowPartialPayments: v.boolean(),
    invoiceNote: v.union(v.string(), v.null()),
    invoicePrefix: v.string(),
  },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const row = await settingsRow(ctx, ctx.companyId);
    const current = settingsOf(row);
    if (args.revision !== current.revision) throw userError("These settings were changed somewhere else. Reload to see the latest.");
    if (args.taxRateBps !== null && (!Number.isInteger(args.taxRateBps) || args.taxRateBps < 0 || args.taxRateBps > LIMITS.taxRateBps)) throw userError("Enter a tax rate between 0% and 25%, with up to two decimals.");
    if (!Number.isInteger(args.paymentTermsDays) || args.paymentTermsDays < LIMITS.termsDays.min || args.paymentTermsDays > LIMITS.termsDays.max) throw userError("Payment terms must be between 0 and 120 days.");
    const prefix = args.invoicePrefix.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,8}$/.test(prefix)) throw userError("Use up to 8 letters or digits for the invoice prefix.");
    const label = args.taxLabel.trim() || "Sales tax";
    if (label.length > 40) throw userError("Keep the tax name under 40 characters.");
    const note = args.invoiceNote?.trim() || undefined;
    if (note && note.length > 500) throw userError("Keep the invoice note under 500 characters.");
    const serviceIds = new Set(businessSettingsOf(ctx.company).services.filter((s) => s.status === "active").map((s) => s.id));
    const taxable = [...new Set(args.taxableServiceIds)].filter((id) => serviceIds.has(id));
    const fields = {
      taxRateBps: args.taxRateBps ?? undefined,
      taxLabel: label,
      taxableServiceIds: taxable,
      paymentTermsDays: args.paymentTermsDays,
      allowPartialPayments: args.allowPartialPayments,
      invoiceNote: note,
      invoicePrefix: prefix,
      revision: current.revision + 1,
      updatedBy: ctx.member._id,
      updatedAt: Date.now(),
    };
    const id = row ? (await ctx.db.patch(row._id, fields), row._id) : await ctx.db.insert("financeSettings", { companyId: ctx.companyId, nextInvoiceNumber: current.nextInvoiceNumber, ...fields });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "finance_settings.saved", actor: byMember(ctx), subject: { table: "financeSettings", id }, data: { taxRateBps: args.taxRateBps, paymentTermsDays: args.paymentTermsDays } });
    return { revision: fields.revision };
  },
});

// ── Invoices ─────────────────────────────────────────────────────────────────────────────────────

function lineId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Starts a draft from a completed visit (its price and service) or for a customer with no visit. */
export const createInvoice = ownerMutation({
  args: { jobId: v.optional(v.id("jobs")), customerId: v.optional(v.id("customers")) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "draft");
    const settings = settingsOf(await settingsRow(ctx, ctx.companyId));
    const now = Date.now();
    let lines: InvoiceLine[] = [];
    let customerId: Id<"customers">;
    let propertyId: Id<"properties"> | undefined;
    let jobId: Id<"jobs"> | undefined;
    if (args.jobId) {
      const job = await owned(ctx, args.jobId);
      const existing = await ctx.db
        .query("invoices")
        .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", job._id))
        .take(10);
      const live = existing.find((invoice) => invoice.status !== "void");
      // One invoice per visit: asking again opens the one that exists.
      if (live) return { invoiceId: live._id, existing: true };
      if (job.status === "cancelled") throw userError("This visit was cancelled. Start an invoice for the customer instead if something is still owed.");
      customerId = job.customerId;
      propertyId = job.propertyId;
      jobId = job._id;
      const serviceId = job.serviceSnapshot?.serviceId;
      const name = job.serviceSnapshot?.name ?? job.serviceType;
      const day = new Intl.DateTimeFormat("en-US", { timeZone: ctx.company.timezone, month: "short", day: "numeric", year: "numeric" }).format(new Date(job.startsAt));
      lines = [{ id: lineId(), kind: "service", description: `${name} · ${day}`, quantity: 1, unitCents: job.priceCents ?? 0, amountCents: job.priceCents ?? 0, taxable: serviceId ? settings.taxableServiceIds.includes(serviceId) : false, serviceId }];
    } else if (args.customerId) {
      customerId = (await owned(ctx, args.customerId))._id;
    } else {
      throw userError("Choose a visit or a customer.");
    }
    const taxRateBps = settings.taxRateBps ?? 0;
    const invoiceId = await ctx.db.insert("invoices", {
      companyId: ctx.companyId,
      customerId,
      propertyId,
      jobId,
      status: "draft",
      lines,
      taxRateBps,
      taxLabel: settings.taxLabel,
      totals: { ...emptyTotals(), ...linesTotal(lines, taxRateBps), balanceCents: linesTotal(lines, taxRateBps).totalCents },
      memo: settings.invoiceNote ?? undefined,
      revision: 0,
      createdBy: ctx.member._id,
      createdAt: now,
      updatedAt: now,
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "invoice.created", actor: byMember(ctx), subject: { table: "invoices", id: invoiceId }, data: { jobId: jobId ?? null } });
    return { invoiceId, existing: false };
  },
});

async function draft(ctx: Ctx, invoiceId: Id<"invoices">, revision: number): Promise<Doc<"invoices">> {
  const invoice = await owned(ctx, invoiceId);
  if (invoice.status !== "draft") throw userError("This invoice was already issued, so its lines can't change. Add a credit or void it instead.");
  if (invoice.revision !== revision) throw userError("This draft was changed somewhere else. Reload to see the latest.");
  return invoice;
}

/** Saves a draft. Amounts are worked out again on the server; the browser's arithmetic is never trusted. */
export const saveDraft = ownerMutation({
  args: {
    invoiceId: v.id("invoices"),
    revision: v.number(),
    lines: v.array(invoiceLineValidator),
    depositCents: v.union(v.number(), v.null()),
    memo: v.union(v.string(), v.null()),
    useCurrentTaxRate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requireFinance(ctx, "draft");
    const invoice = await draft(ctx, args.invoiceId, args.revision);
    const lines = cleanLines(args.lines);
    const settings = settingsOf(await settingsRow(ctx, ctx.companyId));
    const taxRateBps = args.useCurrentTaxRate ? (settings.taxRateBps ?? 0) : invoice.taxRateBps;
    const base = linesTotal(lines, taxRateBps);
    if (base.totalCents > LIMITS.invoiceCents) throw userError("An invoice can be up to $100,000.");
    if (base.totalCents < 0) throw userError("Discounts can't be more than the invoice.");
    let depositCents: number | undefined;
    if (args.depositCents !== null) {
      if (!Number.isInteger(args.depositCents) || args.depositCents <= 0) throw userError("Enter the deposit as an amount above zero, or remove it.");
      if (args.depositCents >= base.totalCents) throw userError("A deposit must be less than the invoice total. To ask for everything now, remove the deposit.");
      depositCents = args.depositCents;
    }
    const memo = args.memo?.trim() || undefined;
    if (memo && memo.length > LIMITS.memo) throw userError("Keep the note under 1,000 characters.");
    await ctx.db.patch(invoice._id, {
      lines,
      taxRateBps,
      taxLabel: args.useCurrentTaxRate ? settings.taxLabel : invoice.taxLabel,
      totals: { ...emptyTotals(), ...base, balanceCents: base.totalCents },
      depositCents,
      memo,
      revision: invoice.revision + 1,
      updatedAt: Date.now(),
    });
    return { revision: invoice.revision + 1 };
  },
});

/**
 * Issues a draft: it gets a number, a due date and a pay link, and its lines are frozen. Nothing is sent
 * to the customer by this; sharing the link is its own step.
 */
export const issueInvoice = ownerMutation({
  args: { invoiceId: v.id("invoices"), revision: v.number(), dueDate: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "send");
    const invoice = await draft(ctx, args.invoiceId, args.revision);
    if (!invoice.lines.length) throw userError("Add at least one line before issuing.");
    const base = linesTotal(invoice.lines, invoice.taxRateBps);
    if (base.totalCents <= 0) throw userError("An invoice must be for more than $0.");
    const customer = await owned(ctx, invoice.customerId);
    if (customer.status !== "active") throw userError("This customer is archived. Restore them before issuing an invoice.");
    const now = Date.now();
    const tz = ctx.company.timezone;
    const row = await settingsRow(ctx, ctx.companyId);
    const settings = settingsOf(row);
    const dueAt = args.dueDate ? endOfLocalDate(args.dueDate, tz) : dueAfterDays(now, settings.paymentTermsDays, tz);
    if (dueAt < startOfLocalDay(now, tz)) throw userError("The due date can't be in the past.");
    const number = invoiceNumber(settings);
    if (row) await ctx.db.patch(row._id, { nextInvoiceNumber: settings.nextInvoiceNumber + 1 });
    else await ctx.db.insert("financeSettings", { companyId: ctx.companyId, taxableServiceIds: [], paymentTermsDays: settings.paymentTermsDays, allowPartialPayments: settings.allowPartialPayments, nextInvoiceNumber: settings.nextInvoiceNumber + 1, invoicePrefix: settings.invoicePrefix, revision: 0, updatedBy: ctx.member._id, updatedAt: now });
    await ctx.db.patch(invoice._id, { status: "open", number, publicId: newPublicId(), issuedAt: now, issuedBy: ctx.member._id, dueAt, revision: invoice.revision + 1, updatedAt: now });
    const after = await recompute(ctx, invoice._id);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "invoice.issued", actor: byMember(ctx), subject: { table: "invoices", id: invoice._id }, data: { amountCents: after.totals.totalCents, number, depositCents: invoice.depositCents ?? null } });
    return { number, payLinksConfigured: payLinksConfigured() };
  },
});

/** Notes how the customer was given the pay link. Selestial does not send it itself yet, and does not claim to. */
export const markShared = ownerMutation({
  args: { invoiceId: v.id("invoices"), how: v.union(v.literal("link_copied"), v.literal("marked_sent")) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "send");
    const invoice = await owned(ctx, args.invoiceId);
    if (invoice.status !== "open" && invoice.status !== "paid") throw userError("Only an issued invoice has a link to share.");
    // A copied link stays copied; "I sent it" is the stronger statement and replaces it.
    if (invoice.shared?.how === "marked_sent" || (invoice.shared && args.how === "link_copied")) return { already: true };
    await ctx.db.patch(invoice._id, { shared: { how: args.how, at: Date.now(), by: ctx.member._id }, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "invoice.shared", actor: byMember(ctx), subject: { table: "invoices", id: invoice._id }, data: { how: args.how } });
    return { already: false };
  },
});

/** After the visit, asks for the rest of an invoice that started with a deposit. */
export const requestBalance = ownerMutation({
  args: { invoiceId: v.id("invoices"), dueDate: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "send");
    const invoice = await owned(ctx, args.invoiceId);
    if (invoice.status !== "open" || !inDepositStage(invoice)) throw userError("This invoice isn't waiting to request its balance.");
    const now = Date.now();
    const tz = ctx.company.timezone;
    const settings = settingsOf(await settingsRow(ctx, ctx.companyId));
    const dueAt = args.dueDate ? endOfLocalDate(args.dueDate, tz) : dueAfterDays(now, settings.paymentTermsDays, tz);
    if (dueAt < startOfLocalDay(now, tz)) throw userError("The due date can't be in the past.");
    await ctx.db.patch(invoice._id, { balanceRequestedAt: now, dueAt, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "invoice.balance_requested", actor: byMember(ctx), subject: { table: "invoices", id: invoice._id }, data: { amountCents: invoice.totals.balanceCents } });
    return { ok: true };
  },
});

async function voidFacts(ctx: Ctx, invoice: Doc<"invoices">) {
  const rows = await invoiceRows(ctx, invoice);
  const netPaid = invoice.totals.paidCents - invoice.totals.refundedCents;
  const live = rows.payments.filter((p) => p.status === "processing" || p.status === "checking").length;
  return { invoice: invoice._id, status: invoice.status, total: invoice.totals.totalCents, netPaid, live, credited: invoice.totals.creditedCents };
}

export const voidPreview = ownerQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const invoice = await owned(ctx, args.invoiceId);
    const facts = await voidFacts(ctx, invoice);
    const customer = await ctx.db.get(invoice.customerId);
    const blocked = facts.live > 0 ? "A payment on this invoice is still processing. Wait for it to finish." : facts.netPaid > 0 ? `The customer has paid ${dollars(facts.netPaid)} on this invoice. Refund it first, then void.` : null;
    return {
      blocked,
      lines: [`Void ${invoice.number ?? "this draft"} for ${customer?.name ?? "the customer"}.`, `${dollars(invoice.totals.totalCents)} will no longer be owed.`, "The pay link stops working. The invoice stays in the history with your reason."],
      bindsTo: await bindsTo("void_invoice", facts),
    };
  },
});

export const voidInvoice = ownerMutation({
  args: { invoiceId: v.id("invoices"), reason: v.string(), bindsTo: v.string() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const invoice = await owned(ctx, args.invoiceId);
    if (invoice.status === "void") return { already: true };
    const facts = await voidFacts(ctx, invoice);
    await requireSame(args.bindsTo, "void_invoice", facts);
    if (facts.live > 0) throw userError("A payment on this invoice is still processing. Wait for it to finish.");
    if (facts.netPaid > 0) throw userError("Refund what was paid before voiding this invoice.");
    const reason = args.reason.trim();
    if (!reason) throw userError("Say why, so the history makes sense later.");
    if (reason.length > LIMITS.reason) throw userError("Keep the reason under 500 characters.");
    await ctx.db.patch(invoice._id, { status: "void", voided: { at: Date.now(), by: ctx.member._id, reason }, updatedAt: Date.now() });
    await cancelStartedPayments(ctx, invoice._id);
    await recordEvent(ctx, { companyId: ctx.companyId, type: invoice.status === "draft" ? "invoice.discarded" : "invoice.voided", actor: byMember(ctx), subject: { table: "invoices", id: invoice._id }, data: { amountCents: invoice.totals.totalCents } });
    return { already: false };
  },
});

/** Payments a customer started and never finished are stopped, so they can't complete for money no longer owed. */
export async function cancelStartedPayments(ctx: MutationCtx, invoiceId: Id<"invoices">, except?: Id<"payments">) {
  const invoice = (await ctx.db.get(invoiceId))!;
  const started = await ctx.db
    .query("payments")
    .withIndex("by_company_invoice", (q) => q.eq("companyId", invoice.companyId).eq("invoiceId", invoiceId))
    .take(200);
  for (const payment of started) {
    if (payment._id === except || payment.status !== "awaiting_customer") continue;
    await ctx.scheduler.runAfter(0, internal.financeStripe.cancelStarted, { paymentId: payment._id });
  }
}

// ── Payments recorded by hand ────────────────────────────────────────────────────────────────────

/** The Owner records money they received outside Selestial. They confirm it arrived; it is never assumed. */
export const recordPayment = ownerMutation({
  args: {
    invoiceId: v.id("invoices"),
    amountCents: v.number(),
    method: paymentMethodValidator,
    receivedOn: v.string(),
    reference: v.union(v.string(), v.null()),
    note: v.union(v.string(), v.null()),
    confirmedReceived: v.boolean(),
    clientKey: v.string(),
  },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    if (!args.confirmedReceived) throw userError("Confirm that you received this money.");
    if (!/^[\w-]{8,80}$/.test(args.clientKey)) throw userError("Reload the page and try again.");
    const repeat = await ctx.db
      .query("payments")
      .withIndex("by_company_clientKey", (q) => q.eq("companyId", ctx.companyId).eq("clientKey", args.clientKey))
      .unique();
    if (repeat) return { paymentId: repeat._id, repeated: true };
    const invoice = await owned(ctx, args.invoiceId);
    if (invoice.status !== "open") throw userError(invoice.status === "paid" ? "This invoice is already paid." : "Issue the invoice before recording a payment.");
    if (!MANUAL_METHODS.includes(args.method)) throw userError("Card and bank payments come through Stripe. Choose how you were paid.");
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) throw userError("Enter the amount you received.");
    const owed = invoice.totals.balanceCents - invoice.totals.processingCents;
    if (args.amountCents > owed) throw userError(`That's more than the ${dollars(Math.max(0, owed))} still owed${invoice.totals.processingCents ? " (a card payment is processing)" : ""}.`);
    const tz = ctx.company.timezone;
    const receivedAt = endOfLocalDate(args.receivedOn, tz);
    const now = Date.now();
    if (receivedAt - DAY > now) throw userError("The date received can't be in the future.");
    const reference = args.reference?.trim() || undefined;
    const note = args.note?.trim() || undefined;
    if ((reference?.length ?? 0) > 80 || (note?.length ?? 0) > 500) throw userError("Keep the reference and note short.");
    // Placed at midday of the day received, so it counts in that day's totals, and never before the invoice it pays.
    const succeededAt = Math.max(invoice.issuedAt ?? 0, Math.min(now, startOfLocalDay(receivedAt, tz) + 12 * 3_600_000));
    const paymentId = await ctx.db.insert("payments", {
      companyId: ctx.companyId,
      invoiceId: invoice._id,
      customerId: invoice.customerId,
      amountCents: args.amountCents,
      method: args.method,
      source: "manual",
      status: "succeeded",
      clientKey: args.clientKey,
      manual: { receivedOn: args.receivedOn, reference, note, recordedBy: ctx.member._id },
      refundedCents: 0,
      succeededAt,
      createdAt: now,
      updatedAt: now,
    });
    const after = await recompute(ctx, invoice._id);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "payment.recorded", actor: byMember(ctx), subject: { table: "payments", id: paymentId }, data: { amountCents: args.amountCents, method: args.method } });
    if (after.status === "paid") {
      await recordEvent(ctx, { companyId: ctx.companyId, type: "invoice.paid", actor: byMember(ctx), subject: { table: "invoices", id: invoice._id }, data: { amountCents: after.totals.totalCents } });
      await cancelStartedPayments(ctx, invoice._id);
    }
    return { paymentId, repeated: false };
  },
});

async function paymentVoidFacts(payment: Doc<"payments">) {
  return { payment: payment._id, status: payment.status, amount: payment.amountCents, refunded: payment.refundedCents, source: payment.source };
}

export const voidPaymentPreview = ownerQuery({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const payment = await owned(ctx, args.paymentId);
    const invoice = await owned(ctx, payment.invoiceId);
    const blocked = payment.source !== "manual" ? "Card and bank payments can't be voided. Refund them instead." : payment.status !== "succeeded" ? "This payment is already voided." : payment.refundedCents > 0 ? "Part of this payment was refunded, so it can't be voided." : null;
    return {
      blocked,
      lines: [`Void the ${dollars(payment.amountCents)} ${METHOD_WORDS[payment.method].toLowerCase()} payment on ${invoice.number}.`, `${invoice.number} will show ${dollars(invoice.totals.balanceCents + payment.amountCents)} owed again.`, "Use this only for a payment recorded by mistake. It stays in the history with your reason."],
      bindsTo: await bindsTo("void_payment", await paymentVoidFacts(payment)),
    };
  },
});

/** Corrects a payment recorded by mistake. It is kept, marked voided, with the reason. */
export const voidPayment = ownerMutation({
  args: { paymentId: v.id("payments"), reason: v.string(), bindsTo: v.string() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const payment = await owned(ctx, args.paymentId);
    await requireSame(args.bindsTo, "void_payment", await paymentVoidFacts(payment));
    if (payment.source !== "manual") throw userError("Card and bank payments can't be voided. Refund them instead.");
    if (payment.status !== "succeeded") throw userError("This payment is already voided.");
    if (payment.refundedCents > 0) throw userError("Part of this payment was refunded, so it can't be voided.");
    const reason = args.reason.trim();
    if (!reason) throw userError("Say why, so the history makes sense later.");
    if (reason.length > LIMITS.reason) throw userError("Keep the reason under 500 characters.");
    await ctx.db.patch(payment._id, { status: "voided", voided: { at: Date.now(), by: ctx.member._id, reason }, updatedAt: Date.now() });
    await recompute(ctx, payment.invoiceId);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "payment.voided", actor: byMember(ctx), subject: { table: "payments", id: payment._id }, data: { amountCents: payment.amountCents } });
    return { ok: true };
  },
});

// ── Credits ──────────────────────────────────────────────────────────────────────────────────────

async function creditFacts(invoice: Doc<"invoices">, amountCents: number) {
  return { invoice: invoice._id, amount: amountCents, balance: invoice.totals.balanceCents, processing: invoice.totals.processingCents, credited: invoice.totals.creditedCents, status: invoice.status };
}

export const creditPreview = ownerQuery({
  args: { invoiceId: v.id("invoices"), amountCents: v.number() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const invoice = await owned(ctx, args.invoiceId);
    const customer = await ctx.db.get(invoice.customerId);
    const room = invoice.totals.balanceCents - invoice.totals.processingCents;
    const blocked = invoice.status !== "open" ? "Credits apply to an issued invoice that still has a balance." : !Number.isInteger(args.amountCents) || args.amountCents <= 0 ? "Enter the amount to credit." : args.amountCents > room ? `A credit can be up to the ${dollars(Math.max(0, room))} still owed. To give money back, refund a payment.` : null;
    return {
      blocked,
      lines: [`${customer?.name ?? "The customer"} will owe ${dollars(args.amountCents)} less on ${invoice.number}.`, `New balance: ${dollars(invoice.totals.balanceCents - Math.max(0, args.amountCents))}.`, "No money moves. The credit and your reason are kept on the invoice."],
      bindsTo: await bindsTo("credit", await creditFacts(invoice, args.amountCents)),
    };
  },
});

export const addCredit = ownerMutation({
  args: { invoiceId: v.id("invoices"), amountCents: v.number(), reason: v.string(), bindsTo: v.string() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const invoice = await owned(ctx, args.invoiceId);
    await requireSame(args.bindsTo, "credit", await creditFacts(invoice, args.amountCents));
    if (invoice.status !== "open") throw userError("Credits apply to an issued invoice that still has a balance.");
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) throw userError("Enter the amount to credit.");
    if (args.amountCents > invoice.totals.balanceCents - invoice.totals.processingCents) throw userError("A credit can't be more than what is still owed.");
    const reason = args.reason.trim();
    if (!reason) throw userError("Say why, so the customer's statement makes sense.");
    if (reason.length > LIMITS.reason) throw userError("Keep the reason under 500 characters.");
    const creditId = await ctx.db.insert("invoiceCredits", { companyId: ctx.companyId, invoiceId: invoice._id, customerId: invoice.customerId, amountCents: args.amountCents, reason, by: ctx.member._id, at: Date.now() });
    const after = await recompute(ctx, invoice._id);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "credit.added", actor: byMember(ctx), subject: { table: "invoiceCredits", id: creditId }, data: { amountCents: args.amountCents } });
    if (after.status === "paid") await cancelStartedPayments(ctx, invoice._id);
    return { creditId };
  },
});

export const reverseCredit = ownerMutation({
  args: { creditId: v.id("invoiceCredits"), reason: v.string() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const credit = await owned(ctx, args.creditId);
    if (credit.reversed) return { already: true };
    if (credit.refundId) throw userError("This credit came with a refund, so it stays.");
    const invoice = await owned(ctx, credit.invoiceId);
    if (invoice.status === "void") throw userError("This invoice is void.");
    const reason = args.reason.trim();
    if (!reason) throw userError("Say why, so the history makes sense later.");
    await ctx.db.patch(credit._id, { reversed: { at: Date.now(), by: ctx.member._id, reason: reason.slice(0, LIMITS.reason) } });
    await recompute(ctx, invoice._id);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "credit.reversed", actor: byMember(ctx), subject: { table: "invoiceCredits", id: credit._id }, data: { amountCents: credit.amountCents } });
    return { already: false };
  },
});

// ── Refunds ──────────────────────────────────────────────────────────────────────────────────────

async function refundFacts(ctx: Ctx, payment: Doc<"payments">, amountCents: number, alsoCredit: boolean) {
  const refunds = await ctx.db
    .query("refunds")
    .withIndex("by_company_payment", (q) => q.eq("companyId", ctx.companyId).eq("paymentId", payment._id))
    .take(100);
  const inFlight = refunds.filter((r) => REFUND_IN_FLIGHT.includes(r.status)).reduce((s, r) => s + r.amountCents, 0);
  const invoice = (await ctx.db.get(payment.invoiceId))!;
  return { payment: payment._id, status: payment.status, amount: amountCents, refunded: payment.refundedCents, inFlight, alsoCredit, balance: invoice.totals.balanceCents, disputed: payment.dispute !== undefined };
}

function refundRoom(payment: Doc<"payments">, inFlight: number): number {
  return payment.status === "succeeded" ? payment.amountCents - payment.refundedCents - inFlight : 0;
}

/** Exactly what a refund will do, before the Owner confirms it. */
export const refundPreview = ownerQuery({
  args: { paymentId: v.id("payments"), amountCents: v.number(), alsoCredit: v.boolean() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "issue_refunds");
    const payment = await owned(ctx, args.paymentId);
    const invoice = await owned(ctx, payment.invoiceId);
    const customer = await ctx.db.get(payment.customerId);
    const facts = await refundFacts(ctx, payment, args.amountCents, args.alsoCredit);
    const room = refundRoom(payment, facts.inFlight);
    const stripe = payment.source === "stripe";
    const blocked =
      payment.status !== "succeeded"
        ? "Only a payment that was received can be refunded."
        : payment.dispute
          ? "This payment is disputed. Handle it in your Stripe Dashboard instead."
          : !Number.isInteger(args.amountCents) || args.amountCents <= 0
            ? "Enter the amount to refund."
            : args.amountCents > room
              ? `Up to ${dollars(Math.max(0, room))} of this payment can still be refunded.`
              : null;
    const owedAfter = invoice.totals.balanceCents + args.amountCents - (args.alsoCredit ? args.amountCents : 0);
    return {
      blocked,
      roomCents: Math.max(0, room),
      lines: [
        stripe
          ? `Stripe returns ${dollars(args.amountCents)} to ${customer?.name ?? "the customer"}'s ${payment.stripe?.methodLabel ?? "card"}. It usually reaches them in 5 to 10 business days.`
          : `You return ${dollars(args.amountCents)} to ${customer?.name ?? "the customer"} yourself. Selestial records that you did.`,
        args.alsoCredit ? `${invoice.number} is also credited ${dollars(args.amountCents)}, so they won't owe it again.` : `${invoice.number} will show ${dollars(Math.max(0, owedAfter))} owed after the refund.`,
        stripe ? "Stripe keeps its original processing fee. A refund can't be undone." : "No money moves through Selestial.",
      ],
      owedAfterCents: owedAfter,
      source: payment.source,
      bindsTo: await bindsTo("refund", facts),
    };
  },
});

/**
 * Starts a refund the Owner confirmed. A card refund is sent to Stripe once, under one request key; if
 * Stripe's answer is unclear the refund is marked "checking" and the same request is asked again, never
 * a new one. A refund of money paid outside Stripe is recorded as already returned.
 */
export const requestRefund = ownerMutation({
  args: { paymentId: v.id("payments"), amountCents: v.number(), reason: v.string(), alsoCredit: v.boolean(), bindsTo: v.string(), clientKey: v.string(), confirmedReturned: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "issue_refunds");
    if (!/^[\w-]{8,80}$/.test(args.clientKey)) throw userError("Reload the page and try again.");
    const repeat = await ctx.db
      .query("refunds")
      .withIndex("by_company_clientKey", (q) => q.eq("companyId", ctx.companyId).eq("clientKey", args.clientKey))
      .unique();
    if (repeat) return { refundId: repeat._id, repeated: true };
    const payment = await owned(ctx, args.paymentId);
    const facts = await refundFacts(ctx, payment, args.amountCents, args.alsoCredit);
    await requireSame(args.bindsTo, "refund", facts);
    if (payment.status !== "succeeded") throw userError("Only a payment that was received can be refunded.");
    if (payment.dispute) throw userError("This payment is disputed. Handle it in your Stripe Dashboard instead.");
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0 || args.amountCents > refundRoom(payment, facts.inFlight)) throw userError("That amount can't be refunded from this payment.");
    const reason = args.reason.trim();
    if (!reason) throw userError("Say why, so the customer's statement makes sense.");
    if (reason.length > LIMITS.reason) throw userError("Keep the reason under 500 characters.");
    if (payment.source === "manual" && !args.confirmedReturned) throw userError("Confirm that you returned this money to the customer.");
    const invoice = await owned(ctx, payment.invoiceId);
    if (args.alsoCredit && invoice.status === "void") throw userError("This invoice is void.");
    const now = Date.now();
    const manual = payment.source === "manual";
    const refundId = await ctx.db.insert("refunds", {
      companyId: ctx.companyId,
      paymentId: payment._id,
      invoiceId: payment.invoiceId,
      customerId: payment.customerId,
      amountCents: args.amountCents,
      reason,
      status: manual ? "recorded" : "sending",
      alsoCredit: args.alsoCredit,
      tries: 0,
      requestedBy: ctx.member._id,
      clientKey: args.clientKey,
      createdAt: now,
      updatedAt: now,
      settledAt: manual ? now : undefined,
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: manual ? "refund.recorded" : "refund.requested", actor: byMember(ctx), subject: { table: "refunds", id: refundId }, data: { amountCents: args.amountCents } });
    if (manual) {
      await ctx.db.patch(payment._id, { refundedCents: payment.refundedCents + args.amountCents, updatedAt: now });
      if (args.alsoCredit) await addRefundCredit(ctx, refundId);
      await recompute(ctx, payment.invoiceId);
    } else {
      await ctx.scheduler.runAfter(0, internal.financeStripe.sendRefund, { refundId });
    }
    return { refundId, repeated: false };
  },
});

/** The credit that goes with a refund the Owner chose to also take off what is owed. Written once the money is back. */
export async function addRefundCredit(ctx: MutationCtx, refundId: Id<"refunds">) {
  const refund = (await ctx.db.get(refundId))!;
  const existing = await ctx.db
    .query("invoiceCredits")
    .withIndex("by_company_invoice", (q) => q.eq("companyId", refund.companyId).eq("invoiceId", refund.invoiceId))
    .take(200);
  if (existing.some((c) => c.refundId === refund._id)) return;
  const creditId = await ctx.db.insert("invoiceCredits", { companyId: refund.companyId, invoiceId: refund.invoiceId, customerId: refund.customerId, amountCents: refund.amountCents, reason: refund.reason, refundId: refund._id, by: refund.requestedBy, at: Date.now() });
  await recordEvent(ctx, { companyId: refund.companyId, type: "credit.added", actor: { kind: "member", memberId: refund.requestedBy }, subject: { table: "invoiceCredits", id: creditId }, data: { amountCents: refund.amountCents } });
}
