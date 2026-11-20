/**
 * Admin Support Sessions (docs/operations/03-support-sessions.md): what Selestial staff may do inside a
 * company's workspace, and how long for.
 *
 * Staff capabilities are code, like the agents' permission catalog. A staff member holds their role's base
 * capabilities plus any a staff admin granted them by name. Sensitive capabilities are never part of a
 * role: each is granted to a person, with a reason, and the grant is recorded.
 */
import { literals } from "../statuses";

export const CAPABILITIES = [
  /** Open a company's workspace in View mode: configuration, workflow state, records. Message content stays hidden. */
  "workspace.view",
  /** Correct configuration and drafts, and work tasks, inside a Manage session. */
  "records.edit",
  /** Pause agents, retry eligible failed work, read an inbox or registration again. */
  "agents.recover",
  /** Actions that reach a customer, cleaner or applicant. None is opened to support sessions yet. */
  "communications.send",
  /** Credits, balances, refunds and plans. None is opened to support sessions yet. */
  "billing.adjust",
  /** Deleting or cancelling things that cannot be brought back. None is opened to support sessions yet. */
  "records.destroy",
] as const;
export type Capability = (typeof CAPABILITIES)[number];
export const capabilityValidator = literals(CAPABILITIES);

export const CAPABILITY_LABELS: Record<Capability, { label: string; detail: string; sensitive: boolean }> = {
  "workspace.view": { label: "View workspaces", detail: "Open a company's workspace to inspect setup, workflows and records. Message content stays hidden unless revealed with a reason.", sensitive: false },
  "records.edit": { label: "Edit records", detail: "In Manage mode: correct business settings, service drafts and texting details, and work tasks.", sensitive: false },
  "agents.recover": { label: "Recover agent work", detail: "In Manage mode: pause agents, retry failed first work, read an inbox or a registration again.", sensitive: false },
  "communications.send": { label: "Communication actions", detail: "Anything that reaches a customer, cleaner or applicant. Granted per person.", sensitive: true },
  "billing.adjust": { label: "Billing adjustments", detail: "Credits, balances, refunds and plans. Granted per person.", sensitive: true },
  "records.destroy": { label: "Destructive actions", detail: "Deleting or cancelling what cannot be restored. Granted per person.", sensitive: true },
};

/** What each staff role holds without a grant. Reviewers work the request queues and open no workspace. */
export const ROLE_CAPABILITIES: Record<"admin" | "support" | "reviewer", readonly Capability[]> = {
  admin: ["workspace.view", "records.edit", "agents.recover"],
  support: ["workspace.view", "records.edit", "agents.recover"],
  reviewer: [],
};

export function capabilitiesOf(staff: { role: "admin" | "support" | "reviewer"; capabilities?: readonly Capability[] }): Set<Capability> {
  return new Set<Capability>([...ROLE_CAPABILITIES[staff.role], ...(staff.capabilities ?? [])]);
}

/** A session lasts an hour, and can be extended by an hour at a time with a fresh verification. */
export const SESSION_MS = 60 * 60 * 1000;
/** Starting a session, switching to Manage and revealing content need a second factor this recent. */
export const RECENT_VERIFICATION_MINUTES = 10;
/** An owner's grant of Manage access lasts this long unless they end it sooner. */
export const GRANT_DEFAULT_HOURS = 24;
export const GRANT_MAX_HOURS = 72;

/** The name a company sees for anything done in a support session. Never the owner's or a member's name. */
export const SUPPORT_NAME = "Selestial Support";
/** The support member row's address. It never receives mail: support members are never notice recipients. */
export const SUPPORT_EMAIL = "support-session@selestial.invalid";

/**
 * Customer, cleaner and applicant words that a View session shows only after "Reveal content". Each
 * table lists the fields replaced, and the address fields masked, in query results. Mutations always see
 * the stored values, so nothing redacted is ever written back.
 */
export const REDACTED_FIELDS: Record<string, { hide: readonly string[]; mask?: readonly string[] }> = {
  messages: { hide: ["body", "subject"], mask: ["to"] },
  inboundMessages: { hide: ["body"], mask: ["from"] },
  financeMessages: { hide: ["body", "subject"] },
  salesMessages: { hide: ["body", "subject"] },
  salesActions: { hide: ["body", "subject"] },
  salesFollowUps: { hide: ["preview"] },
  sourceMessages: { hide: ["excerpt", "subject"] },
  replyReadings: { hide: ["excerpt"] },
  retentionEntries: { hide: ["text"] },
  chatMessages: { hide: ["text"] },
};
export const HIDDEN_WORDS = "Hidden in support session";
