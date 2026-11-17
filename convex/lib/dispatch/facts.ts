/** Reads the facts the eligibility rules need from the shared record. Nothing here decides anything. */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Span } from "../availability";
import type { CleanerFacts, Ended, JobFacts } from "./eligibility";
import { nextRole } from "./crew";
import { CREW_PAY_DEFAULT, payFor, type CrewPay } from "./pay";
import { crewPayOf } from "./policy";
import { dispatchSettings } from "./settings";
import { assignmentBlockers } from "../workforce/requirements";

type Db = QueryCtx | MutationCtx;

export async function jobAssignments(ctx: Db, job: Doc<"jobs">): Promise<Doc<"assignments">[]> {
  return ctx.db
    .query("assignments")
    .withIndex("by_company_job", (q) => q.eq("companyId", job.companyId).eq("jobId", job._id))
    .take(200);
}

export async function jobFacts(ctx: Db, company: Doc<"companies">, job: Doc<"jobs">): Promise<JobFacts> {
  const property = await ctx.db.get(job.propertyId);
  return {
    span: { startsAt: job.startsAt, endsAt: job.endsAt },
    requiredSkills: job.requiredSkills,
    postalCode: property?.address.postalCode.trim().toUpperCase() ?? "",
    timezone: company.timezone,
    travelBufferMinutes: dispatchSettings(company).travelBufferMinutes,
  };
}

/** The times this cleaner is already holding: every other job they have an offer on or have accepted. */
export async function heldSpans(
  ctx: Db,
  companyId: Id<"companies">,
  cleanerId: Id<"cleaners">,
  exceptJob: Id<"jobs">,
  statuses: readonly ("offered" | "accepted")[] = ["offered", "accepted"],
): Promise<Span[]> {
  const spans: Span[] = [];
  for (const status of statuses) {
    const rows = await ctx.db
      .query("assignments")
      .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", companyId).eq("cleanerId", cleanerId).eq("status", status))
      .take(500);
    for (const row of rows) {
      if (row.jobId === exceptJob) continue;
      const job = await ctx.db.get(row.jobId);
      if (job && (job.status === "scheduled" || job.status === "in_progress")) spans.push({ startsAt: job.startsAt, endsAt: job.endsAt });
    }
  }
  return spans;
}

export type JobHistory = {
  /** Visits for this customer each cleaner accepted before. */
  prior: Map<string, number>;
  /** Cleaners already ruled out for this visit at this time. */
  ended: Map<string, Ended>;
  /** The Owner's crew pay rule and the role the next offer would carry, so a candidate's pay is the pay they would be offered. */
  crewPay: { rule: CrewPay; role: "lead" | "support" };
};

/**
 * What already happened around this job: who has cleaned for the customer, and who was already asked.
 * An answer about an earlier time does not count once the job has moved.
 */
export async function jobHistory(ctx: Db, job: Doc<"jobs">, assignments: Doc<"assignments">[], skipped: Id<"cleaners">[] = []): Promise<JobHistory> {
  const ended = new Map<string, Ended>();
  for (const cleanerId of skipped) ended.set(cleanerId, "skipped");
  for (const row of assignments) {
    if ((row.jobStartsAt ?? job.startsAt) !== job.startsAt) continue;
    if (row.status === "declined") ended.set(row.cleanerId, "declined");
    else if (row.status === "expired") ended.set(row.cleanerId, "expired");
    else if (row.status === "cancelled" && row.endCause === "released") ended.set(row.cleanerId, "released");
    else if (row.status === "cancelled" && row.endCause === "dropped") ended.set(row.cleanerId, "dropped");
    else if (row.status === "cancelled" && row.endCause === "no_show") ended.set(row.cleanerId, "no_show");
    else if (row.status === "cancelled" && row.endCause === "undelivered") ended.set(row.cleanerId, "unreachable");
  }

  const prior = new Map<string, number>();
  const others = await ctx.db
    .query("jobs")
    .withIndex("by_company_customer", (q) => q.eq("companyId", job.companyId).eq("customerId", job.customerId))
    .order("desc")
    .take(100);
  for (const other of others) {
    if (other._id === job._id || other.status === "cancelled") continue;
    for (const row of await jobAssignments(ctx, other)) {
      if (row.status === "accepted") prior.set(row.cleanerId, (prior.get(row.cleanerId) ?? 0) + 1);
    }
  }
  const company = await ctx.db.get(job.companyId);
  return { prior, ended, crewPay: { rule: company ? crewPayOf(company) : CREW_PAY_DEFAULT, role: nextRole(assignments) } };
}

export async function cleanerFacts(ctx: Db, job: Doc<"jobs">, cleaner: Doc<"cleaners">, history: JobHistory): Promise<CleanerFacts> {
  const windows = await ctx.db
    .query("availabilityWindows")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", job.companyId).eq("cleanerId", cleaner._id))
    .take(100);
  const timeOff = await ctx.db
    .query("timeOff")
    .withIndex("by_company_cleaner_end", (q) => q.eq("companyId", job.companyId).eq("cleanerId", cleaner._id).gt("endsAt", job.startsAt))
    .take(200);
  return {
    id: cleaner._id,
    name: cleaner.name,
    status: cleaner.status,
    skills: cleaner.skills,
    serviceAreas: cleaner.serviceAreas,
    windows: windows.map((row) => ({ weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute })),
    timeOff: timeOff.map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt })),
    held: await heldSpans(ctx, job.companyId, cleaner._id, job._id),
    endedForJob: history.ended.get(cleaner._id) ?? null,
    priorVisitsForCustomer: history.prior.get(cleaner._id) ?? 0,
    pay: payFor(cleaner, job, history.crewPay),
    onboardingBlockers: await assignmentBlockers(ctx, cleaner, Date.now()),
  };
}

/** Every cleaner marked ready for work, with their facts for this job. */
export async function readyCleanerFacts(ctx: Db, job: Doc<"jobs">, history: JobHistory) {
  const cleaners = await ctx.db
    .query("cleaners")
    .withIndex("by_company_status", (q) => q.eq("companyId", job.companyId).eq("status", "ready"))
    .take(200);
  const facts: CleanerFacts[] = [];
  for (const cleaner of cleaners) facts.push(await cleanerFacts(ctx, job, cleaner, history));
  return { cleaners, facts };
}
