/**
 * A client's Sales work, for their Clients & Properties profile: deals in the pipeline, quotes, proposals,
 * bookings and Sales recurring plans. Read from the Sales records that own them; every row links back to
 * Sales, where it is changed. Nothing here writes.
 *
 * Kept apart on purpose: a proposal accepted is not a booking, a booking requested is not confirmed, and a
 * confirmed booking says nothing about staffing (that is Dispatch's, on each visit).
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { owned } from "./lib/access";
import { companyQuery } from "./lib/builders";
import { cadenceLabel, type Cadence } from "./lib/sales/cadence";
import { todayIn, versionFor, versionsOf } from "./lib/sales/plans";
import { MILESTONE_WORDS } from "./pipeline";
import { STATUS_WORDS as PROPOSAL_WORDS } from "./proposals";

const SALES = "/app/agents/sales";

const STAGE_WORDS: Record<Doc<"salesOpportunities">["stage"], string> = { new: "New", qualifying: "Qualifying", quoting: "Quoting", won: "Won", lost: "Lost" };
const QUOTE_WORDS: Record<Doc<"salesQuotes">["status"], string> = { saved: "Saved, not sent", sent: "Sent", accepted: "Accepted", expired: "Expired", superseded: "Replaced by a newer quote", withdrawn: "Withdrawn" };
const BOOKING_WORDS: Record<Doc<"bookings">["status"], string> = { requested: "Requested, not confirmed", awaiting: "Waiting on what it needs", confirmed: "Confirmed", cancelled: "Cancelled" };
const PAYMENT_WORDS: Record<Doc<"bookings">["requirements"]["payment"]["state"], string> = { not_required: "No payment needed first", link_needed: "Payment link not sent", awaiting: "Waiting for payment", paid: "Paid", failed: "Payment failed", approval_needed: "Price waiting for the Owner" };
const AGREEMENT_WORDS: Record<Doc<"bookings">["requirements"]["agreement"]["state"], string> = { not_required: "No agreement needed", to_send: "Agreement not sent", sent: "Agreement sent, not signed", signed: "Agreement signed", declined: "Agreement declined" };
const SCHEDULE_WORDS: Record<Doc<"bookings">["requirements"]["schedule"]["state"], string> = { proposed: "Time proposed", held: "Time held", confirmed: "Time confirmed", expired: "Held time expired", conflict: "Time no longer free" };
const PLAN_WORDS: Record<Doc<"recurringPlans">["status"], string> = { pending: "Starts when its booking is confirmed", active: "Running", paused: "Paused", ended: "Ended" };

export const forClient = companyQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const byCustomer = { companyId: ctx.companyId, customerId: customer._id };
    const propertyName = async (id: Id<"properties">) => {
      const p = await ctx.db.get(id);
      return p ? p.label?.trim() || p.address.line1 : "A property";
    };
    const memberName = async (id: Id<"members"> | undefined) => (id ? ((await ctx.db.get(id))?.name ?? null) : null);

    const opportunities = await ctx.db
      .query("salesOpportunities")
      .withIndex("by_company_customer", (q) => q.eq("companyId", byCustomer.companyId).eq("customerId", byCustomer.customerId))
      .take(50);
    const deals = [];
    for (const o of opportunities.sort((a, b) => b.updatedAt - a.updatedAt)) {
      const draft = (
        await ctx.db
          .query("salesDrafts")
          .withIndex("by_company_opportunity", (q) => q.eq("companyId", ctx.companyId).eq("opportunityId", o._id))
          .order("desc")
          .take(1)
      )[0];
      deals.push({
        id: o._id,
        title: o.title,
        stage: o.stage,
        stageWords: STAGE_WORDS[o.stage],
        milestoneWords: o.milestone ? MILESTONE_WORDS[o.milestone] : null,
        open: o.stage !== "won" && o.stage !== "lost",
        owner: await memberName(o.ownerMemberId),
        nextAction: o.nextAction ?? null,
        nextActionAt: o.nextActionAt ?? null,
        overdue: o.stage !== "won" && o.stage !== "lost" && o.nextActionAt !== undefined && o.nextActionAt < Date.now(),
        followUps: o.followUps,
        estimateCents: o.estimateCents ?? null,
        closedReason: o.closedReason ?? null,
        href: draft ? `${SALES}/book/${draft._id}` : `${SALES}/pipeline`,
      });
    }

    const quoteRows = await ctx.db
      .query("salesQuotes")
      .withIndex("by_company_customer", (q) => q.eq("companyId", byCustomer.companyId).eq("customerId", byCustomer.customerId))
      .take(50);
    const quotes = [];
    for (const q of quoteRows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 15)) {
      quotes.push({ id: q._id, kind: q.kind, property: await propertyName(q.propertyId), visitCents: q.visit.totalCents, firstCents: q.first?.totalCents ?? null, cadence: q.cadence ? cadenceLabel(q.cadence as Cadence) : null, status: q.status, statusWords: q.status === "sent" && q.expiresAt < Date.now() ? "Expired" : QUOTE_WORDS[q.status], expiresAt: q.expiresAt, createdAt: q.createdAt, href: `${SALES}/book/${q.draftId}` });
    }

    const proposalRows = await ctx.db
      .query("proposals")
      .withIndex("by_company_customer", (q) => q.eq("companyId", byCustomer.companyId).eq("customerId", byCustomer.customerId))
      .take(50);
    const proposals = proposalRows
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 15)
      .map((p) => {
        const expired = (p.status === "sent" || p.status === "changes_requested") && p.expiresAt !== undefined && p.expiresAt < Date.now();
        const status = expired ? "expired" : p.status;
        return {
          id: p._id,
          title: p.title,
          template: p.template,
          status,
          statusWords: PROPOSAL_WORDS[status],
          // An accepted proposal is an agreement to proceed. Service starts only when its sites are activated in Sales.
          next: status === "accepted" ? "Accepted. No service is booked by accepting: set it up in Sales." : null,
          latestVersion: p.latestVersion,
          sentVersion: p.sentVersion,
          acceptedVersion: p.acceptedVersion ?? null,
          expiresAt: p.expiresAt ?? null,
          viewCount: p.viewCount,
          updatedAt: p.updatedAt,
          href: p.setupId ? `${SALES}/setups/${p.setupId}` : p.draftId ? `${SALES}/book/${p.draftId}` : `${SALES}/quotes-proposals`,
        };
      });

    const bookingRows = await ctx.db
      .query("bookings")
      .withIndex("by_company_customer", (q) => q.eq("companyId", byCustomer.companyId).eq("customerId", byCustomer.customerId))
      .take(50);
    const bookings = [];
    for (const b of bookingRows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 15)) {
      bookings.push({
        id: b._id,
        kind: b.kind,
        property: await propertyName(b.propertyId),
        startsAt: b.slot.startsAt,
        priceCents: b.priceCents,
        status: b.status,
        statusWords: BOOKING_WORDS[b.status],
        payment: PAYMENT_WORDS[b.requirements.payment.state],
        agreement: AGREEMENT_WORDS[b.requirements.agreement.state],
        schedule: SCHEDULE_WORDS[b.requirements.schedule.state],
        problem: b.problem ?? null,
        jobId: b.jobId ?? null,
        planId: b.planId ?? null,
        href: `${SALES}/book/${b.draftId}`,
      });
    }

    const planRows = await ctx.db
      .query("recurringPlans")
      .withIndex("by_company_customer", (q) => q.eq("companyId", byCustomer.companyId).eq("customerId", byCustomer.customerId))
      .take(20);
    const plans = [];
    for (const plan of planRows) {
      const versions = await versionsOf(ctx, plan._id);
      const current = versionFor(versions, todayIn(plan.timezone)) ?? versions[0] ?? null;
      const service = current ? await ctx.db.get(current.versionId) : null;
      plans.push({
        id: plan._id,
        propertyId: plan.propertyId,
        property: await propertyName(plan.propertyId),
        service: service?.spec.name ?? current?.serviceKey ?? "A service",
        serviceKey: current?.serviceKey ?? null,
        status: plan.status,
        statusWords: PLAN_WORDS[plan.status],
        cadence: current ? cadenceLabel(current.cadence as Cadence) : null,
        visitCents: current?.visitPriceCents ?? null,
        billing: plan.billing === "monthly_consolidated" ? "One invoice a month" : "Invoiced per visit",
        startDate: plan.startDate,
        endDate: plan.endDate ?? null,
        bookedThrough: plan.generatedThrough ?? null,
        pause: plan.pause ?? null,
        pendingChange: versions.some((ver) => ver.state === "pending"),
        href: `${SALES}/plans/${plan._id}`,
      });
    }

    return { deals, quotes, proposals, bookings, plans, newBooking: `${SALES}/new?mode=booking&customer=${customer._id}`, newProposal: `${SALES}/new?mode=proposal&customer=${customer._id}` };
  },
});
