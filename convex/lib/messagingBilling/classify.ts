/**
 * Whether a message is a metered business message or one of Selestial's own included notices. Decided on
 * the server from the message's purpose, which only Selestial's code sets: a screen, an agent or a request
 * cannot mark a message to a customer as a platform notice.
 *
 * Included (never charged): answers to STOP, HELP and START (the law requires them), sign-in codes, and
 * Selestial's own notices to the company's members (approval alerts, billing and low-balance notices,
 * invitations, security), which do not go through the business outbox at all.
 *
 * Metered: every business message to a customer, applicant, cleaner or contact, when it is delivered
 * through a paid route (Selestial's texting numbers, or Selestial's email delivery). Email sent from the
 * company's own connected Gmail has no Selestial delivery charge.
 */
import type { Doc } from "../../_generated/dataModel";

type Purpose = Doc<"messages">["purpose"];

const INCLUDED: ReadonlySet<Purpose> = new Set<Purpose>(["compliance_reply", "verification_code", "operator_alert", "member_notice"]);

export type BillingClass = "included" | "metered";

export function billingClassOf(purpose: Purpose): BillingClass {
  return INCLUDED.has(purpose) ? "included" : "metered";
}

export const INCLUDED_WORDS: Partial<Record<Purpose, string>> = {
  compliance_reply: "Answer to STOP, HELP or START (required, included)",
  verification_code: "Sign-in code (included)",
  operator_alert: "Alert to your team (included)",
  member_notice: "Notice to your team from Selestial (included)",
};
