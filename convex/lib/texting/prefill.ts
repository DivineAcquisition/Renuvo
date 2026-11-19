/**
 * Filling in a new texting setup from what the company already told Selestial: its compliance profile,
 * onboarding facts, booking page and the owner's own account. Each detail keeps where it came from and
 * stays unconfirmed until the owner confirms it. Only empty details are filled: nothing the owner typed is
 * replaced. The notes say exactly what was filled and from where, and nothing else.
 */
import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { readProfile } from "../compliance/profile";
import { bookingSettingsOf } from "../booking/settings";
import { factsOf } from "../setup/facts";
import type { Business, BusinessField, DetailSource } from "./schema";

export type Found = { field: BusinessField; value: string; source: DetailSource; ref?: string };

const SOURCE_WORDS: Record<DetailSource, string> = {
  profile: "your company profile",
  onboarding: "what you told Selestial during setup",
  website: "your website",
  booking: "your booking page",
  company: "your Selestial account",
  account: "your own sign-in details",
  owner: "you",
};

export const sourceWords = (source: DetailSource) => SOURCE_WORDS[source];

function phone(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

function website(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

/** Everything known, in order of preference: the first value for a field wins. */
export async function findDetails(ctx: QueryCtx, company: Doc<"companies">, member: Doc<"members">): Promise<Found[]> {
  const profile = await readProfile(ctx, company._id);
  const facts = await factsOf(ctx, company._id);
  const booking = await bookingSettingsOf(ctx, company);
  const fact = (key: string) => {
    const row = facts.find((f) => f.key === key);
    if (!row || typeof row.value !== "string" || !row.value.trim()) return null;
    const source: DetailSource = row.source === "website" ? "website" : row.source === "sign_in" ? "account" : "onboarding";
    return { value: row.value.trim(), source, ref: row.sourceRef };
  };
  const id = profile.identity;
  const out: Found[] = [];
  const add = (field: BusinessField, value: string | undefined | null, source: DetailSource, ref?: string) => {
    if (value && value.trim() && !out.some((row) => row.field === field)) out.push({ field, value: value.trim(), source, ...(ref ? { ref } : {}) });
  };

  add("displayName", id.tradingName, "profile");
  add("displayName", booking.profile.displayName, "booking");
  add("displayName", company.name, "company");
  add("legalName", id.legalName, "profile");

  const site = fact("company.website");
  add("website", website(site?.value), site?.source ?? "onboarding", site?.ref);
  add("website", website(booking.profile.website), "booking");

  add("supportEmail", id.supportEmail, "profile");
  const mail = fact("contact.email");
  add("supportEmail", mail?.value, mail?.source ?? "onboarding", mail?.ref);
  add("supportEmail", booking.profile.email, "booking");

  add("supportPhone", id.supportPhone, "profile");
  const tel = fact("contact.phone");
  add("supportPhone", phone(tel?.value), tel?.source ?? "onboarding", tel?.ref);
  add("supportPhone", phone(booking.profile.phone), "booking");

  if (id.address && id.address.country === "US") {
    add("street", [id.address.line1, id.address.line2].filter(Boolean).join(", "), "profile");
    add("city", id.address.city, "profile");
    add("state", id.address.region.toUpperCase(), "profile");
    add("postalCode", id.address.postalCode.slice(0, 5), "profile");
  }

  const [first, ...rest] = (id.representative?.name ?? member.name).trim().split(/\s+/);
  const nameSource: DetailSource = id.representative ? "profile" : "account";
  add("contactFirstName", first, nameSource);
  add("contactLastName", rest.join(" "), nameSource);
  add("contactEmail", id.representative?.email ?? member.email, nameSource);
  return out;
}

const GROUPS: { fields: BusinessField[]; words: string }[] = [
  { fields: ["displayName", "legalName"], words: "your business name" },
  { fields: ["street", "city", "state", "postalCode"], words: "your business address" },
  { fields: ["website"], words: "your website" },
  { fields: ["supportEmail", "supportPhone"], words: "your support contact" },
  { fields: ["contactFirstName", "contactLastName", "contactEmail"], words: "the contact person" },
];

/** Fills only empty fields. Answers with the new details, their sources, and one note per group actually filled. */
export function fill(current: Business, found: Found[]): { business: Business; sources: { field: string; source: DetailSource; ref?: string; confirmed: boolean }[]; notes: string[] } {
  const business: Business = { ...current };
  const sources: { field: string; source: DetailSource; ref?: string; confirmed: boolean }[] = [];
  for (const row of found) {
    if (business[row.field]) continue;
    business[row.field] = row.value;
    sources.push({ field: row.field, source: row.source, ...(row.ref ? { ref: row.ref } : {}), confirmed: false });
  }
  const notes: string[] = [];
  for (const group of GROUPS) {
    const filled = sources.filter((row) => group.fields.includes(row.field as BusinessField));
    if (filled.length === 0) continue;
    const from = [...new Set(filled.map((row) => SOURCE_WORDS[row.source]))];
    const check = group.words === "your business address" ? " Please confirm it matches your registration records." : " Please check it.";
    notes.push(`I filled in ${group.words} from ${from.join(" and ")}.${check}`);
  }
  return { business, sources, notes };
}
