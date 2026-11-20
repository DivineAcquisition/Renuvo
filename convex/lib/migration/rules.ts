/**
 * Bringing a cleaning company's business into Selestial: the pure rules. Nothing here reads or writes the
 * database, so every rule is tested on its own (convex/migration.test.ts).
 *
 * What is decided here is deterministic on purpose: dates, times, money, recurrence, identifiers and
 * required fields are read by rules, never guessed. A suggestion (a column, a category, a grouping) always
 * carries the source value it came from, and the owner accepts, changes or rejects it.
 *
 * Uploaded text is data. Nothing in a cell is ever read as an instruction to an agent.
 */
import type { Schedule } from "../services/spec";

// ── Record types ─────────────────────────────────────────────────────────────────────────────────────

/** What can be imported now, in the order it is written: a parent before what depends on it. */
export const IMPORTABLE = ["customers", "properties", "recurring", "bookings"] as const;
export type Importable = (typeof IMPORTABLE)[number];

/** Recognized and kept, but not imported yet. Shown as "not transferred, and why" rather than silently dropped. */
export const NOT_YET = ["cleaners", "services", "history", "agreements", "balances", "other"] as const;
export type NotYet = (typeof NOT_YET)[number];

export const FILE_KINDS = [...IMPORTABLE, ...NOT_YET] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const KIND_LABELS: Record<FileKind, { label: string; contains: string }> = {
  customers: { label: "Customers", contains: "People and companies you clean for, with contact details and usually an address." },
  properties: { label: "Properties", contains: "Service addresses, each linked to a customer. Commercial accounts often have several." },
  recurring: { label: "Recurring services", contains: "Standing schedules: how often, the next visit, and the price." },
  bookings: { label: "Upcoming bookings", contains: "Visits already on the calendar: date, time, service and price." },
  cleaners: { label: "Cleaners", contains: "Your team. Kept with this migration; importing cleaners comes next." },
  services: { label: "Services & prices", contains: "Your service list. Used to match bookings to your Services & Pricing; not imported as new services." },
  history: { label: "Service history", contains: "Completed visits. Kept with this migration; importing history comes next." },
  agreements: { label: "Agreements", contains: "Signed documents. Kept with this migration; importing agreements comes next." },
  balances: { label: "Balances & invoices", contains: "Outstanding amounts. Kept with this migration; importing balances comes next." },
  other: { label: "Something else", contains: "A file Selestial didn't recognize. Tell us what it is, or ask Selestial for help." },
};

// ── Fields ───────────────────────────────────────────────────────────────────────────────────────────

export type FieldDef = { key: string; label: string; required?: "always" | "one_of"; guesses: string[]; help?: string };

const ADDRESS: FieldDef[] = [
  { key: "line1", label: "Street address", guesses: ["street", "street 1", "address", "address 1", "address line 1", "service street 1", "service street", "property street", "street address", "service address"] },
  { key: "line2", label: "Apartment or unit", guesses: ["street 2", "address 2", "address line 2", "apt", "unit", "suite", "service street 2", "apt/suite"] },
  { key: "city", label: "City", guesses: ["city", "service city", "property city", "town"] },
  { key: "region", label: "State", guesses: ["state", "province", "region", "service state", "property state"] },
  { key: "postalCode", label: "ZIP code", guesses: ["zip", "zip code", "postal code", "postcode", "service zip code", "service zip", "property zip", "zipcode"] },
];

const CUSTOMER_REF: FieldDef[] = [
  { key: "customerRef", label: "Customer ID in the old system", guesses: ["customer id", "client id", "j-id", "customer number", "client number", "customer_id", "client_id"], help: "Links this row to a customer exactly. Without it, Selestial matches by name and asks when unsure." },
  { key: "customerName", label: "Customer name", guesses: ["customer", "customer name", "client", "client name", "display name", "name", "company", "company name"] },
];

export const FIELDS: Record<Importable, FieldDef[]> = {
  customers: [
    { key: "externalId", label: "ID in the old system", guesses: ["id", "j-id", "client id", "customer id", "external id", "customer number", "client number"], help: "Lets Selestial find this customer again if the same file is uploaded twice." },
    { key: "name", label: "Customer name", required: "one_of", guesses: ["name", "client name", "customer name", "display name", "full name", "client"] },
    { key: "firstName", label: "First name", required: "one_of", guesses: ["first name", "first", "given name"] },
    { key: "lastName", label: "Last name", guesses: ["last name", "last", "surname", "family name"] },
    { key: "company", label: "Company name", required: "one_of", guesses: ["company", "company name", "business name", "organization"] },
    { key: "category", label: "Customer type", guesses: ["client type", "customer type", "type", "category", "property type", "service type", "segment", "tags", "tag"] },
    { key: "email", label: "Email", guesses: ["email", "e-mail", "emails", "e-mails", "email address", "primary email"] },
    { key: "phone", label: "Phone", guesses: ["phone", "mobile", "mobile phone", "mobile number", "cell", "main phone", "main phone #s", "mobile phone #s", "phone number", "home number", "work number", "phones"] },
    ...ADDRESS,
    { key: "notes", label: "Notes", guesses: ["notes", "note", "client notes", "customer notes", "comments"] },
    { key: "doNotContact", label: "Opted out of messages", guesses: ["do not contact", "do not text", "opted out", "opt out", "unsubscribed", "sms opt out", "marketing opt out", "email opt out", "do not email"], help: "A documented opt-out is kept. A phone number or email is never treated as permission to message." },
  ],
  properties: [
    { key: "externalId", label: "Property ID in the old system", guesses: ["property id", "location id", "site id", "address id", "id"] },
    ...CUSTOMER_REF,
    { key: "label", label: "Property name", guesses: ["property name", "location name", "site name", "property", "location", "site"] },
    ...ADDRESS.map((f) => (f.key === "line1" || f.key === "city" || f.key === "region" || f.key === "postalCode" ? { ...f, required: "always" as const } : f)),
    { key: "kind", label: "Property type", guesses: ["property type", "type", "location type", "home type"] },
    { key: "bedrooms", label: "Bedrooms", guesses: ["bedrooms", "beds", "bedroom"] },
    { key: "bathrooms", label: "Bathrooms", guesses: ["bathrooms", "baths", "bathroom"] },
    { key: "squareFeet", label: "Square feet", guesses: ["square feet", "sq ft", "sqft", "square footage", "size"] },
    { key: "accessNotes", label: "Access instructions", guesses: ["access", "access instructions", "entry instructions", "gate code", "lockbox", "alarm", "key"], help: "Kept private: Owners and Managers only, and a cleaner only on an accepted visit." },
    { key: "crewNotes", label: "Notes for the crew", guesses: ["notes", "property notes", "service notes", "instructions", "cleaning notes"] },
    { key: "siteContactName", label: "Site contact", guesses: ["site contact", "contact", "contact name", "on-site contact"] },
    { key: "siteContactPhone", label: "Site contact phone", guesses: ["site contact phone", "contact phone"] },
    { key: "siteContactEmail", label: "Site contact email", guesses: ["site contact email", "contact email"] },
  ],
  recurring: [
    { key: "externalId", label: "Recurring ID in the old system", guesses: ["recurring id", "schedule id", "plan id", "id", "job id", "job #", "job number"] },
    ...CUSTOMER_REF,
    { key: "propertyRef", label: "Property ID in the old system", guesses: ["property id", "location id", "site id"] },
    ...ADDRESS,
    { key: "service", label: "Service", required: "always", guesses: ["service", "service name", "service type", "job title", "title", "line items", "item"] },
    { key: "frequency", label: "How often", required: "always", guesses: ["frequency", "recurrence", "repeat", "repeats", "schedule", "interval", "service frequency"] },
    { key: "nextVisit", label: "Next visit", required: "always", guesses: ["next visit", "next date", "next service", "next appointment", "start date", "starts", "first visit"] },
    { key: "endDate", label: "Ends on", guesses: ["end date", "ends", "ends on", "until"] },
    { key: "time", label: "Start time", guesses: ["time", "start time", "arrival time", "time slot", "scheduled time"] },
    { key: "durationMinutes", label: "Length", guesses: ["duration", "length", "hours", "estimated hours", "duration (minutes)", "minutes"] },
    { key: "price", label: "Price per visit", guesses: ["price", "amount", "total", "rate", "price per visit", "visit price", "cost"] },
    { key: "status", label: "Status", guesses: ["status", "state", "active", "paused"] },
    { key: "cleaner", label: "Assigned cleaner", guesses: ["cleaner", "assigned to", "team", "provider", "employee", "technician", "assigned"] },
    { key: "notes", label: "Notes", guesses: ["notes", "instructions", "job notes", "description"] },
  ],
  bookings: [
    { key: "externalId", label: "Booking ID in the old system", guesses: ["booking id", "visit id", "appointment id", "job id", "job #", "job number", "id", "booking #"] },
    ...CUSTOMER_REF,
    { key: "propertyRef", label: "Property ID in the old system", guesses: ["property id", "location id", "site id"] },
    ...ADDRESS,
    { key: "service", label: "Service", required: "always", guesses: ["service", "service name", "service type", "job title", "title", "line items", "item"] },
    { key: "date", label: "Date", required: "always", guesses: ["date", "visit date", "booking date", "service date", "scheduled date", "scheduled for", "appointment date", "start date"] },
    { key: "time", label: "Start time", guesses: ["time", "start time", "arrival time", "time slot", "scheduled time", "start"] },
    { key: "endTime", label: "End time", guesses: ["end time", "finish time", "end"] },
    { key: "durationMinutes", label: "Length", guesses: ["duration", "length", "hours", "estimated hours", "duration (minutes)", "minutes"] },
    { key: "price", label: "Price", guesses: ["price", "amount", "total", "booking total", "final amount", "subtotal", "cost"] },
    { key: "status", label: "Status", guesses: ["status", "booking status", "job status", "state"] },
    { key: "cleaner", label: "Assigned cleaner", guesses: ["cleaner", "assigned to", "team", "provider", "employee", "technician", "assigned"] },
    { key: "recurringRef", label: "Recurring ID it belongs to", guesses: ["recurring id", "schedule id", "plan id", "series id"] },
    { key: "notes", label: "Notes", guesses: ["notes", "instructions", "job notes", "description", "customer notes"] },
  ],
};

export type Mapping = Record<string, number>;

const norm = (cell: string) => cell.trim().toLowerCase().replace(/[_\s]+/g, " ");

/** Column suggestions for one record type. Exact names first, then a column that contains the name. Each column is used once. */
export function guessMapping(kind: Importable, header: string[]): Mapping {
  const names = header.map(norm);
  const out: Mapping = {};
  const used = new Set<number>();
  for (const pass of ["exact", "contains"] as const) {
    for (const field of FIELDS[kind]) {
      if (out[field.key] !== undefined) continue;
      for (const guess of field.guesses) {
        const index = pass === "exact" ? names.indexOf(guess) : guess.length >= 5 ? names.findIndex((name, i) => !used.has(i) && name.includes(guess)) : -1;
        if (index >= 0 && !used.has(index)) {
          out[field.key] = index;
          used.add(index);
          break;
        }
      }
    }
  }
  return out;
}

/** Which kind of file this most likely is, from its header, with the columns that decided it. */
export function guessKind(header: string[]): { kind: FileKind; because: string[] } {
  const names = header.map(norm);
  const has = (...words: string[]) => words.filter((word) => names.some((name) => name.includes(word)));
  const scores: [FileKind, string[]][] = [
    ["recurring", has("frequency", "recurrence", "repeat", "next visit", "next date")],
    ["bookings", has("booking", "visit date", "appointment", "scheduled", "date", "start time", "arrival")],
    ["history", has("completed", "completion", "finished")],
    ["balances", has("balance", "amount due", "outstanding", "invoice", "paid")],
    ["cleaners", has("employee", "hire date", "pay rate", "hourly rate", "role", "availability")],
    ["services", has("price book", "unit of measure", "taxable", "industry", "category")],
    ["agreements", has("agreement", "contract", "signed")],
    ["properties", has("property id", "location", "site", "lockbox", "gate code", "bedrooms", "square")],
    ["customers", has("email", "phone", "first name", "last name", "client", "customer", "company")],
  ];
  // A schedule file mentions dates too, so recurrence wins when present; completed visits beat upcoming ones.
  if (scores[0][1].length) return { kind: "recurring", because: scores[0][1] };
  if (scores[2][1].length && scores[1][1].length) return { kind: "history", because: [...scores[2][1], ...scores[1][1]] };
  const best = scores.slice(1).reduce((a, b) => (b[1].length > a[1].length ? b : a));
  if (!best[1].length) return { kind: "other", because: [] };
  // A customer list with a street and no dates is customers, which carry their first property.
  if (best[0] === "properties" && scores[8][1].length >= 2 && !has("property id", "site", "location").length) return { kind: "customers", because: scores[8][1] };
  return { kind: best[0], because: best[1] };
}

/** The values one row gives for the mapped fields, trimmed, at most 500 characters each. */
export function valuesOf(cells: string[], mapping: Mapping): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, index] of Object.entries(mapping)) {
    const value = (cells[index] ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
    if (value) out[key] = value;
  }
  return out;
}

// ── Dates and times ──────────────────────────────────────────────────────────────────────────────────

export type DateOrder = "mdy" | "dmy";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function isoDay(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/**
 * A calendar day from a spreadsheet value. "03/04/2027" is ambiguous between March 4 and April 3: it is
 * read in the order the owner confirmed for the file, and never guessed. ISO and written-out months are
 * not ambiguous. A time after the date is ignored here (see parseTime).
 */
export function parseDay(raw: string, order: DateOrder | null): { day: string } | { error: string } | { ambiguous: true } {
  const value = raw.trim();
  if (!value) return { error: "There is no date." };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(value);
  if (m) {
    const day = isoDay(+m[1], +m[2], +m[3]);
    return day ? { day } : { error: `"${value}" is not a real date.` };
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ ,T].*)?$/.exec(value);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = fullYear(+m[3]);
    if (a > 12 && b <= 12) return isoDay(y, b, a) ? { day: isoDay(y, b, a)! } : { error: `"${value}" is not a real date.` };
    if (b > 12 && a <= 12) return isoDay(y, a, b) ? { day: isoDay(y, a, b)! } : { error: `"${value}" is not a real date.` };
    if (a === b) return isoDay(y, a, b) ? { day: isoDay(y, a, b)! } : { error: `"${value}" is not a real date.` };
    if (!order) return { ambiguous: true };
    const day = order === "mdy" ? isoDay(y, a, b) : isoDay(y, b, a);
    return day ? { day } : { error: `"${value}" is not a real date.` };
  }
  m = /^(?:[a-z]+,?\s+)?([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i.exec(value);
  if (m && MONTHS.includes(m[1].slice(0, 3).toLowerCase())) {
    const day = isoDay(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]);
    return day ? { day } : { error: `"${value}" is not a real date.` };
  }
  m = /^(\d{1,2})\s+([a-z]{3,})\.?,?\s+(\d{4})/i.exec(value);
  if (m && MONTHS.includes(m[2].slice(0, 3).toLowerCase())) {
    const day = isoDay(+m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]);
    return day ? { day } : { error: `"${value}" is not a real date.` };
  }
  return { error: `"${value.slice(0, 40)}" isn't a date Selestial can read. Use a format like 2027-03-04.` };
}

/** How a file's dates are written, from all of them: decided only when a value proves it; null means the owner chooses. */
export function dateOrderOf(values: string[]): { order: DateOrder | null; ambiguous: number; proof: string | null } {
  let mdy: string | null = null;
  let dmy: string | null = null;
  let ambiguous = 0;
  for (const value of values) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(value.trim());
    if (!m) continue;
    const a = +m[1];
    const b = +m[2];
    if (a > 12 && b <= 12) dmy ??= value;
    else if (b > 12 && a <= 12) mdy ??= value;
    else if (a !== b) ambiguous += 1;
  }
  if (mdy && dmy) return { order: null, ambiguous, proof: null };
  if (mdy) return { order: "mdy", ambiguous, proof: mdy };
  if (dmy) return { order: "dmy", ambiguous, proof: dmy };
  return { order: null, ambiguous, proof: null };
}

/** "9am", "9:30 AM", "14:30", "2:00 PM - 4:00 PM" (the start), "2027-03-04 09:00" (the time) as HH:MM, or null. A bare "9" is not a time. */
export function parseTime(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  const iso = /^\d{4}-\d{1,2}-\d{1,2}[ t](.+)$/.exec(value);
  if (iso) value = iso[1];
  const m = /(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?/.exec(value);
  if (!m) return null;
  let hour = +m[1];
  const minute = m[2] ? +m[2] : 0;
  const half = m[3]?.[0];
  if (!m[2] && !half) return null;
  if (half && (hour < 1 || hour > 12)) return null;
  if (half === "p" && hour < 12) hour += 12;
  if (half === "a" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** A length in minutes: "120", "2 hours", "2.5", "1:30", "90 min". A bare number of 12 or less is hours. */
export function parseMinutes(raw: string): number | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  let m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (m) return +m[1] * 60 + +m[2];
  m = /^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minutes)?$/.exec(value);
  if (!m) return null;
  const n = +m[1];
  const unit = m[2]?.[0];
  const minutes = unit === "h" ? n * 60 : unit === "m" ? n : n <= 12 ? n * 60 : n;
  const rounded = Math.round(minutes);
  return rounded >= 15 && rounded <= 24 * 60 ? rounded : null;
}

// ── Money ────────────────────────────────────────────────────────────────────────────────────────────

/** "$1,234.50", "1234.5", "USD 80" as whole cents. A blank is null: a missing price is never invented. */
export function parseCents(raw: string): { cents: number | null } | { error: string } {
  const value = raw.trim();
  if (!value) return { cents: null };
  const cleaned = value.replace(/usd|\$|,|\s/gi, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return { error: `"${value.slice(0, 30)}" isn't an amount Selestial can read.` };
  const cents = Math.round(Number(cleaned) * 100);
  if (cents < 0) return { error: "A price can't be negative." };
  if (cents > 100_000_00) return { error: "That price is more than $100,000." };
  return { cents };
}

// ── Recurrence ───────────────────────────────────────────────────────────────────────────────────────

export const SCHEDULE_WORDS: Record<Schedule, string> = {
  every_7_days: "Every week",
  every_14_days: "Every two weeks",
  every_28_days: "Every four weeks",
  twice_per_month: "Twice a month",
  once_per_month: "Once a month (same date each month)",
};

/**
 * How often, from the old system's words. Every four weeks and once a month stay apart: one is 13 visits a
 * year, the other 12. A word with two meanings ("biweekly") is read the common way and says so.
 */
export function parseFrequency(raw: string): { schedule: Schedule; note?: string } | { error: string } {
  const value = raw.trim().toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ");
  if (!value) return { error: "It doesn't say how often." };
  if (/^(one time|once|single|none|n\/a|one off|not recurring)$/.test(value)) return { error: "This says it's a one-time service, not a recurring one." };
  if (/\b(weekly|every week|each week|1 week|every 7 days|7 days|once a week|once per week)\b/.test(value) && !/bi ?weekly|twice a week/.test(value)) return { schedule: "every_7_days" };
  if (/\b(every other week|every 2 weeks|every two weeks|fortnight|fortnightly|14 days|every 14 days|2 weeks)\b/.test(value)) return { schedule: "every_14_days" };
  if (/\bbi ?weekly\b/.test(value)) return { schedule: "every_14_days", note: `"${raw.trim()}" was read as every two weeks, which is what it usually means. Change it if it means twice a week.` };
  if (/\b(every 4 weeks|every four weeks|4 weeks|28 days|every 28 days|four weekly|4 weekly)\b/.test(value)) return { schedule: "every_28_days" };
  if (/\b(twice a month|twice monthly|semi ?monthly|2x month|2 times a month|bi ?monthly twice)\b/.test(value)) return { schedule: "twice_per_month" };
  if (/\b(monthly|every month|once a month|once per month|1 month|each month)\b/.test(value)) return { schedule: "once_per_month" };
  if (/\bbi ?monthly\b/.test(value)) return { error: `"${raw.trim()}" can mean twice a month or every two months. Choose which.` };
  if (/twice a week|2x week|every 3 weeks|every three weeks|every 6 weeks|quarterly|every 2 months|daily|every day/.test(value)) return { error: `"${raw.trim()}" isn't a schedule Selestial plans yet (every week, two weeks, four weeks, twice a month or once a month). Import it as separate bookings, or choose the closest and review.` };
  return { error: `"${raw.trim().slice(0, 40)}" isn't a frequency Selestial can read.` };
}

// ── Customers ────────────────────────────────────────────────────────────────────────────────────────

export const CATEGORIES = ["residential_one_time", "residential_recurring", "commercial", "office", "short_term_rental", "property_manager"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = {
  residential_one_time: "Residential · one-time",
  residential_recurring: "Residential · recurring",
  commercial: "Commercial",
  office: "Office",
  short_term_rental: "Short-term rental",
  property_manager: "Property manager",
};

/** A suggested category with the words that suggested it. Recurring is decided by an actual schedule, never by a word alone. */
export function suggestCategory(values: Record<string, string>, hasRecurring: boolean): { category: Category; because: string } {
  const words = `${values.category ?? ""} ${values.company ?? ""}`.toLowerCase();
  const name = values.name ?? "";
  if (/airbnb|vrbo|vacation|short.?term|\bstr\b|turnover|rental/.test(words)) return { category: "short_term_rental", because: `"${values.category ?? values.company}" reads as a short-term rental.` };
  if (/property manag|\bhoa\b|\bpm\b/.test(words)) return { category: "property_manager", because: `"${values.category ?? values.company}" reads as a property manager.` };
  if (/office/.test(words)) return { category: "office", because: `"${values.category ?? values.company}" mentions an office.` };
  if (/commercial|business|retail|medical|dental|clinic|restaurant|church|school|warehouse|gym/.test(words) || /\b(llc|inc|corp|ltd|co\.|company|group|partners)\b/i.test(name) || (values.company && !values.firstName && !values.lastName)) {
    return { category: "commercial", because: values.company ? `It has a company name, "${values.company}".` : `"${values.category ?? name}" reads as a business.` };
  }
  return hasRecurring ? { category: "residential_recurring", because: "A recurring service in your files is for this customer." } : { category: "residential_one_time", because: "No recurring service in your files is for this customer." };
}

export function customerNameOf(values: Record<string, string>): string {
  const person = [values.firstName, values.lastName].filter(Boolean).join(" ").trim();
  return (values.name || person || values.company || "").slice(0, 160);
}

export const phoneKey = (phone: string | undefined) => {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
};
export const emailKey = (email: string | undefined) => (email ?? "").trim().toLowerCase();
export const nameKey = (name: string | undefined) => (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const addressKey = (values: Record<string, string>) => (values.line1 && values.postalCode ? `${nameKey(values.line1)}|${nameKey(values.line2)}|${values.postalCode.trim().slice(0, 5)}` : "");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The first email in a cell that lists several. */
export function firstEmail(value: string | undefined): string | undefined {
  return value?.split(/[,;\s]+/).find((part) => part.includes("@"))?.trim();
}
export function firstPhone(value: string | undefined): string | undefined {
  return value?.split(/[,;/]|\bor\b/)[0]?.trim() || undefined;
}

/** "yes", "true", "opted out", "unsubscribed": a documented opt-out. A blank or "no" is not one. */
export function isOptOut(value: string | undefined): boolean {
  const word = (value ?? "").trim().toLowerCase();
  if (!word || /^(no|false|0|n|subscribed|opted in|ok)$/.test(word)) return false;
  return /^(yes|true|1|y|x)$/.test(word) || /opt(ed)? ?out|unsubscrib|do not|don't|stop|blocked/.test(word);
}

export function addressComplete(values: Record<string, string>): boolean {
  return Boolean(values.line1 && values.city && values.region && values.postalCode);
}

/** Problems that stop a row: required information that is missing or unreadable. Never filled in for the owner. */
export function requiredProblems(kind: Importable, values: Record<string, string>): string[] {
  const out: string[] = [];
  if (kind === "customers") {
    if (!customerNameOf(values)) out.push("It has no customer or company name.");
    const email = firstEmail(values.email);
    if (values.email && (!email || !EMAIL.test(email))) out.push("The email doesn't look like an email address.");
    if (values.phone && phoneKey(firstPhone(values.phone)).length < 7) out.push("The phone number is too short.");
  }
  if (kind === "properties" && !addressComplete(values)) out.push("The address is incomplete: it needs a street, city, state and ZIP.");
  if ((kind === "properties" || kind === "recurring" || kind === "bookings") && !values.customerRef && !values.customerName) out.push("It doesn't say which customer it's for.");
  if ((kind === "recurring" || kind === "bookings") && !values.service) out.push("It doesn't say which service.");
  if (kind === "recurring" && !values.frequency) out.push("It doesn't say how often.");
  if (kind === "recurring" && !values.nextVisit) out.push("It doesn't give the next visit date.");
  if (kind === "bookings" && !values.date) out.push("It has no date.");
  return out;
}

/** A booking's status words that mean it won't happen. Such rows are skipped and say so. */
export function cancelledStatus(value: string | undefined): boolean {
  return /cancel|void|deleted|declined|no.?show/i.test(value ?? "");
}
export function completedStatus(value: string | undefined): boolean {
  return /complete|done|finished|closed|paid|invoiced/i.test(value ?? "");
}
export function pausedStatus(value: string | undefined): boolean {
  return /pause|hold|inactive|suspend|stopped|ended|cancel/i.test(value ?? "");
}
