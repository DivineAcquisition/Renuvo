/**
 * Bringing an established company's clients in from a spreadsheet or another system. Pure parts only:
 * checking one row and recognizing other systems' export columns. Writing is in convex/clientImports.ts.
 *
 * An imported row is a client and, when the address is complete, a property. It is never permission to
 * text or email anyone: that is recorded separately, and an import is never counted as consent.
 */

export type ImportRow = {
  name: string;
  type?: string;
  kind?: string;
  email?: string;
  phone?: string;
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  notes?: string;
  schedule?: string;
  /** The record's id in the system it came from, so importing the same export again finds it. */
  externalId?: string;
};

export const ROW_LIMIT = 1000;
export const COMMIT_LIMIT = 100;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function rowProblems(row: ImportRow): string[] {
  const problems: string[] = [];
  if (!row.name?.trim()) problems.push("It has no name.");
  if (row.name && row.name.trim().length > 160) problems.push("The name is longer than 160 characters.");
  if (row.email?.trim() && !EMAIL.test(row.email.trim())) problems.push("The email doesn't look like an email address.");
  if (row.phone?.trim() && row.phone.replace(/\D/g, "").length < 7) problems.push("The phone number is too short.");
  return problems;
}

/** A complete address, which becomes a property. Without one the client is still imported, with no property. */
export function hasAddress(row: ImportRow): boolean {
  return Boolean(row.line1?.trim() && row.city?.trim() && row.region?.trim() && row.postalCode?.trim());
}

export function kindOf(row: ImportRow): "home" | "commercial" | "short_term_rental" | "property_manager" {
  const words = `${row.kind ?? ""} ${row.type ?? ""}`.toLowerCase();
  if (/airbnb|vacation|short|str|vrbo/.test(words)) return "short_term_rental";
  if (/property manag|pm\b/.test(words)) return "property_manager";
  if (/commercial|office|business|company|retail/.test(words)) return "commercial";
  return "home";
}

export function typeOf(row: ImportRow): "person" | "business" {
  const words = `${row.type ?? ""} ${row.kind ?? ""}`.toLowerCase();
  return /business|company|commercial|office|llc|inc\b|corp/.test(words) || /\b(llc|inc|corp|ltd|co\.)\b/i.test(row.name) ? "business" : "person";
}

// ── Recognizing exports from other systems ──────────────────────────────────────────────────────

export type ImportField = keyof ImportRow | "firstName" | "lastName" | "company";
export const FIELD_LABELS: Record<ImportField, string> = {
  name: "Client name",
  firstName: "First name",
  lastName: "Last name",
  company: "Company name",
  type: "Client type",
  kind: "Property type",
  email: "Email",
  phone: "Phone",
  line1: "Street address",
  line2: "Apartment or unit",
  city: "City",
  region: "State",
  postalCode: "ZIP or postal code",
  notes: "Notes",
  schedule: "Schedule or frequency",
  externalId: "ID in the old system",
};

/** Common header names, including those seen in Jobber, Housecall Pro and BookingKoala exports. Matching is a suggestion the owner confirms. */
const GUESSES: Record<ImportField, string[]> = {
  name: ["name", "client name", "customer name", "display name", "full name", "client"],
  firstName: ["first name", "first", "given name"],
  lastName: ["last name", "last", "surname", "family name"],
  company: ["company", "company name", "business name", "organization"],
  type: ["client type", "customer type", "type"],
  kind: ["property type", "home type", "service type", "lead source type"],
  email: ["email", "e-mail", "emails", "email address", "e-mails", "primary email"],
  phone: ["phone", "mobile", "mobile phone", "mobile number", "cell", "main phone", "main phone #s", "mobile phone #s", "phone number", "home number", "work number", "phones"],
  line1: ["street", "street 1", "address", "address 1", "address line 1", "service street 1", "billing street 1", "service address", "street address"],
  line2: ["street 2", "address 2", "address line 2", "apt", "unit", "suite", "service street 2", "billing street 2"],
  city: ["city", "service city", "billing city", "town"],
  region: ["state", "province", "region", "service state", "billing state"],
  postalCode: ["zip", "zip code", "postal code", "postcode", "service zip code", "billing zip code", "zipcode"],
  notes: ["notes", "note", "client notes", "customer notes", "comments", "private notes"],
  schedule: ["frequency", "schedule", "recurrence", "service frequency", "repeat"],
  externalId: ["id", "j-id", "client id", "customer id", "external id"],
};

export type Detected = "jobber" | "housecall_pro" | "bookingkoala" | null;

/** Which system an export most likely came from, by its headers. Only used to word the screen. */
export function detectSource(header: string[]): Detected {
  const names = header.map((cell) => cell.trim().toLowerCase());
  if (names.includes("j-id") || names.some((name) => name.startsWith("service street")) || names.includes("main phone #s")) return "jobber";
  if (names.includes("display name") && (names.includes("mobile number") || names.includes("home number"))) return "housecall_pro";
  if (names.includes("frequency") && names.includes("apt") && names.includes("zip code")) return "bookingkoala";
  return null;
}

export function guessMapping(header: string[]): Partial<Record<ImportField, number>> {
  const names = header.map((cell) => cell.trim().toLowerCase());
  const out: Partial<Record<ImportField, number>> = {};
  const used = new Set<number>();
  for (const field of Object.keys(GUESSES) as ImportField[]) {
    for (const guess of GUESSES[field]) {
      const index = names.indexOf(guess);
      if (index >= 0 && !used.has(index)) {
        out[field] = index;
        used.add(index);
        break;
      }
    }
  }
  return out;
}

/** One spreadsheet row as an import row, using the owner's confirmed mapping. */
export function toRow(cells: string[], mapping: Partial<Record<ImportField, number>>): ImportRow {
  const at = (field: ImportField) => (mapping[field] === undefined ? "" : (cells[mapping[field]!] ?? "").trim());
  const person = [at("firstName"), at("lastName")].filter(Boolean).join(" ");
  const name = at("name") || person || at("company");
  const phone = at("phone").split(/[,;\n]/)[0]?.trim() ?? "";
  const email = at("email").split(/[,;\n\s]/)[0]?.trim() ?? "";
  const row: ImportRow = { name };
  const set = (key: keyof ImportRow, value: string) => {
    if (value) row[key] = value.slice(0, 500);
  };
  set("type", at("type") || (at("company") && !person ? "business" : ""));
  set("kind", at("kind"));
  set("email", email);
  set("phone", phone);
  set("line1", at("line1"));
  set("line2", at("line2"));
  set("city", at("city"));
  set("region", at("region"));
  set("postalCode", at("postalCode"));
  set("notes", at("notes"));
  set("schedule", at("schedule"));
  set("externalId", at("externalId"));
  return row;
}
