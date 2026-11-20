/**
 * The words of Selestial's operational monitoring (docs/operations/02-incidents.md): which problems are
 * tracked, where each appears in the staff Operations workspace, how serious it is, and who acts next.
 *
 * An incident is a problem someone has to track, not every error: one row per condition, found again
 * and again by the same key, and closed only once its condition is checked and gone.
 */
import { literals } from "../statuses";

/** The staff Operations views an incident belongs to. */
export const AREAS = ["agents", "communications", "connections", "billing", "platform"] as const;
export type Area = (typeof AREAS)[number];
export const areaValidator = literals(AREAS);

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const severityValidator = literals(SEVERITIES);
export const severityRank = (severity: Severity) => SEVERITIES.indexOf(severity);

/**
 * investigating: found, not yet understood. recovering: an automatic recovery is running for it.
 * waiting_owner / waiting_provider: the next move is the company's or the provider's. needs_staff: a
 * Selestial person must act. resolved: the condition was checked and is gone.
 */
export const STATES = ["investigating", "recovering", "waiting_owner", "waiting_provider", "needs_staff", "resolved"] as const;
export type State = (typeof STATES)[number];
export const stateValidator = literals(STATES);
export type OpenState = Exclude<State, "resolved">;

/** Who has the next move, as the overview shows it. */
export function nextActor(state: State): "Selestial (automatic)" | "Owner" | "Provider" | "Selestial staff" | "Nobody" {
  if (state === "recovering" || state === "investigating") return "Selestial (automatic)";
  if (state === "waiting_owner") return "Owner";
  if (state === "waiting_provider") return "Provider";
  if (state === "needs_staff") return "Selestial staff";
  return "Nobody";
}

/** Every check that looks for incidents. Each has its own schedule; see convex/lib/operations/detectors.ts. */
export const CHECKS = [
  "agent_work",
  "chat_runs",
  "uncertain_messages",
  "owner_notices",
  "stuck_sends",
  "inbound_processing",
  "mailboxes",
  "google",
  "connectors",
  "texting",
  "ai_billing",
  "messaging_billing",
  "messaging_attention",
] as const;
export type Check = (typeof CHECKS)[number];
export const checkValidator = literals(CHECKS);

/** What an incident is about. Several kinds can come from one check. */
export const KINDS = [
  // Agent work
  "agent_task_lease_expired",
  "agent_task_failed",
  "chat_run_not_closed",
  // Communications
  "message_unconfirmed",
  "owner_notice_failing",
  "send_recovery_stopped",
  "inbound_processing_failed",
  "texting_needs_owner",
  "texting_interrupted",
  "texting_failed",
  "texting_stalled",
  "texting_number_not_connected",
  // Connections
  "mailbox_reconnect",
  "mailbox_read_failing",
  "google_reconnect",
  "google_job_failed",
  "google_job_uncertain",
  "connector_reconnect",
  // Billing
  "ai_settlement_unverified",
  "ai_settlement_overdue",
  "messaging_settlement_unverified",
  "messaging_settlement_overdue",
  "messaging_overdraft_floor",
  "messaging_inbound_spike",
  // Grouped: one provider failing for several companies at once.
  "provider_outage",
] as const;
export type Kind = (typeof KINDS)[number];
export const kindValidator = literals(KINDS);

/** How the overview names each kind, for staff. */
export const KIND_LABELS: Record<Kind, string> = {
  agent_task_lease_expired: "Agent step stopped reporting",
  agent_task_failed: "Agent work failed after retries",
  chat_run_not_closed: "Chat response never closed",
  message_unconfirmed: "Delivery not confirmed",
  owner_notice_failing: "Owner notifications failing",
  send_recovery_stopped: "Stuck-send recovery stopped",
  inbound_processing_failed: "Provider callbacks failing",
  texting_needs_owner: "Texting registration needs the owner",
  texting_interrupted: "Texting interrupted by carriers",
  texting_failed: "Texting setup failed",
  texting_stalled: "Texting setup not progressing",
  texting_number_not_connected: "Approved campaign, number not connected",
  mailbox_reconnect: "Inbox needs reconnecting",
  mailbox_read_failing: "Inbox reads failing",
  google_reconnect: "Google needs reconnecting",
  google_job_failed: "Google work failed",
  google_job_uncertain: "Google write outcome unknown",
  connector_reconnect: "Connected system needs reconnecting",
  ai_settlement_unverified: "AI credit charge unsettled",
  ai_settlement_overdue: "AI credit settlement overdue",
  messaging_settlement_unverified: "Messaging charge unsettled",
  messaging_settlement_overdue: "Messaging settlement overdue",
  messaging_overdraft_floor: "Messaging balance at overdraft floor",
  messaging_inbound_spike: "Unusual burst of incoming texts",
  provider_outage: "Provider failing for several companies",
};

/**
 * Kinds whose source record ends in a final state (a failed Google job stays failed). The condition can
 * never "go away" by itself, so a staff member may close one with a written reason once it is handled.
 * Every other kind closes only when its check finds the condition gone.
 */
export const CLOSE_BY_HAND: ReadonlySet<Kind> = new Set<Kind>(["agent_task_failed", "google_job_failed", "texting_failed"]);

/** A resolved incident whose condition returns within this time is reopened, not opened again. */
export const REOPEN_WITHIN_MS = 24 * 60 * 60 * 1000;
/** At most this many related records are kept on one incident; the count of occurrences keeps going. */
export const MAX_RELATED = 25;
/** A provider failing in at least this many companies inside the window is one shared incident. */
export const OUTAGE_COMPANIES = 3;
export const OUTAGE_WINDOW_MS = 30 * 60 * 1000;
/** ...and began within this time, so problems that have stood for days are not mistaken for an outage. */
export const OUTAGE_STARTED_WITHIN_MS = 2 * 60 * 60 * 1000;
