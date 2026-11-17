/**
 * The one pricing engine. Pricing Studio, the builder's live preview, Company Chat and visit creation all
 * call these functions, so the same service and the same inputs give the same price everywhere. A model
 * never produces a price: it passes inputs here and explains what comes back.
 *
 * Pure and deterministic: no clock, no randomness, no database. Money is whole cents; every line is
 * rounded half away from zero when it is computed, and the total is the sum of the lines shown.
 *
 * The order of calculation (CALCULATION_ORDER) is fixed and shown to owners in the same words.
 */
import { addOnWord, areaWord, formatCents, formatMillicents, scheduleLabel } from "./words";
import type { AddOn, Adjustment, Modifiers, Pricing, Schedule, SizeBand, Spec } from "./spec";

export const ENGINE_VERSION = 1;

export const CALCULATION_ORDER = [
  "Base price from the pricing method",
  "Property condition, as a percent of the base price",
  "First-clean reset",
  "Extras the customer chose (anything the service already includes is never charged)",
  "Laundry loads (short-term rentals)",
  "Service area or travel",
  "Rush or after-hours work",
  "Demand, when switched on: the larger of a marked peak day and a busy day, never both, and never above the cap",
  "Recurring discount and promotion, on the cleaning amount only, combined as the service's stacking rule says",
  "Minimum charge",
  "Rounding",
] as const;

// ── Inputs and results ──────────────────────────────────────────────────────────────────────────────

export type QuoteInput = {
  /** Square feet or meters, in the service's unit. */
  area?: number;
  bedrooms?: number;
  bathrooms?: number;
  halfBaths?: number;
  /** For per-unit pricing: rooms, units, loads, windows, turnovers. */
  units?: number;
  /** For hourly per cleaner: the expected labor-minutes. Defaults to the service's estimate. */
  laborMinutes?: number;
  /** For hourly per crew: the expected minutes on the clock. Defaults to the service's estimate. */
  elapsedMinutes?: number;
  crewSize?: number;
  /** A condition level id. Defaults to the first level. */
  condition?: string;
  firstVisit?: boolean;
  /** Omitted: a one-time visit. */
  schedule?: Schedule;
  addOns?: { id: string; quantity: number }[];
  postalCode?: string;
  /** YYYY-MM-DD on the company's calendar, for demand and promotion dates. */
  date?: string;
  rush?: boolean;
  afterHours?: boolean;
  promotionId?: string;
  /** How full the day already is, 0 to 100, from the schedule. Supplied by Selestial, never by a customer. */
  dayFullnessPercent?: number;
  /** Short-term rentals: beds to make. */
  beds?: number;
  answers?: Record<string, string | number | boolean>;
  /** Pricing Studio: "what if it takes longer". 100 is as expected. */
  timePercent?: number;
};

export type LineKind = "base" | "adjustment" | "add_on" | "fee" | "discount" | "minimum" | "rounding" | "info" | "billed_later";

export type Line = {
  key: string;
  kind: LineKind;
  label: string;
  /** Why, in words an owner reads. */
  detail: string;
  /** Zero for info lines. Negative for discounts. Billed-later lines are not part of the total. */
  amountCents: number;
};

export type Outcome = "firm" | "estimate" | "walkthrough" | "incomplete";

export type Warning = { code: WarningCode; severity: "critical" | "warning" | "info"; message: string };
export type WarningCode =
  | "missing_info"
  | "walkthrough"
  | "time_staffing"
  | "turnover_window"
  | "discount_stacking"
  | "discount_capped"
  | "below_floor"
  | "low_margin"
  | "negative_margin"
  | "no_overhead"
  | "illustrative"
  | "band_overlap"
  | "band_gap"
  | "band_drop"
  | "band_jump"
  | "zero_price"
  | "area_refused"
  | "laundry_capacity";

export type Quote = {
  engineVersion: number;
  outcome: Outcome;
  /** Why the price is not firm. */
  reasons: string[];
  /** Null when there is no price to give (incomplete, or walkthrough with no starting price). */
  totalCents: number | null;
  /** "visit", "turnover", "job" or "month" (recurring packages are charged per calendar month). */
  per: string;
  /** How many visits the total covers: 1, or for a monthly package its annual-average visits per month. */
  visits: number;
  lines: Line[];
  /** The cleaning amount discounts apply to. */
  cleaningCents: number;
  includedScope: string[];
  extras: { id: string; label: string; quantity: number; amountCents: number; included: boolean }[];
  time: { laborMinutes: number; crewSize: number; elapsedMinutes: number };
  schedule: ScheduleFacts | null;
  /** Short-term rentals: the laundry and restocking this turnover needs. */
  str: { loads: number; linenSets: number; windowMinutes: number; restock: { label: string; quantity: number; rule: string }[] } | null;
  warnings: Warning[];
  missing: string[];
};

export type ScheduleFacts = {
  schedule: Schedule;
  label: string;
  /** Exact for calendar-month schedules; an average over 365.25 days for every-N-days schedules. */
  visitsPerYear: number;
  /** visitsPerYear ÷ 12, always labeled as an annual average. */
  monthlyAverage: number;
  /** For every-N-days schedules: some months have more visits than others. */
  visitsPerMonthRange: [number, number];
};

// ── Small arithmetic, in one place ──────────────────────────────────────────────────────────────────

/** Half away from zero, to whole cents. Tiny float noise below a millionth of a cent is removed first. */
export function roundCents(value: number): number {
  const cleaned = Math.round(value * 1e6) / 1e6;
  return cleaned < 0 ? -Math.floor(-cleaned + 0.5) : Math.floor(cleaned + 0.5);
}

export function percentOf(cents: number, percent: number): number {
  return roundCents((cents * percent) / 100);
}

function adjust(cents: number, adjustment: Adjustment): number {
  return adjustment.kind === "percent" ? percentOf(cents, adjustment.value) : roundCents(adjustment.value);
}

function adjustmentWords(adjustment: Adjustment): string {
  return adjustment.kind === "percent" ? `${trimNumber(adjustment.value)}%` : formatCents(adjustment.value);
}

export function trimNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

const hoursWords = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
};

// ── Recurring schedules ─────────────────────────────────────────────────────────────────────────────

const DAYS_PER_YEAR = 365.25;

export function scheduleFacts(schedule: Schedule): ScheduleFacts {
  switch (schedule) {
    case "every_7_days":
      return { schedule, label: scheduleLabel(schedule), visitsPerYear: DAYS_PER_YEAR / 7, monthlyAverage: DAYS_PER_YEAR / 7 / 12, visitsPerMonthRange: [4, 5] };
    case "every_14_days":
      return { schedule, label: scheduleLabel(schedule), visitsPerYear: DAYS_PER_YEAR / 14, monthlyAverage: DAYS_PER_YEAR / 14 / 12, visitsPerMonthRange: [2, 3] };
    case "twice_per_month":
      return { schedule, label: scheduleLabel(schedule), visitsPerYear: 24, monthlyAverage: 2, visitsPerMonthRange: [2, 2] };
    case "once_per_month":
      return { schedule, label: scheduleLabel(schedule), visitsPerYear: 12, monthlyAverage: 1, visitsPerMonthRange: [1, 1] };
  }
}

/** Parses YYYY-MM-DD as a UTC calendar day number, or null. */
export function dayNumber(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return Math.round(ms / 86_400_000);
}

export function dayString(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * The actual visit dates of a schedule from `start` for `months` calendar months (the month of `start`
 * included). Calendar-month schedules use `daysOfMonth` (default: the start's day, and for twice a month
 * also 14 days later), clamped to the month's last day.
 */
export function scheduleDates(schedule: Schedule, start: string, months: number, daysOfMonth?: number[]): string[] {
  const first = dayNumber(start);
  if (first === null || months < 1 || months > 36) return [];
  const startDate = new Date(first * 86_400_000);
  const endExclusive = Math.round(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + months, 1) / 86_400_000);
  const out: string[] = [];
  if (schedule === "every_7_days" || schedule === "every_14_days") {
    const step = schedule === "every_7_days" ? 7 : 14;
    for (let day = first; day < endExclusive; day += step) out.push(dayString(day));
    return out;
  }
  const startDay = startDate.getUTCDate();
  const days = (daysOfMonth?.length ? daysOfMonth : schedule === "twice_per_month" ? [startDay, ((startDay + 13) % 28) + 1] : [startDay]).slice(0, schedule === "twice_per_month" ? 2 : 1);
  for (let i = 0; i < months; i += 1) {
    const year = startDate.getUTCFullYear() + Math.floor((startDate.getUTCMonth() + i) / 12);
    const month0 = (startDate.getUTCMonth() + i) % 12;
    const last = daysInMonth(year, month0);
    const picked = [...new Set(days.map((d) => Math.min(Math.max(1, Math.round(d)), last)))].sort((a, b) => a - b);
    for (const d of picked) {
      const day = Math.round(Date.UTC(year, month0, d) / 86_400_000);
      if (day >= first) out.push(dayString(day));
    }
  }
  return out;
}

/** Visits per calendar month for the dates of a schedule, in month order. */
export function visitsByMonth(dates: string[]): { month: string; visits: number }[] {
  const counts = new Map<string, number>();
  for (const date of dates) counts.set(date.slice(0, 7), (counts.get(date.slice(0, 7)) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, visits]) => ({ month, visits }));
}

// ── Base price and time per method ──────────────────────────────────────────────────────────────────

type Base = { cents: number | null; laborMinutes: number; crewSize?: number; label: string; detail: string; per?: string; missing: string[]; walkthrough: string[]; estimate: string[]; hourly: boolean };

function findBand(bands: SizeBand[], area: number): SizeBand | null {
  return bands.find((band) => area >= band.from && (band.to === null || area < band.to)) ?? null;
}

function base(spec: Spec, input: QuoteInput): Base {
  const p = spec.pricing;
  const word = spec.visitWord;
  const none = { missing: [] as string[], walkthrough: [] as string[], estimate: [] as string[], hourly: false };
  switch (p.method) {
    case "fixed":
      return { ...none, cents: p.amountCents, laborMinutes: p.laborMinutes, label: "Base price", detail: `${formatCents(p.amountCents)} per ${word}` };
    case "hourly_per_cleaner": {
      const crew = input.crewSize ?? spec.team.crewSize;
      const labor = input.laborMinutes ?? p.estimatedLaborMinutes;
      return {
        ...none,
        hourly: true,
        estimate: input.laborMinutes === undefined ? [`Billed on the cleaners' actual hours; this uses the usual ${hoursWords(p.estimatedLaborMinutes)} of cleaner time.`] : ["Billed on the cleaners' actual hours."],
        cents: null,
        laborMinutes: labor,
        crewSize: crew,
        label: "Cleaner hours",
        detail: `${formatCents(p.rateCents)} per cleaner per hour`,
      };
    }
    case "hourly_per_crew": {
      const elapsed = input.elapsedMinutes ?? p.estimatedElapsedMinutes;
      return {
        ...none,
        hourly: true,
        estimate: input.elapsedMinutes === undefined ? [`Billed on the actual time on site; this uses the usual ${hoursWords(p.estimatedElapsedMinutes)}.`] : ["Billed on the actual time on site."],
        cents: null,
        laborMinutes: elapsed * p.crewSize,
        crewSize: p.crewSize,
        label: "Crew hours",
        detail: `${formatCents(p.rateCents)} per hour for the crew of ${p.crewSize}`,
      };
    }
    case "size_bands": {
      if (input.area === undefined) return { ...none, missing: [`Property size (${areaWord(p.unit)})`], cents: null, laborMinutes: 0, label: "Base price", detail: "" };
      const band = findBand(p.bands, input.area);
      if (!band) {
        const top = p.bands.reduce((max, b) => Math.max(max, b.to ?? Infinity), 0);
        const reason = input.area >= top ? `${trimNumber(input.area)} ${areaWord(p.unit)} is above the largest size band.` : `${trimNumber(input.area)} ${areaWord(p.unit)} falls in no size band.`;
        return { ...none, walkthrough: [reason], cents: null, laborMinutes: 0, label: "Base price", detail: "" };
      }
      return { ...none, cents: band.amountCents, laborMinutes: band.laborMinutes, label: "Base price", detail: `${trimNumber(band.from)}–${band.to === null ? "and up" : trimNumber(band.to - (p.unit === "sq_ft" ? 1 : 0))} ${areaWord(p.unit)}: ${formatCents(band.amountCents)} per ${word}` };
    }
    case "per_area": {
      if (input.area === undefined) return { ...none, missing: [`Area (${areaWord(p.unit)})`], cents: null, laborMinutes: 0, label: "Base price", detail: "" };
      if (p.walkthroughAbove !== null && input.area >= p.walkthroughAbove) return { ...none, walkthrough: [`${trimNumber(input.area)} ${areaWord(p.unit)} is at or above ${trimNumber(p.walkthroughAbove)}, which needs a walkthrough.`], cents: null, laborMinutes: 0, label: "Base price", detail: "" };
      return {
        ...none,
        cents: roundCents((input.area * p.rateMillicents) / 1000),
        laborMinutes: (input.area / 1000) * p.laborMinutesPer1000,
        label: "Base price",
        detail: `${trimNumber(input.area)} ${areaWord(p.unit)} × ${formatMillicents(p.rateMillicents)} per ${areaWord(p.unit, 1)}`,
      };
    }
    case "bed_bath": {
      const missing = [...(input.bedrooms === undefined ? ["Bedrooms"] : []), ...(input.bathrooms === undefined ? ["Bathrooms"] : [])];
      if (missing.length) return { ...none, missing, cents: null, laborMinutes: 0, label: "Base price", detail: "" };
      const beds = Math.max(0, input.bedrooms! - p.includedBedrooms);
      const baths = Math.max(0, input.bathrooms! - p.includedBathrooms);
      const halves = input.halfBaths ?? 0;
      const cents = p.baseCents + beds * p.perBedroomCents + baths * p.perBathroomCents + halves * p.perHalfBathCents;
      const parts = [`${formatCents(p.baseCents)} with ${p.includedBedrooms} bed and ${p.includedBathrooms} bath`];
      if (beds) parts.push(`${beds} more bedroom${beds === 1 ? "" : "s"} × ${formatCents(p.perBedroomCents)}`);
      if (baths) parts.push(`${baths} more bathroom${baths === 1 ? "" : "s"} × ${formatCents(p.perBathroomCents)}`);
      if (halves) parts.push(`${halves} half bath${halves === 1 ? "" : "s"} × ${formatCents(p.perHalfBathCents)}`);
      return {
        ...none,
        cents,
        laborMinutes: p.baseLaborMinutes + beds * p.perBedroomMinutes + baths * p.perBathroomMinutes + halves * p.perHalfBathMinutes,
        label: "Base price",
        detail: parts.join(" + "),
      };
    }
    case "per_unit": {
      if (input.units === undefined) return { ...none, missing: [`Number of ${p.unitWord}s`], cents: null, laborMinutes: 0, label: "Base price", detail: "" };
      const units = Math.max(input.units, p.minimumUnits);
      const cents = p.baseCents + units * p.unitCents;
      const detail = `${p.baseCents ? `${formatCents(p.baseCents)} + ` : ""}${units} ${p.unitWord}${units === 1 ? "" : "s"} × ${formatCents(p.unitCents)}${input.units < p.minimumUnits ? ` (minimum ${p.minimumUnits})` : ""}`;
      return { ...none, cents, laborMinutes: p.baseLaborMinutes + units * p.laborMinutesPerUnit, label: "Base price", detail };
    }
    case "recurring_package": {
      const facts = scheduleFacts(p.schedule);
      const detail = p.basis === "included" ? `${formatCents(p.monthlyCents)} per calendar month for ${p.includedVisits} visits` : `${formatCents(p.monthlyCents)} per calendar month for visits ${facts.label.toLowerCase()} (${facts.visitsPerMonthRange[0] === facts.visitsPerMonthRange[1] ? facts.visitsPerMonthRange[0] : facts.visitsPerMonthRange.join(" or ")} a month)`;
      return { ...none, cents: p.monthlyCents, laborMinutes: p.laborMinutesPerVisit, label: "Monthly package", detail, per: "month" };
    }
    case "custom_quote":
      return { ...none, walkthrough: ["This service is priced after a walkthrough."], cents: null, laborMinutes: p.laborMinutes ?? 0, label: "Base price", detail: "" };
  }
}

/** Hourly methods: billed time rounded up to the increment, never below the minimum. */
function hourlyPrice(p: Extract<Pricing, { method: "hourly_per_cleaner" | "hourly_per_crew" }>, laborMinutes: number, crew: number): { cents: number; detail: string } {
  const step = Math.max(1, p.incrementMinutes);
  if (p.method === "hourly_per_cleaner") {
    const billed = Math.max(Math.ceil(laborMinutes / step - 1e-9) * step, p.minimumHours * 60);
    return { cents: roundCents((billed / 60) * p.rateCents), detail: `${trimNumber(billed / 60)} cleaner-hours (${crew} cleaner${crew === 1 ? "" : "s"}) × ${formatCents(p.rateCents)} per cleaner per hour` };
  }
  const elapsed = laborMinutes / p.crewSize;
  const billed = Math.max(Math.ceil(elapsed / step - 1e-9) * step, p.minimumHours * 60);
  return { cents: roundCents((billed / 60) * p.rateCents), detail: `${trimNumber(billed / 60)} hours on site × ${formatCents(p.rateCents)} per hour for the crew of ${p.crewSize}` };
}

// ── The quote ───────────────────────────────────────────────────────────────────────────────────────

function chargeable(spec: Spec, addOn: AddOn): boolean {
  return !addOn.coversItemId || !spec.included.some((item) => item.id === addOn.coversItemId);
}

function weekdayOf(date: string): number | null {
  const day = dayNumber(date);
  return day === null ? null : (((day + 4) % 7) + 7) % 7;
}

function inDates(date: string, from: string | null, to: string | null): boolean {
  const day = dayNumber(date);
  if (day === null) return false;
  const a = from ? dayNumber(from) : null;
  const b = to ? dayNumber(to) : null;
  return (a === null || day >= a) && (b === null || day <= b);
}

/** Demand percent for a date: the larger of a matching peak day and the busy-day rule, capped. 0 when off. */
export function demandPercent(modifiers: Modifiers, date: string | undefined, fullness: number | undefined): { percent: number; why: string | null } {
  const d = modifiers.demand;
  if (!d.enabled || !date) return { percent: 0, why: null };
  if (d.endsOn && !inDates(date, null, d.endsOn)) return { percent: 0, why: null };
  const weekday = weekdayOf(date);
  let best = 0;
  let why: string | null = null;
  for (const peak of d.peakDays) {
    const dayMatch = peak.weekdays.length === 0 || (weekday !== null && peak.weekdays.includes(weekday));
    if (dayMatch && inDates(date, peak.from, peak.to) && peak.percent > best) {
      best = peak.percent;
      why = `${peak.label} (a day you marked)`;
    }
  }
  if (d.busyDay.enabled && fullness !== undefined && fullness >= d.busyDay.thresholdPercent && d.busyDay.percent > best) {
    best = d.busyDay.percent;
    why = `the schedule is ${Math.round(fullness)}% full that day (your threshold is ${trimNumber(d.busyDay.thresholdPercent)}%)`;
  }
  const capped = Math.min(best, d.capPercent);
  if (capped < best && why) why = `${why}; held to your ${trimNumber(d.capPercent)}% cap`;
  return { percent: capped, why };
}

export function quote(spec: Spec, input: QuoteInput): Quote {
  const lines: Line[] = [];
  const warnings: Warning[] = [];
  const m = spec.modifiers;
  const b = base(spec, input);
  const missing = [...b.missing];
  const walkthrough = [...b.walkthrough];
  const estimate = [...b.estimate];
  const per = b.per ?? spec.visitWord;
  const isPackage = spec.pricing.method === "recurring_package";

  // Required quoting questions, and answers that mean a walkthrough.
  for (const question of spec.questions) {
    const answer = input.answers?.[question.id];
    if (answer === undefined || answer === "") {
      if (question.required) missing.push(question.label);
      continue;
    }
    const rule = question.walkthroughIf;
    if (rule && ((rule.equals !== undefined && String(answer).toLowerCase() === rule.equals.toLowerCase()) || (rule.atLeast !== undefined && Number(answer) >= rule.atLeast))) walkthrough.push(`"${question.label}" was answered "${String(answer)}".`);
  }

  // Condition.
  const levels = m.condition.enabled ? m.condition.levels : [];
  const level = levels.length ? (levels.find((l) => l.id === input.condition) ?? (input.condition === undefined ? levels[0] : null)) : null;
  if (m.condition.enabled && input.condition !== undefined && !level) missing.push("A known property condition");
  if (level?.requiresWalkthrough) walkthrough.push(`The condition "${level.label}" needs a walkthrough.`);
  if (m.condition.enabled && input.condition === undefined && levels.length) estimate.push(`Condition was not given, so "${levels[0].label}" is assumed.`);

  // Time. The core is the service's own work; extras and laundry are added after. An hourly service
  // bills the core time (and unpriced laundry), never the time of an extra that has its own price.
  const crew = Math.max(1, Math.round(b.crewSize ?? input.crewSize ?? spec.team.crewSize));
  const timePercent = input.timePercent ?? 100;
  let coreMinutes = b.laborMinutes;
  if (level) coreMinutes *= 1 + level.timePercent / 100;
  const firstApplies = m.firstClean.enabled && input.firstVisit === true && !isPackage;
  if (firstApplies) coreMinutes *= 1 + m.firstClean.timePercent / 100;
  coreMinutes = (coreMinutes * timePercent) / 100;
  if (timePercent !== 100) estimate.push(`Time is set to ${trimNumber(timePercent)}% of the usual.`);
  let laborMinutes = coreMinutes;
  let billableMinutes = coreMinutes;

  // Area zone (decided early: a refused area stops the quote).
  let zoneLine: { label: string; adjustment: Adjustment } | null = null;
  if (m.area.enabled && !isPackage) {
    if (!input.postalCode) estimate.push("No postal code was given, so no area adjustment is included.");
    else {
      const code = input.postalCode.trim().toUpperCase();
      const zone = m.area.zones.find((z) => z.postalCodes.some((pc) => pc.trim().toUpperCase() === code));
      if (zone) zoneLine = { label: zone.label, adjustment: zone.adjustment };
      else if (m.area.outside === "refuse") {
        warnings.push({ code: "area_refused", severity: "critical", message: `${input.postalCode} is outside every area this service lists.` });
        walkthrough.push(`${input.postalCode} is outside this service's areas.`);
      }
    }
  }

  // Extras.
  const extras: Quote["extras"] = [];
  let extrasLabor = 0;
  for (const chosen of input.addOns ?? []) {
    const addOn = spec.addOns.find((a) => a.id === chosen.id);
    if (!addOn) {
      missing.push(`A known extra (${chosen.id})`);
      continue;
    }
    const quantity = Math.min(Math.max(0, Math.round(chosen.quantity)), addOn.maxQuantity);
    if (quantity === 0) continue;
    const included = !chargeable(spec, addOn);
    const amountCents = included ? 0 : quantity * addOn.priceCents;
    extras.push({ id: addOn.id, label: addOn.label, quantity, amountCents, included });
    if (!included) extrasLabor += quantity * addOn.laborMinutes;
  }
  laborMinutes += (extrasLabor * timePercent) / 100;

  // Short-term rental laundry and restocking.
  let strFacts: Quote["str"] = null;
  let laundryCents = 0;
  if (spec.str?.enabled) {
    const str = spec.str;
    if (input.beds === undefined) missing.push("Beds to make");
    const sets = Math.max(0, (input.beds ?? 0) * str.linenSetsPerBed);
    const loads = str.laundry.location === "none" || str.setsPerLoad <= 0 ? 0 : Math.ceil(sets / str.setsPerLoad - 1e-9);
    const laundryMinutes = (loads * str.laundry.loadMinutes * timePercent) / 100;
    laborMinutes += laundryMinutes;
    laundryCents = loads * str.laundry.loadCents;
    if (laundryCents === 0) billableMinutes += laundryMinutes;
    const window = minutesBetween(str.checkoutTime, str.checkinTime);
    if (str.laundry.location === "on_site" && loads > str.laundry.maxLoads) warnings.push({ code: "laundry_capacity", severity: "warning", message: `${loads} loads are needed but the site's machines can finish ${str.laundry.maxLoads} in one turnover. Plan off-site laundry or a linen swap.` });
    strFacts = { loads, linenSets: sets, windowMinutes: window, restock: str.restock.map((item) => ({ label: item.label, quantity: item.perTurnover, rule: item.rule })) };
  }

  const elapsedMinutes = Math.ceil(laborMinutes / crew - 1e-9);
  const time = { laborMinutes: Math.round(laborMinutes), crewSize: crew, elapsedMinutes };

  if (elapsedMinutes > spec.team.maxVisitMinutes) {
    const need = Math.ceil(laborMinutes / spec.team.maxVisitMinutes - 1e-9);
    warnings.push({
      code: "time_staffing",
      severity: "warning",
      message: `About ${hoursWords(elapsedMinutes)} on site with ${crew} cleaner${crew === 1 ? "" : "s"}, longer than your ${hoursWords(spec.team.maxVisitMinutes)} limit. ${need <= spec.team.maxCrew ? `A crew of ${need} would fit.` : "Split it into two visits or allow more cleaners."}`,
    });
  }
  if (strFacts && strFacts.windowMinutes > 0 && elapsedMinutes > strFacts.windowMinutes) {
    warnings.push({ code: "turnover_window", severity: "critical", message: `About ${hoursWords(elapsedMinutes)} on site, but checkout ${spec.str!.checkoutTime} to check-in ${spec.str!.checkinTime} leaves ${hoursWords(strFacts.windowMinutes)}. Add a cleaner.` });
  }

  const includedScope = spec.included.map((item) => item.label);
  const schedule = input.schedule ? scheduleFacts(input.schedule) : isPackage && spec.pricing.method === "recurring_package" && spec.pricing.basis === "schedule" ? scheduleFacts(spec.pricing.schedule) : null;

  const p = spec.pricing;
  const visits = p.method === "recurring_package" ? (p.basis === "schedule" ? scheduleFacts(p.schedule).monthlyAverage : Math.max(1, p.includedVisits)) : 1;

  const finish = (outcome: Outcome, totalCents: number | null, cleaningCents: number, reasons: string[]): Quote => {
    for (const reason of walkthrough) if (outcome === "walkthrough") warnings.push({ code: "walkthrough", severity: "warning", message: reason });
    if (missing.length) warnings.push({ code: "missing_info", severity: "critical", message: `A firm price needs: ${missing.join(", ")}.` });
    if (spec.illustrative) warnings.push({ code: "illustrative", severity: "warning", message: "Some amounts are illustrative (from a template or import) and have not been confirmed for your market." });
    return { engineVersion: ENGINE_VERSION, outcome, reasons, totalCents, per, visits, lines, cleaningCents, includedScope, extras, time, schedule, str: strFacts, warnings, missing };
  };

  if (missing.length) return finish("incomplete", null, 0, missing.map((what) => `Missing: ${what}`));
  if (walkthrough.length) {
    const from = spec.pricing.method === "custom_quote" ? spec.pricing.fromCents : null;
    if (from !== null) lines.push({ key: "from", kind: "info", label: "Starting price", detail: "An advertised starting price. The firm price is set after the walkthrough.", amountCents: 0 });
    return finish("walkthrough", from, 0, walkthrough);
  }

  // 1. Base.
  let baseCents: number;
  if (b.hourly) {
    const priced = hourlyPrice(spec.pricing as Extract<Pricing, { method: "hourly_per_cleaner" | "hourly_per_crew" }>, billableMinutes, crew);
    baseCents = priced.cents;
    lines.push({ key: "base", kind: "base", label: b.label, detail: priced.detail, amountCents: baseCents });
  } else {
    baseCents = b.cents ?? 0;
    lines.push({ key: "base", kind: "base", label: b.label, detail: b.detail, amountCents: baseCents });
  }

  // Recurring packages: the monthly price, extras per visit shown separately, promotions only.
  if (isPackage && spec.pricing.method === "recurring_package") {
    const p = spec.pricing;
    const facts = p.basis === "schedule" ? scheduleFacts(p.schedule) : null;
    const perVisit = facts ? roundCents((p.monthlyCents * 12) / facts.visitsPerYear) : p.includedVisits > 0 ? roundCents(p.monthlyCents / p.includedVisits) : 0;
    lines.push({ key: "per_visit", kind: "info", label: "Per visit, annual average", detail: facts ? `${formatCents(p.monthlyCents)} × 12 months ÷ ${trimNumber(facts.visitsPerYear)} visits a year` : `${formatCents(p.monthlyCents)} ÷ ${p.includedVisits} included visits`, amountCents: 0 });
    if (perVisit) lines[lines.length - 1].detail += ` = ${formatCents(perVisit)}`;
    if (p.extraVisitCents !== null) lines.push({ key: "extra_visit", kind: "info", label: "Extra visit", detail: `${formatCents(p.extraVisitCents)} for each visit beyond the plan`, amountCents: 0 });
    for (const extra of extras) lines.push({ key: `addon:${extra.id}`, kind: "info", label: extra.label, detail: extra.included ? "Included in the plan" : `${formatCents(extra.amountCents)} per visit when requested, billed with the visit`, amountCents: 0 });
    let total = baseCents;
    const promo = applicablePromotion(m, input);
    if (promo.promotion) {
      const off = Math.min(adjust(total, promo.promotion.discount), total);
      lines.push({ key: "promotion", kind: "discount", label: promo.promotion.label, detail: `${adjustmentWords(promo.promotion.discount)} off the monthly price`, amountCents: -off });
      total -= off;
    } else if (promo.note) lines.push({ key: "promotion", kind: "info", label: "Promotion not applied", detail: promo.note, amountCents: 0 });
    total = applyRounding(m, total, lines);
    if (total === 0) warnings.push({ code: "zero_price", severity: "warning", message: "The monthly price is $0." });
    return finish(estimate.length ? "estimate" : "firm", total, baseCents, estimate);
  }

  // 2. Condition.
  let serviceCents = baseCents;
  if (level && level.id !== levels[0]?.id) {
    if (b.hourly) lines.push({ key: "condition", kind: "info", label: `Condition: ${level.label}`, detail: `Hourly service: the time is ${trimNumber(level.timePercent)}% longer, and the price follows the time.`, amountCents: 0 });
    else if (level.pricePercent) {
      const amount = percentOf(baseCents, level.pricePercent);
      lines.push({ key: "condition", kind: "adjustment", label: `Condition: ${level.label}`, detail: `${trimNumber(level.pricePercent)}% of the base price`, amountCents: amount });
      serviceCents += amount;
    }
  }

  // 3. First clean.
  if (firstApplies) {
    if (b.hourly) lines.push({ key: "first_clean", kind: "info", label: "First-clean reset", detail: `Hourly service: the first visit takes ${trimNumber(m.firstClean.timePercent)}% longer, and the price follows the time.`, amountCents: 0 });
    else {
      const amount = adjust(serviceCents, m.firstClean.price);
      if (amount) {
        lines.push({ key: "first_clean", kind: "adjustment", label: "First-clean reset", detail: m.firstClean.price.kind === "percent" ? `${adjustmentWords(m.firstClean.price)} of ${formatCents(serviceCents)}, first visit only` : "First visit only", amountCents: amount });
        serviceCents += amount;
      }
    }
  }

  // 4. Extras.
  for (const extra of extras) {
    const addOn = spec.addOns.find((a) => a.id === extra.id)!;
    lines.push({
      key: `addon:${extra.id}`,
      kind: extra.included ? "info" : "add_on",
      label: extra.label,
      detail: extra.included ? "Already included in this service, so not charged" : `${extra.quantity} × ${formatCents(addOn.priceCents)} ${addOnWord(addOn)}`,
      amountCents: extra.amountCents,
    });
    serviceCents += extra.amountCents;
  }

  // 5. Laundry.
  if (strFacts && strFacts.loads > 0) {
    lines.push({ key: "laundry", kind: laundryCents ? "add_on" : "info", label: "Laundry", detail: laundryCents ? `${strFacts.loads} load${strFacts.loads === 1 ? "" : "s"} × ${formatCents(spec.str!.laundry.loadCents)}` : `${strFacts.loads} load${strFacts.loads === 1 ? "" : "s"}, included`, amountCents: laundryCents });
    serviceCents += laundryCents;
  }
  const cleaningCents = serviceCents;

  // 6. Area. 7. Rush and after-hours. 8. Demand. All on the cleaning amount.
  let fees = 0;
  if (zoneLine) {
    const amount = adjust(cleaningCents, zoneLine.adjustment);
    if (amount) {
      lines.push({ key: "area", kind: "fee", label: `Area: ${zoneLine.label}`, detail: zoneLine.adjustment.kind === "percent" ? `${adjustmentWords(zoneLine.adjustment)} of ${formatCents(cleaningCents)}` : "Travel to this area", amountCents: amount });
      fees += amount;
    }
  }
  if (input.rush && m.rush.enabled) {
    const amount = adjust(cleaningCents, m.rush.adjustment);
    lines.push({ key: "rush", kind: "fee", label: "Rush", detail: m.rush.adjustment.kind === "percent" ? `${adjustmentWords(m.rush.adjustment)} of ${formatCents(cleaningCents)}` : "Short notice", amountCents: amount });
    fees += amount;
  }
  if (input.afterHours && m.afterHours.enabled) {
    const amount = adjust(cleaningCents, m.afterHours.adjustment);
    lines.push({ key: "after_hours", kind: "fee", label: "After hours", detail: m.afterHours.adjustment.kind === "percent" ? `${adjustmentWords(m.afterHours.adjustment)} of ${formatCents(cleaningCents)}` : "Outside regular hours", amountCents: amount });
    fees += amount;
  }
  const demand = demandPercent(m, input.date, input.dayFullnessPercent);
  if (demand.percent > 0) {
    const amount = percentOf(cleaningCents, demand.percent);
    lines.push({ key: "demand", kind: "fee", label: "Demand", detail: `${trimNumber(demand.percent)}% because ${demand.why}`, amountCents: amount });
    fees += amount;
  } else if (m.demand.enabled && !input.date) estimate.push("No date was given, so demand pricing could not be checked.");

  // 9. Discounts, on the cleaning amount only.
  const recurringOption = input.schedule && m.recurring.enabled ? m.recurring.options.find((o) => o.schedule === input.schedule) : undefined;
  const recurringOff = recurringOption ? Math.min(adjust(cleaningCents, recurringOption.discount), cleaningCents) : 0;
  const promo = applicablePromotion(m, input);
  if (promo.note) lines.push({ key: "promotion_note", kind: "info", label: "Promotion not applied", detail: promo.note, amountCents: 0 });
  let discounts: { key: string; label: string; detail: string; cents: number }[] = [];
  const recurringLine = recurringOption && recurringOff ? { key: "recurring", label: `Recurring: ${scheduleLabel(recurringOption.schedule).toLowerCase()}`, detail: `${adjustmentWords(recurringOption.discount)} off the cleaning amount, each visit`, cents: recurringOff } : null;
  if (promo.promotion) {
    if (m.discounts.stacking === "stack") {
      const remaining = cleaningCents - recurringOff;
      const promoOff = Math.min(adjust(remaining, promo.promotion.discount), remaining);
      discounts = [...(recurringLine ? [recurringLine] : []), { key: "promotion", label: promo.promotion.label, detail: `${adjustmentWords(promo.promotion.discount)} off${recurringLine ? " what remains after the recurring discount" : " the cleaning amount"}`, cents: promoOff }];
      if (recurringLine && promoOff) warnings.push({ code: "discount_stacking", severity: "info", message: "The recurring discount and the promotion both apply, because this service stacks them." });
    } else {
      const promoOff = Math.min(adjust(cleaningCents, promo.promotion.discount), cleaningCents);
      if (recurringLine && recurringOff >= promoOff) {
        discounts = [recurringLine];
        lines.push({ key: "promotion_note", kind: "info", label: `${promo.promotion.label} not combined`, detail: "This service applies only the larger discount; the recurring discount is larger.", amountCents: 0 });
      } else {
        discounts = [{ key: "promotion", label: promo.promotion.label, detail: `${adjustmentWords(promo.promotion.discount)} off the cleaning amount`, cents: promoOff }];
        if (recurringLine) lines.push({ key: "recurring_note", kind: "info", label: "Recurring discount not combined", detail: "This service applies only the larger discount; the promotion is larger.", amountCents: 0 });
      }
    }
  } else if (recurringLine) discounts = [recurringLine];

  const cap = percentOf(cleaningCents, m.discounts.maxTotalPercent);
  let totalOff = 0;
  for (const discount of discounts) {
    let cents = discount.cents;
    if (totalOff + cents > cap) {
      cents = Math.max(0, cap - totalOff);
      warnings.push({ code: "discount_capped", severity: "warning", message: `Discounts were held to ${trimNumber(m.discounts.maxTotalPercent)}% of the cleaning amount (${formatCents(cap)}).` });
    }
    if (cents > 0) lines.push({ key: discount.key, kind: "discount", label: discount.label, detail: discount.detail, amountCents: -cents });
    totalOff += cents;
  }

  let total = cleaningCents + fees - totalOff;

  // 10. Minimum.
  if (m.minimumCents !== null && total < m.minimumCents) {
    lines.push({ key: "minimum", kind: "minimum", label: "Minimum charge", detail: `Brought up to the ${formatCents(m.minimumCents)} minimum`, amountCents: m.minimumCents - total });
    total = m.minimumCents;
  }

  // 11. Rounding.
  total = applyRounding(m, total, lines);

  // Billed after the visit, never part of the total.
  if (strFacts) {
    for (const item of spec.str!.restock) {
      if (item.rule === "at_cost" || item.rule === "cost_plus") lines.push({ key: `restock:${item.id}`, kind: "billed_later", label: `Restock: ${item.label}`, detail: item.rule === "at_cost" ? `${item.perTurnover} per turnover, billed at cost after the visit` : `${item.perTurnover} per turnover, billed at cost plus ${trimNumber(item.markupPercent)}% after the visit`, amountCents: 0 });
    }
    if (spec.str!.conditionCharges.length) lines.push({ key: "condition_charges", kind: "info", label: "Excessive-condition charges", detail: "Applied only after a person reviews the photos", amountCents: 0 });
  }

  if (total === 0) warnings.push({ code: "zero_price", severity: "warning", message: `This ${per} is priced at $0.` });
  return finish(estimate.length ? "estimate" : "firm", total, cleaningCents, estimate);
}

function applicablePromotion(m: Modifiers, input: QuoteInput): { promotion: Modifiers["promotions"][number] | null; note: string | null } {
  if (!input.promotionId) return { promotion: null, note: null };
  const promotion = m.promotions.find((p) => p.id === input.promotionId);
  if (!promotion) return { promotion: null, note: "That promotion is not on this service." };
  if (!promotion.approved) return { promotion: null, note: `"${promotion.label}" has not been approved by the Owner.` };
  if (promotion.startsOn || promotion.endsOn) {
    if (!input.date) return { promotion: null, note: `"${promotion.label}" has dates, and no visit date was given.` };
    if (!inDates(input.date, promotion.startsOn, promotion.endsOn)) return { promotion: null, note: `"${promotion.label}" does not run on ${input.date}.` };
  }
  return { promotion, note: null };
}

function applyRounding(m: Modifiers, total: number, lines: Line[]): number {
  const step = m.rounding.stepCents;
  if (step <= 1) return total;
  const rounded = m.rounding.mode === "up" ? Math.ceil(total / step) * step : Math.floor(total / step + 0.5) * step;
  if (rounded !== total) lines.push({ key: "rounding", kind: "rounding", label: "Rounding", detail: `${m.rounding.mode === "up" ? "Rounded up" : "Rounded"} to the nearest ${formatCents(step)}`, amountCents: rounded - total });
  return rounded;
}

export function minutesBetween(from: string, to: string): number {
  const parse = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const a = parse(from);
  const b = parse(to);
  if (a === null || b === null) return 0;
  return b > a ? b - a : b + 24 * 60 - a;
}

/** The sum of the lines that count toward the total. The engine's tests check it always equals the total. */
export function sumOfLines(lines: Line[]): number {
  return lines.filter((line) => line.kind !== "info" && line.kind !== "billed_later").reduce((sum, line) => sum + line.amountCents, 0);
}

// ── Checking a service before review ────────────────────────────────────────────────────────────────

export type Problem = { severity: "blocker" | "warning"; field: string; code: WarningCode | "required" | "duplicate" | "unconfirmed"; message: string };

/**
 * What stands between a draft and publishing. Blockers stop a submission; warnings are shown and allowed.
 * Size bands are half-open: a band covers its lower bound up to, not including, its upper bound.
 */
export function checkSpec(spec: Spec): Problem[] {
  const out: Problem[] = [];
  const blocker = (field: string, code: Problem["code"], message: string) => out.push({ severity: "blocker", field, code, message });
  const warn = (field: string, code: Problem["code"], message: string) => out.push({ severity: "warning", field, code, message });
  if (!spec.name.trim()) blocker("name", "required", "Give the service a name.");
  if (!spec.summary.trim()) warn("summary", "required", "Add a short description customers will read.");
  if (spec.included.length === 0) warn("included", "required", "List what the service includes, so the customer and the crew see the same scope.");
  if (spec.excluded.length === 0) warn("excluded", "required", "List what is not included. It prevents most scope disputes.");

  const p = spec.pricing;
  const needPrice = (field: string, cents: number) => {
    if (!Number.isSafeInteger(cents) || cents < 0) blocker(field, "required", "Prices must be whole cents, zero or more.");
    else if (cents === 0) warn(field, "zero_price", "This price is $0.");
  };
  switch (p.method) {
    case "fixed":
      needPrice("pricing.amountCents", p.amountCents);
      break;
    case "hourly_per_cleaner":
    case "hourly_per_crew":
      needPrice("pricing.rateCents", p.rateCents);
      if (p.incrementMinutes < 1) blocker("pricing.incrementMinutes", "required", "Billing must round to at least one minute.");
      break;
    case "size_bands": {
      if (p.bands.length === 0) blocker("pricing.bands", "required", "Add at least one size band.");
      const bands = [...p.bands].sort((a, b) => a.from - b.from);
      if (bands.length && bands[0].from > 0) warn("pricing.bands", "band_gap", `Sizes under ${trimNumber(bands[0].from)} ${areaWord(p.unit)} are in no band.`);
      bands.forEach((band, i) => {
        if (band.to !== null && band.to <= band.from) blocker(`pricing.bands.${i}`, "band_overlap", `A band must end above where it starts (${trimNumber(band.from)}).`);
        if (band.to === null && i < bands.length - 1) blocker(`pricing.bands.${i}`, "band_overlap", `The band from ${trimNumber(band.from)} has no upper limit, so it overlaps the bands above it.`);
        needPrice(`pricing.bands.${i}`, band.amountCents);
        const next = bands[i + 1];
        if (!next || band.to === null) return;
        if (next.from < band.to) blocker(`pricing.bands.${i + 1}`, "band_overlap", `The bands starting at ${trimNumber(band.from)} and ${trimNumber(next.from)} overlap: ${trimNumber(next.from)} to ${trimNumber(band.to)} would have two prices.`);
        else if (next.from > band.to) blocker(`pricing.bands.${i + 1}`, "band_gap", `Nothing covers ${trimNumber(band.to)} up to ${trimNumber(next.from)} ${areaWord(p.unit)}.`);
        if (next.amountCents < band.amountCents) warn(`pricing.bands.${i + 1}`, "band_drop", `The price drops from ${formatCents(band.amountCents)} to ${formatCents(next.amountCents)} as the property gets larger.`);
        else if (band.amountCents > 0 && next.amountCents > band.amountCents * 1.5) warn(`pricing.bands.${i + 1}`, "band_jump", `The price jumps ${Math.round((next.amountCents / band.amountCents - 1) * 100)}% at ${trimNumber(next.from)} ${areaWord(p.unit)}. A customer just over the line pays much more.`);
      });
      break;
    }
    case "per_area":
      if (!Number.isSafeInteger(p.rateMillicents) || p.rateMillicents <= 0) blocker("pricing.rateMillicents", "required", "Set the rate per area.");
      break;
    case "bed_bath":
      needPrice("pricing.baseCents", p.baseCents);
      break;
    case "per_unit":
      if (!p.unitWord.trim()) blocker("pricing.unitWord", "required", "Say what one unit is, for example room or load.");
      needPrice("pricing.unitCents", p.unitCents);
      break;
    case "recurring_package":
      needPrice("pricing.monthlyCents", p.monthlyCents);
      if (p.basis === "included" && p.includedVisits < 1) blocker("pricing.includedVisits", "required", "A package with included visits needs at least one.");
      break;
    case "custom_quote":
      break;
  }

  const ids = new Set<string>();
  for (const addOn of spec.addOns) {
    if (ids.has(addOn.id)) blocker(`addOns.${addOn.id}`, "duplicate", `Two extras share the id ${addOn.id}.`);
    ids.add(addOn.id);
    if (!addOn.label.trim()) blocker(`addOns.${addOn.id}`, "required", "Every extra needs a name.");
    if (!chargeable(spec, addOn)) warn(`addOns.${addOn.id}`, "duplicate", `"${addOn.label}" is already included in the service, so it will never be charged.`);
    const sameName = spec.included.find((item) => item.label.trim().toLowerCase() === addOn.label.trim().toLowerCase());
    if (sameName && chargeable(spec, addOn)) warn(`addOns.${addOn.id}`, "duplicate", `"${addOn.label}" is sold as an extra and also listed as included. Link it to the included task or remove one.`);
  }

  const m = spec.modifiers;
  if (m.demand.enabled) {
    if (m.demand.capPercent <= 0) blocker("modifiers.demand", "required", "Demand pricing needs a cap above 0%.");
    if (m.demand.peakDays.length === 0 && !m.demand.busyDay.enabled) blocker("modifiers.demand", "required", "Demand pricing is on but has no peak days and no busy-day rule.");
  }
  if (m.discounts.maxTotalPercent < 0 || m.discounts.maxTotalPercent > 100) blocker("modifiers.discounts", "required", "The discount limit must be between 0% and 100%.");
  if (m.promotions.some((promo) => !promo.approved)) warn("modifiers.promotions", "unconfirmed", "A promotion that is not approved is never applied.");
  if (spec.str?.enabled && minutesBetween(spec.str.checkoutTime, spec.str.checkinTime) === 0) blocker("str", "required", "Set the checkout and check-in times.");

  if (spec.illustrative) blocker("illustrative", "illustrative", "Confirm or replace the illustrative amounts for your market before publishing.");
  for (const requirement of spec.requirements) if (!requirement.confirmed) blocker(`requirements.${requirement.id}`, "unconfirmed", `Confirm that your company has this: ${requirement.label}.`);
  return out;
}

export function blockers(spec: Spec): Problem[] {
  return checkSpec(spec).filter((problem) => problem.severity === "blocker");
}

// ── Labels ──────────────────────────────────────────────────────────────────────────────────────────

/** "From $120 per visit", "$45.00 per cleaner per hour". The unit is always stated. */
export function priceSummary(spec: Spec): string {
  const p = spec.pricing;
  const word = spec.visitWord;
  switch (p.method) {
    case "fixed":
      return `${formatCents(p.amountCents)} per ${word}`;
    case "hourly_per_cleaner":
      return `${formatCents(p.rateCents)} per cleaner per hour, ${trimNumber(p.minimumHours)} cleaner-hour minimum`;
    case "hourly_per_crew":
      return `${formatCents(p.rateCents)} per hour for a crew of ${p.crewSize}, ${trimNumber(p.minimumHours)}-hour minimum`;
    case "size_bands": {
      const lowest = p.bands.reduce<number | null>((min, b) => (min === null || b.amountCents < min ? b.amountCents : min), null);
      return lowest === null ? "Priced by size" : `From ${formatCents(lowest)} per ${word}, by size`;
    }
    case "per_area":
      return `${formatMillicents(p.rateMillicents)} per ${areaWord(p.unit, 1)}`;
    case "bed_bath":
      return `From ${formatCents(p.baseCents)} per ${word}, by bedrooms and bathrooms`;
    case "per_unit":
      return `${formatCents(p.unitCents)} per ${p.unitWord}${p.baseCents ? ` plus ${formatCents(p.baseCents)}` : ""}`;
    case "recurring_package":
      return `${formatCents(p.monthlyCents)} per calendar month`;
    case "custom_quote":
      return p.fromCents === null ? "Priced after a walkthrough" : `From ${formatCents(p.fromCents)}, priced after a walkthrough`;
  }
}

/**
 * The lowest price a customer could see advertised for this service, in cents, when the method has one:
 * a fixed price, the base of bedrooms and bathrooms, the smallest size band, or a walkthrough's "from"
 * price. Rates (hourly, per area, per unit) and monthly packages have no single starting price: null.
 */
export function startingCents(spec: Spec): number | null {
  const p = spec.pricing;
  switch (p.method) {
    case "fixed":
      return p.amountCents;
    case "bed_bath":
      return p.baseCents;
    case "size_bands":
      return p.bands.reduce<number | null>((min, b) => (min === null || b.amountCents < min ? b.amountCents : min), null);
    case "custom_quote":
      return p.fromCents;
    default:
      return null;
  }
}

/** Minutes of labor for a usual visit, for scheduling defaults. */
export function usualLaborMinutes(spec: Spec): number {
  const p = spec.pricing;
  switch (p.method) {
    case "fixed":
      return p.laborMinutes;
    case "hourly_per_cleaner":
      return p.estimatedLaborMinutes;
    case "hourly_per_crew":
      return p.estimatedElapsedMinutes * p.crewSize;
    case "size_bands":
      return p.bands[0]?.laborMinutes ?? 0;
    case "per_area":
      return p.laborMinutesPer1000;
    case "bed_bath":
      return p.baseLaborMinutes;
    case "per_unit":
      return p.baseLaborMinutes + p.laborMinutesPerUnit * Math.max(1, p.minimumUnits);
    case "recurring_package":
      return p.laborMinutesPerVisit;
    case "custom_quote":
      return p.laborMinutes ?? 0;
  }
}
