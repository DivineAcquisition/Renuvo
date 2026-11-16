/**
 * The words of every text Dispatch sends a cleaner. Each has one purpose and at most one link, names
 * the company, and says only what the record supports. "{link}" is filled in at the moment of sending.
 * An offer gives the area, never the street address: that comes after acceptance.
 */
import type { Doc } from "../../_generated/dataModel";
import { clock, dayName } from "../time";
import { money } from "./pay";

type Company = Pick<Doc<"companies">, "name" | "timezone">;
type Job = Pick<Doc<"jobs">, "startsAt" | "endsAt" | "serviceType" | "arrivalWindowMinutes" | "requiredCrew">;

const MINUTE = 60_000;

/** "Tue, Mar 2, arrive 10:00 AM to 10:30 AM" or "Tue, Mar 2 at 10:00 AM". An arrival window is never shown as one time. */
export function arrivalWords(job: Pick<Doc<"jobs">, "startsAt" | "arrivalWindowMinutes">, timezone: string): string {
  const day = dayName(job.startsAt, timezone);
  const width = job.arrivalWindowMinutes ?? 0;
  if (width <= 0) return `${day} at ${clock(job.startsAt, timezone)}`;
  return `${day}, arrive ${clock(job.startsAt, timezone)} to ${clock(job.startsAt + width * MINUTE, timezone)}`;
}

export function durationWords(job: Pick<Doc<"jobs">, "startsAt" | "endsAt">): string {
  const hours = Math.round(((job.endsAt - job.startsAt) / (60 * MINUTE)) * 10) / 10;
  return `about ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

export function roleWords(role: Doc<"assignments">["role"], crew: number): string {
  if (crew <= 1) return "Solo job";
  return role === "lead" ? `Lead of ${crew}` : `Support, crew of ${crew}`;
}

/** City and postal code. The street is not part of an offer. */
export function areaWords(property: Pick<Doc<"properties">, "address"> | null): string {
  return property ? `${property.address.city} ${property.address.postalCode}` : "area not on file";
}

const deadline = (at: number, timezone: string) => `${clock(at, timezone)} ${dayName(at, timezone)}`;

export function offerSms(input: { company: Company; job: Job; property: Pick<Doc<"properties">, "address"> | null; assignment: Pick<Doc<"assignments">, "payCents" | "respondBy" | "role">; backup: boolean; moved?: boolean }): string {
  const { company, job, assignment } = input;
  const crew = Math.max(1, job.requiredCrew ?? 1);
  return [
    `${company.name}: ${input.moved ? "the job you accepted has moved. Please confirm the new time" : input.backup ? "cover needed" : "job offer"}.`,
    `${job.serviceType}, ${arrivalWords(job, company.timezone)}, ${durationWords(job)}.`,
    `${areaWords(input.property)}. ${roleWords(assignment.role, crew)}.`,
    `Est. pay ${money(assignment.payCents)}.`,
    `Answer by ${deadline(assignment.respondBy, company.timezone)}: {link}`,
  ].join(" ");
}

export function confirmedSms(input: { company: Company; job: Job }): string {
  return `${input.company.name}: you're confirmed for ${arrivalWords(input.job, input.company.timezone)}. Address, instructions, checklist and check-in are here: {link}`;
}

/** Says when the job is and where to check in. It never says the cleaner is on the way: nobody has confirmed that. */
export function reminderSms(input: { company: Company; job: Job }): string {
  return `${input.company.name} reminder: your job is ${arrivalWords(input.job, input.company.timezone)}. Open it to check in when you arrive, or to tell us if you're running late: {link}`;
}

export function beforePhotosSms(input: { company: Company; count: number }): string {
  const need = input.count > 0 ? ` (${input.count} needed)` : "";
  return `${input.company.name}: you're checked in. Please add your before photos${need} before you start: {link}`;
}

export function checkInNudgeSms(input: { company: Company; job: Job }): string {
  return `${input.company.name}: we don't have a check-in for your ${clock(input.job.startsAt, input.company.timezone)} job yet. Check in, send an ETA, or tell us you can't make it: {link}`;
}

export function withdrawnSms(input: { company: Company; job: Job }): string {
  return `${input.company.name}: the offer for ${arrivalWords(input.job, input.company.timezone)} is no longer open. Nothing for you to do.`;
}

export function endedSms(input: { company: Company; job: Job }): string {
  return `${input.company.name}: you are no longer assigned to the job on ${arrivalWords(input.job, input.company.timezone)}. Your link for it has been closed.`;
}
