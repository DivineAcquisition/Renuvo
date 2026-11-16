/**
 * How many cleaners a job needs and how many it has. Required and accepted are two numbers, read
 * separately: a job is fully staffed only when every required place has an accepted cleaner. An offer
 * that is out is not a cleaner.
 */
import type { Doc } from "../../_generated/dataModel";

export type Staffing = {
  required: number;
  accepted: number;
  offersOut: number;
  /** Places with no accepted cleaner. */
  open: number;
  state: "full" | "partial" | "none";
};

export function requiredCrew(job: Pick<Doc<"jobs">, "requiredCrew">): number {
  const value = job.requiredCrew ?? 1;
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

export function staffing(job: Pick<Doc<"jobs">, "requiredCrew">, assignments: Pick<Doc<"assignments">, "status">[]): Staffing {
  const required = requiredCrew(job);
  const accepted = assignments.filter((row) => row.status === "accepted").length;
  const offersOut = assignments.filter((row) => row.status === "offered").length;
  const open = Math.max(0, required - accepted);
  return { required, accepted, offersOut, open, state: open === 0 ? "full" : accepted > 0 ? "partial" : "none" };
}

export type Coverage = "covered" | "offered" | "uncovered";

/**
 * Covered means every required place has an accepted cleaner. One acceptance on a job that needs three
 * is not coverage, and an offer that is still out is not coverage either. Every screen and query reads
 * a job's coverage through this, so they cannot disagree.
 */
export function coverageOf(assignments: Pick<Doc<"assignments">, "status">[], job: Pick<Doc<"jobs">, "requiredCrew"> = {}): Coverage {
  if (staffing(job, assignments).open === 0) return "covered";
  if (assignments.some((row) => row.status === "offered")) return "offered";
  return "uncovered";
}

/** The role the next offer on this job would carry: lead until a lead holds an offer or has accepted. */
export function nextRole(assignments: Pick<Doc<"assignments">, "status" | "role">[]): "lead" | "support" {
  return assignments.some((row) => (row.status === "offered" || row.status === "accepted") && row.role === "lead") ? "support" : "lead";
}
