/**
 * Readiness, as one pure function (docs/cleaners/00-architecture.md, section 4). The directory, the profile,
 * Dispatch's eligibility rules, the portal, Chat and the follow-up engine all call this, so they can never
 * disagree about who is ready and why not.
 *
 * Only a cleaner's assigned requirements count: a requirement the Owner adds later does not silently block
 * people already working, until the Owner applies it to them. Met means accepted (and not expired) or
 * waived by a named person. Submitted and awaiting review are not met: an upload is not a verification.
 */
import type { CleanerStatus } from "../statuses";
import type { Definition } from "./settings";
import type { Engagement, RequirementEffect, RequirementKind, RequirementState } from "./schema";

const DAY = 24 * 60 * 60 * 1000;

export type RequirementRow = {
  key: string;
  status: RequirementState;
  expiresAt?: number;
  acceptedAt?: number;
  submittedAt?: number;
  reviewNote?: string;
  waiver?: { reason: string; at: number };
  /** For an acknowledgment: the words the cleaner agreed to. */
  acknowledged?: { words: string; at: number };
};

/** What the record says, outside the requirement rows, for requirements that are read from data. */
export type ReadinessFacts = {
  status: CleanerStatus;
  engagement: Engagement;
  weeklyWindows: number;
  serviceAreas: number;
  /** For agreement requirements: the state of the linked agreement, by document type ("*" for any workforce agreement). */
  agreements: { docType: string; state: "signed" | "sent" | "draft" }[];
};

export type RequirementView = {
  key: string;
  label: string;
  description?: string;
  kind: RequirementKind;
  effect: RequirementEffect;
  /** The state after expiry and data are taken into account. */
  state: RequirementState;
  met: boolean;
  /** Read from the record (availability, areas, a signed agreement) rather than reviewed. */
  fromRecord: boolean;
  reviewer: "manager" | "owner";
  cleanerCompletes: boolean;
  forServices: string[];
  providedBy?: "company" | "cleaner" | "crew";
  expiresAt?: number;
  expiringSoon: boolean;
  reviewNote?: string;
  waiverReason?: string;
};

export type ReadinessState = "ready" | "blocked" | "onboarding" | "not_active";

export type Readiness = {
  state: ReadinessState;
  /** Ready for assignments in general. Ready is not available: availability is its own check, per job. */
  eligible: boolean;
  /** Unmet requirements that block every assignment. */
  blockers: RequirementView[];
  /** Unmet requirements that block only some services. */
  serviceBlockers: RequirementView[];
  paymentBlockers: RequirementView[];
  payoutReady: boolean;
  requirements: RequirementView[];
  /** Every assigned requirement that is met, out of all assigned. */
  progress: { met: number; total: number };
  /** One line a person reads: what this person's readiness is and, if not ready, exactly why. */
  summary: string;
  /** The first thing to do, in a few words. */
  nextStep: string | null;
};

const MET: readonly RequirementState[] = ["accepted", "waived"];

function list(views: RequirementView[]): string {
  const labels = views.map((view) => view.label.charAt(0).toLowerCase() + view.label.slice(1));
  if (labels.length <= 2) return labels.join(" and ");
  return `${labels.slice(0, 2).join(", ")} and ${labels.length - 2} more`;
}

function fromRecord(def: Definition, facts: ReadinessFacts): RequirementState | null {
  if (def.kind === "availability") return facts.weeklyWindows > 0 ? "accepted" : "not_started";
  if (def.kind === "service_areas") return facts.serviceAreas > 0 ? "accepted" : "not_started";
  if (def.kind === "agreement") {
    const match = facts.agreements.filter((row) => !def.agreementDocType || row.docType === def.agreementDocType);
    if (match.some((row) => row.state === "signed")) return "accepted";
    // Sent for signature is not signed. A draft says nothing to the cleaner yet.
    if (match.some((row) => row.state === "sent")) return "submitted";
    return null;
  }
  return null;
}

export function viewOf(def: Definition, row: RequirementRow, facts: ReadinessFacts, now: number, warningDays: number): RequirementView {
  const recorded = fromRecord(def, facts);
  let state: RequirementState = row.status;
  // Weekly hours and areas are facts on the record: only the record (or a person's waiver) answers for them.
  if ((def.kind === "availability" || def.kind === "service_areas") && row.status !== "waived") state = recorded ?? "not_started";
  // For an agreement, a signed one in Agreements answers; without one, a person's record of a paper copy stands.
  else if (row.status !== "waived" && recorded !== null && (recorded === "accepted" || row.status === "not_started")) state = recorded;
  // An acknowledgment is of the words it was given to. When the company changes them, it is asked again.
  if (def.kind === "acknowledgment" && state === "accepted" && row.acknowledged && row.acknowledged.words.trim() !== (def.description ?? "").trim()) state = "not_started";
  if (state === "accepted" && row.expiresAt !== undefined && row.expiresAt <= now) state = "expired";
  const met = MET.includes(state);
  return {
    key: def.key,
    label: def.label,
    description: def.description,
    kind: def.kind,
    effect: def.effect,
    state,
    met,
    fromRecord: recorded !== null && state === recorded,
    reviewer: def.reviewer,
    cleanerCompletes: def.cleanerCompletes,
    forServices: def.forServices,
    providedBy: def.providedBy,
    expiresAt: row.expiresAt,
    expiringSoon: met && state === "accepted" && row.expiresAt !== undefined && row.expiresAt - now <= warningDays * DAY,
    reviewNote: row.reviewNote,
    waiverReason: row.waiver?.reason,
  };
}

/** Whether a requirement counts for a job of this service (lower case), or for work in general when null. */
export function countsFor(view: Pick<RequirementView, "forServices" | "providedBy">, service: string | null, jobSkills: string[] = []): boolean {
  // Equipment the crew provides is checked on the crew, never held against one person.
  if (view.providedBy === "crew") return false;
  if (view.forServices.length === 0) return true;
  if (service === null) return false;
  const wanted = [service.trim().toLowerCase(), ...jobSkills.map((skill) => skill.toLowerCase())];
  return view.forServices.some((name) => wanted.includes(name));
}

/**
 * The readiness of one cleaner. `service` narrows it to one kind of job (Dispatch passes the job's service
 * and skills); without it, service-specific requirements are reported separately and do not make anyone
 * "not ready" in general.
 */
export function readiness(input: {
  definitions: Definition[];
  rows: RequirementRow[];
  facts: ReadinessFacts;
  now: number;
  warningDays?: number;
  service?: { name: string; skills: string[] } | null;
}): Readiness {
  const { facts, now } = input;
  const byKey = new Map(input.rows.map((row) => [row.key, row]));
  const views: RequirementView[] = [];
  for (const def of input.definitions) {
    if (!def.appliesTo.includes(facts.engagement)) continue;
    const row = byKey.get(def.key);
    // Not assigned to this person: it does not count until the Owner applies it to them.
    if (!row) continue;
    views.push(viewOf(def, row, facts, now, input.warningDays ?? 30));
  }
  const service = input.service ?? null;
  const assignment = views.filter((view) => view.effect === "blocks_assignments" && !view.met);
  const blockers = assignment.filter((view) => countsFor(view, service?.name ?? null, service?.skills ?? []) && (service !== null || view.forServices.length === 0));
  const serviceBlockers = service === null ? assignment.filter((view) => view.forServices.length > 0 && view.providedBy !== "crew") : [];
  const paymentBlockers = views.filter((view) => view.effect === "blocks_payment" && !view.met);
  const met = views.filter((view) => view.met).length;

  let state: ReadinessState;
  let summary: string;
  let nextStep: string | null = null;
  // `summary` follows the state's own words on screen ("Ready for assignments", "Onboarding"), so it explains rather than repeats.
  if (facts.status === "ended") {
    state = "not_active";
    summary = "The engagement has ended. Their history is kept.";
  } else if (facts.status === "suspended") {
    state = "not_active";
    summary = "Suspended. No work is offered until an approved reinstatement.";
  } else if (facts.status === "paused") {
    state = "not_active";
    summary = "Paused. No work is offered until a person makes the engagement active again.";
  } else if (facts.status === "onboarding") {
    state = "onboarding";
    if (blockers.length > 0) {
      summary = `Still needed before work: ${list(blockers)}.`;
      nextStep = blockers[0].label;
    } else {
      summary = "Every requirement for work is met. A person can make the engagement active.";
      nextStep = "Make the engagement active";
    }
  } else if (blockers.length > 0) {
    state = "blocked";
    summary = `The engagement is active, but ${list(blockers)} ${blockers.length === 1 ? "is" : "are"} not met, so no work can be offered.`;
    nextStep = blockers[0].label;
  } else {
    state = "ready";
    summary = serviceBlockers.length > 0 ? `Every requirement for work is met, except for ${[...new Set(serviceBlockers.flatMap((view) => view.forServices))].join(", ")} work. Free time is checked for each job.` : "Every requirement for work is met. Free time is checked for each job.";
  }
  return {
    state,
    eligible: state === "ready",
    blockers,
    serviceBlockers,
    paymentBlockers,
    payoutReady: paymentBlockers.length === 0,
    requirements: views,
    progress: { met, total: views.length },
    summary,
    nextStep,
  };
}

export const STATE_WORDS: Record<RequirementState, string> = {
  not_started: "Not started",
  submitted: "Submitted",
  awaiting_review: "Awaiting review",
  accepted: "Accepted",
  needs_changes: "Needs changes",
  expired: "Expired",
  waived: "Waived",
};

export const EFFECT_WORDS: Record<RequirementEffect, string> = {
  blocks_assignments: "Needed before work",
  blocks_payment: "Needed before payment",
  informational: "For information",
};
