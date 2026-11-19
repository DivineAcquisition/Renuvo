/**
 * A client's billing, for the Billing tab on their profile. Read from Finance's own records (invoices,
 * payments, refunds, credits) under Finance's rule: the Owner only, checked here on every call, not by
 * hiding the tab. Amounts are kept apart by what they are: invoiced, collected, still processing,
 * overdue, owed but not yet due, credited, and an estimate from booked visits that is not an invoice.
 * No card or bank details are read: a payment is described by its kind only.
 */
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { owned } from "./lib/access";
import { ownerQuery } from "./lib/builders";
import { requireFinance } from "./lib/finance/authority";
import { amountRequested, invoiceState, STATE_WORDS } from "./lib/finance/invoiceState";
import { invoiceRows, REFUND_COUNTS } from "./lib/finance/ledger";
import { localDateKey, settingsOf, settingsRow } from "./lib/finance/settings";

const DAY = 86_400_000;
const ESTIMATE_DAYS = 60;

const METHOD_WORDS: Record<Doc<"payments">["method"], string> = { card: "Card", bank_debit: "Bank debit", cash: "Cash", check: "Check", bank_transfer: "Bank transfer", zelle: "Zelle", venmo: "Venmo", other: "Other" };

export const summary = ownerQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    requireFinance(ctx, "read");
    const customer = await owned(ctx, args.customerId);
    const now = Date.now();
    const tz = ctx.company.timezone;
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .order("desc")
      .take(500);
    const issued = invoices.filter((i) => i.status !== "draft" && i.status !== "void");
    let collected = 0;
    let refunded = 0;
    const methods = new Set<string>();
    for (const invoice of issued) {
      const rows = await invoiceRows(ctx, invoice);
      for (const p of rows.payments) {
        if (p.status !== "succeeded") continue;
        collected += p.amountCents;
        methods.add(METHOD_WORDS[p.method]);
      }
      for (const r of rows.refunds) if (REFUND_COUNTS.includes(r.status)) refunded += r.amountCents;
    }
    let overdue = 0;
    let due = 0;
    let processing = 0;
    let credited = 0;
    for (const invoice of issued) {
      credited += invoice.totals.creditedCents;
      if (invoice.status !== "open") continue;
      processing += invoice.totals.processingCents;
      const owed = Math.max(0, invoice.totals.balanceCents - invoice.totals.processingCents);
      if (invoiceState(invoice, now) === "overdue") overdue += owed;
      else due += owed;
    }
    // Booked visits carry the price they were booked at. Until invoiced, that is an estimate, not money owed.
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_company_customer_start", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id).gte("startsAt", now - 90 * DAY))
      .take(300);
    let estimated = 0;
    let estimatedCount = 0;
    let unpriced = 0;
    let notInvoiced = 0;
    let notInvoicedCount = 0;
    for (const job of jobs) {
      // A correction visit is never billed: it is left out of what is owed and what is estimated.
      if (job.status === "cancelled" || job.skipped || job.recovery) continue;
      const invoice = await ctx.db
        .query("invoices")
        .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", job._id))
        .first();
      if (invoice && invoice.status !== "void") continue;
      if (job.status === "completed") {
        notInvoicedCount += 1;
        notInvoiced += job.priceCents ?? 0;
      } else if (job.startsAt >= now && job.startsAt < now + ESTIMATE_DAYS * DAY) {
        if (job.priceCents === undefined) unpriced += 1;
        else {
          estimated += job.priceCents;
          estimatedCount += 1;
        }
      }
    }
    const contacts = await ctx.db
      .query("clientContacts")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .take(50);
    const billingContacts = contacts.filter((c) => c.status === "active" && c.roles.includes("billing")).map((c) => ({ name: c.name, email: c.email ?? null, phone: c.phone ?? null }));
    const settings = settingsOf(await settingsRow(ctx, ctx.companyId));
    return {
      amounts: {
        invoicedCents: issued.reduce((sum, i) => sum + i.totals.totalCents, 0),
        collectedCents: collected - refunded,
        refundedCents: refunded,
        processingCents: processing,
        overdueCents: overdue,
        dueCents: due,
        creditedCents: credited,
        estimatedCents: estimated,
        estimatedVisits: estimatedCount,
        unpricedVisits: unpriced,
        notInvoicedCents: notInvoiced,
        notInvoicedVisits: notInvoicedCount,
      },
      invoices: invoices.slice(0, 25).map((i) => {
        const state = invoiceState(i, now);
        return {
          id: i._id,
          number: i.number ?? null,
          state,
          stateWords: STATE_WORDS[state],
          issuedOn: i.issuedAt ? localDateKey(i.issuedAt, tz) : null,
          dueOn: i.dueAt ? localDateKey(i.dueAt, tz) : null,
          totalCents: i.totals.totalCents,
          balanceCents: i.status === "open" ? i.totals.balanceCents : 0,
          requestedCents: amountRequested(i),
        };
      }),
      drafts: invoices.filter((i) => i.status === "draft").length,
      methods: [...methods],
      billingContacts,
      billingEmail: customer.email ?? null,
      termsDays: settings.paymentTermsDays,
      today: localDateKey(now, tz),
      estimateDays: ESTIMATE_DAYS,
    };
  },
});
