/**
 * One status list per thing (brief, section 9). A job, an assignment, a task and an approval each have
 * their own list and their own allowed changes, and none is inferred from another: a job being scheduled
 * says nothing about whether a cleaner accepted it, and neither says anything about payment.
 */
import { v, type Validator } from "convex/values";

import { userError } from "./errors";

export function literals<const T extends readonly [string, string, ...string[]]>(values: T): Validator<T[number]> {
  return v.union(...values.map((value) => v.literal(value))) as unknown as Validator<T[number]>;
}

export const AGENTS = ["sales", "recruiter", "dispatch", "retention"] as const;
export type Agent = (typeof AGENTS)[number];
export const agentValidator = literals(AGENTS);

export const MEMBER_STATUSES = ["invited", "active", "removed"] as const;
export const memberStatusValidator = literals(MEMBER_STATUSES);

export const RECORD_STATUSES = ["active", "archived"] as const;
export const recordStatusValidator = literals(RECORD_STATUSES);

export const WORK_KINDS = ["home", "short_term_rental", "property_manager", "commercial"] as const;
export const workKindValidator = literals(WORK_KINDS);

/** Only a person moves a cleaner between these. No agent changes one. */
export const CLEANER_STATUSES = ["onboarding", "ready", "paused", "ended"] as const;
export type CleanerStatus = (typeof CLEANER_STATUSES)[number];
export const cleanerStatusValidator = literals(CLEANER_STATUSES);

/** The service itself. Coverage is not here: it is read from the job's assignments. */
export const JOB_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const jobStatusValidator = literals(JOB_STATUSES);
export const JOB_CHANGES: Record<JobStatus, readonly JobStatus[]> = {
  scheduled: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/** One offer of one job to one cleaner. Confirmed only by "accepted". */
export const ASSIGNMENT_STATUSES = ["offered", "accepted", "declined", "expired", "cancelled"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export const assignmentStatusValidator = literals(ASSIGNMENT_STATUSES);
export const ASSIGNMENT_CHANGES: Record<AssignmentStatus, readonly AssignmentStatus[]> = {
  offered: ["accepted", "declined", "expired", "cancelled"],
  accepted: ["cancelled"],
  declined: [],
  expired: [],
  cancelled: [],
};
/** The assignments that hold a cleaner's time. */
export const ACTIVE_ASSIGNMENT: readonly AssignmentStatus[] = ["offered", "accepted"];

/**
 * open: an agent or person has a next action and a deadline. waiting: on someone outside, with a
 * follow-up time. needs_decision: handed to a person with the open question.
 */
export const TASK_STATUSES = ["open", "waiting", "needs_decision", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const taskStatusValidator = literals(TASK_STATUSES);
export const TASK_CHANGES: Record<TaskStatus, readonly TaskStatus[]> = {
  open: ["waiting", "needs_decision", "done", "cancelled"],
  waiting: ["open", "needs_decision", "done", "cancelled"],
  needs_decision: ["open", "waiting", "done", "cancelled"],
  done: [],
  cancelled: [],
};
export const WAITING_ON = ["customer", "cleaner", "applicant", "owner", "other"] as const;
export const waitingOnValidator = literals(WAITING_ON);

export const APPROVAL_STATUSES = ["pending", "approved", "changed", "skipped", "expired"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const approvalStatusValidator = literals(APPROVAL_STATUSES);

/** Refuses a status change the list does not allow. The record is named so the message can be checked. */
export function assertChange<S extends string>(changes: Record<S, readonly S[]>, from: S, to: S, thing: string) {
  if (!changes[from].includes(to)) {
    throw userError(`This ${thing} is ${from.replace(/_/g, " ")}, so it cannot become ${to.replace(/_/g, " ")}.`);
  }
}
