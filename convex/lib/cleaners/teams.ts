/**
 * Where each person stands on a team's job, read from the job's own assignments.
 *
 * A team for a job keeps the people it was assembled with, whatever later happens to a permanent crew. It
 * does not say they are still on the job: someone can decline, not answer, drop out or be released, and
 * Dispatch can put someone else on the job through its own paths. The job's assignments are the one record of
 * who is on it, so the team is shown against them rather than kept as a second copy.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import { staffing, type Staffing } from "../dispatch/crew";

export type Standing = "accepted" | "offered" | "declined" | "expired" | "off";

export const STANDING_WORDS: Record<Standing, string> = {
  accepted: "Accepted",
  offered: "Offer out",
  declined: "Declined",
  expired: "Did not answer in time",
  off: "No longer on this job",
};

/** On the job now: an accepted place or an offer still out. */
export const onJobNow = (standing: Standing | null) => standing === "accepted" || standing === "offered";

/** The person's latest assignment on this job decides where they stand. Null: never offered it. */
export function standingOf(assignments: Pick<Doc<"assignments">, "cleanerId" | "status" | "offeredAt" | "_creationTime">[], cleanerId: Id<"cleaners">): Standing | null {
  const rows = assignments.filter((row) => row.cleanerId === cleanerId);
  if (rows.length === 0) return null;
  const latest = rows.reduce((a, b) => (b.offeredAt > a.offeredAt || (b.offeredAt === a.offeredAt && b._creationTime > a._creationTime) ? b : a));
  return latest.status === "cancelled" ? "off" : latest.status;
}

export type TeamView = {
  /** The people assembled for the job, each with where they stand on it now. */
  standings: Map<string, Standing | null>;
  /** People on the job now who were not assembled with the team, for example a replacement Dispatch found. */
  addedElsewhere: Id<"cleaners">[];
  staffing: Staffing;
};

export function teamView(job: Pick<Doc<"jobs">, "requiredCrew">, assignments: Doc<"assignments">[], memberIds: Id<"cleaners">[]): TeamView {
  const standings = new Map<string, Standing | null>(memberIds.map((id) => [id as string, standingOf(assignments, id)]));
  const addedElsewhere = [...new Set(assignments.filter((row) => (row.status === "accepted" || row.status === "offered") && !standings.has(row.cleanerId)).map((row) => row.cleanerId))];
  return { standings, addedElsewhere, staffing: staffing(job, assignments) };
}

/** Accepted first, then offers out, then everyone who is no longer on the job. */
export const STANDING_ORDER: Record<Standing, number> = { accepted: 0, offered: 1, declined: 2, expired: 3, off: 4 };
