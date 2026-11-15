/**
 * The only place an assignment changes status. Ending one always closes its links, so a cleaner who is
 * no longer on a job cannot open it. Accepting is one transaction that checks the job's remaining places
 * and the cleaner's own commitments again at that moment: two cleaners answering at once cannot both
 * take the last place, because the second one reads the first one's acceptance.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { overlaps } from "../availability";
import { recordEvent, type Actor } from "../events";
import { queueMessage } from "../messaging/outbox";
import { assertChange, ASSIGNMENT_CHANGES, type AssignmentStatus, type EndCause } from "../statuses";
import { jobCoverageRequests, settleCoverage } from "./coverage";
import { requiredCrew, staffing } from "./crew";
import { heldSpans, jobAssignments } from "./facts";
import { issueLink, revokeAssignmentLinks } from "./links";
import { dispatchPolicy } from "./policy";
import { confirmedSms, withdrawnSms } from "./sms";
import { coverJob } from "./workflow";

const HOUR = 60 * 60 * 1000;

export async function endAssignment(
  ctx: MutationCtx,
  assignment: Doc<"assignments">,
  to: AssignmentStatus,
  actor: Actor,
  extra: { endReason?: string; endCause?: EndCause; data?: Record<string, string> } = {},
) {
  assertChange(ASSIGNMENT_CHANGES, assignment.status, to, "assignment");
  await ctx.db.patch(assignment._id, {
    status: to,
    ...(to === "accepted" || to === "declined" ? { respondedAt: Date.now() } : {}),
    ...(extra.endReason ? { endReason: extra.endReason } : {}),
    ...(extra.endCause ? { endCause: extra.endCause } : {}),
  });
  await recordEvent(ctx, {
    companyId: assignment.companyId,
    type: `assignment.${to}`,
    actor,
    subject: { table: "assignments", id: assignment._id },
    data: { from: assignment.status, jobId: assignment.jobId, cleanerId: assignment.cleanerId, ...extra.data },
  });
  // The offer is answered either way, so its link is done. Anything but an acceptance closes the job link too.
  await revokeAssignmentLinks(ctx, assignment, to === "accepted" ? "The offer was answered." : extra.endReason ?? `The assignment is ${to}.`, actor, to === "accepted" ? "offer" : undefined);
}

export type AnswerResult =
  | { status: "accepted"; jobLinkId: Id<"actionLinks"> | null }
  | { status: "declined" }
  | { status: "expired" }
  | { status: "refused"; code: "not_open" | "job_closed" | "filled" | "conflict" | "not_ready"; message: string };

/**
 * The cleaner's answer to an offer, however it arrived. Nothing is trusted from when the offer was
 * made: the deadline, the job, its remaining places and the cleaner's standing and commitments are all
 * read again here.
 */
export async function answerOffer(ctx: MutationCtx, assignment: Doc<"assignments">, answer: "accepted" | "declined", actor: Actor, data: Record<string, string> = {}): Promise<AnswerResult> {
  if (assignment.status !== "offered") return { status: "refused", code: "not_open", message: `This offer is ${assignment.status}, so it can no longer be answered.` };
  // An answer after the deadline does not count. The offer is recorded as expired and the caller is told.
  if (Date.now() > assignment.respondBy) {
    await endAssignment(ctx, assignment, "expired", actor, { endReason: "The response deadline passed." });
    await coverJob(ctx, assignment.jobId);
    return { status: "expired" };
  }
  if (answer === "declined") {
    await endAssignment(ctx, assignment, "declined", actor, { data });
    await coverJob(ctx, assignment.jobId);
    return { status: "declined" };
  }

  const job = await ctx.db.get(assignment.jobId);
  const company = await ctx.db.get(assignment.companyId);
  const cleaner = await ctx.db.get(assignment.cleanerId);
  if (!job || !company || !cleaner || job.status !== "scheduled") return { status: "refused", code: "job_closed", message: "This job is no longer scheduled." };
  const all = await jobAssignments(ctx, job);
  const before = staffing(job, all);
  if (before.open === 0) {
    return { status: "refused", code: "filled", message: requiredCrew(job) === 1 ? "Another cleaner has already accepted this job." : "This job already has every cleaner it needs." };
  }
  if (cleaner.status !== "ready") return { status: "refused", code: "not_ready", message: "This cleaner is not marked ready for work, so the offer cannot be accepted." };
  const span = { startsAt: job.startsAt, endsAt: job.endsAt };
  const committed = await heldSpans(ctx, job.companyId, cleaner._id, job._id, ["accepted"]);
  if (committed.some((other) => overlaps(other, span))) {
    return { status: "refused", code: "conflict", message: "This cleaner has already accepted another job at that time." };
  }
  const timeOff = await ctx.db
    .query("timeOff")
    .withIndex("by_company_cleaner_end", (q) => q.eq("companyId", job.companyId).eq("cleanerId", cleaner._id).gt("endsAt", job.startsAt))
    .take(200);
  if (timeOff.some((off) => overlaps(off, span))) return { status: "refused", code: "conflict", message: "This cleaner has time off then." };

  // A lead who was offered support, or the other way round, keeps what they were offered unless a lead is already on the job.
  const hasLead = all.some((row) => row.status === "accepted" && row.role === "lead");
  const role = hasLead ? "support" : (assignment.role ?? "lead");
  if (role !== assignment.role) await ctx.db.patch(assignment._id, { role });
  await endAssignment(ctx, assignment, "accepted", actor, { data });

  // The last place is taken, so every other open offer for the job is withdrawn and its link closed.
  if (before.open === 1) {
    for (const other of all) {
      if (other._id === assignment._id || other.status !== "offered") continue;
      await endAssignment(ctx, other, "cancelled", actor, { endReason: "Another cleaner accepted the job.", endCause: "job_covered", data: { cause: "job_covered" } });
      const otherCleaner = await ctx.db.get(other.cleanerId);
      if (otherCleaner?.phone) {
        await queueMessage(ctx, { companyId: job.companyId, purpose: "offer_withdrawn", cleaner: otherCleaner, jobId: job._id, assignmentId: other._id, body: withdrawnSms({ company, job }), dedupeKey: `withdrawn:${other._id}`, actor });
      }
    }
  }
  if (assignment.coverageRequestId) {
    const request = (await jobCoverageRequests(ctx, job)).find((row) => row._id === assignment.coverageRequestId);
    if (request) await settleCoverage(ctx, request, "filled", actor, { filledByAssignmentId: assignment._id });
  }

  // The job link is its own thing: it starts now and lasts through the service, whatever the offer's deadline was.
  const accepted = (await ctx.db.get(assignment._id))!;
  const jobLink = await issueLink(ctx, { assignment: accepted, purpose: "job", expiresAt: job.endsAt + dispatchPolicy(company).jobAccessGraceHours * HOUR, actor });
  await queueMessage(ctx, {
    companyId: job.companyId,
    purpose: "assignment_confirmed",
    cleaner,
    jobId: job._id,
    assignmentId: assignment._id,
    link: jobLink,
    body: confirmedSms({ company, job }),
    dedupeKey: `confirmed:${assignment._id}`,
    actor,
  });
  await coverJob(ctx, assignment.jobId);
  return { status: "accepted", jobLinkId: jobLink?._id ?? null };
}
