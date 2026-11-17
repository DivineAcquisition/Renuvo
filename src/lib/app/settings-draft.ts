/**
 * The business-settings draft: what the forms edit, how it is read from the saved record, and how it is
 * turned back into the one complete payload the server validates. Pure, so it is tested without a
 * browser. The server is the authority on what is valid; this only keeps text fields honest.
 */

export type HoursWindow = { weekday: number; startMinute: number; endMinute: number };

export type ServiceDraft = {
  id: string;
  name: string;
  scope: string;
  duration: string;
  crew: string;
  skills: string;
  /** Dollars as typed. Empty means no starting price. */
  price: string;
  status: "active" | "archived";
};

export type BusinessDraft = {
  name: string;
  timezone: string;
  /** One postal code per entry, as the Owner added them. */
  areas: string[];
  /**
   * "any" sends no hours, which the server reads as no company-wide limit. "set" sends `hours`; a day
   * with no window is then closed for booking. The windows are kept while "any" is chosen, so switching
   * back does not lose them, but they are not sent.
   */
  hoursMode: "any" | "set";
  hours: HoursWindow[];
  services: ServiceDraft[];
};

export type SavedBusiness = {
  revision: number;
  name: string;
  timezone: string;
  serviceAreas: string[];
  hours: HoursWindow[];
  services: { id: string; name: string; scope: string; durationMinutes: number; defaultCrew: number; skills: string[]; startingPriceCents?: number; status: "active" | "archived" }[];
};

export type BusinessPayload = {
  name: string;
  timezone: string;
  serviceAreas: string[];
  hours: HoursWindow[];
  services: { id: string; name: string; scope: string; durationMinutes: number; defaultCrew: number; skills: string[]; startingPriceCents?: number; status: "active" | "archived" }[];
};

export const dollars = (cents: number) => (cents / 100).toFixed(2);

export function draftFrom(saved: SavedBusiness): BusinessDraft {
  return {
    name: saved.name,
    timezone: saved.timezone,
    areas: [...saved.serviceAreas],
    hoursMode: saved.hours.length > 0 ? "set" : "any",
    hours: saved.hours.map((w) => ({ weekday: w.weekday, startMinute: w.startMinute, endMinute: w.endMinute })),
    services: saved.services.map((s) => ({
      id: s.id,
      name: s.name,
      scope: s.scope,
      duration: String(s.durationMinutes),
      crew: String(s.defaultCrew),
      skills: s.skills.join(", "),
      price: s.startingPriceCents === undefined ? "" : dollars(s.startingPriceCents),
      status: s.status,
    })),
  };
}

export const splitList = (text: string) => text.split(/[\n,;]+/).map((part) => part.trim()).filter(Boolean);

/** "12.50" or "$1,200" to cents, or null when it is not an amount. */
export function parseDollars(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** What the form would send. A field that is not a number is sent as NaN, which the server refuses in words. */
export function payloadFrom(draft: BusinessDraft): BusinessPayload {
  return {
    name: draft.name,
    timezone: draft.timezone,
    serviceAreas: draft.areas.map(normalizePostalCode).filter(Boolean),
    hours: draft.hoursMode === "any" ? [] : [...draft.hours].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute),
    services: draft.services.map((s) => {
      const price = s.price.trim() === "" ? undefined : (parseDollars(s.price) ?? Number.NaN);
      return {
        id: s.id,
        name: s.name,
        scope: s.scope,
        durationMinutes: s.duration.trim() === "" ? Number.NaN : Number(s.duration),
        defaultCrew: s.crew.trim() === "" ? Number.NaN : Number(s.crew),
        skills: splitList(s.skills),
        ...(price === undefined ? {} : { startingPriceCents: price }),
        status: s.status,
      };
    }),
  };
}

/** What is wrong with one service, by field, so each message sits beside the field it is about. */
export type ServiceErrors = Partial<Record<"name" | "scope" | "price" | "duration" | "crew", string>>;

export function serviceErrors(s: ServiceDraft): ServiceErrors {
  const out: ServiceErrors = {};
  if (!s.name.trim()) out.name = "Give the service a name.";
  if (!s.scope.trim()) out.scope = "Describe what the crew does.";
  if (s.price.trim() !== "") {
    const cents = parseDollars(s.price);
    if (cents === null) out.price = "Enter an amount, like 150 or 150.00.";
    else if (cents > 100_000_00) out.price = "The starting price can be at most $100,000.";
  }
  const duration = Number(s.duration);
  if (s.duration.trim() === "" || !Number.isInteger(duration)) out.duration = "Enter whole minutes, like 120.";
  else if (duration < 15 || duration > 1440) out.duration = "Enter between 15 and 1,440 minutes (24 hours).";
  const crew = Number(s.crew);
  if (s.crew.trim() === "" || !Number.isInteger(crew)) out.crew = "Enter a whole number, like 2.";
  else if (crew < 1 || crew > 12) out.crew = "Enter between 1 and 12 cleaners.";
  return out;
}

/** Problems visible before sending, so a typo is caught beside its field instead of after a round trip. */
export function localProblems(draft: BusinessDraft): string[] {
  const out: string[] = [];
  if (!draft.name.trim()) out.push("Enter your company name.");
  for (const code of draft.areas) {
    const problem = postalCodeProblem(code);
    if (problem) out.push(problem);
  }
  if (draft.hoursMode === "set") {
    if (draft.hours.length === 0) out.push("Booking hours: open at least one day, or choose “Customers can book at any time”.");
    for (const problem of hoursProblems(draft.hours)) out.push(`Booking hours: ${problem}`);
  }
  for (const [index, s] of draft.services.entries()) {
    const label = s.name.trim() || `Service ${index + 1}`;
    for (const message of Object.values(serviceErrors(s))) out.push(`${label}: ${message}`);
  }
  return out;
}

export function isDirty(draft: BusinessDraft, saved: SavedBusiness): boolean {
  return JSON.stringify(payloadFrom(draft)) !== JSON.stringify(payloadFrom(draftFrom(saved)));
}

// ── Service area ────────────────────────────────────────────────────────────────────────────────────

/** The server's spelling of a postal code: upper case, single spaces, ZIP+4 collapsed to five digits. */
export function normalizePostalCode(value: string): string {
  const trimmed = value.trim().toUpperCase().replace(/\s+/g, " ");
  return /^\d{5}-\d{4}$/.test(trimmed) ? trimmed.slice(0, 5) : trimmed;
}

const POSTAL = /^[A-Z0-9][A-Z0-9 -]{1,9}[A-Z0-9]$/;

/** Why a postal code would be refused, or null when it is fine. */
export function postalCodeProblem(value: string): string | null {
  const code = normalizePostalCode(value);
  if (!code) return "Enter a ZIP or postal code.";
  if (!POSTAL.test(code)) return `“${value.trim()}” doesn’t look like a ZIP or postal code.`;
  return null;
}

/** Adds what was typed (one code, or several separated by commas or spaces) and says what could not be added. */
export function addPostalCodes(current: readonly string[], typed: string): { areas: string[]; added: number; problems: string[] } {
  const parts = typed.split(/[\n,;]+|\s{2,}/).map((part) => part.trim()).filter(Boolean);
  const pieces = parts.flatMap((part) => (/^\d{5}(\s+\d{5})+$/.test(part) ? part.split(/\s+/) : [part]));
  const areas = [...current];
  const problems: string[] = [];
  let added = 0;
  for (const piece of pieces) {
    const problem = postalCodeProblem(piece);
    if (problem) {
      problems.push(problem);
      continue;
    }
    const code = normalizePostalCode(piece);
    if (areas.includes(code)) continue;
    areas.push(code);
    added += 1;
  }
  return { areas, added, problems };
}

/** A fresh, collision-resistant id for a new service. It is chosen once and never edited. */
export function newServiceId(random: () => number = Math.random): string {
  return `svc-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0")}${Date.now().toString(36).slice(-4)}`;
}

export function blankService(random?: () => number): ServiceDraft {
  return { id: newServiceId(random), name: "", scope: "", duration: "120", crew: "1", skills: "", price: "", status: "active" };
}

// ── Hours ───────────────────────────────────────────────────────────────────────────────────────────

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const minuteToTime = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** "09:30" to minutes of the day. "24:00" is the end of the day. */
export function timeToMinute(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute >= 0 && minute <= 1440 && Number(match[2]) < 60 ? minute : null;
}

/** Hours as one line per day, for reading: "Mon–Fri 8:00 AM–5:00 PM". Days with no window are left out. */
export function hoursSummary(hours: HoursWindow[]): string[] {
  const label = (minute: number) => {
    const h = Math.floor(minute / 60) % 24;
    return `${h % 12 === 0 ? 12 : h % 12}:${String(minute % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };
  return WEEKDAYS.flatMap((day, weekday) => {
    const windows = hours.filter((w) => w.weekday === weekday).sort((a, b) => a.startMinute - b.startMinute);
    return windows.length ? [`${day}: ${windows.map((w) => `${label(w.startMinute)} to ${label(w.endMinute)}`).join(", ")}`] : [];
  });
}

/** Whether leaving for `href` from this page leaves Settings, where an unsaved draft would be lost. */
export function leavesSettings(href: string, origin: string, current: { pathname: string; search: string }): boolean {
  let target: URL;
  try {
    target = new URL(href, origin);
  } catch {
    return false;
  }
  if (target.origin !== origin) return true;
  if (target.pathname === current.pathname && target.search === current.search) return false;
  return !(target.pathname === "/app/settings" || target.pathname.startsWith("/app/settings/"));
}

/** Problems with the weekly hours the server would refuse, in words. */
export function hoursProblems(hours: readonly HoursWindow[]): string[] {
  const out: string[] = [];
  for (const window of hours) {
    if (window.startMinute >= window.endMinute) out.push(`on ${WEEKDAYS[window.weekday]}, closing time must be after opening time.`);
  }
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const day = hours.filter((w) => w.weekday === weekday).sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < day.length; i += 1) if (day[i].startMinute < day[i - 1].endMinute) out.push(`on ${WEEKDAYS[weekday]}, two time ranges overlap.`);
  }
  if (hours.length > 28) out.push("there can be at most 28 time ranges in a week.");
  return [...new Set(out)];
}

/** "8:00 AM" from minutes of the day; 1440 reads as midnight at the end of the day. */
export function clockLabel(minute: number): string {
  if (minute >= 1440) return "Midnight";
  const h = Math.floor(minute / 60) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(minute % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
