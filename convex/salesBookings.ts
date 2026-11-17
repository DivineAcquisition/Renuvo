/**
 * Booking helpers for the Sales workspace: the open times for an opportunity, and the deposit invoice.
 *
 * Money is Finance's. Sales never takes a payment and never issues an invoice: the Owner drafts the
 * deposit invoice from the accepted quote here, issues it in Finance, and the customer pays on Finance's
 * pay page. Sales only reads whether the ledger says the deposit is in.
 *
 * The internal functions are how an agreement being signed or a payment arriving reaches Sales: each
 * starts a run that reads the booking checklist again.
 */
import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { companyQuery, ownerMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { requireFinance } from "./lib/finance/authority";
import { emptyTotals } from "./lib/finance/ledger";
import { linesTotal } from "./lib/finance/money";
import { settingsOf, settingsRow } from "./lib/finance/settings";
import { openSlots } from "./lib/sales/capacity";
import { currentQuote, ownedOpportunity } from "./lib/sales/opportunities";
import { versionOf } from "./lib/sales/quotes";
import { enqueueRun } from "./lib/sales/runs";
import { publishedByKey } from "./lib/services/store";

/** Times that are open right now for this opportunity's quoted visit. Open is not reserved, and reserved is not booked. */
export const slots = companyQuery({
  args: { opportunityId: v.id("salesOpportunities") },
  handler: async (ctx, args) => {
    const opportunity = await ownedOpportunity(ctx, ctx.companyId, args.opportunityId);
    const quote = await currentQuote(ctx, opportunity);
    const version = quote ? await versionOf(ctx, quote, quote.acceptance?.version ?? quote.sentVersion ?? quote.currentVersion) : null;
    if (!version) return { slots: [], why: "A time can be chosen once there is a quote: the quote says how long the visit takes and how many cleaners it needs." };
    const property = opportunity.propertyId ? await ctx.db.get(opportunity.propertyId) : null;
    const postal = property?.address.postalCode ?? String(opportunity.facts.find((fact) => fact.key === "postalCode")?.value ?? "");
    if (!postal) return { slots: [], why: "The postal code is not known yet, so no time can be checked." };
    const service = await publishedByKey(ctx, ctx.companyId, version.serviceKey);
    const found = await openSlots(ctx, ctx.company, { serviceName: version.serviceName, skills: service?.version.spec.team.skills ?? [], crew: version.crewSize, postalCode: postal }, { durationMinutes: version.durationMinutes, limit: 9, except: { opportunityId: opportunity._id } });
    return { slots: found, why: found.length === 0 ? "No time in the next ten days has enough eligible cleaners free. Check availability under Cleaners, or choose a time and confirm it yourself." : null };
  },
});

function lineId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The Owner drafts the deposit invoice from the accepted quote. It is a draft: issuing it, and so asking for money, is done in Finance. */
export const draftDepositInvoice = ownerMutation({
  args: { opportunityId: v.id("salesOpportunities") },
  handler: async (ctx, args) => {
    requireFinance(ctx, "draft");
    const opportunity = await ownedOpportunity(ctx, ctx.companyId, args.opportunityId);
    const existing = opportunity.booking?.depositInvoiceId ? await ctx.db.get(opportunity.booking.depositInvoiceId) : null;
    if (existing && existing.status !== "void") return { invoiceId: existing._id, existing: true };
    const quote = await currentQuote(ctx, opportunity);
    const version = quote?.acceptance ? await versionOf(ctx, quote, quote.acceptance.version) : null;
    if (!quote || !version) throw userError("The deposit invoice is made from the quote the customer accepted, and none is accepted yet.");
    if (!version.depositCents) throw userError("The accepted quote does not ask for a deposit.");
    const settings = settingsOf(await settingsRow(ctx, ctx.companyId));
    const taxable = settings.taxableServiceIds.includes(version.serviceKey);
    const lines = [
      { id: lineId(), kind: "service" as const, description: `${version.serviceName} (quote Q-${quote.number}, version ${version.version})`.slice(0, 200), quantity: 1, unitCents: version.priceCents, amountCents: version.priceCents, taxable, serviceId: version.serviceKey },
      ...(version.discount ? [{ id: lineId(), kind: "discount" as const, description: `Discount: ${version.discount.reason}`.slice(0, 200), quantity: 1, unitCents: -version.discount.cents, amountCents: -version.discount.cents, taxable }] : []),
    ];
    const taxRateBps = taxable ? (settings.taxRateBps ?? 0) : 0;
    const base = linesTotal(lines, taxRateBps);
    const now = Date.now();
    const invoiceId = await ctx.db.insert("invoices", { companyId: ctx.companyId, customerId: opportunity.customerId, propertyId: opportunity.propertyId, status: "draft", lines, taxRateBps, taxLabel: settings.taxLabel, totals: { ...emptyTotals(), ...base, balanceCents: base.totalCents }, depositCents: Math.min(version.depositCents, Math.max(1, base.totalCents - 1)), memo: settings.invoiceNote ?? undefined, revision: 0, createdBy: ctx.member._id, createdAt: now, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "invoice.created", actor: byMember(ctx), subject: { table: "invoices", id: invoiceId }, data: { jobId: null } });
    await ctx.db.patch(opportunity._id, { booking: { ...opportunity.booking, depositInvoiceId: invoiceId }, humanTouches: opportunity.humanTouches + 1, updatedAt: now });
    return { invoiceId, existing: false };
  },
});

/** An invoice's money changed. If it is an opportunity's deposit, Sales reads the booking checklist again. */
export const invoiceChanged = internalMutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) return 0;
    const rows = await ctx.db
      .query("salesOpportunities")
      .withIndex("by_company_customer", (q) => q.eq("companyId", invoice.companyId).eq("customerId", invoice.customerId))
      .take(50);
    let started = 0;
    for (const row of rows) {
      if (row.stage !== "booking_pending" || row.booking?.depositInvoiceId !== invoice._id || row.takeover) continue;
      if (await enqueueRun(ctx, row, { trigger: "booking_change", key: `deposit:${row._id}:${invoice.totals.paidCents}:${invoice.totals.refundedCents}:${invoice.status}` })) started += 1;
    }
    return started;
  },
});

/** An agreement was fully signed. Any booking waiting on it for the same customer is looked at again. */
export const agreementSigned = internalMutation({
  args: { agreementId: v.id("agreements") },
  handler: async (ctx, args) => {
    const agreement = await ctx.db.get(args.agreementId);
    if (!agreement) return 0;
    const links = await ctx.db
      .query("agreementLinks")
      .withIndex("by_company_agreement", (q) => q.eq("companyId", agreement.companyId).eq("agreementId", agreement._id))
      .take(50);
    let started = 0;
    for (const link of links) {
      if (link.table !== "customers") continue;
      const customerId = ctx.db.normalizeId("customers", link.recordId);
      if (!customerId) continue;
      const rows = await ctx.db
        .query("salesOpportunities")
        .withIndex("by_company_customer", (q) => q.eq("companyId", agreement.companyId).eq("customerId", customerId))
        .take(50);
      for (const row of rows) {
        if (row.stage !== "booking_pending" || row.takeover) continue;
        if (await enqueueRun(ctx, row, { trigger: "booking_change", key: `agreement:${row._id}:${agreement._id}` })) started += 1;
      }
    }
    return started;
  },
});
