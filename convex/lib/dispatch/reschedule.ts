/**
 * Moving a visit to another time, as one step. A cleaner agreed to a specific time, so nothing they
 * agreed to is moved underneath them: open offers are withdrawn, and everyone who had accepted is
 * taken off and asked again for the new time, at the pay they accepted. Whoever cannot work the new
 * time is told, and their place is open. The plan and the commit are the same code, so the preview a
 * person approves is what is carried out, and a visit that changed in between is refused.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import { queueMessage } from "../messaging/outbox";
import { ACTIVE_ASSIGNMENT } from "../statuses";
import { endAssignment } from "./assignmentState";
import { jobAssignments, jobHistory } from "./facts";
import { offerProblem, personRules, placeOffer, type OfferRequest } from "./offers";
import { dispatchSettings } from "./settings";
import { endedSms, withdrawnSms } from "./sms";
import { afterReschedule, jobApprovals } from "./workflow";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type Move = { startsAt: number; endsAt: number; hardDeadlineAt?: number | null };

export type MovePlan = {
  /** Names the state the plan was made from. The commit is refused if the visit no longer matches it. */
  version: string;
  from: { startsAt: number; endsAt: number };
  to: { startsAt: number; endsAt: number };
  hardDeadlineAt: number | null;
  /** Why the move cannot be made at all. Empty means it can. */
  problems: string[];
  offersWithdrawn: { assignmentId: Id<"assignments">; cleanerId: Id<"cleaners">; name: string }[];
  /** Everyone who had accepted the old time, and what the move means for each of them. */
  crew: { assignmentId: Id<"assignments">; cleanerId: Id<"cleaners">; name: string; role: Doc<"assignments">["role"] | null; payCents: number; outcome: "asked_again" | "place_reopens"; reason: string | null; respondBy: number | null }[];
  proposalsClosed: number;
  placesOpenAfter: number;
};

function versionOf(job: Doc<"jobs">, active: Doc<"assignments">[]): string {
  return [job.status, job.startsAt, job.endsAt, job.hardDeadlineAt ?? "", ...active.map((row) => `${row._id}:${row.status}`).sort()].join("|");
}

/** What moving the visit would do, read from the record as it is now. Changes nothing. */
export async function planMove(ctx: QueryCtx | MutationCtx, company: Doc<"companies">, job: Doc<"jobs">, move: Move): Promise<{ plan: MovePlan; requests: Map<Id<"assignments">, OfferRequest> }> {
  const now = Date.now();
  const assignments = await jobAssignments(ctx, job);
  const active = assignments.filter((row) => ACTIVE_ASSIGNMENT.includes(row.status));
  const deadline = move.hardDeadlineAt === undefined ? (job.hardDeadlineAt ?? null) : move.hardDeadlineAt;
  const problems: string[] = [];
  if (job.status !== "scheduled") problems.push("Only a scheduled visit can be moved.");
  if (!(move.startsAt < move.endsAt)) problems.push("A visit must start before it ends.");
  else if (move.endsAt - move.startsAt > DAY) problems.push("A visit cannot be longer than a day.");
  if (move.startsAt <= now) problems.push("The new start must be in the future.");
  if (move.startsAt === job.startsAt && move.endsAt === job.endsAt && deadline === (job.hardDeadlineAt ?? null)) problems.push("That is the time the visit already has.");
  if (deadline !== null && move.endsAt > deadline) problems.push("The new end is after the time the service must be finished by. Change that deadline with the move, or choose an earlier time.");

  const moved: Doc<"jobs"> = { ...job, startsAt: move.startsAt, endsAt: move.endsAt };
  // After the move nobody holds a place, so each cleaner is checked against an empty crew.
  const ended = assignments.filter((row) => !ACTIVE_ASSIGNMENT.includes(row.status));
  const history = await jobHistory(ctx, moved, ended);
  const window = dispatchSettings(company).offerWindowMinutes * MINUTE;
  const respondBy = Math.min(now + window, move.startsAt);

  const names = new Map<string, Doc<"cleaners"> | null>();
  for (const row of active) if (!names.has(row.cleanerId)) names.set(row.cleanerId, await ctx.db.get(row.cleanerId));
  const requests = new Map<Id<"assignments">, OfferRequest>();
  const crew: MovePlan["crew"] = [];
  // The lead is asked first, so the lead's place is theirs to keep.
  const accepted = active.filter((row) => row.status === "accepted").sort((a, b) => (a.role === "lead" ? -1 : 0) - (b.role === "lead" ? -1 : 0));
  for (const row of accepted) {
    const cleaner = names.get(row.cleanerId) ?? null;
    let reason: string | null = cleaner ? null : "This cleaner's record is gone.";
    if (cleaner && problems.length === 0) {
      const request: OfferRequest = { company, job: moved, cleaner, respondBy, payCents: row.payCents, rules: personRules(false) };
      reason = await offerProblem(ctx, request, { assignments: ended, history });
      if (!reason) requests.set(row._id, request);
    }
    crew.push({ assignmentId: row._id, cleanerId: row.cleanerId, name: cleaner?.name ?? "A cleaner", role: row.role ?? null, payCents: row.payCents, outcome: reason ? "place_reopens" : "asked_again", reason, respondBy: reason ? null : respondBy });
  }
  const required = Math.max(1, job.requiredCrew ?? 1);
  return {
    plan: {
      version: versionOf(job, active),
      from: { startsAt: job.startsAt, endsAt: job.endsAt },
      to: { startsAt: move.startsAt, endsAt: move.endsAt },
      hardDeadlineAt: deadline,
      problems,
      offersWithdrawn: active.filter((row) => row.status === "offered").map((row) => ({ assignmentId: row._id, cleanerId: row.cleanerId, name: names.get(row.cleanerId)?.name ?? "A cleaner" })),
      crew,
      proposalsClosed: (await jobApprovals(ctx, job)).filter((row) => row.status === "pending").length,
      // Nobody is accepted for the new time until they answer again, so every place is open after the move.
      placesOpenAfter: required,
    },
    requests,
  };
}

/** Carries the plan out in one transaction: all of it happens, or none of it does. */
export async function commitMove(ctx: MutationCtx, company: Doc<"companies">, job: Doc<"jobs">, move: Move, expectedVersion: string, actor: Actor): Promise<MovePlan> {
  const { plan, requests } = await planMove(ctx, company, job, move);
  if (plan.problems.length > 0) throw userError(plan.problems[0]);
  if (plan.version !== expectedVersion) throw userError("This visit changed since you looked at the move. Review what the move does again, then confirm it.");
  const assignments = await jobAssignments(ctx, job);
  const byId = new Map(assignments.map((row) => [row._id, row]));

  for (const offer of plan.offersWithdrawn) {
    const row = byId.get(offer.assignmentId)!;
    await endAssignment(ctx, row, "cancelled", actor, { endReason: "The visit was moved to another time.", endCause: "job_moved", data: { cause: "job_moved" } });
    const cleaner = await ctx.db.get(row.cleanerId);
    if (cleaner?.phone) await queueMessage(ctx, { companyId: job.companyId, purpose: "offer_withdrawn", cleaner, jobId: job._id, assignmentId: row._id, body: withdrawnSms({ company, job }), dedupeKey: `withdrawn:${row._id}`, actor });
  }
  for (const member of plan.crew) {
    const row = byId.get(member.assignmentId)!;
    await endAssignment(ctx, row, "cancelled", actor, { endReason: "The visit was moved to another time.", endCause: "job_moved", data: { cause: "job_moved" } });
    // Someone who can be asked again gets one text, the new offer. Only a cleaner who cannot is told they are off the job.
    if (member.outcome === "place_reopens") {
      const cleaner = await ctx.db.get(row.cleanerId);
      if (cleaner?.phone) await queueMessage(ctx, { companyId: job.companyId, purpose: "assignment_ended", cleaner, jobId: job._id, assignmentId: row._id, body: endedSms({ company, job }), dedupeKey: `ended:${row._id}`, actor });
    }
  }

  await ctx.db.patch(job._id, { startsAt: move.startsAt, endsAt: move.endsAt, hardDeadlineAt: plan.hardDeadlineAt ?? undefined });
  const moved = (await ctx.db.get(job._id))!;
  await recordEvent(ctx, {
    companyId: job.companyId,
    type: "job.rescheduled",
    actor,
    subject: { table: "jobs", id: job._id },
    data: { from: job.startsAt, to: move.startsAt, offersWithdrawn: plan.offersWithdrawn.length, askedAgain: plan.crew.filter((row) => row.outcome === "asked_again").length, placesReopened: plan.crew.filter((row) => row.outcome === "place_reopens").length },
  });

  for (const member of plan.crew) {
    const request = requests.get(member.assignmentId);
    if (!request) continue;
    await placeOffer(ctx, { ...request, job: moved }, actor, { movedFrom: job.startsAt }, { moved: true });
  }
  await afterReschedule(ctx, moved);
  return plan;
}
