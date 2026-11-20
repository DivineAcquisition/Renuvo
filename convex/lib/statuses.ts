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

/** support: the company's Selestial Support member (convex/lib/support/access.ts). It cannot sign in and is never notified. */
export const MEMBER_STATUSES = ["invited", "active", "removed", "support"] as const;
export const memberStatusValidator = literals(MEMBER_STATUSES);

/**
 * An invitation to join a company. "expired" is not here: it is worked out from the expiry time, so a
 * stored status never disagrees with the clock.
 */
export const INVITATION_STATUSES = ["pending", "accepted", "revoked"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];
export const invitationStatusValidator = literals(INVITATION_STATUSES);

/** What became of the invitation email. queued: planned. not_sent: there was no way to send it. */
export const INVITATION_DELIVERY_STATES = ["not_sent", "queued", "sent", "failed"] as const;
export type InvitationDeliveryState = (typeof INVITATION_DELIVERY_STATES)[number];
export const invitationDeliveryStateValidator = literals(INVITATION_DELIVERY_STATES);

export const RECORD_STATUSES =["active", "archived"] as const;
export const recordStatusValidator = literals(RECORD_STATUSES);

export const WORK_KINDS = ["home", "short_term_rental", "property_manager", "commercial"] as const;
export type WorkKind = (typeof WORK_KINDS)[number];
export const workKindValidator = literals(WORK_KINDS);

/**
 * A cleaner's engagement status. Only a person moves a cleaner between these; no agent changes one.
 * "ready" is the stored word for an active engagement, kept for the records and indexes that already use it.
 * Active is not eligible: job eligibility also needs every assignment-blocking requirement accepted
 * (lib/cleaners/readiness.ts). "paused" is a routine break; "suspended" follows an approved personnel request.
 */
export const CLEANER_STATUSES = ["onboarding", "ready", "paused", "suspended", "ended"] as const;
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

/** Why an assignment that ended as cancelled ended. Only some causes count against asking the same cleaner again. */
export const END_CAUSES = ["released", "job_covered", "job_cancelled", "job_moved", "dropped", "no_show", "undelivered"] as const;
export type EndCause = (typeof END_CAUSES)[number];
export const endCauseValidator = literals(END_CAUSES);

/** Lead or support on a job that needs more than one cleaner. */
export const CREW_ROLES = ["lead", "support"] as const;
export type CrewRole = (typeof CREW_ROLES)[number];
export const crewRoleValidator = literals(CREW_ROLES);

/**
 * One outbound message. queued: planned. sending: handed to the provider, outcome not known yet.
 * sent: the provider accepted it. delivered: the provider confirmed the handset got it. failed: it did
 * not go. unconfirmed: a send was started and never settled, so nobody knows; it is not sent again
 * without a person. not_sent: there was nothing to send to, messaging is not connected, or the sending
 * policy (convex/lib/messaging/policy.ts) refused it. held: the policy said not yet (quiet hours), and it
 * is planned for the end of that window, when the policy is asked again.
 */
export const MESSAGE_STATUSES = ["queued", "held", "sending", "sent", "delivered", "failed", "unconfirmed", "not_sent"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export const messageStatusValidator = literals(MESSAGE_STATUSES);
export const MESSAGE_CHANGES: Record<MessageStatus, readonly MessageStatus[]> = {
  queued: ["sending", "held", "not_sent", "failed"],
  held: ["sending", "not_sent", "failed", "queued"],
  sending: ["sent", "delivered", "failed", "queued", "unconfirmed", "held"],
  sent: ["delivered", "failed"],
  delivered: [],
  failed: [],
  unconfirmed: ["delivered", "failed"],
  not_sent: [],
};

/** A slot that lost its cleaner and has to be filled again. unresolved means nobody could, and a person has it. */
export const COVERAGE_STATUSES = ["open", "filled", "unresolved", "cancelled"] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];
export const coverageStatusValidator = literals(COVERAGE_STATUSES);
export const COVERAGE_CAUSES = ["drop", "no_show", "delay", "released", "undelivered"] as const;
export type CoverageCause = (typeof COVERAGE_CAUSES)[number];
export const coverageCauseValidator = literals(COVERAGE_CAUSES);

/** Where Dispatch hands work it does not own. Until those agents exist, each is a queue a person works. */
export const HANDOFF_QUEUES = ["recruiter", "team_coordinator", "customer_care", "quality", "finance"] as const;
export type HandoffQueue = (typeof HANDOFF_QUEUES)[number];
export const handoffValidator = literals(HANDOFF_QUEUES);

export const APPROVAL_STATUSES = ["pending", "approved", "changed", "skipped", "expired"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const approvalStatusValidator = literals(APPROVAL_STATUSES);

/** Refuses a status change the list does not allow. The record is named so the message can be checked. */
export function assertChange<S extends string>(changes: Record<S, readonly S[]>, from: S, to: S, thing: string) {
  if (!changes[from].includes(to)) {
    throw userError(`This ${thing} is ${from.replace(/_/g, " ")}, so it cannot become ${to.replace(/_/g, " ")}.`);
  }
}
