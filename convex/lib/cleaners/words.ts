/**
 * A cleaner's history in sentences. The words come from the event's type and its small facts; nothing here
 * is written by a model, and a type without words reads as "made a change", never its internal name.
 */
import type { Doc } from "../../_generated/dataModel";
import { AGENT_PROFILES } from "../departments";
import { STATUS_WORDS } from "./enroll";

const STATUS = STATUS_WORDS as Record<string, string>;

export type TimelineEntry = {
  id: string;
  at: number;
  /** Who did it, in words: a person's name, an agent, "Selestial", or the cleaner themselves. */
  who: string;
  whoKind: "member" | "agent" | "system" | "cleaner";
  text: string;
  /** What kind of thing it was, for the icon. */
  tone: "record" | "message" | "job" | "requirement" | "decision" | "agent";
  jobId?: string;
};

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function eventText(event: Doc<"events">, labels: Map<string, string>): { text: string; tone: TimelineEntry["tone"] } {
  const data = event.data ?? {};
  const key = str(data.key);
  const label = key ? (labels.get(key) ?? "a requirement") : "a requirement";
  switch (event.type) {
    case "cleaner.created":
      return { text: data.from === "hiring" ? "joined from Recruiter after accepting an offer" : data.from === "imported" ? "was imported" : "was added", tone: "record" };
    case "cleaner.updated":
      return { text: "had their details updated", tone: "record" };
    case "cleaner.status_changed":
      return { text: `engagement changed from ${STATUS[str(data.from) ?? ""] ?? "unknown"} to ${STATUS[str(data.to) ?? ""] ?? "unknown"}`, tone: "record" };
    case "cleaner.pay_changed":
      return { text: "had their pay arrangement changed", tone: "decision" };
    case "cleaner.availability_set":
      return { text: `had their weekly availability set (${data.windows ?? 0} window${data.windows === 1 ? "" : "s"})`, tone: "record" };
    case "cleaner.availability_confirmed":
      return { text: str(data.how) ? `had their weekly availability confirmed as still right (${str(data.how)})` : "confirmed their weekly availability is still right", tone: "record" };
    case "cleaner.time_off_added":
      return { text: "had time away recorded", tone: "record" };
    case "cleaner.time_off_removed":
      return { text: "had time away removed", tone: "record" };
    case "cleaner.exception_added":
      return { text: `had a date exception recorded (${data.kind === "available" ? "can work" : "cannot work"} ${str(data.date) ?? ""})`, tone: "record" };
    case "cleaner.exception_removed":
      return { text: `had a date exception removed (${str(data.date) ?? ""})`, tone: "record" };
    case "cleaner.requirements_assigned":
      return { text: `was given ${data.count ?? 0} onboarding requirement${data.count === 1 ? "" : "s"}`, tone: "requirement" };
    case "cleaner.requirement_submitted":
      return { text: `submitted ${label}`, tone: "requirement" };
    case "cleaner.requirement_accepted":
      return { text: `had ${label} accepted`, tone: "requirement" };
    case "cleaner.requirement_needs_changes":
      return { text: `was asked to change ${label}`, tone: "requirement" };
    case "cleaner.requirement_waived":
      return { text: `had ${label} waived`, tone: "requirement" };
    case "cleaner.requirement_reset":
      return { text: `had ${label} reopened`, tone: "requirement" };
    case "cleaner.requirement_expired":
      return { text: `${label} expired`, tone: "requirement" };
    case "cleaner.photo_set":
      return { text: "had their photo updated", tone: "record" };
    case "cleaner.duplicate_overridden":
      return { text: "was added although a similar record exists, with a reason", tone: "record" };
    case "cleaner.engagement_type_changed":
      return { text: "had their relationship type changed", tone: "decision" };
    case "cleaner.affiliation_changed":
      return { text: "moved to a different subcontractor company", tone: "record" };
    case "cleaner.skill_claimed":
      return { text: `said they have the skill "${str(data.skill) ?? ""}"`, tone: "record" };
    case "cleaner.skill_confirmed":
      return { text: `had the skill "${str(data.skill) ?? ""}" confirmed`, tone: "record" };
    case "cleaner.skill_declined":
      return { text: `had the skill "${str(data.skill) ?? ""}" not confirmed`, tone: "record" };
    case "cleaner.crew_joined":
      return { text: `joined the crew ${str(data.crew) ?? ""}${data.role === "lead" ? " as lead" : ""}`, tone: "record" };
    case "cleaner.crew_left":
      return { text: `left the crew ${str(data.crew) ?? ""}`, tone: "record" };
    case "cleaner.portal_invited":
      return { text: "was invited to their portal", tone: "message" };
    case "cleaner.portal_revoked":
      return { text: "had their portal access ended", tone: "record" };
    case "cleaner.personnel_requested":
      return { text: `had a ${str(data.kind)?.replace(/_/g, " ") ?? "personnel"} request opened`, tone: "decision" };
    case "cleaner.personnel_decided":
      return { text: `had a ${str(data.kind)?.replace(/_/g, " ") ?? "personnel"} request ${str(data.decision) ?? "decided"}`, tone: "decision" };
    case "cleaner.coaching_added":
      return { text: data.shared ? "was sent feedback in their portal" : "had an internal note added", tone: "decision" };
    case "cleaner.coaching_drafted":
      return { text: "had a coaching note drafted by Selestial for review", tone: "agent" };
    case "cleaner.feedback_answered":
      return { text: "replied to feedback", tone: "record" };
    case "cleaner.record_disputed":
      return { text: "had a performance record disputed", tone: "decision" };
    case "cleaner.dispute_decided":
      return { text: `had a disputed record ${data.decision === "corrected" ? "corrected" : "upheld"}`, tone: "decision" };
    case "cleaner.checked_in":
      return { text: `answered a check-in: ${data.answer === "available" ? "still available" : data.answer === "fewer" ? "available for fewer jobs" : data.answer === "break" ? "taking a break" : "wants to stop"}`, tone: "record" };
    case "cleaner.follow_up":
      return { text: str(data.words) ?? "had a routine follow-up", tone: "agent" };
    default:
      return { text: "had a change recorded", tone: "record" };
  }
}

export function actorWords(actor: Doc<"events">["actor"], members: Map<string, string>, cleanerName: string): { who: string; whoKind: TimelineEntry["whoKind"] } {
  if (actor.kind === "member") return { who: members.get(actor.memberId) ?? "A team member", whoKind: "member" };
  if (actor.kind === "agent") return { who: AGENT_PROFILES[actor.agent].name, whoKind: "agent" };
  if (actor.kind === "cleaner" || actor.kind === "cleaner_portal") return { who: cleanerName, whoKind: "cleaner" };
  if (actor.kind === "subcontractor_contact") return { who: "Their subcontractor company", whoKind: "cleaner" };
  return { who: "Selestial", whoKind: "system" };
}

/** What became of a message, in words that never overstate it. */
export const MESSAGE_STATE_WORDS: Record<Doc<"messages">["status"], string> = {
  queued: "being prepared",
  held: "waiting for quiet hours to end",
  sending: "being sent",
  sent: "sent",
  delivered: "delivered",
  failed: "not delivered",
  unconfirmed: "sent, but delivery is not confirmed",
  not_sent: "not sent",
};

export const PURPOSE_WORDS: Partial<Record<Doc<"messages">["purpose"], string>> = {
  offer: "Job offer",
  backup_offer: "Cover offer",
  assignment_confirmed: "Assignment confirmed",
  reminder: "Job reminder",
  before_photos: "Before-photos link",
  check_in_nudge: "Check-in nudge",
  offer_withdrawn: "Offer withdrawn",
  assignment_ended: "Assignment ended",
  portal_invitation: "Portal invitation",
  onboarding_reminder: "Onboarding reminder",
  availability_check: "Availability check",
  idle_check_in: "Check-in",
  verification_code: "Sign-in code",
};
