/**
 * Changes to a recurring service, for a person in the office and for a customer on their own link alike.
 *
 * Seven different things a customer might mean are kept apart, because they have different consequences:
 * skip one visit, move one visit, change how often, pause the service, pause billing, resume, end.
 * Every change is previewed first: the exact visits it cancels, what happens to future dates, to billing
 * and to credits. A change is carried out only for the visits the person was shown; if the plan's visits
 * changed in between, nothing is changed and they are asked to look again.
 *
 * Pausing service never pauses billing. In Selestial a recurring service is billed for visits that
 * happen, so a paused service bills nothing new, but invoices already issued stay due until the Owner
 * changes them. The preview says exactly that, every time.
 *
 * Both plan systems are served (docs/clients/00-architecture.md): Clients service plans and Sales
 * recurring plans. Changing how often visits happen, and moving one visit, are requests: a price or a
 * crew's time may change, so a person decides before anything does.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { addDays } from "../agreements/store";
import { localParts } from "../availability";
import { refreshClient } from "../clients/directory";
import { bookAhead, upcomingPlanVisits } from "../clients/plans";
import { money } from "../dispatch/pay";
import { recordEvent, type Actor } from "../events";
import { cancelVisit } from "../jobs/visits";
import { cadenceLabel } from "../sales/cadence";
import { cancelVisitJob, futureVisits, generateVisits, replaceFrom, versionFor, versionsOf } from "../sales/plans";
import { clock, dayName } from "../time";
import type { PlanChange, PlanRef } from "./schema";

type Ctx = QueryCtx | MutationCtx;

export const CHANGE_WORDS: Record<PlanChange, string> = {
  skip_visit: "Skip one visit",
  reschedule_visit: "Move one visit",
  change_cadence: "Change how often",
  pause_service: "Pause service",
  pause_billing: "Pause billing",
  resume: "Resume service",
  end_service: "End service",
};

/** What a case about a plan change is closed as once the change is carried out. */
export const CHANGE_OUTCOME: Record<PlanChange, "plan_adjusted" | "plan_resumed" | "customer_cancelled"> = { skip_visit: "plan_adjusted", pause_service: "plan_adjusted", resume: "plan_resumed", end_service: "customer_cancelled", reschedule_visit: "plan_adjusted", change_cadence: "plan_adjusted", pause_billing: "plan_adjusted" };

/** Changes a person must decide, because a price, a crew's time or money already invoiced may change. */
export const NEEDS_PERSON: readonly PlanChange[] = ["reschedule_visit", "change_cadence", "pause_billing"];

const SERVICE_CADENCE: Record<string, string> = { every_7_days: "Every week", every_14_days: "Every 2 weeks", every_28_days: "Every 4 weeks", twice_per_month: "Twice a month", once_per_month: "Once a month" };

export type PlanView = {
  ref: PlanRef;
  companyId: Id<"companies">;
  customerId: Id<"customers">;
  propertyId: Id<"properties">;
  state: "setup" | "active" | "paused" | "ended";
  recurring: boolean;
  cadence: string;
  visitPriceCents: number | null;
  /** How this plan's visits are billed. Neither kind charges anything automatically. */
  billing: "per_visit" | "monthly_consolidated" | "by_invoice";
  pausedFrom: string | null;
  pausedUntil: string | null;
  endsOn: string | null;
};

export async function loadPlan(ctx: Ctx, companyId: Id<"companies">, ref: PlanRef): Promise<PlanView | null> {
  if (ref.kind === "service") {
    const plan = await ctx.db.get(ref.id);
    if (!plan || plan.companyId !== companyId) return null;
    return { ref, companyId, customerId: plan.customerId, propertyId: plan.propertyId, state: plan.state, recurring: plan.kind === "recurring", cadence: plan.cadence ? (SERVICE_CADENCE[plan.cadence] ?? plan.cadence) : "No calendar: visits are booked one by one", visitPriceCents: plan.priceCents, billing: "by_invoice", pausedFrom: plan.pausedFrom ?? null, pausedUntil: plan.pausedUntil ?? null, endsOn: plan.endsOn ?? null };
  }
  const plan = await ctx.db.get(ref.id);
  if (!plan || plan.companyId !== companyId) return null;
  const today = localParts(Date.now(), plan.timezone).day;
  const version = versionFor(await versionsOf(ctx, plan._id), today);
  return { ref, companyId, customerId: plan.customerId, propertyId: plan.propertyId, state: plan.status === "pending" ? "setup" : plan.status, recurring: true, cadence: version ? cadenceLabel(version.cadence) : "Not set", visitPriceCents: version?.visitPriceCents ?? null, billing: plan.billing, pausedFrom: plan.pause?.from ?? null, pausedUntil: plan.pause?.until ?? null, endsOn: plan.endDate ?? null };
}

/** The plan's visits that have not started, from a day on, soonest first. */
export async function upcomingVisits(ctx: Ctx, plan: PlanView, fromDay: string, untilDay?: string): Promise<Doc<"jobs">[]> {
  if (plan.ref.kind === "service") {
    const row = await ctx.db.get(plan.ref.id);
    if (!row) return [];
    return (await upcomingPlanVisits(ctx as QueryCtx, row, fromDay)).filter((job) => !untilDay || (job.planDate ?? "") < untilDay);
  }
  const row = await ctx.db.get(plan.ref.id);
  if (!row) return [];
  return (await futureVisits(ctx, row, fromDay)).filter((v) => !untilDay || v.visit.date < untilDay).map((v) => v.job).sort((a, b) => a.startsAt - b.startsAt);
}

/** What the customer owes on invoices already issued. Read for the preview; nothing here changes an invoice. */
export async function openBilling(ctx: Ctx, companyId: Id<"companies">, customerId: Id<"customers">): Promise<{ invoices: number; dueCents: number; ids: Id<"invoices">[] }> {
  const rows = await ctx.db
    .query("invoices")
    .withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customerId))
    .order("desc")
    .take(100);
  const open = rows.filter((row) => row.status === "open" && row.totals.balanceCents > 0);
  return { invoices: open.length, dueCents: open.reduce((sum, row) => sum + row.totals.balanceCents, 0), ids: open.map((row) => row._id) };
}

export type ChangeInput = { change: PlanChange; from?: string; until?: string; jobId?: Id<"jobs">; cadence?: string; preferred?: string };

export type Preview = {
  change: PlanChange;
  title: string;
  /** Why it cannot be done as asked, or null. */
  blocked: string | null;
  /** A person decides before anything changes. */
  needsPerson: boolean;
  visits: { jobId: Id<"jobs">; startsAt: number; day: string; when: string; service: string }[];
  /** What happens to visits already booked, to future dates, to billing and to credits, in that order. */
  consequences: { topic: "bookings" | "future" | "billing" | "credits"; text: string }[];
  shown: Id<"jobs">[];
  from: string | null;
  until: string | null;
};

/** Exactly what a change would do, before anything is changed. `amounts` is false where money is not the viewer's to read. */
export async function previewPlanChange(ctx: Ctx, company: Doc<"companies">, plan: PlanView, input: ChangeInput, amounts = true): Promise<Preview> {
  const tz = company.timezone;
  const today = localParts(Date.now(), tz).day;
  const from = input.from && input.from >= today ? input.from : today;
  const until = input.until;
  const line = (job: Doc<"jobs">) => ({ jobId: job._id, startsAt: job.startsAt, day: localParts(job.startsAt, tz).day, when: `${dayName(job.startsAt, tz)} at ${clock(job.startsAt, tz)}`, service: job.serviceSnapshot?.name ?? job.serviceType });
  const billing = await openBilling(ctx, company._id, plan.customerId);
  const owed = billing.invoices === 0 ? "There are no open invoices." : amounts ? `${billing.invoices} open ${billing.invoices === 1 ? "invoice" : "invoices"} (${money(billing.dueCents)}) ${billing.invoices === 1 ? "stays" : "stay"} due.` : `${billing.invoices} open ${billing.invoices === 1 ? "invoice stays" : "invoices stay"} due.`;
  const perVisit = plan.billing === "monthly_consolidated" ? "Visits are billed once a month, for the visits that were completed." : "Each visit is billed after it happens.";
  const credits = "No prepaid cleaning credits or memberships are held for this service, so none are affected.";
  const base = { change: input.change, title: CHANGE_WORDS[input.change], needsPerson: NEEDS_PERSON.includes(input.change), from: null as string | null, until: null as string | null };
  const none = (blocked: string): Preview => ({ ...base, blocked, visits: [], consequences: [], shown: [] });
  if (!plan.recurring) return none("This is a standing arrangement with no calendar. Its visits are booked one by one, so there is no series to change.");
  if (plan.state === "ended") return none("This service has already ended.");
  if (plan.state === "setup") return none("This service has not started yet.");

  if (input.change === "skip_visit" || input.change === "reschedule_visit") {
    const all = await upcomingVisits(ctx, plan, today);
    const job = input.jobId ? all.find((row) => row._id === input.jobId) : all[0];
    if (!job) return none(input.jobId ? "That visit is not an upcoming visit of this service." : "There is no upcoming visit to change.");
    const next = all.find((row) => row.startsAt > job.startsAt);
    if (input.change === "skip_visit") {
      return {
        ...base,
        blocked: null,
        visits: [line(job)],
        consequences: [
          { topic: "bookings", text: `The visit on ${line(job).when} is cancelled. That day is not booked again.` },
          { topic: "future", text: next ? `The next visit stays as booked: ${line(next).when}.` : "Later visits are booked as the schedule reaches them." },
          { topic: "billing", text: `Nothing is billed for a skipped visit. ${perVisit} ${owed} Skipping does not change them.` },
          { topic: "credits", text: credits },
        ],
        shown: [job._id],
      };
    }
    return {
      ...base,
      blocked: null,
      visits: [line(job)],
      consequences: [
        { topic: "bookings", text: `The visit on ${line(job).when} stays booked until a new time is confirmed with you.` },
        { topic: "future", text: "Only this one visit moves. The rest of the schedule is unchanged." },
        { topic: "billing", text: `Moving a visit does not change its price. ${owed}` },
        { topic: "credits", text: credits },
      ],
      shown: [job._id],
    };
  }

  if (input.change === "pause_service") {
    if (plan.state !== "active") return none("Only a running service can be paused.");
    if (until && until <= from) return none("It must resume after the pause starts.");
    const visits = await upcomingVisits(ctx, plan, from, until);
    return {
      ...base,
      from,
      until: until ?? null,
      blocked: null,
      visits: visits.map(line),
      consequences: [
        { topic: "bookings", text: visits.length ? `${visits.length} booked ${visits.length === 1 ? "visit is" : "visits are"} cancelled, listed below.` : "No visits are booked in this period, so none are cancelled." },
        { topic: "future", text: until ? `No visits are booked from ${from} until ${until}. Booking starts again on ${until}.` : `No visits are booked from ${from} until the service is resumed. It does not restart by itself.` },
        { topic: "billing", text: `Pausing service does not pause billing. Nothing new is billed while no visits happen, but invoices already issued are not paused or cancelled. ${owed}` },
        { topic: "credits", text: credits },
      ],
      shown: visits.map((job) => job._id),
    };
  }

  if (input.change === "pause_billing") {
    return {
      ...base,
      blocked: billing.invoices === 0 ? "There are no open invoices to pause. Nothing is charged automatically: each visit is billed after it happens." : null,
      visits: [],
      consequences: [
        { topic: "bookings", text: "Pausing billing does not pause service. Booked visits stay booked and still happen." },
        { topic: "future", text: "Future visits are booked as usual." },
        { topic: "billing", text: `${owed} Only the Owner can change what is due or when. This asks them to; it changes nothing by itself.` },
        { topic: "credits", text: credits },
      ],
      shown: [],
    };
  }

  if (input.change === "resume") {
    if (plan.state !== "paused" && !plan.pausedFrom) return none("This service is not paused.");
    return {
      ...base,
      blocked: null,
      visits: [],
      consequences: [
        { topic: "bookings", text: "Visits cancelled by the pause stay cancelled." },
        { topic: "future", text: `Visits are booked again from today, on the same schedule (${plan.cadence.toLowerCase()}), as far ahead as the company books.` },
        { topic: "billing", text: `${perVisit} ${owed}` },
        { topic: "credits", text: credits },
      ],
      shown: [],
    };
  }

  if (input.change === "end_service") {
    const visits = await upcomingVisits(ctx, plan, from);
    return {
      ...base,
      from,
      blocked: null,
      visits: visits.map(line),
      consequences: [
        { topic: "bookings", text: visits.length ? `${visits.length} booked ${visits.length === 1 ? "visit is" : "visits are"} cancelled, listed below.` : "No visits are booked, so none are cancelled." },
        { topic: "future", text: `The service ends on ${from}. No more visits are booked.` },
        { topic: "billing", text: `Nothing is billed for visits that do not happen. Completed visits and invoices already issued are unchanged. ${owed}` },
        { topic: "credits", text: credits },
      ],
      shown: visits.map((job) => job._id),
    };
  }

  // change_cadence
  const visits = await upcomingVisits(ctx, plan, from);
  return {
    ...base,
    from,
    blocked: null,
    visits: visits.map(line),
    consequences: [
      { topic: "bookings", text: `Nothing changes yet. ${visits.length} booked ${visits.length === 1 ? "visit stays" : "visits stay"} as booked until the new schedule is confirmed with you.` },
      { topic: "future", text: `Now: ${plan.cadence.toLowerCase()}. Asked for: ${input.cadence ?? "a different schedule"}. If agreed, visits from the change date are booked again on the new schedule.` },
      { topic: "billing", text: "The price of each visit can depend on how often visits happen. The company confirms the price of the new schedule with you before anything changes." },
      { topic: "credits", text: credits },
    ],
    shown: visits.map((job) => job._id),
  };
}

const same = (a: Id<"jobs">[], b: Id<"jobs">[]) => [...a].map(String).sort().join(",") === [...b].map(String).sort().join(",");

/**
 * Carries out skip, pause, resume or end, for exactly the visits that were shown. Anything else is a
 * request a person decides (convex/lib/retention/actions.ts hands it on). Never changes an invoice.
 */
export async function applyPlanChange(ctx: MutationCtx, company: Doc<"companies">, row: Doc<"retentionCases">, action: Doc<"retentionActions">, actor: Actor): Promise<{ ok: boolean; detail: string; retry?: boolean }> {
  const change = action.planChange;
  if (!change) return { ok: false, detail: "There is no plan change to carry out." };
  const plan = await loadPlan(ctx, company._id, change.plan);
  if (!plan) return { ok: false, detail: "The plan no longer exists." };
  if (plan.customerId !== row.customerId) return { ok: false, detail: "That plan belongs to a different customer." };
  const preview = await previewPlanChange(ctx, company, plan, { change: change.change, from: change.from, until: change.until, jobId: change.jobId, cadence: change.cadence });
  if (preview.blocked) return { ok: false, detail: preview.blocked };
  if (!same(preview.shown, change.shown)) return { ok: false, retry: true, detail: "The plan's booked visits changed after this was previewed. Review the visits again before changing the plan." };
  const tz = company.timezone;
  const today = localParts(Date.now(), tz).day;
  const reason = change.reason?.trim() || (change.requestedBy === "customer" ? "The customer asked." : "Changed in Retention.");
  const who = change.requestedBy === "customer" ? "at the customer's request" : "by the office";
  const subject = change.plan.kind === "service" ? ({ table: "servicePlans", id: change.plan.id } as const) : ({ table: "recurringPlans", id: change.plan.id } as const);
  const visits = await upcomingVisits(ctx, plan, preview.from ?? today, preview.until ?? undefined);
  const scoped = { ...ctx, companyId: company._id };

  if (change.plan.kind === "service") {
    const record = (await ctx.db.get(change.plan.id))!;
    const bump = { revision: record.revision + 1, updatedAt: Date.now() };
    if (change.change === "skip_visit") {
      const job = visits.find((v) => v._id === preview.shown[0]) ?? (await ctx.db.get(preview.shown[0]));
      if (!job || job.status !== "scheduled" || !job.planDate) return { ok: false, retry: true, detail: "That visit has started or is no longer booked, so it cannot be skipped." };
      await cancelVisit(scoped, job, `Skipped ${who}: ${reason}`.slice(0, 500), actor, true);
      await ctx.db.patch(record._id, { skipped: [...new Set([...record.skipped, job.planDate])].sort(), ...bump });
      await recordEvent(ctx, { companyId: company._id, type: "plan.visit_skipped", actor, subject, data: { day: job.planDate, via: "retention" } });
      return { ok: true, detail: `Skipped the visit on ${job.planDate}. That day is not booked again. Billing is unchanged.` };
    }
    if (change.change === "pause_service") {
      for (const job of visits) await cancelVisit(scoped, job, `Service paused ${who}: ${reason}`.slice(0, 500), actor, true);
      await ctx.db.patch(record._id, { state: preview.until ? "active" : "paused", pausedFrom: preview.from!, pausedUntil: preview.until ?? undefined, ...bump });
      await recordEvent(ctx, { companyId: company._id, type: "plan.paused", actor, subject, data: { from: preview.from!, until: preview.until ?? "until resumed", cancelled: visits.length, via: "retention" } });
      await refreshClient(ctx, record.customerId);
      return { ok: true, detail: `Service paused from ${preview.from}${preview.until ? ` until ${preview.until}` : " until it is resumed"}. ${visits.length} ${visits.length === 1 ? "visit was" : "visits were"} cancelled. Billing was not paused: invoices already issued stay due.` };
    }
    if (change.change === "resume") {
      await ctx.db.patch(record._id, { state: "active", pausedFrom: undefined, pausedUntil: undefined, bookedThrough: undefined, ...bump });
      await recordEvent(ctx, { companyId: company._id, type: "plan.resumed", actor, subject, data: { via: "retention" } });
      const booked = await bookAhead(ctx, (await ctx.db.get(record._id))!, actor);
      await refreshClient(ctx, record.customerId);
      return { ok: true, detail: `Service resumed. ${booked.booked} ${booked.booked === 1 ? "visit was" : "visits were"} booked ahead.${booked.problems.length ? ` ${booked.problems.length} could not be booked; Dispatch has a task.` : ""}` };
    }
    for (const job of visits) await cancelVisit(scoped, job, `Service ended ${who}: ${reason}`.slice(0, 500), actor, false);
    await ctx.db.patch(record._id, { state: "ended", endsOn: preview.from!, ...bump });
    await recordEvent(ctx, { companyId: company._id, type: "plan.ended", actor, subject, data: { from: preview.from!, cancelled: visits.length, via: "retention" } });
    await refreshClient(ctx, record.customerId);
    return { ok: true, detail: `Service ended on ${preview.from}. ${visits.length} ${visits.length === 1 ? "visit was" : "visits were"} cancelled. Completed visits and issued invoices are unchanged.` };
  }

  const record = (await ctx.db.get(change.plan.id))!;
  const rows = await futureVisits(ctx, record, preview.from ?? today);
  const byJob = new Map(rows.map((r) => [r.job._id as string, r]));
  if (change.change === "skip_visit") {
    const found = byJob.get(preview.shown[0] as string);
    if (!found) return { ok: false, retry: true, detail: "That visit has started or is no longer booked, so it cannot be skipped." };
    await cancelVisitJob(ctx, found.job, `Skipped ${who}: ${reason}`, actor);
    await ctx.db.patch(found.visit._id, { state: "skipped", exception: reason.slice(0, 300), updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: company._id, type: "recurring_plan.visit_skipped", actor, subject, data: { date: found.visit.date, via: "retention" } });
    return { ok: true, detail: `Skipped the visit on ${found.visit.date}. ${record.billing === "per_visit" ? "Nothing is billed for a skipped visit." : "A skipped visit is left out of the month's invoice."}` };
  }
  if (change.change === "pause_service") {
    let cancelled = 0;
    for (const job of visits) {
      const found = byJob.get(job._id as string);
      if (!found) continue;
      await cancelVisitJob(ctx, found.job, `Service paused ${who}: ${reason}`, actor);
      await ctx.db.patch(found.visit._id, { state: "skipped", exception: "Paused", updatedAt: Date.now() });
      cancelled += 1;
    }
    await ctx.db.patch(record._id, { status: preview.until ? "active" : "paused", pause: { from: preview.from!, ...(preview.until ? { until: addDays(preview.until, -1) } : {}), reason: reason.slice(0, 300) }, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: company._id, type: "recurring_plan.paused", actor, subject, data: { from: preview.from!, until: preview.until ?? null, cancelled, via: "retention" } });
    return { ok: true, detail: `Service paused from ${preview.from}${preview.until ? ` until ${preview.until}` : " until it is resumed"}. ${cancelled} ${cancelled === 1 ? "visit was" : "visits were"} cancelled. Billing was not paused: invoices already issued stay due.` };
  }
  if (change.change === "resume") {
    await ctx.db.patch(record._id, { status: "active", pause: undefined, updatedAt: Date.now() });
    await replaceFrom(ctx, (await ctx.db.get(record._id))!, today, "Plan resumed", actor);
    const made = await generateVisits(ctx, (await ctx.db.get(record._id))!, actor);
    await recordEvent(ctx, { companyId: company._id, type: "recurring_plan.resumed", actor, subject, data: { from: today, made, via: "retention" } });
    return { ok: true, detail: `Service resumed. ${made} ${made === 1 ? "visit was" : "visits were"} booked ahead.` };
  }
  let cancelled = 0;
  for (const found of rows) {
    await cancelVisitJob(ctx, found.job, `Service ended ${who}: ${reason}`, actor);
    await ctx.db.patch(found.visit._id, { state: "cancelled", exception: "Plan ended", updatedAt: Date.now() });
    cancelled += 1;
  }
  await ctx.db.patch(record._id, { endDate: preview.from!, status: "ended", endedReason: reason.slice(0, 300), updatedAt: Date.now() });
  await recordEvent(ctx, { companyId: company._id, type: "recurring_plan.ended", actor, subject, data: { lastDate: preview.from!, cancelled, via: "retention" } });
  await refreshClient(ctx, record.customerId);
  return { ok: true, detail: `Service ended on ${preview.from}. ${cancelled} ${cancelled === 1 ? "visit was" : "visits were"} cancelled. Completed visits and issued invoices are unchanged.` };
}
