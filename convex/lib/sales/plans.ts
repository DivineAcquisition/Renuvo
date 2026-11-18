/**
 * Recurring plans: one plan, its versions, and the visits it makes.
 *
 * - A plan is not a subscription. Nothing is charged automatically: completed visits are invoiced per
 *   visit through Finance, or gathered into one draft invoice a month for a person to review and issue.
 * - Visits are made ahead over a rolling horizon by a sweep. Each cadence date is made at most once:
 *   the (plan, date) row is checked before anything is created, in the same transaction.
 * - A change to the future is a new version from a date. Visits before that date keep the version they
 *   were made with; scheduled visits on or after it are replaced and made again from the new version.
 * - A date the company is closed is never moved silently: it becomes an exception for Dispatch.
 * - A plan does not mean every visit has a cleaner: staffing is Dispatch's, shown per visit.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { endAssignment } from "../dispatch/assignmentState";
import { coverJob } from "../dispatch/workflow";
import { recordEvent, type Actor } from "../events";
import { recompute, emptyTotals } from "../finance/ledger";
import { linesTotal } from "../finance/money";
import { settingsOf, settingsRow } from "../finance/settings";
import { businessSettingsOf } from "../settings/business";
import { ACTIVE_ASSIGNMENT } from "../statuses";
import { openTask } from "../taskState";
import { addDays, cadenceDates, dayNumber, localInstant, weekdayOf, type Cadence } from "./cadence";
import { createVisit } from "./visits";
import { quote as runQuote, type QuoteInput } from "../services/engine";

export const HORIZON_DAYS = 56;
const MAX_PER_RUN = 40;

export function todayIn(timezone: string, at = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

export async function versionsOf(ctx: QueryCtx | MutationCtx, planId: Id<"recurringPlans">): Promise<Doc<"recurringPlanVersions">[]> {
  const rows = await ctx.db
    .query("recurringPlanVersions")
    .withIndex("by_plan_version", (q) => q.eq("planId", planId))
    .take(200);
  return rows.filter((row) => (row.state ?? "active") === "active").sort((a, b) => a.version - b.version);
}

/** The version a date uses: the latest active one in effect on that date. */
export function versionFor(versions: Doc<"recurringPlanVersions">[], date: string): Doc<"recurringPlanVersions"> | null {
  let found: Doc<"recurringPlanVersions"> | null = null;
  for (const version of versions) if (version.effectiveFrom <= date) found = version;
  return found;
}

export type NewPlan = {
  customerId: Id<"customers">;
  propertyId: Id<"properties">;
  bookingId?: Id<"bookings">;
  setupId?: Id<"serviceSetups">;
  startDate: string;
  endDate?: string;
  arrivalMinute: number;
  arrivalWindowMinutes: number;
  durationMinutes: number;
  crew: number;
  cadence: Cadence;
  serviceKey: string;
  versionId: Id<"serviceVersions">;
  quoteInput: Doc<"recurringPlanVersions">["quoteInput"];
  visitPriceCents: number;
  first?: NonNullable<Doc<"recurringPlanVersions">["first"]>;
  preferredCleanerId?: Id<"cleaners">;
  billing: Doc<"recurringPlans">["billing"];
  createdBy: Id<"members">;
};

/** Creates a plan, its first version and the visits inside the horizon. */
export async function createPlan(ctx: MutationCtx, company: Doc<"companies">, input: NewPlan, firstJobAt?: { startsAt: number; endsAt: number }): Promise<Id<"recurringPlans">> {
  const now = Date.now();
  const planId = await ctx.db.insert("recurringPlans", {
    companyId: company._id,
    customerId: input.customerId,
    propertyId: input.propertyId,
    ...(input.bookingId ? { bookingId: input.bookingId } : {}),
    ...(input.setupId ? { setupId: input.setupId } : {}),
    status: "active",
    currentVersion: 1,
    timezone: company.timezone,
    horizonDays: HORIZON_DAYS,
    startDate: input.startDate,
    ...(input.endDate ? { endDate: input.endDate } : {}),
    billing: input.billing,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("recurringPlanVersions", {
    companyId: company._id,
    planId,
    version: 1,
    effectiveFrom: input.startDate,
    cadence: input.cadence,
    arrivalMinute: input.arrivalMinute,
    arrivalWindowMinutes: input.arrivalWindowMinutes,
    durationMinutes: input.durationMinutes,
    crew: input.crew,
    serviceKey: input.serviceKey,
    versionId: input.versionId,
    quoteInput: input.quoteInput,
    visitPriceCents: input.visitPriceCents,
    ...(input.first ? { first: input.first } : {}),
    ...(input.preferredCleanerId ? { preferredCleanerId: input.preferredCleanerId } : {}),
    state: "active",
    createdBy: input.createdBy,
    createdAt: now,
  });
  await recordEvent(ctx, { companyId: company._id, type: "recurring_plan.created", actor: { kind: "system" }, subject: { table: "recurringPlans", id: planId }, data: { ...(input.bookingId ? { bookingId: input.bookingId } : {}), ...(input.setupId ? { setupId: input.setupId } : {}) } });
  await generateVisits(ctx, (await ctx.db.get(planId))!, { kind: "system" }, { firstJobAt });
  return planId;
}

/** Creates the plan from a confirmed recurring booking. */
export async function createPlanFromBooking(ctx: MutationCtx, company: Doc<"companies">, booking: Doc<"bookings">): Promise<Id<"recurringPlans">> {
  if (!booking.recurring) throw new Error("The booking has no cadence.");
  const startDate = todayIn(company.timezone, booking.slot.startsAt);
  const arrivalMinute = Math.round((booking.slot.startsAt - localInstant(startDate, 0, company.timezone)) / 60_000);
  const firstMinutes = Math.round((booking.slot.endsAt - booking.slot.startsAt) / 60_000);
  // The ongoing visit's own length, from its saved quote; the first visit keeps the booked length.
  const ongoingVersion = await ctx.db.get(booking.versionId);
  const ongoingMinutes = ongoingVersion ? Math.max(15, runQuote(ongoingVersion.spec, booking.quoteInput as QuoteInput).time.elapsedMinutes) : firstMinutes;
  return createPlan(
    ctx,
    company,
    {
      customerId: booking.customerId,
      propertyId: booking.propertyId,
      bookingId: booking._id,
      startDate,
      ...(booking.recurring.endDate ? { endDate: booking.recurring.endDate } : {}),
      arrivalMinute,
      arrivalWindowMinutes: booking.slot.arrivalWindowMinutes,
      durationMinutes: booking.first ? ongoingMinutes : firstMinutes,
      crew: booking.slot.crew,
      cadence: booking.recurring.cadence,
      serviceKey: booking.serviceKey,
      versionId: booking.versionId,
      quoteInput: booking.quoteInput,
      visitPriceCents: booking.priceCents,
      ...(booking.first ? { first: { serviceKey: booking.first.serviceKey, versionId: booking.first.versionId, quoteInput: booking.first.quoteInput, priceCents: booking.first.priceCents, durationMinutes: firstMinutes, crew: booking.slot.crew } } : {}),
      ...(booking.preferredCleanerId ? { preferredCleanerId: booking.preferredCleanerId } : {}),
      billing: booking.recurring.billing,
      createdBy: booking.createdBy,
    },
    booking.slot,
  );
}

/**
 * Makes the plan's visits from where it left off to the horizon. Safe to run again at any time: a date
 * that already has a visit is passed over. Returns how many visits it made.
 */
export async function generateVisits(ctx: MutationCtx, plan: Doc<"recurringPlans">, actor: Actor, options: { firstJobAt?: { startsAt: number; endsAt: number } } = {}): Promise<number> {
  if (plan.status !== "active") return 0;
  const company = await ctx.db.get(plan.companyId);
  if (!company) return 0;
  const versions = await versionsOf(ctx, plan._id);
  if (!versions.length) return 0;
  const today = todayIn(plan.timezone);
  const from = plan.generatedThrough ? addDays(plan.generatedThrough, 1) : plan.startDate;
  let until = addDays(today, plan.horizonDays);
  if (plan.endDate && plan.endDate < until) until = plan.endDate;
  if (from > until) return 0;
  const hours = businessSettingsOf(company).hours;
  const closed = new Set(hours.length ? [0, 1, 2, 3, 4, 5, 6].filter((d) => !hours.some((h) => h.weekday === d)) : []);
  // Dates from each version's own anchor, kept only where that version is the one in effect.
  const dates = new Set<string>();
  for (const version of versions) {
    for (const date of cadenceDates(version.cadence as Cadence, version.effectiveFrom, from < version.effectiveFrom ? version.effectiveFrom : from, until, 400)) {
      if (versionFor(versions, date)?._id === version._id) dates.add(date);
    }
  }
  let made = 0;
  let through = plan.generatedThrough ?? addDays(plan.startDate, -1);
  for (const date of [...dates].sort()) {
    if (made >= MAX_PER_RUN) break;
    const existing = await ctx.db
      .query("planVisits")
      .withIndex("by_plan_date", (q) => q.eq("planId", plan._id).eq("date", date))
      .take(10);
    if (existing.some((row) => !(row.state === "cancelled" && row.exception?.startsWith("Replaced")))) {
      through = date;
      continue;
    }
    const version = versionFor(versions, date)!;
    const first = date === plan.startDate && Boolean(version.first) && version.version === 1;
    const paused = plan.pause && date >= plan.pause.from && (!plan.pause.until || date <= plan.pause.until);
    const now = Date.now();
    if (paused) {
      await ctx.db.insert("planVisits", { companyId: plan.companyId, planId: plan._id, date, state: "skipped", version: version.version, first, exception: "Paused", createdAt: now, updatedAt: now });
    } else if (closed.has(weekdayOf(date))) {
      const visitId = await ctx.db.insert("planVisits", { companyId: plan.companyId, planId: plan._id, date, state: "exception", version: version.version, first, exception: "The company is closed this weekday. Agree another day with the customer.", createdAt: now, updatedAt: now });
      await openTask(ctx, { companyId: plan.companyId, agent: "dispatch", title: "A recurring visit falls on a closed day", nextAction: `Agree another day for the ${date} visit with the customer, or skip it.`, dueAt: now + 2 * 86_400_000, completionCondition: "The visit is moved or skipped.", about: { table: "customers", id: plan.customerId }, key: `plan-exception:${visitId}`, actor });
    } else {
      const startsAt = first && options.firstJobAt ? options.firstJobAt.startsAt : localInstant(date, version.arrivalMinute, plan.timezone);
      const length = first && version.first ? version.first.durationMinutes : version.durationMinutes;
      const endsAt = first && options.firstJobAt ? options.firstJobAt.endsAt : startsAt + length * 60_000;
      const jobId = await createVisit(ctx, {
        company,
        customerId: plan.customerId,
        propertyId: plan.propertyId,
        versionId: first && version.first ? version.first.versionId : version.versionId,
        serviceKey: first && version.first ? version.first.serviceKey : version.serviceKey,
        priceCents: first && version.first ? version.first.priceCents : version.visitPriceCents,
        startsAt,
        endsAt,
        crew: first && version.first ? version.first.crew : version.crew,
        arrivalWindowMinutes: version.arrivalWindowMinutes,
        actor,
        from: "plan",
      });
      await ctx.db.insert("planVisits", { companyId: plan.companyId, planId: plan._id, date, state: "scheduled", version: version.version, first, jobId, createdAt: now, updatedAt: now });
    }
    made += 1;
    through = date;
  }
  // Only claim the whole window when every date in it was handled.
  const finished = made < MAX_PER_RUN;
  await ctx.db.patch(plan._id, { generatedThrough: finished ? until : through, updatedAt: Date.now() });
  return made;
}

/** Cancels one scheduled visit the way Dispatch does: its offers and acceptances end, with the reason. */
export async function cancelVisitJob(ctx: MutationCtx, job: Doc<"jobs">, reason: string, actor: Actor): Promise<boolean> {
  if (job.status !== "scheduled") return false;
  await ctx.db.patch(job._id, { status: "cancelled", cancelReason: reason.slice(0, 500) });
  await recordEvent(ctx, { companyId: job.companyId, type: "job.cancelled", actor, subject: { table: "jobs", id: job._id }, data: { from: job.status, reason: reason.slice(0, 200) } });
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_company_job", (q) => q.eq("companyId", job.companyId).eq("jobId", job._id))
    .take(50);
  for (const assignment of assignments) {
    if (!ACTIVE_ASSIGNMENT.includes(assignment.status)) continue;
    await endAssignment(ctx, assignment, "cancelled", actor, { endReason: reason.slice(0, 200), endCause: "job_cancelled", data: { cause: "job_cancelled" } });
  }
  await coverJob(ctx, job._id);
  return true;
}

/**
 * What changing the future from `effectiveFrom` does to visits already made: the scheduled ones it
 * replaces and whether a cleaner had accepted each. Completed visits and their invoices are never touched.
 */
export async function futureVisits(ctx: QueryCtx | MutationCtx, plan: Doc<"recurringPlans">, effectiveFrom: string) {
  const rows = await ctx.db
    .query("planVisits")
    .withIndex("by_plan_date", (q) => q.eq("planId", plan._id).gte("date", effectiveFrom))
    .take(200);
  const out = [];
  for (const row of rows) {
    if (row.state !== "scheduled" || !row.jobId) continue;
    const job = await ctx.db.get(row.jobId);
    if (!job || job.status !== "scheduled") continue;
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_company_job", (q) => q.eq("companyId", plan.companyId).eq("jobId", job._id))
      .take(20);
    out.push({ visit: row, job, accepted: assignments.filter((a) => a.status === "accepted").length });
  }
  return out;
}

/** Replaces the scheduled visits from a date so the next sweep makes them again from the plan's current versions. */
export async function replaceFrom(ctx: MutationCtx, plan: Doc<"recurringPlans">, effectiveFrom: string, reason: string, actor: Actor): Promise<number> {
  let replaced = 0;
  for (const row of await futureVisits(ctx, plan, effectiveFrom)) {
    await cancelVisitJob(ctx, row.job, reason, actor);
    await ctx.db.patch(row.visit._id, { state: "cancelled", exception: `Replaced: ${reason}`.slice(0, 300), updatedAt: Date.now() });
    replaced += 1;
  }
  // Dates that were skipped or excepted from the date on are also made again.
  const others = await ctx.db
    .query("planVisits")
    .withIndex("by_plan_date", (q) => q.eq("planId", plan._id).gte("date", effectiveFrom))
    .take(200);
  for (const row of others) if ((row.state === "skipped" && row.exception === "Paused") || row.state === "exception") await ctx.db.patch(row._id, { state: "cancelled", exception: `Replaced: ${reason}`.slice(0, 300), updatedAt: Date.now() });
  const before = addDays(effectiveFrom, -1);
  await ctx.db.patch(plan._id, { generatedThrough: plan.generatedThrough && plan.generatedThrough < before ? plan.generatedThrough : before, updatedAt: Date.now() });
  return replaced;
}

/**
 * Monthly consolidated billing: one draft invoice per plan per finished calendar month, listing the
 * visits completed in it. A draft only: an Owner reviews and issues it in Finance.
 */
export async function draftMonthlyInvoice(ctx: MutationCtx, plan: Doc<"recurringPlans">): Promise<Id<"invoices"> | null> {
  if (plan.billing !== "monthly_consolidated") return null;
  const today = todayIn(plan.timezone);
  const lastMonth = (() => {
    const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();
  if (plan.billedThrough && plan.billedThrough >= lastMonth) return null;
  if (plan.startDate.slice(0, 7) > lastMonth) return null;
  const visits = await ctx.db
    .query("planVisits")
    .withIndex("by_plan_date", (q) => q.eq("planId", plan._id).gte("date", `${lastMonth}-01`).lte("date", `${lastMonth}-31`))
    .take(100);
  const lines = [];
  const settings = settingsOf(await settingsRow(ctx, plan.companyId));
  for (const visit of visits) {
    if (!visit.jobId) continue;
    const job = await ctx.db.get(visit.jobId);
    if (!job || job.status !== "completed") continue;
    // A visit already invoiced on its own is never billed twice.
    const own = await ctx.db
      .query("invoices")
      .withIndex("by_company_job", (q) => q.eq("companyId", plan.companyId).eq("jobId", job._id))
      .take(5);
    if (own.some((invoice) => invoice.status !== "void")) continue;
    const price = job.priceCents ?? 0;
    lines.push({ id: `${visit._id}`.slice(-12), kind: "service" as const, description: `${job.serviceSnapshot?.name ?? job.serviceType} · ${visit.date}`, quantity: 1, unitCents: price, amountCents: price, taxable: job.serviceSnapshot?.serviceId ? settings.taxableServiceIds.includes(job.serviceSnapshot.serviceId) : false, serviceId: job.serviceSnapshot?.serviceId });
  }
  await ctx.db.patch(plan._id, { billedThrough: lastMonth, updatedAt: Date.now() });
  if (!lines.length) return null;
  const now = Date.now();
  const base = linesTotal(lines, settings.taxRateBps ?? 0);
  const invoiceId = await ctx.db.insert("invoices", { companyId: plan.companyId, customerId: plan.customerId, propertyId: plan.propertyId, status: "draft", lines, taxRateBps: settings.taxRateBps ?? 0, taxLabel: settings.taxLabel, totals: { ...emptyTotals(), ...base, balanceCents: base.totalCents }, memo: `Visits in ${lastMonth} under the recurring plan.`, revision: 0, createdBy: plan.createdBy, createdAt: now, updatedAt: now });
  await recompute(ctx, invoiceId);
  await recordEvent(ctx, { companyId: plan.companyId, type: "invoice.created", actor: { kind: "system" }, subject: { table: "invoices", id: invoiceId }, data: { planId: plan._id, month: lastMonth } });
  return invoiceId;
}

export function isDate(value: string): boolean {
  return dayNumber(value) !== null;
}
