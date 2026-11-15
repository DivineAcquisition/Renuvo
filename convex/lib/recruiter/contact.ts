/**
 * Deciding which address, if any, an applicant can be written to. Pure: the evidence goes in, a verdict
 * comes out. Nothing is guessed. Two different addresses that both look like the applicant's are a
 * conflict for a person, not a coin toss, and a job board's forwarding address is used only when the
 * Owner has confirmed that board's forwarding works.
 */
import type { Contact, ContactEvidence, ContactStatus, Source } from "./schema";

function distinct(evidence: ContactEvidence[], kind: ContactEvidence["kind"]): string[] {
  return [...new Set(evidence.filter((entry) => entry.kind === kind).map((entry) => entry.address))];
}

export function resolveContact(evidence: ContactEvidence[], source: Source, verifiedRelays: readonly Source[]): Contact {
  const direct = distinct(evidence, "direct");
  const relay = distinct(evidence, "relay");
  let status: ContactStatus;
  let address: string | undefined;
  if (direct.length === 1) [status, address] = ["direct", direct[0]];
  else if (direct.length > 1) status = "conflict";
  else if (relay.length === 1) [status, address] = [verifiedRelays.includes(source) ? "relay" : "relay_unverified", relay[0]];
  else if (relay.length > 1) status = "conflict";
  else if (distinct(evidence, "notification").length > 0 && distinct(evidence, "unknown").length === 0) status = "notification_only";
  else status = "missing";
  return { status, address, evidence };
}

export const CONTACT_WORDS: Record<ContactStatus, string> = {
  direct: "An address the applicant gave as their own.",
  relay: "The job board's forwarding address for this applicant. You confirmed this board's forwarding reaches applicants.",
  relay_unverified: "Only the job board's forwarding address is known, and its forwarding has not been confirmed for this company.",
  notification_only: "The only address is one that sends notices. Nobody reads mail sent to it.",
  missing: "No address that is clearly the applicant's was found.",
  conflict: "More than one address could be the applicant's.",
};

/** What a person should do about an application whose contact is not usable. */
export function contactNextStep(status: ContactStatus): string {
  if (status === "conflict") return "Choose the applicant's address from the ones found, or enter the right one.";
  if (status === "relay_unverified") return "Confirm this job board's forwarding address reaches applicants (Playbook), or enter the applicant's own address from the job board.";
  return "Open the application on the job board and enter the applicant's email address.";
}
