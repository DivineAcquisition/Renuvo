/**
 * Service plans: a client's recurring service or standing arrangement (lib/clients/plans.ts has the
 * rules). Everyone reads them. Owners and Managers set them up and change them, because a plan books and
 * cancels visits on its own.
 *
 * A plan's price is worked out by the pricing engine from the service's live version, the property's own
 * approved price if it has one, and the plan's schedule. It is not typed here: changing what a client pays
 * is Services & Pricing's job (a property price the Owner approves), not a plan's.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { addDays } from "./lib/agreements/store";
import { companyQuery, managerMutation, managerQuery, type MemberAccess } from "./lib/builders";
import { refreshClient } from "./lib/clients/directory";
import { bookAhead, HORIZON_DAYS, seriesDays, upcomingPlanVisits } from "./lib/clients/plans";
import { visitSummary } from "./lib/clients/signals";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { cancelVisit } from "./lib/jobs/visits";
import { isManager } from "./lib/roles";
import { quote, type QuoteInput } from "./lib/services/engine";
import { dayOf, engineInput, priceInForce } from "./lib/services/propertyPrices";
import { quoteInputValidator } from "./lib/services/schema";
import { scheduleValidator, type Schedule } from "./lib/services/spec";
import { publishedSpec } from "./lib/services/store";
import { optionalText } from "./lib/text";

type Ctx = QueryCtx & MemberAccess;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const STALE = "This plan changed after you opened it. Reload to see the latest, then make your change again.";

/** The price, time and crew of a plan's visits, from the engine. Refused when the job cannot be priced firmly. */
async function pricePlan(ctx: Ctx, input: { propertyId: Id<"properties">; serviceId: Id<"services">; cadence: Schedule | null; quoteInput: QuoteInput; startsOn: string }) {
  const property = await owned(ctx, input.propertyId);
  const service = await owned(ctx, input.serviceId);
  const live = await publishedSpec(ctx, service);
  if (!live || service.status !== "active") throw userError("Choose a live service from Services & Pricing.");
  const own = await priceInForce(ctx, ctx.companyId, property._id, service._id, input.startsOn);
  const base: QuoteInput = { ...input.quoteInput, ...(input.cadence ? { schedule: input.cadence } : {}), ...(own ? { propertyPrice: engineInput(own) } : {}) };
  delete base.dayFullnessPercent;
  const regular = quote(live.spec, { ...base, firstVisit: false });
  const first = quote(live.spec, { ...base, firstVisit: true });
  if (regular.outcome === "incomplete") throw userError(`The price needs: ${regular.missing.join(", ")}.`);
  if (regular.outcome === "walkthrough" || regular.totalCents === null) throw userError("This job needs a walkthrough before it has a price. Book the walkthrough first, or give the property its own price in Services & Pricing.");
  const firstDiffers = first.totalCents !== regular.totalCents || first.time.elapsedMinutes !== regular.time.elapsedMinutes;
  return {
    property,
    service,
    version: live.version,
    perVisitCents: regular.totalCents,
    durationMinutes: Math.max(15, regular.time.elapsedMinutes),
    crewSize: regular.time.crewSize,
    estimate: regular.outcome === "estimate",
    lines: regular.lines.map((l) => ({ label: l.label, amountCents: l.amountCents })),
    firstVisit: firstDiffers ? { priceCents: first.totalCents, durationMinutes: Math.max(15, first.time.elapsedMinutes) } : null,
    propertyPrice: own ? own.baseCents : null,
  };
}

const planInput = {
  propertyId: v.id("properties"),
  serviceId: v.id("services"),
  kind: v.union(v.literal("recurring"), v.literal("standing")),
  cadence: v.union(scheduleValidator, v.null()),
  startsOn: v.string(),
  quoteInput: quoteInputValidator,
};

/** What a plan would cost and take, before it is set up. */
export const preview = companyQuery({
  args: planInput,
  handler: async (ctx, args) => {
    const priced = await pricePlan(ctx, { ...args, cadence: args.kind === "recurring" ? args.cadence : null, quoteInput: args.quoteInput as QuoteInput });
    const days = args.kind === "recurring" && args.cadence ? seriesDays({ cadence: args.cadence, startsOn: args.startsOn, skipped: [], state: "active" }, args.startsOn, addDays(args.startsOn, 90)).slice(0, 6) : [];
    return { perVisitCents: priced.perVisitCents, durationMinutes: priced.durationMinutes, crewSize: priced.crewSize, estimate: priced.estimate, lines: priced.lines, firstVisit: priced.firstVisit, propertyPrice: priced.propertyPrice, version: priced.version, firstDays: days };
  },
});

/** A client's plans, with what each promises and what comes next. */
export const forClient = companyQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const plans = await ctx.db
      .query("servicePlans")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .take(100);
    const out = [];
    for (const plan of plans.sort((a, b) => Number(a.state === "ended") - Number(b.state === "ended") || b.createdAt - a.createdAt)) {
      const service = await ctx.db.get(plan.serviceId);
      const property = await ctx.db.get(plan.propertyId);
      const agreement = plan.agreementId ? await ctx.db.get(plan.agreementId) : null;
      const visits = await upcomingPlanVisits(ctx, plan, dayOf(Date.now(), ctx.company.timezone));
      const next = visits[0] ?? null;
      out.push({
        id: plan._id,
        kind: plan.kind,
        state: plan.state,
        cadence: plan.cadence,
        service: service?.name ?? "A service",
        serviceId: plan.serviceId,
        property: property ? property.label?.trim() || property.address.line1 : "A property",
        propertyId: plan.propertyId,
        startsOn: plan.startsOn,
        startTime: plan.startTime,
        durationMinutes: plan.durationMinutes,
        arrivalWindowMinutes: plan.arrivalWindowMinutes,
        crewSize: plan.crewSize,
        priceCents: plan.priceCents,
        firstVisit: plan.firstVisit,
        scopeNote: plan.scopeNote,
        agreement: agreement && agreement.companyId === ctx.companyId ? { id: agreement._id, title: agreement.title, workflow: agreement.workflow } : null,
        bookedThrough: plan.bookedThrough ?? null,
        pausedFrom: plan.pausedFrom ?? null,
        pausedUntil: plan.pausedUntil ?? null,
        endsOn: plan.endsOn ?? null,
        skipped: plan.skipped,
        next: next ? await visitSummary(ctx, ctx.company, next, () => (property ? property.label?.trim() || property.address.line1 : "")) : null,
        booked: visits.length,
        revision: plan.revision,
        createdAt: plan.createdAt,
      });
    }
    return { plans: out, canChange: isManager(ctx.role), horizonDays: HORIZON_DAYS };
  },
});

function checkDay(day: string, label: string) {
  if (!DATE.test(day)) throw userError(`${label} must be a calendar day.`);
}

/** Sets up a plan. Started at once, a recurring plan books its visits through the horizon. */
export const create = managerMutation({
  args: { ...planInput, customerId: v.id("customers"), startTime: v.string(), arrivalWindowMinutes: v.number(), scopeNote: v.optional(v.string()), agreementId: v.optional(v.id("agreements")), start: v.boolean() },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const property = await owned(ctx, args.propertyId);
    if (property.customerId !== customer._id) throw userError("That property belongs to a different client.");
    if (property.status !== "active") throw userError("That property is archived.");
    if (customer.status !== "active") throw userError("Restore the client first.");
    checkDay(args.startsOn, "The first day");
    if (args.startsOn < dayOf(Date.now(), ctx.company.timezone)) throw userError("The first day cannot be in the past.");
    if (!TIME.test(args.startTime)) throw userError("The start time must be a time of day.");
    if (!Number.isInteger(args.arrivalWindowMinutes) || args.arrivalWindowMinutes < 0 || args.arrivalWindowMinutes > 720) throw userError("The arrival window must be from 0 to 720 minutes.");
    if (args.kind === "recurring" && !args.cadence) throw userError("Choose how often.");
    if (args.agreementId) {
      const agreement = await owned(ctx, args.agreementId);
      if (agreement.category !== "customer") throw userError("Link a customer agreement.");
    }
    const priced = await pricePlan(ctx, { ...args, cadence: args.kind === "recurring" ? args.cadence : null, quoteInput: args.quoteInput as QuoteInput });
    const now = Date.now();
    const planId = await ctx.db.insert("servicePlans", {
      companyId: ctx.companyId,
      customerId: customer._id,
      propertyId: property._id,
      serviceId: priced.service._id,
      kind: args.kind,
      state: args.start ? "active" : "setup",
      cadence: args.kind === "recurring" ? args.cadence : null,
      startsOn: args.startsOn,
      startTime: args.startTime,
      durationMinutes: priced.durationMinutes,
      arrivalWindowMinutes: args.arrivalWindowMinutes,
      crewSize: priced.crewSize,
      quoteInput: JSON.stringify(args.quoteInput),
      priceCents: priced.perVisitCents,
      firstVisit: priced.firstVisit ? { priceCents: priced.firstVisit.priceCents, durationMinutes: priced.firstVisit.durationMinutes, note: "" } : null,
      scopeNote: optionalText(args.scopeNote, "Notes for the crew", 1000) ?? "",
      preferredCleanerIds: [],
      ...(args.agreementId ? { agreementId: args.agreementId } : {}),
      skipped: [],
      revision: 1,
      createdBy: byMember(ctx),
      createdAt: now,
      updatedAt: now,
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: args.kind === "standing" ? "plan.standing_set_up" : args.start ? "plan.started" : "plan.set_up", actor: byMember(ctx), subject: { table: "customers", id: customer._id }, data: { service: priced.service.name, cadence: args.cadence ?? "none" } });
    const result = args.start ? await bookAhead(ctx, (await ctx.db.get(planId))!, byMember(ctx)) : { booked: 0, problems: [] };
    await refreshClient(ctx, customer._id);
    return { planId, ...result };
  },
});

async function ownedPlan(ctx: Ctx, planId: Id<"servicePlans">, expectedRevision: number) {
  const plan = await owned(ctx, planId);
  if (plan.revision !== expectedRevision) throw userError(STALE);
  return plan;
}

/** Starts a plan that was set up. */
export const start = managerMutation({
  args: { planId: v.id("servicePlans"), expectedRevision: v.number() },
  handler: async (ctx, args) => {
    const plan = await ownedPlan(ctx, args.planId, args.expectedRevision);
    if (plan.state !== "setup") throw userError("Only a plan being set up can be started.");
    const today = dayOf(Date.now(), ctx.company.timezone);
    await ctx.db.patch(plan._id, { state: "active", startsOn: plan.startsOn < today ? today : plan.startsOn, revision: plan.revision + 1, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "plan.started", actor: byMember(ctx), subject: { table: "customers", id: plan.customerId } });
    return bookAhead(ctx, (await ctx.db.get(plan._id))!, byMember(ctx));
  },
});

/** The visits a pause, an end or a series change from a day would cancel. Shown before anything is changed. */
export const affected = managerQuery({
  args: { planId: v.id("servicePlans"), from: v.string(), until: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const plan = await owned(ctx, args.planId);
    checkDay(args.from, "The day");
    const property = await ctx.db.get(plan.propertyId);
    const visits = (await upcomingPlanVisits(ctx, plan, args.from)).filter((job) => !args.until || (job.planDate ?? "") < args.until);
    const out = await Promise.all(visits.map((job) => visitSummary(ctx, ctx.company, job, () => property?.label?.trim() || property?.address.line1 || "")));
    return { visits: out, revision: plan.revision };
  },
});

/** Cancels exactly the visits the person was shown. If the plan's visits changed since, nothing is changed. */
async function cancelShown(ctx: MutationCtx & MemberAccess, plan: Doc<"servicePlans">, from: string, until: string | undefined, shown: Id<"jobs">[], reason: string, skipped: boolean) {
  const visits = (await upcomingPlanVisits(ctx, plan, from)).filter((job) => !until || (job.planDate ?? "") < until);
  const now = visits.map((j) => j._id as string).sort().join(",");
  if (now !== [...shown].map(String).sort().join(",")) throw userError("The plan's booked visits changed after you looked. Review the visits again before changing the plan.");
  for (const job of visits) await cancelVisit(ctx, job, reason, byMember(ctx), skipped);
  return visits.length;
}

/** "This visit only": skips one of the plan's visits. The day is never booked again. */
export const skipVisit = managerMutation({
  args: { planId: v.id("servicePlans"), expectedRevision: v.number(), jobId: v.id("jobs"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const plan = await ownedPlan(ctx, args.planId, args.expectedRevision);
    const job = await owned(ctx, args.jobId);
    if (job.planId !== plan._id || !job.planDate) throw userError("That visit is not part of this plan.");
    if (job.status !== "scheduled") throw userError("Only a visit that has not started can be skipped.");
    await cancelVisit(ctx, job, optionalText(args.reason, "The reason", 300) ?? "Skipped (this visit only).", byMember(ctx), true);
    await ctx.db.patch(plan._id, { skipped: [...new Set([...plan.skipped, job.planDate])].sort(), revision: plan.revision + 1, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "plan.visit_skipped", actor: byMember(ctx), subject: { table: "customers", id: plan.customerId }, data: { day: job.planDate } });
    return null;
  },
});

/** Pauses a plan from a day, until a day or until resumed. The visits in the pause are cancelled, as shown. */
export const pause = managerMutation({
  args: { planId: v.id("servicePlans"), expectedRevision: v.number(), from: v.string(), until: v.optional(v.string()), shown: v.array(v.id("jobs")), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const plan = await ownedPlan(ctx, args.planId, args.expectedRevision);
    if (plan.kind !== "recurring" || plan.state !== "active") throw userError("Only a running recurring plan can be paused.");
    checkDay(args.from, "The first day of the pause");
    if (args.until) {
      checkDay(args.until, "The day it resumes");
      if (args.until <= args.from) throw userError("It must resume after the pause starts.");
    }
    const cancelled = await cancelShown(ctx, plan, args.from, args.until, args.shown, optionalText(args.reason, "The reason", 300) ?? "The plan is paused.", true);
    await ctx.db.patch(plan._id, { state: args.until ? "active" : "paused", pausedFrom: args.from, pausedUntil: args.until, revision: plan.revision + 1, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "plan.paused", actor: byMember(ctx), subject: { table: "customers", id: plan.customerId }, data: { from: args.from, until: args.until ?? "until resumed", cancelled } });
    await refreshClient(ctx, plan.customerId);
    return { cancelled };
  },
});

/** Resumes a paused plan from today, and books ahead again. */
export const resume = managerMutation({
  args: { planId: v.id("servicePlans"), expectedRevision: v.number() },
  handler: async (ctx, args) => {
    const plan = await ownedPlan(ctx, args.planId, args.expectedRevision);
    if (plan.state !== "paused" && !plan.pausedFrom) throw userError("This plan is not paused.");
    // Booking starts again from today. Days the pause cancelled keep their skipped visits, so they are not booked again.
    await ctx.db.patch(plan._id, { state: "active", pausedFrom: undefined, pausedUntil: undefined, bookedThrough: undefined, revision: plan.revision + 1, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "plan.resumed", actor: byMember(ctx), subject: { table: "customers", id: plan.customerId } });
    return bookAhead(ctx, (await ctx.db.get(plan._id))!, byMember(ctx));
  },
});

/** Ends a plan from a day. The visits from then on are cancelled, as shown. History is kept. */
export const end = managerMutation({
  args: { planId: v.id("servicePlans"), expectedRevision: v.number(), from: v.string(), shown: v.array(v.id("jobs")), reason: v.string() },
  handler: async (ctx, args) => {
    const plan = await ownedPlan(ctx, args.planId, args.expectedRevision);
    if (plan.state === "ended") throw userError("This plan has already ended.");
    checkDay(args.from, "The day it ends");
    const reason = optionalText(args.reason, "The reason", 300);
    if (!reason) throw userError("Say why the plan ends.");
    const cancelled = await cancelShown(ctx, plan, args.from, undefined, args.shown, `The plan ended: ${reason}`, false);
    await ctx.db.patch(plan._id, { state: "ended", endsOn: args.from, revision: plan.revision + 1, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "plan.ended", actor: byMember(ctx), subject: { table: "customers", id: plan.customerId }, data: { from: args.from, cancelled, reason } });
    await refreshClient(ctx, plan.customerId);
    return { cancelled };
  },
});

/**
 * "This and future visits": changes the series from a day. Visits from then on that have not started
 * are cancelled, as shown, and the series is booked again with the new time, cadence or arrival window.
 * The price is not changed here.
 */
export const changeSeries = managerMutation({
  args: { planId: v.id("servicePlans"), expectedRevision: v.number(), from: v.string(), shown: v.array(v.id("jobs")), cadence: v.optional(scheduleValidator), startTime: v.optional(v.string()), arrivalWindowMinutes: v.optional(v.number()), scopeNote: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const plan = await ownedPlan(ctx, args.planId, args.expectedRevision);
    if (plan.kind !== "recurring" || plan.state !== "active") throw userError("Only a running recurring plan's series can be changed.");
    checkDay(args.from, "The first day of the change");
    if (args.from < dayOf(Date.now(), ctx.company.timezone)) throw userError("A change cannot start in the past.");
    if (args.startTime !== undefined && !TIME.test(args.startTime)) throw userError("The start time must be a time of day.");
    if (args.arrivalWindowMinutes !== undefined && (!Number.isInteger(args.arrivalWindowMinutes) || args.arrivalWindowMinutes < 0 || args.arrivalWindowMinutes > 720)) throw userError("The arrival window must be from 0 to 720 minutes.");
    const cancelled = await cancelShown(ctx, plan, args.from, undefined, args.shown, "Replaced by a change to the plan's series.", false);
    await ctx.db.patch(plan._id, {
      ...(args.cadence ? { cadence: args.cadence } : {}),
      ...(args.startTime ? { startTime: args.startTime } : {}),
      ...(args.arrivalWindowMinutes !== undefined ? { arrivalWindowMinutes: args.arrivalWindowMinutes } : {}),
      ...(args.scopeNote !== undefined ? { scopeNote: optionalText(args.scopeNote, "Notes for the crew", 1000) ?? "" } : {}),
      // The series restarts from the day of the change; days before it keep their bookings.
      startsOn: args.from,
      bookedThrough: addDays(args.from, -1),
      skipped: plan.skipped.filter((day) => day < args.from),
      revision: plan.revision + 1,
      updatedAt: Date.now(),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "plan.series_changed", actor: byMember(ctx), subject: { table: "customers", id: plan.customerId }, data: { from: args.from, cancelled } });
    const result = await bookAhead(ctx, (await ctx.db.get(plan._id))!, byMember(ctx));
    return { cancelled, ...result };
  },
});

/** Once a day: every running recurring plan books its visits through the horizon. */
export const bookAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    let booked = 0;
    const companies = await ctx.db.query("companies").take(500);
    for (const company of companies) {
      if (company.suspendedAt) continue;
      const plans = await ctx.db
        .query("servicePlans")
        .withIndex("by_company_state", (q) => q.eq("companyId", company._id).eq("state", "active"))
        .take(500);
      for (const plan of plans) {
        // A paused-until plan resumes on its own once the pause is over.
        if (plan.pausedUntil && plan.pausedUntil <= dayOf(Date.now(), company.timezone)) await ctx.db.patch(plan._id, { pausedFrom: undefined, pausedUntil: undefined });
        booked += (await bookAhead(ctx, (await ctx.db.get(plan._id))!, { kind: "system" })).booked;
      }
    }
    return { booked };
  },
});
