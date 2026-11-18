/**
 * The company facts setup can hold, and their choices. Shared by the functions and the screens, so a
 * choice is worded once. A fact is something no other module owns; anything with a home lives there.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

export type Choice = { value: string; label: string; hint?: string };

export const CATEGORY_CHOICES: Choice[] = [
  { value: "residential", label: "Homes", hint: "Standard, deep and move-in or move-out cleans" },
  { value: "commercial", label: "Offices and businesses", hint: "Offices, retail, shared areas" },
  { value: "short_term_rental", label: "Short-term rentals", hint: "Turnovers between guests" },
  { value: "property_management", label: "Property managers", hint: "Vacant units and buildings" },
  { value: "post_construction", label: "Post-construction", hint: "Rough, final and touch-up cleans" },
  { value: "specialty", label: "Specialty", hint: "Windows, carpets, floors, events" },
];

export const WORKFORCE_CHOICES: Choice[] = [
  { value: "employees", label: "Employees", hint: "On your payroll" },
  { value: "contractors", label: "Independent contractors", hint: "Paid per job or by share" },
  { value: "subcontractors", label: "Subcontractor companies", hint: "Other companies supply the cleaners" },
  { value: "solo", label: "Just me for now", hint: "You do the cleaning yourself" },
];

export const SCALE_CHOICES: Choice[] = [
  { value: "1", label: "Just me" },
  { value: "2-5", label: "2 to 5" },
  { value: "6-15", label: "6 to 15" },
  { value: "16-40", label: "16 to 40" },
  { value: "41+", label: "More than 40" },
];

export const TOOL_CHOICES: Choice[] = [
  { value: "spreadsheets", label: "Spreadsheets" },
  { value: "paper", label: "Paper or a whiteboard" },
  { value: "calendar", label: "A shared calendar" },
  { value: "scheduling_software", label: "Scheduling software" },
  { value: "accounting", label: "Accounting software" },
  { value: "texts_calls", label: "Texts and calls" },
];

/** Every fact key setup writes, with the words shown beside it and whether it holds several values. */
export const FACTS = {
  "company.website": { label: "Website", many: false },
  "company.location": { label: "Where you are based", many: false },
  "company.areas": { label: "Areas you serve", many: false },
  "services.categories": { label: "Who you clean for", many: true },
  "workforce.arrangement": { label: "How your cleaners work with you", many: true },
  "scale.cleaners": { label: "People who clean", many: false },
  "tools.current": { label: "What you use today", many: true },
  "tools.other": { label: "Other tools", many: false },
} as const;
export type FactKey = keyof typeof FACTS;
export const isFactKey = (key: string): key is FactKey => key in FACTS;

type Ctx = QueryCtx | MutationCtx;

export async function factsOf(ctx: Ctx, companyId: Id<"companies">): Promise<Doc<"companyFacts">[]> {
  return ctx.db
    .query("companyFacts")
    .withIndex("by_company_key", (q) => q.eq("companyId", companyId))
    .take(200);
}

const same = (a: string | string[], b: string | string[]) => JSON.stringify(a) === JSON.stringify(b);
const empty = (value: string | string[]) => (Array.isArray(value) ? value.length === 0 : value.trim() === "");

/**
 * The owner states a fact: it is confirmed, by them, now. An empty value removes it. Saying the same thing
 * again changes nothing, so a step saved twice is quiet.
 */
export async function stateFact(ctx: MutationCtx, companyId: Id<"companies">, memberId: Id<"members">, key: FactKey, value: string | string[]): Promise<void> {
  const row = await ctx.db
    .query("companyFacts")
    .withIndex("by_company_key", (q) => q.eq("companyId", companyId).eq("key", key))
    .first();
  if (empty(value)) {
    if (row) await ctx.db.delete(row._id);
    return;
  }
  const now = Date.now();
  if (!row) {
    await ctx.db.insert("companyFacts", { companyId, key, value, source: "owner", state: "confirmed", confirmedBy: memberId, confirmedAt: now, updatedAt: now });
    return;
  }
  if (same(row.value, value) && row.state === "confirmed") return;
  // Their word settles it: a value found elsewhere is replaced, and any conflict is closed.
  await ctx.db.patch(row._id, { value, source: same(row.value, value) ? row.source : "owner", state: "confirmed", confirmedBy: memberId, confirmedAt: now, conflict: undefined, updatedAt: now });
}

const labelOf = (choices: Choice[], value: string) => choices.find((choice) => choice.value === value)?.label ?? value;

/** Confirmed facts in words, for Chat and the agents. Found-but-unconfirmed facts are left out. */
export function factLines(rows: Doc<"companyFacts">[]): string[] {
  const confirmed = new Map(rows.filter((row) => row.state === "confirmed").map((row) => [row.key, row.value]));
  const one = (key: FactKey) => (typeof confirmed.get(key) === "string" ? (confirmed.get(key) as string) : "");
  const many = (key: FactKey) => (Array.isArray(confirmed.get(key)) ? (confirmed.get(key) as string[]) : []);
  const lines: string[] = [];
  if (one("company.location")) lines.push(`- Based in: ${one("company.location")}.`);
  if (one("company.areas")) lines.push(`- Serves: ${one("company.areas")}.`);
  if (many("services.categories").length) lines.push(`- Cleans for: ${many("services.categories").map((value) => labelOf(CATEGORY_CHOICES, value).toLowerCase()).join(", ")}.`);
  if (many("workforce.arrangement").length) lines.push(`- Cleaners work as: ${many("workforce.arrangement").map((value) => labelOf(WORKFORCE_CHOICES, value).toLowerCase()).join(", ")}.`);
  if (one("scale.cleaners")) lines.push(`- People who clean: ${labelOf(SCALE_CHOICES, one("scale.cleaners")).toLowerCase()}.`);
  const tools = [...many("tools.current").map((value) => labelOf(TOOL_CHOICES, value).toLowerCase()), one("tools.other")].filter(Boolean);
  if (tools.length) lines.push(`- Runs the business today on: ${tools.join(", ")}.`);
  if (one("company.website")) lines.push(`- Website: ${one("company.website")}.`);
  return lines;
}
