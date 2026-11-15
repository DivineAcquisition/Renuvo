/**
 * Who can take a visit, and in what order to ask (brief, section 11). Pure functions over facts already
 * read from the record, so the same rules run in the workflow, in the offer check and in a test.
 *
 * Filter: ready for work, not already asked for this visit, has the skills, works in the area, said they
 * can work then, not on time off, and not holding a job that overlaps or sits closer than the company's
 * time between jobs. Rank: has cleaned for this customer before, then the lighter day, then by name.
 * No distance is invented: travel is only the time the company keeps between jobs.
 */
import { localParts, overlaps, withinWeeklyWindows, type Span, type WeeklyWindow } from "../availability";
import type { CleanerStatus } from "../statuses";
import type { PayAnswer } from "./pay";

export type JobFacts = {
  span: Span;
  requiredSkills: string[];
  /** The property's postal code, upper case. */
  postalCode: string;
  timezone: string;
  travelBufferMinutes: number;
};

/** Why this cleaner was already ruled out for this visit at this time. */
export type Ended = "declined" | "expired" | "released" | "skipped";

export type CleanerFacts = {
  id: string;
  name: string;
  status: CleanerStatus;
  skills: string[];
  serviceAreas: string[];
  windows: WeeklyWindow[];
  timeOff: Span[];
  /** Other jobs this cleaner has an offer on or has accepted. */
  held: Span[];
  endedForJob: Ended | null;
  /** Visits for this customer the cleaner accepted before. */
  priorVisitsForCustomer: number;
  pay: PayAnswer;
};

/** Which rules apply. Dispatch applies all of them. A person offering by hand may set some aside. */
export type Rules = { serviceArea: boolean; travelBuffer: boolean; ended: boolean; pay: boolean };
export const DISPATCH_RULES: Rules = { serviceArea: true, travelBuffer: true, ended: true, pay: true };

export type ExclusionCode =
  | "not_ready"
  | "already_asked"
  | "missing_skill"
  | "outside_area"
  | "outside_hours"
  | "time_off"
  | "already_booked"
  | "too_close"
  | "no_pay";

/** `reason` finishes the sentence "<Name> …" or "This cleaner …". */
export type Exclusion = { code: ExclusionCode; reason: string; ended?: Ended };

const ENDED_WORDS: Record<Ended, string> = {
  declined: "already declined this visit",
  expired: "did not answer an earlier offer for this visit",
  released: "was released from this visit",
  skipped: "was passed over for this visit by a person",
};

/** The first rule this cleaner fails for this job, or null when they can be asked. */
export function assess(cleaner: CleanerFacts, job: JobFacts, rules: Rules = DISPATCH_RULES): Exclusion | null {
  if (cleaner.status !== "ready") return { code: "not_ready", reason: "is not marked ready for work" };
  if (rules.ended && cleaner.endedForJob) return { code: "already_asked", reason: ENDED_WORDS[cleaner.endedForJob], ended: cleaner.endedForJob };
  const missing = job.requiredSkills.filter((skill) => !cleaner.skills.includes(skill));
  if (missing.length > 0) return { code: "missing_skill", reason: `does not have a skill the job needs: ${missing.join(", ")}` };
  if (rules.serviceArea && !cleaner.serviceAreas.includes(job.postalCode)) {
    return { code: "outside_area", reason: cleaner.serviceAreas.length === 0 ? "has no service area set" : `does not work in ${job.postalCode}` };
  }
  if (!withinWeeklyWindows(cleaner.windows, job.span, job.timezone)) return { code: "outside_hours", reason: "has not said they can work at that time" };
  if (cleaner.timeOff.some((off) => overlaps(off, job.span))) return { code: "time_off", reason: "has time off then" };
  if (cleaner.held.some((other) => overlaps(other, job.span))) return { code: "already_booked", reason: "already has an offer or a job that overlaps this one" };
  if (rules.travelBuffer && job.travelBufferMinutes > 0) {
    const buffer = job.travelBufferMinutes * 60000;
    const padded = { startsAt: job.span.startsAt - buffer, endsAt: job.span.endsAt + buffer };
    if (cleaner.held.some((other) => overlaps(other, padded))) {
      return { code: "too_close", reason: `has another job within ${job.travelBufferMinutes} minutes of this one` };
    }
  }
  if (rules.pay && !cleaner.pay.ok) return { code: "no_pay", reason: cleaner.pay.reason };
  return null;
}

export type Candidate = {
  cleanerId: string;
  name: string;
  /** Why this cleaner fits, each finishing the sentence "<Name> …". */
  reasons: string[];
  priorVisitsForCustomer: number;
  otherVisitsThatDay: number;
  pay: PayAnswer;
};
export type Excluded = { cleanerId: string; name: string } & Exclusion;

function otherVisitsThatDay(cleaner: CleanerFacts, job: JobFacts): number {
  const day = localParts(job.span.startsAt, job.timezone).day;
  return cleaner.held.filter((other) => localParts(other.startsAt, job.timezone).day === day).length;
}

const times = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function fitReasons(cleaner: CleanerFacts, job: JobFacts, sameDay: number): string[] {
  const reasons = ["is free then", `works in ${job.postalCode}`];
  if (job.requiredSkills.length > 0) reasons.push("has the skills this visit needs");
  if (cleaner.priorVisitsForCustomer > 0) reasons.push(`has taken ${times(cleaner.priorVisitsForCustomer, "visit", "visits")} for this customer before`);
  reasons.push(sameDay === 0 ? "has no other visits that day" : `has ${times(sameDay, "other visit", "other visits")} that day`);
  return reasons;
}

/** Everyone who can be asked, best first, and everyone who cannot with the reason. */
export function rankCleaners(cleaners: CleanerFacts[], job: JobFacts, rules: Rules = DISPATCH_RULES): { candidates: Candidate[]; excluded: Excluded[] } {
  const candidates: Candidate[] = [];
  const excluded: Excluded[] = [];
  for (const cleaner of cleaners) {
    const exclusion = assess(cleaner, job, rules);
    if (exclusion) {
      excluded.push({ cleanerId: cleaner.id, name: cleaner.name, ...exclusion });
      continue;
    }
    const sameDay = otherVisitsThatDay(cleaner, job);
    candidates.push({
      cleanerId: cleaner.id,
      name: cleaner.name,
      reasons: fitReasons(cleaner, job, sameDay),
      priorVisitsForCustomer: cleaner.priorVisitsForCustomer,
      otherVisitsThatDay: sameDay,
      pay: cleaner.pay,
    });
  }
  candidates.sort(
    (a, b) =>
      b.priorVisitsForCustomer - a.priorVisitsForCustomer ||
      a.otherVisitsThatDay - b.otherVisitsThatDay ||
      a.name.localeCompare(b.name) ||
      a.cleanerId.localeCompare(b.cleanerId),
  );
  excluded.sort((a, b) => a.name.localeCompare(b.name) || a.cleanerId.localeCompare(b.cleanerId));
  return { candidates, excluded };
}

/**
 * A staffing gap is when nobody has the capacity or the willingness. A cleaner ruled out only because
 * their pay is not set, or because a person passed them over, could still take the visit, so that is a
 * setup problem or a person's choice and Recruiter is not told there is a gap.
 */
export function isStaffingGap(excluded: Excluded[]): boolean {
  return !excluded.some((entry) => entry.code === "no_pay" || entry.ended === "skipped");
}
