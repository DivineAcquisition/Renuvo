/**
 * Managing a recurring plan from the customer record, Sales or Dispatch: its upcoming visits with their
 * schedule and staffing shown separately, billing, agreement and history, and changes to one visit or to
 * the series from a date. Every change says what it does to visits already made before it is applied.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { requestApproval } from "./lib/approvalQueue";
import { companyMutation, companyQuery, type MemberAccess } from "./lib/builders";
import { coverageOf } from "./lib/dispatch/crew";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { isOwner } from "./lib/roles";
import { cadenceValidator } from "./lib/sales/schema";
import { cadenceLabel, cadenceProblem, cadenceRate, type Cadence } from "./lib/sales/cadence";
import { cancelVisitJob, draftMonthlyInvoice, futureVisits, generateVisits, isDate, replaceFrom, todayIn, versionFor, versionsOf } from "./lib/sales/plans";
import { priceChoice } from "./lib/sales/pricing";
import { pricingSchedule } from "./lib/sales/cadence";
import { quoteInputValidator } from "./lib/services/schema";
import { formatCents } from "./lib/services/words";
import { optionalText, text } from "./lib/text";

type Ctx = MutationCtx & MemberAccess;

export const get = companyQuery({
  args: { planId: v.id("recurringPlans") },
  handler: async (ctx, args) => {
    const plan = await owned(ctx, args.planId);
    const customer = await ctx.db.get(plan.customerId);
    const property = await ctx.db.get(plan.propertyId);
    const all = await ctx.db
      .query("recurringPlanVersions")
      .withIndex("by_plan_version", (q) => q.eq("planId", plan._id))
      .take(100);
    const versions = await versionsOf(ctx, plan._id);
    const today = todayIn(plan.timezone);
    const current = versionFor(versions, today) ?? versions[0] ?? null;
    const rows = await ctx.db
      .query("planVisits")
      .withIndex("by_plan_date", (q) => q.eq("planId", plan._id))
      .take(400);
    const visits = [];
    for (const row of rows.sort((a, b) => a.date.localeCompare(b.date))) {
      if (row.state === "cancelled" && row.exception?.startsWith("Replaced")) continue;
      const job = row.jobId ? await ctx.db.get(row.jobId) : null;
      const assignments = job
        ? await ctx.db
            .query("assignments")
            .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", job._id))
            .take(20)
        : [];
      const coverage = job ? coverageOf(assignments, job) : null;
      visits.push({
        _id: row._id,
        date: row.date,
        state: row.state,
        first: row.first,
        version: row.version,
        exception: row.exception ?? null,
        job: job ? { _id: job._id, startsAt: job.startsAt, status: job.status, priceCents: job.priceCents ?? null, service: job.serviceSnapshot?.name ?? job.serviceType } : null,
        staffing: coverage,
      });
    }
    const booking = plan.bookingId ? await ctx.db.get(plan.bookingId) : null;
    const agreementId = booking?.requirements.agreement.agreementId;
    const agreement = agreementId ? await ctx.db.get(agreementId) : null;
    const events = await ctx.db
      .query("events")
      .withIndex("by_company_subject_at", (q) => q.eq("companyId", ctx.companyId).eq("subjectId", plan._id))
      .order("desc")
      .take(30);
    return {
      plan,
      customer: customer ? { _id: customer._id, name: customer.name } : null,
      property: property ? { label: property.label ?? null, line1: property.address.line1, city: property.address.city } : null,
      current: current ? { ...current, cadenceWords: cadenceLabel(current.cadence as Cadence), rate: cadenceRate(current.cadence as Cadence) } : null,
      pendingVersions: all.filter((row) => row.state === "pending").map((row) => ({ version: row.version, effectiveFrom: row.effectiveFrom, visitPriceCents: row.visitPriceCents, reason: row.reason ?? null })),
      upcoming: visits.filter((row) => row.date >= today).slice(0, 24),
      past: visits.filter((row) => row.date < today).slice(-12).reverse(),
      agreement: agreement ? { id: agreement._id, title: agreement.title, workflow: agreement.workflow } : null,
      billingWords: plan.billing === "per_visit" ? "Each completed visit is invoiced on its own in Finance." : "Completed visits are gathered into one draft invoice each calendar month, for the Owner to review and issue.",
      history: events.map((event) => ({ type: event.type, at: event.at })),
      today,
    };
  },
});

export const forCustomer = companyQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const plans = await ctx.db
      .query("recurringPlans")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .take(20);
    const out = [];
    for (const plan of plans) {
      const versions = await versionsOf(ctx, plan._id);
      const current = versionFor(versions, todayIn(plan.timezone)) ?? versions[0];
      out.push({ _id: plan._id, status: plan.status, cadence: current ? cadenceLabel(current.cadence as Cadence) : null, priceCents: current?.visitPriceCents ?? null });
    }
    return out;
  },
});

export const list = companyQuery({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const status of ["active", "paused", "pending"] as const) {
      const rows = await ctx.db
        .query("recurringPlans")
        .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", status))
        .take(200);
      for (const plan of rows) {
        const customer = await ctx.db.get(plan.customerId);
        const versions = await versionsOf(ctx, plan._id);
        const current = versionFor(versions, todayIn(plan.timezone)) ?? versions[0];
        const exceptions = await ctx.db
          .query("planVisits")
          .withIndex("by_plan_date", (q) => q.eq("planId", plan._id).gte("date", todayIn(plan.timezone)))
          .take(50);
        out.push({ _id: plan._id, customer: customer?.name ?? "Customer", status: plan.status, cadence: current ? cadenceLabel(current.cadence as Cadence) : null, priceCents: current?.visitPriceCents ?? null, exceptions: exceptions.filter((row) => row.state === "exception").length });
      }
    }
    return out;
  },
});

async function visitOf(ctx: Ctx, visitId: Id<"planVisits">) {
  const visit = await owned(ctx, visitId);
  const plan = await owned(ctx, visit.planId);
  return { visit, plan };
}

/** Skips one visit. Its job is cancelled the way Dispatch cancels one; the rest of the series is untouched. */
export const skipVisit = companyMutation({
  args: { visitId: v.id("planVisits"), reason: v.string() },
  handler: async (ctx, args) => {
    const { visit, plan } = await visitOf(ctx, args.visitId);
    const reason = text(args.reason, "The reason", 300);
    if (visit.state !== "scheduled" && visit.state !== "exception") throw userError("Only an upcoming visit can be skipped.");
    if (visit.jobId) {
      const job = await ctx.db.get(visit.jobId);
      if (job && job.status !== "scheduled") throw userError("This visit has started or finished, so it can't be skipped.");
      if (job) await cancelVisitJob(ctx, job, `Skipped: ${reason}`, byMember(ctx));
    }
    await ctx.db.patch(visit._id, { state: "skipped", exception: reason, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "recurring_plan.visit_skipped", actor: byMember(ctx), subject: { table: "recurringPlans", id: plan._id }, data: { date: visit.date } });
    return { effect: plan.billing === "per_visit" ? "Nothing is billed for a skipped visit." : "A skipped visit is left out of the month's invoice." };
  },
});

/** Pauses the plan from a date: scheduled visits in the pause are cancelled, and none are made until it ends. */
export const pause = companyMutation({
  args: { planId: v.id("recurringPlans"), from: v.string(), until: v.optional(v.string()), reason: v.string() },
  handler: async (ctx, args) => {
    const plan = await owned(ctx, args.planId);
    if (plan.status !== "active") throw userError("Only an active plan can be paused.");
    if (!isDate(args.from) || (args.until && (!isDate(args.until) || args.until < args.from))) throw userError("Choose when the pause starts, and an end on or after it.");
    if (args.from < todayIn(plan.timezone)) throw userError("A pause starts today or later.");
    const reason = text(args.reason, "The reason", 300);
    let cancelled = 0;
    for (const row of await futureVisits(ctx, plan, args.from)) {
      if (args.until && row.visit.date > args.until) continue;
      await cancelVisitJob(ctx, row.job, `Plan paused: ${reason}`, byMember(ctx));
      await ctx.db.patch(row.visit._id, { state: "skipped", exception: "Paused", updatedAt: Date.now() });
      cancelled += 1;
    }
    await ctx.db.patch(plan._id, { status: args.until ? "active" : "paused", pause: { from: args.from, ...(args.until ? { until: args.until } : {}), reason }, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "recurring_plan.paused", actor: byMember(ctx), subject: { table: "recurringPlans", id: plan._id }, data: { from: args.from, until: args.until ?? null, cancelled } });
    return { cancelled };
  },
});

export const resume = companyMutation({
  args: { planId: v.id("recurringPlans"), from: v.string() },
  handler: async (ctx, args) => {
    const plan = await owned(ctx, args.planId);
    if (!plan.pause && plan.status !== "paused") throw userError("This plan isn't paused.");
    if (!isDate(args.from) || args.from < todayIn(plan.timezone)) throw userError("Resume today or later.");
    await ctx.db.patch(plan._id, { status: "active", pause: undefined, updatedAt: Date.now() });
    const fresh = (await ctx.db.get(plan._id))!;
    await replaceFrom(ctx, fresh, args.from, "Plan resumed", byMember(ctx));
    const made = await generateVisits(ctx, (await ctx.db.get(plan._id))!, byMember(ctx));
    await recordEvent(ctx, { companyId: ctx.companyId, type: "recurring_plan.resumed", actor: byMember(ctx), subject: { table: "recurringPlans", id: plan._id }, data: { from: args.from, made } });
    return { made };
  },
});

/** What a change from a date would do, before it is applied. */
export const changePreview = companyQuery({
  args: { planId: v.id("recurringPlans"), effectiveFrom: v.string(), serviceKey: v.optional(v.string()), quoteInput: v.optional(quoteInputValidator), cadence: v.optional(cadenceValidator) },
  handler: async (ctx, args) => {
    const plan = await owned(ctx, args.planId);
    const versions = await versionsOf(ctx, plan._id);
    const current = versionFor(versions, args.effectiveFrom) ?? versions[versions.length - 1]!;
    const cadence = (args.cadence ?? current.cadence) as Cadence;
    const priced = await priceChoice(ctx, ctx.company, { key: args.serviceKey ?? current.serviceKey, input: args.quoteInput ?? current.quoteInput }, { schedule: pricingSchedule(cadence) }, null);
    const replaced = isDate(args.effectiveFrom) ? await futureVisits(ctx, plan, args.effectiveFrom) : [];
    const newPrice = priced?.quote.totalCents ?? null;
    return {
      currentPriceCents: current.visitPriceCents,
      newPriceCents: newPrice,
      outcome: priced?.quote.outcome ?? null,
      cadence: cadenceLabel(cadence),
      priceChanges: newPrice !== null && newPrice !== current.visitPriceCents,
      needsApproval: newPrice !== null && newPrice !== current.visitPriceCents && !isOwner(ctx.role),
      replaced: replaced.map((row) => ({ date: row.visit.date, accepted: row.accepted })),
      keeps: "Visits before this date, completed visits, issued invoices and payments stay exactly as they are.",
    };
  },
});

/**
 * Changes the series from a date: how often, the arrival time, the service or its answers. The price is
 * the engine's on the published service; a different price waits for the Owner unless the Owner made it.
 */
export const changeFuture = companyMutation({
  args: {
    planId: v.id("recurringPlans"),
    effectiveFrom: v.string(),
    cadence: v.optional(cadenceValidator),
    arrivalMinute: v.optional(v.number()),
    serviceKey: v.optional(v.string()),
    quoteInput: v.optional(quoteInputValidator),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const plan = await owned(ctx, args.planId);
    if (plan.status === "ended") throw userError("This plan has ended.");
    if (!isDate(args.effectiveFrom) || args.effectiveFrom < todayIn(plan.timezone)) throw userError("Changes start today or later.");
    if (plan.endDate && args.effectiveFrom > plan.endDate) throw userError("That date is after the plan ends.");
    const reason = text(args.reason, "The reason", 300);
    const versions = await versionsOf(ctx, plan._id);
    const current = versionFor(versions, args.effectiveFrom) ?? versions[versions.length - 1]!;
    const cadence = (args.cadence ?? current.cadence) as Cadence;
    const problem = cadenceProblem(cadence);
    if (problem) throw userError(problem);
    if (args.arrivalMinute !== undefined && (!Number.isInteger(args.arrivalMinute) || args.arrivalMinute < 0 || args.arrivalMinute >= 24 * 60)) throw userError("Choose an arrival time in the day.");
    const priced = await priceChoice(ctx, ctx.company, { key: args.serviceKey ?? current.serviceKey, input: args.quoteInput ?? current.quoteInput }, { schedule: pricingSchedule(cadence) }, null);
    if (!priced || priced.quote.totalCents === null || priced.quote.outcome === "incomplete" || priced.quote.outcome === "walkthrough") throw userError("The new service can't be priced from its answers. Check them in Services & Pricing.");
    const priceChanges = priced.quote.totalCents !== current.visitPriceCents;
    const all = await ctx.db
      .query("recurringPlanVersions")
      .withIndex("by_plan_version", (q) => q.eq("planId", plan._id))
      .take(200);
    const version = Math.max(...all.map((row) => row.version)) + 1;
    const pending = priceChanges && !isOwner(ctx.role);
    const versionId = await ctx.db.insert("recurringPlanVersions", {
      companyId: ctx.companyId,
      planId: plan._id,
      version,
      effectiveFrom: args.effectiveFrom,
      cadence,
      arrivalMinute: args.arrivalMinute ?? current.arrivalMinute,
      arrivalWindowMinutes: current.arrivalWindowMinutes,
      durationMinutes: Math.max(15, priced.quote.time.elapsedMinutes),
      crew: priced.quote.time.crewSize,
      serviceKey: priced.serviceKey,
      versionId: priced.versionId,
      quoteInput: priced.input,
      visitPriceCents: priced.quote.totalCents,
      ...(current.preferredCleanerId ? { preferredCleanerId: current.preferredCleanerId } : {}),
      reason,
      state: pending ? "pending" : "active",
      createdBy: ctx.member._id,
      createdAt: Date.now(),
    });
    if (pending) {
      const customer = await ctx.db.get(plan.customerId);
      const approvalId = await requestApproval(ctx, {
        companyId: ctx.companyId,
        action: "sales.discount_out_of_band",
        summary: `Change ${customer?.name ?? "a customer"}'s recurring price from ${formatCents(current.visitPriceCents)} to ${formatCents(priced.quote.totalCents)} per visit from ${args.effectiveFrom}`,
        reason,
        decideBy: Date.now() + 3 * 86_400_000,
        authorizes: "Using the new price for visits on and after that date. Earlier visits, invoices and payments are unchanged.",
        ifWaiting: "Visits keep the current price.",
        proposal: { kind: "plan_change", planId: plan._id, version },
        about: { table: "customers", id: plan.customerId },
      });
      await ctx.db.patch(versionId, { approvalId });
      return { applied: false, waitingForApproval: true, replaced: 0 };
    }
    const replaced = await applyVersion(ctx, plan, args.effectiveFrom, version, reason);
    return { applied: true, waitingForApproval: false, replaced };
  },
});

async function applyVersion(ctx: MutationCtx, plan: Doc<"recurringPlans">, effectiveFrom: string, version: number, reason: string) {
  const actor = { kind: "system" as const };
  const replaced = await replaceFrom(ctx, plan, effectiveFrom, `Plan changed: ${reason}`, actor);
  await ctx.db.patch(plan._id, { currentVersion: version, updatedAt: Date.now() });
  await generateVisits(ctx, (await ctx.db.get(plan._id))!, actor);
  await recordEvent(ctx, { companyId: plan.companyId, type: "recurring_plan.changed", actor, subject: { table: "recurringPlans", id: plan._id }, data: { version, effectiveFrom, replaced } });
  return replaced;
}

/** Carries out an approval of a price change to a plan. */
export async function afterPlanDecision(ctx: MutationCtx, approval: Doc<"approvals">, decision: "approved" | "changed" | "skipped") {
  const at = Date.now();
  if (approval.proposal?.kind !== "plan_change") return { ok: false, detail: "Not a plan change.", at };
  const plan = await ctx.db.get(approval.proposal.planId);
  if (!plan || plan.companyId !== approval.companyId) return { ok: false, detail: "The plan no longer exists.", at };
  const versionNumber = approval.proposal.version;
  const row = await ctx.db
    .query("recurringPlanVersions")
    .withIndex("by_plan_version", (q) => q.eq("planId", plan._id).eq("version", versionNumber))
    .unique();
  if (!row || row.state !== "pending") return { ok: false, detail: "This change was already decided.", at };
  if (decision !== "approved") {
    await ctx.db.patch(row._id, { state: "declined" });
    return { ok: true, detail: "The price change was declined. Visits keep the current price.", at };
  }
  if (row.effectiveFrom < todayIn(plan.timezone)) {
    await ctx.db.patch(row._id, { state: "declined" });
    return { ok: false, detail: "The change's start date has passed. Make the change again with a new date.", at };
  }
  await ctx.db.patch(row._id, { state: "active" });
  const replaced = await applyVersion(ctx, plan, row.effectiveFrom, row.version, row.reason ?? "Approved price change");
  return { ok: true, detail: `The new price applies from ${row.effectiveFrom}; ${replaced} scheduled visit${replaced === 1 ? " was" : "s were"} made again at it.`, at };
}

/** Ends the plan after a date. Visits after it are cancelled; nothing already done or invoiced changes. */
export const end = companyMutation({
  args: { planId: v.id("recurringPlans"), lastDate: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const plan = await owned(ctx, args.planId);
    if (plan.status === "ended") return { cancelled: 0 };
    if (!isDate(args.lastDate)) throw userError("Choose the last date of service.");
    const reason = text(args.reason, "The reason", 300);
    let cancelled = 0;
    const after = args.lastDate < todayIn(plan.timezone) ? todayIn(plan.timezone) : args.lastDate;
    for (const row of await futureVisits(ctx, plan, after)) {
      if (row.visit.date <= args.lastDate) continue;
      await cancelVisitJob(ctx, row.job, `Plan ended: ${reason}`, byMember(ctx));
      await ctx.db.patch(row.visit._id, { state: "cancelled", exception: "Plan ended", updatedAt: Date.now() });
      cancelled += 1;
    }
    const ended = args.lastDate <= todayIn(plan.timezone);
    await ctx.db.patch(plan._id, { endDate: args.lastDate, ...(ended ? { status: "ended" as const, endedReason: reason } : {}), updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "recurring_plan.ended", actor: byMember(ctx), subject: { table: "recurringPlans", id: plan._id }, data: { lastDate: args.lastDate, cancelled } });
    return { cancelled, effect: "Completed visits, issued invoices, deposits and payments are unchanged. Anything still owed stays on its invoice." };
  },
});

/** Records a note on one visit's override, for a changed scope or extras handled on the visit in Dispatch. */
export const noteVisit = companyMutation({
  args: { visitId: v.id("planVisits"), note: v.string() },
  handler: async (ctx, args) => {
    const { visit } = await visitOf(ctx, args.visitId);
    await ctx.db.patch(visit._id, { override: { ...visit.override, note: optionalText(args.note, "Note", 500) }, updatedAt: Date.now() });
    return null;
  },
});

/** The daily sweep: makes visits to each active plan's horizon, ends plans past their last date, and drafts monthly invoices. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const plans = await ctx.db
      .query("recurringPlans")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(200);
    for (const plan of plans) {
      if (plan.endDate && plan.endDate < todayIn(plan.timezone)) {
        await ctx.db.patch(plan._id, { status: "ended", endedReason: "Reached its last date", updatedAt: Date.now() });
        continue;
      }
      // Each plan in its own step, so one plan's problem never stops the others.
      await ctx.scheduler.runAfter(0, internal.plans.generateOne, { planId: plan._id });
    }
    return null;
  },
});

export const generateOne = internalMutation({
  args: { planId: v.id("recurringPlans") },
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.planId);
    if (!plan) return null;
    await generateVisits(ctx, plan, { kind: "system" });
    await draftMonthlyInvoice(ctx, (await ctx.db.get(plan._id))!);
    return null;
  },
});

export { cadenceRate };
