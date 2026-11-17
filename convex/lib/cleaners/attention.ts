/**
 * What needs a person's attention about the workforce. Each item is a verified fact from the record with the
 * record behind it, never a guess: a missing requirement is a requirement row, a conflict is an accepted
 * assignment that overlaps a recorded absence, an expiring document has an expiry date. Pure, so the same
 * rules run on the overview, in the profile, in Chat and in a test.
 */
import { localParts, overlaps, withinWeeklyWindows, type Span, type WeeklyWindow } from "../availability";
import type { Readiness } from "./readiness";

const DAY = 24 * 60 * 60 * 1000;

export type AttentionKind =
  | "review_waiting"
  | "missing_requirements"
  | "availability_missing"
  | "availability_unconfirmed"
  | "expiring"
  | "expired"
  | "conflict"
  | "no_contact"
  | "no_pay"
  | "check_in_unanswered"
  | "coaching_review"
  | "skill_claims";

export type Severity = "urgent" | "decide" | "look";

/** The profile section an item opens. */
export type Section = "overview" | "availability" | "onboarding" | "skills" | "performance" | "pay" | "activity";

export type AttentionItem = {
  id: string;
  cleanerId: string;
  cleanerName: string;
  kind: AttentionKind;
  severity: Severity;
  /** One line: what is wrong. */
  title: string;
  /** The facts behind it, in words. */
  detail: string;
  section: Section;
  /** Records the statement rests on: a job opens the shared detail panel. */
  evidence: { label: string; jobId?: string; requirementKey?: string }[];
  /** What Selestial is doing about it, when something is scheduled. Filled by the follow-up engine. */
  selestial?: string;
  at?: number;
};

export type Commitment = { jobId: string; assignmentId: string; startsAt: number; endsAt: number; label: string; status: "offered" | "accepted" };
export type Absence = { kind: "time_off" | "exception"; span: Span; note?: string };

/** Accepted work that clashes with what the cleaner said about their time, or with other accepted work. */
export function conflictsOf(input: { commitments: Commitment[]; absences: Absence[]; windows: WeeklyWindow[]; extraAvailable?: Span[]; timezone: string }): { commitment: Commitment; reason: string }[] {
  const out: { commitment: Commitment; reason: string }[] = [];
  const accepted = input.commitments.filter((row) => row.status === "accepted").sort((a, b) => a.startsAt - b.startsAt);
  for (const commitment of accepted) {
    const span = { startsAt: commitment.startsAt, endsAt: commitment.endsAt };
    const absence = input.absences.find((row) => overlaps(row.span, span));
    if (absence) {
      out.push({ commitment, reason: absence.kind === "time_off" ? `overlaps time away${absence.note ? ` (${absence.note})` : ""}` : "falls on a date they said they cannot work" });
      continue;
    }
    const covered = withinWeeklyWindows(input.windows, span, input.timezone) || (input.extraAvailable ?? []).some((extra) => extra.startsAt <= span.startsAt && span.endsAt <= extra.endsAt);
    if (input.windows.length > 0 && !covered) {
      out.push({ commitment, reason: "is outside the hours they said they can work" });
      continue;
    }
    const clash = accepted.find((other) => other.assignmentId !== commitment.assignmentId && overlaps({ startsAt: other.startsAt, endsAt: other.endsAt }, span));
    if (clash && clash.startsAt <= commitment.startsAt) out.push({ commitment, reason: `overlaps another accepted job (${clash.label})` });
  }
  return out;
}

export type CleanerAttentionInput = {
  cleaner: { id: string; name: string; status: string; phone?: string; email?: string; hasPay: boolean; availabilityConfirmedAt?: number; createdAt: number };
  readiness: Readiness;
  weeklyWindows: number;
  conflicts: { commitment: Commitment; reason: string }[];
  /** Skills the cleaner says they have, waiting for a person. */
  skillClaims: number;
  now: number;
  timezone: string;
  settings: { availabilityConfirmDays: number };
  /** Pay is the Owner's: the item is shown only to the Owner. */
  viewerIsOwner: boolean;
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function day(at: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric" }).format(new Date(at));
}

/** Every attention item for one cleaner. An ended engagement needs nothing. */
export function attentionFor(input: CleanerAttentionInput): AttentionItem[] {
  const { cleaner, readiness, now } = input;
  if (cleaner.status === "ended") return [];
  const items: AttentionItem[] = [];
  const base = { cleanerId: cleaner.id, cleanerName: cleaner.name };
  const working = cleaner.status === "ready" || cleaner.status === "onboarding";

  const review = readiness.requirements.filter((view) => view.state === "awaiting_review" || (view.state === "submitted" && !view.fromRecord));
  if (review.length > 0) {
    items.push({ ...base, id: `review:${cleaner.id}`, kind: "review_waiting", severity: "decide", title: `${plural(review.length, "item")} to review`, detail: `${cleaner.name} submitted ${review.map((view) => view.label.toLowerCase()).join(", ")}. Nothing counts until a person reviews it.`, section: "onboarding", evidence: review.map((view) => ({ label: view.label, requirementKey: view.key })) });
  }

  if (working && readiness.blockers.length > 0) {
    const waiting = readiness.blockers.filter((view) => !review.some((other) => other.key === view.key));
    if (waiting.length > 0) {
      items.push({
        ...base,
        id: `missing:${cleaner.id}`,
        kind: "missing_requirements",
        severity: cleaner.status === "ready" ? "urgent" : "look",
        title: cleaner.status === "ready" ? "Active but cannot be offered work" : `${plural(waiting.length, "onboarding item")} missing`,
        detail: `Not met: ${waiting.map((view) => view.label.toLowerCase()).join(", ")}.`,
        section: "onboarding",
        evidence: waiting.map((view) => ({ label: `${view.label}: ${view.state.replace(/_/g, " ")}`, requirementKey: view.key })),
      });
    }
  }

  for (const view of readiness.requirements) {
    if (view.state === "expired") {
      items.push({ ...base, id: `expired:${cleaner.id}:${view.key}`, kind: "expired", severity: view.effect === "blocks_assignments" ? "urgent" : "look", title: `${view.label}: expired`, detail: `It expired ${view.expiresAt ? day(view.expiresAt, input.timezone) : "recently"}${view.effect === "blocks_assignments" ? ", so no new work can be offered until it is renewed" : ""}.`, section: "onboarding", evidence: [{ label: view.label, requirementKey: view.key }], at: view.expiresAt });
    } else if (view.expiringSoon && view.expiresAt) {
      const days = Math.max(0, Math.ceil((view.expiresAt - now) / DAY));
      items.push({ ...base, id: `expiring:${cleaner.id}:${view.key}`, kind: "expiring", severity: "look", title: `${view.label}: ${days === 0 ? "expires today" : `expiring in ${plural(days, "day")}`}`, detail: `Accepted, valid until ${day(view.expiresAt, input.timezone)}.`, section: "onboarding", evidence: [{ label: view.label, requirementKey: view.key }], at: view.expiresAt });
    }
  }

  if (working && input.weeklyWindows === 0) {
    items.push({ ...base, id: `availability:${cleaner.id}`, kind: "availability_missing", severity: cleaner.status === "ready" ? "urgent" : "look", title: "No weekly availability", detail: "Dispatch never offers a time a cleaner has not said they can work, so nothing can be offered yet.", section: "availability", evidence: [] });
  } else if (cleaner.status === "ready") {
    const since = cleaner.availabilityConfirmedAt;
    const stale = since === undefined ? now - cleaner.createdAt > input.settings.availabilityConfirmDays * DAY : now - since > input.settings.availabilityConfirmDays * DAY;
    if (stale) {
      items.push({ ...base, id: `confirm:${cleaner.id}`, kind: "availability_unconfirmed", severity: "look", title: "Availability needs confirming", detail: since === undefined ? "Their weekly hours have never been confirmed with them." : `Last confirmed ${day(since, input.timezone)}, more than ${input.settings.availabilityConfirmDays} days ago.`, section: "availability", evidence: [], at: since });
    }
  }

  for (const { commitment, reason } of input.conflicts) {
    items.push({ ...base, id: `conflict:${commitment.assignmentId}`, kind: "conflict", severity: "urgent", title: "Upcoming job conflict", detail: `${commitment.label} ${reason}. The assignment stands until a person changes it in Dispatch.`, section: "availability", evidence: [{ label: commitment.label, jobId: commitment.jobId }], at: commitment.startsAt });
  }

  if (working && !cleaner.phone && !cleaner.email) {
    items.push({ ...base, id: `contact:${cleaner.id}`, kind: "no_contact", severity: "look", title: "No way to reach them", detail: "There is no phone number or email on file, so offers and reminders cannot be sent.", section: "overview", evidence: [] });
  }

  if (input.viewerIsOwner && cleaner.status === "ready" && !cleaner.hasPay) {
    items.push({ ...base, id: `pay:${cleaner.id}`, kind: "no_pay", severity: "look", title: "No pay arrangement", detail: "Dispatch cannot state their pay in an offer, so they are left out of offers.", section: "pay", evidence: [] });
  }

  if (input.skillClaims > 0) {
    items.push({ ...base, id: `skills:${cleaner.id}`, kind: "skill_claims", severity: "decide", title: `${plural(input.skillClaims, "skill")} to confirm`, detail: "They told us about skills a person has not confirmed. Dispatch reads only confirmed skills.", section: "skills", evidence: [] });
  }
  return items;
}

const SEVERITY_ORDER: Record<Severity, number> = { urgent: 0, decide: 1, look: 2 };

export function sortAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.at ?? Infinity) - (b.at ?? Infinity) || a.cleanerName.localeCompare(b.cleanerName));
}

/** The weekday short names the directory uses to summarise a weekly pattern, on the company's clock. */
export function weekSummary(windows: WeeklyWindow[]): string {
  if (windows.length === 0) return "No weekly hours yet";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days = [...new Set(windows.map((row) => row.weekday))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  // Runs of consecutive days read as ranges: "Mon–Fri", "Mon–Wed, Sat".
  const runs: number[][] = [];
  for (const dayIndex of days) {
    const last = runs[runs.length - 1];
    if (last && (last[last.length - 1] + 1) % 7 === dayIndex && dayIndex !== 0) last.push(dayIndex);
    else runs.push([dayIndex]);
  }
  return runs.map((run) => (run.length >= 3 ? `${names[run[0]]}–${names[run[run.length - 1]]}` : run.map((d) => names[d]).join(", "))).join(", ");
}

/** True when this instant's local day is `dayKey` (YYYY-MM-DD) on the company's clock. */
export function onDay(at: number, dayKey: string, timezone: string): boolean {
  return localParts(at, timezone).day === dayKey;
}
