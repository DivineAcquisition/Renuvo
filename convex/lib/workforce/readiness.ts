/**
 * Whether a worker can be offered work, and exactly what stands in the way (docs/cleaners/00-architecture.md).
 *
 * Pure functions over facts already read from the record, so the directory, the profile, the attention
 * list and the tests all run the same rules. Each check says what it blocks:
 *  - "assignments": Dispatch will not offer this person work while it is unmet. Every check marked so
 *    here is one Dispatch itself enforces (convex/lib/dispatch/eligibility.ts), so the two never disagree.
 *  - "payment": the person cannot be paid while it is unmet.
 *  - "info": worth knowing, and it changes how work reaches them, but it stops nothing.
 *
 * "Ready" never means "available for every job": a ready worker still has to fit each job's skills,
 * area and time. And "active" (the engagement status a person sets) never means every requirement is
 * met: an active worker with no hours set is active and blocked, and the screen says so.
 */
import type { CleanerStatus } from "../statuses";

export type Blocks = "assignments" | "payment" | "info";
export type CheckState = "met" | "unmet";

/** Where on the profile the fix for a check lives. */
export type ProfileSection = "overview" | "availability" | "onboarding" | "skills" | "performance" | "pay" | "activity";

export type ReadinessCheck = {
  key: string;
  label: string;
  state: CheckState;
  blocks: Blocks;
  /** One sentence a person can act on. */
  detail: string;
  section: ProfileSection;
};

export type ReadinessState = "ready" | "blocked" | "onboarding" | "paused" | "ended";

export type Readiness = {
  state: ReadinessState;
  /** True only when Dispatch may offer this person work that fits them. */
  eligible: boolean;
  /** A short phrase for a card: "Ready for assignments", "Needs hours and a service area". */
  headline: string;
  /** The unmet checks that block assignments, in order. */
  blockers: ReadinessCheck[];
  checks: ReadinessCheck[];
  /** Payment is Finance's record, which is not built: it is never shown as ready or not ready. */
  payout: "not_tracked";
};

export type WorkerFacts = {
  status: CleanerStatus;
  engagement: "contractor" | "employee" | "subcontracted";
  phone?: string;
  email?: string;
  serviceAreas: string[];
  skills: string[];
  /** Weekly windows on record. */
  windowCount: number;
  /** Whether the Owner has set how this person is paid. The amount is never part of readiness. */
  hasPay: boolean;
  /** Permission for work texts, as recorded. */
  workTexts: "granted" | "withdrawn" | "none";
  /** The subcontractor that supplies this worker now, if any. */
  subcontractor: { name: string; status: "active" | "paused" | "ended" } | null;
  /** Onboarding items from a hire that a person has not yet recorded as done. Told to us by Recruiter's handoff. */
  handoffOutstanding: string[];
};

const listWords = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** Every check, in the order a person would work through them. */
export function readinessChecks(facts: WorkerFacts): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const add = (check: ReadinessCheck) => checks.push(check);

  add(
    facts.status === "ready"
      ? { key: "active", label: "Marked active", state: "met", blocks: "assignments", detail: "A person marked them active for work.", section: "overview" }
      : {
          key: "active",
          label: "Marked active",
          state: "unmet",
          blocks: "assignments",
          detail:
            facts.status === "onboarding"
              ? "Still onboarding. A person marks them active once they can take work."
              : facts.status === "paused"
                ? "Paused by a person. Nobody offers them work until they are made active again."
                : "Their engagement has ended.",
          section: "overview",
        },
  );

  if (facts.subcontractor && facts.subcontractor.status !== "active") {
    add({
      key: "subcontractor",
      label: "Supplying company active",
      state: "unmet",
      blocks: "info",
      detail: `${facts.subcontractor.name} is ${facts.subcontractor.status}. Check whether this worker should still take work through them.`,
      section: "overview",
    });
  }

  add(
    facts.serviceAreas.length > 0
      ? { key: "service_areas", label: "Service areas", state: "met", blocks: "assignments", detail: `Works in ${listWords(facts.serviceAreas.slice(0, 4))}${facts.serviceAreas.length > 4 ? ` and ${facts.serviceAreas.length - 4} more` : ""}.`, section: "availability" }
      : { key: "service_areas", label: "Service areas", state: "unmet", blocks: "assignments", detail: "No service area is set, so no visit matches them.", section: "availability" },
  );

  add(
    facts.windowCount > 0
      ? { key: "hours", label: "Weekly hours", state: "met", blocks: "assignments", detail: `${facts.windowCount} weekly ${facts.windowCount === 1 ? "window" : "windows"} on record.`, section: "availability" }
      : { key: "hours", label: "Weekly hours", state: "unmet", blocks: "assignments", detail: "No hours are on record. Nobody is offered a time they have not said they can work.", section: "availability" },
  );

  add(
    facts.hasPay
      ? { key: "pay", label: "Pay arrangement", state: "met", blocks: "assignments", detail: "The Owner has set how they are paid.", section: "pay" }
      : { key: "pay", label: "Pay arrangement", state: "unmet", blocks: "assignments", detail: "The Owner has not set how they are paid, so an offer cannot state their pay.", section: "pay" },
  );

  const phone = facts.phone?.replace(/[^\d]/g, "") ?? "";
  add(
    phone.length >= 10
      ? { key: "phone", label: "Mobile number", state: "met", blocks: "info", detail: "Offers and reminders can be texted.", section: "overview" }
      : { key: "phone", label: "Mobile number", state: "unmet", blocks: "info", detail: "No mobile number, so offers cannot be texted. The office has to reach them another way.", section: "overview" },
  );

  add(
    facts.workTexts === "granted"
      ? { key: "work_texts", label: "Permission for work texts", state: "met", blocks: "info", detail: "They agreed to work texts.", section: "overview" }
      : {
          key: "work_texts",
          label: "Permission for work texts",
          state: "unmet",
          blocks: "info",
          detail: facts.workTexts === "withdrawn" ? "They withdrew permission for work texts. Nothing is texted to them." : "No permission for work texts is on record, so texts to them are refused.",
          section: "overview",
        },
  );

  add(
    facts.skills.length > 0
      ? { key: "skills", label: "Skills", state: "met", blocks: "info", detail: `${facts.skills.length} ${facts.skills.length === 1 ? "skill" : "skills"} on record.`, section: "skills" }
      : { key: "skills", label: "Skills", state: "unmet", blocks: "info", detail: "No skills on record. They match only visits that need no particular skill.", section: "skills" },
  );

  if (facts.handoffOutstanding.length > 0) {
    add({
      key: "hiring_handoff",
      label: "Onboarding from hiring",
      state: "unmet",
      blocks: "info",
      detail: `Still to record from their hire: ${listWords(facts.handoffOutstanding.map((item) => item.toLowerCase()))}.`,
      section: "onboarding",
    });
  }
  return checks;
}

const BLOCKER_WORDS: Record<string, string> = { service_areas: "a service area", hours: "weekly hours", pay: "a pay arrangement" };

export function readinessOf(facts: WorkerFacts): Readiness {
  const checks = readinessChecks(facts);
  const blockers = checks.filter((check) => check.state === "unmet" && check.blocks === "assignments");
  const missing = blockers.filter((check) => check.key !== "active").map((check) => BLOCKER_WORDS[check.key] ?? check.label.toLowerCase());
  const needs = missing.length > 0 ? `Needs ${listWords(missing)}` : null;
  let state: ReadinessState;
  let headline: string;
  if (facts.status === "ended") {
    state = "ended";
    headline = "Engagement ended";
  } else if (facts.status === "paused") {
    state = "paused";
    headline = "Paused";
  } else if (facts.status === "onboarding") {
    state = "onboarding";
    headline = needs ? `Onboarding · ${needs.charAt(0).toLowerCase()}${needs.slice(1)}` : "Onboarding · nothing missing on record";
  } else if (blockers.length > 0) {
    state = "blocked";
    headline = needs ?? "Cannot be offered work";
  } else {
    state = "ready";
    headline = "Ready for assignments";
  }
  return { state, eligible: state === "ready", headline, blockers, checks, payout: "not_tracked" };
}

/** Words for the overview's four counts. Shown beside the numbers, so nobody reads more into them. */
export const COUNT_DEFINITIONS = {
  ready: "Active, with service areas, weekly hours and pay set. Dispatch can offer them work that fits their skills, areas and hours. It does not mean they are free for any particular job.",
  onboarding: "Not yet made active by a person. They are offered no work until they are.",
  attention: "People with something a person should look at: a conflict with upcoming work, an overdue onboarding, or an active worker who cannot be offered work.",
  workingToday: "Has accepted at least one visit today. Someone not working today is not necessarily free.",
} as const;
