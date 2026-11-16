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
  areas: string;
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
    areas: saved.serviceAreas.join(", "),
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
    serviceAreas: splitList(draft.areas),
    hours: draft.hours,
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

/** Problems visible before sending, so a typo is caught beside its field instead of after a round trip. */
export function localProblems(draft: BusinessDraft): string[] {
  const out: string[] = [];
  for (const [index, s] of draft.services.entries()) {
    const label = s.name.trim() || `Service ${index + 1}`;
    if (s.price.trim() !== "" && parseDollars(s.price) === null) out.push(`${label}: the starting price is not an amount.`);
    if (!Number.isInteger(Number(s.duration)) || s.duration.trim() === "") out.push(`${label}: the duration must be a whole number of minutes.`);
    if (!Number.isInteger(Number(s.crew)) || s.crew.trim() === "") out.push(`${label}: the crew must be a whole number.`);
  }
  return out;
}

export function isDirty(draft: BusinessDraft, saved: SavedBusiness): boolean {
  return JSON.stringify(draft) !== JSON.stringify(draftFrom(saved));
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
