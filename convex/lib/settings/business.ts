/**
 * The company's own rules for taking work: where it works, when appointments may be, and the services
 * it sells. Pure functions, so the same checks run when settings are saved, when a visit is made or
 * moved, and in tests.
 *
 * Empty hours and empty areas mean "no company-wide restriction", never "closed". Hours are appointment
 * operating windows. They are not a cleaner's availability and not communication quiet hours.
 */
import { v } from "convex/values";

import type { Doc } from "../../_generated/dataModel";
import { isTimezone, localParts, type Span, type WeeklyWindow } from "../availability";
import { userError } from "../errors";
import { tags, text } from "../text";

export const serviceStatusValidator = v.union(v.literal("active"), v.literal("archived"));

export const serviceValidator = v.object({
  /** Chosen once when the service is made and never changed, so a job's snapshot can name it. */
  id: v.string(),
  name: v.string(),
  scope: v.string(),
  durationMinutes: v.number(),
  defaultCrew: v.number(),
  skills: v.array(v.string()),
  /** An editable default for visits an office member creates. Not a quote, a tax or a charge. */
  startingPriceCents: v.optional(v.number()),
  status: serviceStatusValidator,
});

export const hoursWindowValidator = v.object({ weekday: v.number(), startMinute: v.number(), endMinute: v.number() });

export const businessSettingsValidator = v.object({
  /** Postal codes the company works in. Empty or absent means anywhere. */
  serviceAreas: v.optional(v.array(v.string())),
  /** Appointment operating windows. Empty or absent means any time. */
  hours: v.optional(v.array(hoursWindowValidator)),
  services: v.optional(v.array(serviceValidator)),
});

/** What a job keeps of the service it was made from. It never changes when the service does. */
export const serviceSnapshotValidator = v.object({
  serviceId: v.string(),
  name: v.string(),
  scope: v.string(),
  durationMinutes: v.number(),
  defaultCrew: v.number(),
  skills: v.array(v.string()),
  startingPriceCents: v.optional(v.number()),
  capturedAt: v.number(),
  /** Services & Pricing: the published version the visit was made from, and the saved quote that priced it. */
  versionId: v.optional(v.id("serviceVersions")),
  version: v.optional(v.number()),
  quoteId: v.optional(v.id("serviceQuotes")),
  /** Where the visit's price came from: the engine's quote, a person's typed price, or nothing. */
  priceSource: v.optional(v.union(v.literal("quote"), v.literal("manual"), v.literal("none"))),
});

export type Service = typeof serviceValidator.type;
export type BusinessSettings = { serviceAreas: string[]; hours: WeeklyWindow[]; services: Service[] };

export const LIMITS = {
  areas: 300,
  windows: 28,
  services: 100,
  duration: { min: 15, max: 24 * 60 },
  crew: { min: 1, max: 12 },
  priceCents: 100_000_00,
} as const;

/** A postal code on one spelling: upper case, no spaces or dashes beyond ZIP+4 collapsing to five digits. */
export function normalizePostalCode(value: string): string {
  const trimmed = value.trim().toUpperCase().replace(/\s+/g, " ");
  return /^\d{5}-\d{4}$/.test(trimmed) ? trimmed.slice(0, 5) : trimmed;
}

const POSTAL = /^[A-Z0-9][A-Z0-9 -]{1,9}[A-Z0-9]$/;

export function businessSettingsOf(company: Pick<Doc<"companies">, "businessSettings">): BusinessSettings {
  const own = company.businessSettings ?? {};
  return { serviceAreas: own.serviceAreas ?? [], hours: own.hours ?? [], services: own.services ?? [] };
}

export function revisionOf(company: Pick<Doc<"companies">, "settingsRevision">): number {
  return company.settingsRevision ?? 0;
}

const SERVICE_ID = /^[a-z0-9][a-z0-9-]{2,47}$/;

export function normalizeAreas(input: string[]): string[] {
  const out = [...new Set(input.map(normalizePostalCode).filter(Boolean))];
  if (out.length > LIMITS.areas) throw userError(`A company can list up to ${LIMITS.areas} postal codes.`);
  const bad = out.find((code) => !POSTAL.test(code));
  if (bad !== undefined) throw userError(`"${bad}" is not a postal code.`);
  return out.sort();
}

export function normalizeHours(input: WeeklyWindow[]): WeeklyWindow[] {
  if (input.length > LIMITS.windows) throw userError(`There can be up to ${LIMITS.windows} operating windows.`);
  for (const window of input) {
    if (!Number.isInteger(window.weekday) || window.weekday < 0 || window.weekday > 6) throw userError("Days are numbered 0 (Sunday) to 6 (Saturday).");
    if (!Number.isInteger(window.startMinute) || !Number.isInteger(window.endMinute) || window.startMinute < 0 || window.endMinute > 1440) throw userError("Operating hours must fall within one day.");
    if (window.startMinute >= window.endMinute) throw userError("Each operating window must end after it starts. Overnight appointments are not supported here.");
  }
  const sorted = input.map((window) => ({ weekday: window.weekday, startMinute: window.startMinute, endMinute: window.endMinute })).sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].weekday === sorted[i - 1].weekday && sorted[i].startMinute < sorted[i - 1].endMinute) throw userError("Two operating windows on the same day overlap.");
  }
  return sorted;
}

function normalizeService(input: Service): Service {
  const id = input.id.trim();
  if (!SERVICE_ID.test(id)) throw userError("A service needs a stable id of 3 to 48 lower-case letters, numbers or dashes.");
  const duration = input.durationMinutes;
  if (!Number.isInteger(duration) || duration < LIMITS.duration.min || duration > LIMITS.duration.max) throw userError(`A service's duration must be a whole number of minutes from ${LIMITS.duration.min} to ${LIMITS.duration.max}.`);
  const crew = input.defaultCrew;
  if (!Number.isInteger(crew) || crew < LIMITS.crew.min || crew > LIMITS.crew.max) throw userError(`A service's default crew must be a whole number from ${LIMITS.crew.min} to ${LIMITS.crew.max}.`);
  if (input.startingPriceCents !== undefined && (!Number.isSafeInteger(input.startingPriceCents) || input.startingPriceCents < 0 || input.startingPriceCents > LIMITS.priceCents)) {
    throw userError("A starting price must be a whole number of cents, zero or more, and no more than $100,000.");
  }
  return {
    id,
    name: text(input.name, "A service name", 80),
    scope: text(input.scope, "A service's scope", 2000),
    durationMinutes: duration,
    defaultCrew: crew,
    skills: tags(input.skills, "A service's skills", 20),
    ...(input.startingPriceCents !== undefined ? { startingPriceCents: input.startingPriceCents } : {}),
    status: input.status,
  };
}

/**
 * Checks and tidies the whole draft. Nothing is written until every part is valid. A saved service can
 * be archived but never dropped, because jobs name it.
 */
export function normalizeBusiness(input: { serviceAreas: string[]; hours: WeeklyWindow[]; services: Service[] }, current: BusinessSettings): BusinessSettings {
  if (input.services.length > LIMITS.services) throw userError(`A company can keep up to ${LIMITS.services} services.`);
  const services = input.services.map(normalizeService);
  const ids = new Set<string>();
  for (const service of services) {
    if (ids.has(service.id)) throw userError("Two services share an id.");
    ids.add(service.id);
  }
  const names = services.filter((service) => service.status === "active").map((service) => service.name.toLowerCase());
  if (new Set(names).size !== names.length) throw userError("Two active services have the same name.");
  for (const saved of current.services) {
    if (!ids.has(saved.id)) throw userError(`"${saved.name}" cannot be removed. Archive it instead, so earlier visits keep their record.`);
  }
  return { serviceAreas: normalizeAreas(input.serviceAreas), hours: normalizeHours(input.hours), services };
}

/** Hours on one spelling, whatever order a stored object's keys come back in. */
export function hoursKey(hours: WeeklyWindow[]): string {
  return JSON.stringify(hours.map((w) => [w.weekday, w.startMinute, w.endMinute]));
}

/** A service list on one spelling, so two lists that mean the same thing compare equal. */
export function servicesKey(services: Service[]): string {
  return JSON.stringify(services.map((s) => [s.id, s.name, s.scope, s.durationMinutes, s.defaultCrew, s.skills, s.startingPriceCents ?? null, s.status]));
}

export function validTimezone(value: string): string {
  const zone = value.trim();
  if (!isTimezone(zone)) throw userError("That is not a time zone. Enter the IANA name of your zone.");
  return zone;
}

/** Refuses a place the company has said it does not work. No areas listed means anywhere. */
export function checkArea(settings: BusinessSettings, postalCode: string): void {
  if (settings.serviceAreas.length === 0) return;
  if (!settings.serviceAreas.includes(normalizePostalCode(postalCode))) throw userError(`The company does not work in ${postalCode.trim() || "that postal code"}. Add it under Business & hours first.`);
}

/** Refuses an appointment that does not fit inside one operating window on the company's clock. */
export function checkHours(settings: BusinessSettings, span: Span, timezone: string): void {
  if (settings.hours.length === 0) return;
  const start = localParts(span.startsAt, timezone);
  const end = localParts(span.endsAt, timezone);
  const fits = start.day === end.day && settings.hours.some((w) => w.weekday === start.weekday && w.startMinute <= start.minute && end.minute <= w.endMinute);
  if (!fits) throw userError("That time is outside the company's operating hours. A visit must fit inside one window, and overnight visits are not supported.");
}

export function findService(settings: BusinessSettings, serviceId: string): Service | null {
  return settings.services.find((service) => service.id === serviceId) ?? null;
}
