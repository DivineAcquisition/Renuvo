/**
 * What each step still needs, in words an owner can act on. Shared by the screen (to show what is missing
 * beside each field) and the server (which refuses to submit until nothing is missing). The rules are
 * Telnyx's brand and campaign requirements (docs/texting/00-audit.md §3), stated plainly.
 */
import { chosen } from "./activities";
import { draftGaps, type DraftInput } from "./drafts";
import { DRAFT_KEYS, type Business, type BusinessField, type DraftKey, type EntityType } from "./schema";

export const VERTICALS: { value: string; label: string }[] = [
  { value: "PROFESSIONAL", label: "Professional services (most cleaning companies)" },
  { value: "REAL_ESTATE", label: "Real estate and property services" },
  { value: "HOSPITALITY", label: "Hospitality" },
  { value: "CONSTRUCTION", label: "Construction" },
  { value: "RETAIL", label: "Retail" },
];

export const ENTITY_WORDS: Record<EntityType, { label: string; hint: string }> = {
  PRIVATE_PROFIT: { label: "Company with an EIN", hint: "LLC, corporation or partnership" },
  NON_PROFIT: { label: "Non-profit", hint: "Tax-exempt organization with an EIN" },
  PUBLIC_PROFIT: { label: "Publicly traded company", hint: "Listed on a stock exchange" },
  SOLE_PROPRIETOR: { label: "Sole proprietor, no EIN", hint: "You run the business under your own name" },
};

export type Problem = { field: BusinessField | "taxId"; words: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOLE_WORDS = /\b(llc|l\.l\.c|inc|incorporated|ltd|limited|corp|corporation|company|llp)\b\.?/i;

export const needsTaxId = (entityType: string | undefined) => entityType === "PRIVATE_PROFIT" || entityType === "NON_PROFIT" || entityType === "PUBLIC_PROFIT";

/** A US number in international form, or null. */
export function usPhone(value: string | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten) ? `+1${ten}` : null;
}

export function businessProblems(b: Business, hasTaxId: boolean): Problem[] {
  const out: Problem[] = [];
  const need = (field: Problem["field"], ok: boolean, words: string) => {
    if (!ok) out.push({ field, words });
  };
  const entity = b.entityType as EntityType | undefined;
  need("entityType", !!entity && entity in ENTITY_WORDS, "Choose what kind of business this is.");
  need("displayName", !!b.displayName && b.displayName.length <= 100, "Enter the name customers know you by (up to 100 characters).");
  if (entity === "SOLE_PROPRIETOR") {
    need("displayName", !SOLE_WORDS.test(b.displayName ?? ""), "A sole proprietor's name can't include LLC, Inc, Ltd, Corp, Company or LLP. Use the name you trade under.");
    need("contactFirstName", !!b.contactFirstName, "Enter your first name, as the owner.");
    need("contactLastName", !!b.contactLastName, "Enter your last name, as the owner.");
    need("mobilePhone", !!usPhone(b.mobilePhone), "Enter your own US mobile number. The carriers text it a one-time code to confirm it's you.");
  } else {
    need("legalName", !!b.legalName && b.legalName.length <= 100, "Enter the legal name exactly as it appears on your IRS records.");
    need("taxId", hasTaxId, "Enter your 9-digit EIN.");
  }
  if (entity === "PUBLIC_PROFIT") {
    need("stockSymbol", !!b.stockSymbol, "Enter the stock symbol.");
    need("stockExchange", !!b.stockExchange, "Choose the stock exchange.");
    need("contactEmail", !!b.contactEmail && EMAIL.test(b.contactEmail), "Enter a business contact email.");
  }
  need("vertical", VERTICALS.some((row) => row.value === b.vertical), "Choose the kind of business that fits best.");
  if (entity !== "SOLE_PROPRIETOR" || b.website) {
    need("website", !!b.website && /^https?:\/\/[^\s.]+\.[^\s]+$/.test(b.website) && b.website.length <= 100, "Enter your website's full address, for example https://example.com.");
  }
  need("supportEmail", !!b.supportEmail && EMAIL.test(b.supportEmail), "Enter the email customers can write to for help.");
  need("supportPhone", !!usPhone(b.supportPhone), "Enter a US phone number customers can call for help.");
  need("street", !!b.street, "Enter the street address on your registration records.");
  need("city", !!b.city, "Enter the city.");
  need("state", /^[A-Z]{2}$/.test(b.state ?? ""), "Enter the two-letter state, for example TX.");
  need("postalCode", /^\d{5}$/.test(b.postalCode ?? ""), "Enter the five-digit ZIP code.");
  return out;
}

export function activityProblems(keys: readonly string[], entityType: string | undefined): string[] {
  const rows = chosen(keys);
  const out: string[] = [];
  if (rows.length === 0) out.push("Choose at least one kind of text you'll send.");
  if (entityType === "SOLE_PROPRIETOR" && rows.some((row) => row.category === "marketing")) {
    // A sole proprietor campaign is one use case; Telnyx's guide lists no marketing allowance for it.
    out.push("A sole proprietor registration can't include promotions. Leave Promotions off, or register with an EIN.");
  }
  return out;
}

export type DraftState = { key: DraftKey; gaps: string[] };

export function draftProblems(drafts: Record<string, { text: string }>, input: Pick<DraftInput, "name" | "activities">): DraftState[] {
  const marketing = chosen(input.activities).some((row) => row.category === "marketing");
  return DRAFT_KEYS.filter((key) => key !== "marketing_consent" || marketing).map((key) => ({ key, gaps: drafts[key] ? draftGaps(key, drafts[key].text, input) : ["write it"] }));
}

/** Where permission is collected, and whether Selestial actually records it there. */
export type PlaceState = { place: string; state: "records" | "not_yet" | "described"; words: string };
