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
