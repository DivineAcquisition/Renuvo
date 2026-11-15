/**
 * The one way an offer is made, for a person and for Dispatch alike, so nothing can offer around the
 * checks that protect a cleaner's time. `offerProblem` says why an offer cannot be made, in words a
 * person can read; `placeOffer` records it.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { recordEvent, type Actor, type EventData } from "../events";
import { queueMessage } from "../messaging/outbox";
import { requiredCrew, staffing } from "./crew";
import { assess, type Rules } from "./eligibility";
import { cleanerFacts, jobAssignments, jobFacts, jobHistory, type JobHistory } from "./facts";
import { issueLink } from "./links";
import { offerSms } from "./sms";

export type OfferRequest = {
  company: Doc<"companies">;
  job: Doc<"jobs">;
  cleaner: Doc<"cleaners">;
  respondBy: number;
  payCents: number;
  rules: Rules;
  /** Cover for a place that lost its cleaner may be offered after the start time, until the job's end. */
  afterStart?: boolean;
};

/**
 * A person offering by hand uses their own judgment on area and pay and may ask a cleaner again. The
 * time between jobs still applies to them unless they say plainly that they are setting it aside.
 */
export function personRules(allowTightSchedule: boolean): Rules {
  return { serviceArea: false, travelBuffer: !allowTightSchedule, ended: false, pay: false };
}

/** Why this offer cannot be made right now, or null when it can. */
export async function offerProblem(ctx: QueryCtx | MutationCtx, request: OfferRequest, known?: { assignments: Doc<"assignments">[]; history: JobHistory }): Promise<string | null> {
  const { company, job, cleaner, respondBy, rules } = request;
  if (job.status !== "scheduled") return "Only a scheduled job can be offered.";
  if (respondBy <= Date.now()) return "The response deadline must be in the future.";
  if (request.afterStart ? respondBy > job.endsAt : respondBy > job.startsAt) return request.afterStart ? "The response deadline must be before the job ends." : "The response deadline must be before the job starts.";

  const assignments = known?.assignments ?? (await jobAssignments(ctx, job));
  const facts = await cleanerFacts(ctx, job, cleaner, known?.history ?? (await jobHistory(ctx, job, assignments)));
  const jobView = await jobFacts(ctx, company, job);

  // Standing and skills first, so a person is told the most basic reason.
  const exclusion = assess(facts, jobView, rules);
  if (exclusion && (exclusion.code === "not_ready" || exclusion.code === "missing_skill")) return `This cleaner ${exclusion.reason}.`;
  if (staffing(job, assignments).open === 0) return requiredCrew(job) === 1 ? "A cleaner has already accepted this job." : "This job already has every cleaner it needs.";
  if (assignments.some((row) => row.status === "accepted" && row.cleanerId === cleaner._id)) return "This cleaner has already accepted this job.";
  if (assignments.some((row) => row.status === "offered" && row.cleanerId === cleaner._id)) return "This cleaner already has an open offer for this job.";
  if (exclusion) return `This cleaner ${exclusion.reason}.`;
  return null;
}

export type OfferKind = NonNullable<Doc<"assignments">["offerKind"]>;

/**
 * Records an offer that has passed `offerProblem`, issues its link and plans its text. The offer keeps
 * the scope and the pay as offered. The offer exists whether or not the text goes: delivery is tracked
 * on the message, and a failed one is handled there, never counted as the cleaner's silence.
 */
export async function placeOffer(
  ctx: MutationCtx,
  request: OfferRequest,
  actor: Actor,
  data: EventData = {},
  options: { kind?: OfferKind; coverageRequestId?: Id<"coverageRequests"> } = {},
): Promise<Id<"assignments">> {
  const { company, job, cleaner, respondBy, payCents } = request;
  const kind = options.kind ?? "initial";
  const others = await jobAssignments(ctx, job);
  const hasLead = others.some((row) => (row.status === "offered" || row.status === "accepted") && row.role === "lead");
  const assignmentId = await ctx.db.insert("assignments", {
    companyId: job.companyId,
    jobId: job._id,
    cleanerId: cleaner._id,
    status: "offered",
    scope: job.scope,
    payCents,
    offeredAt: Date.now(),
    respondBy,
    jobStartsAt: job.startsAt,
    role: hasLead ? "support" : "lead",
    offerKind: kind,
    coverageRequestId: options.coverageRequestId,
  });
  await recordEvent(ctx, {
    companyId: job.companyId,
    type: "assignment.offered",
    actor,
    subject: { table: "assignments", id: assignmentId },
    data: { jobId: job._id, cleanerId: cleaner._id, respondBy, payCents, kind, ...data },
  });
  const assignment = (await ctx.db.get(assignmentId))!;
  const link = await issueLink(ctx, { assignment, purpose: "offer", expiresAt: respondBy, actor });
  await queueMessage(ctx, {
    companyId: job.companyId,
    purpose: kind === "backup" ? "backup_offer" : "offer",
    cleaner,
    jobId: job._id,
    assignmentId,
    link,
    body: offerSms({ company, job, property: await ctx.db.get(job.propertyId), assignment, backup: kind === "backup" }),
    dedupeKey: `offer:${assignmentId}`,
    actor,
  });
  return assignmentId;
}
