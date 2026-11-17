/**
 * Services & Pricing, as the screens know it: its routes, its tabs, the builder's steps, and small helpers
 * for reading money people type. The record and every rule live in convex/lib/services.
 */

export const SERVICES_ROOT = "/app/services";

export const SERVICES_TABS = [
  { id: "services", label: "Services", href: SERVICES_ROOT },
  { id: "studio", label: "Pricing Studio", href: `${SERVICES_ROOT}/studio` },
  { id: "research", label: "Research & Insights", href: `${SERVICES_ROOT}/research` },
  { id: "changes", label: "Changes", href: `${SERVICES_ROOT}/changes` },
] as const;

export const servicePath = (serviceId: string) => `${SERVICES_ROOT}/${serviceId}`;
export const changePath = (changeId: string) => `${SERVICES_ROOT}/changes/${changeId}`;
export const briefPath = (briefId: string) => `${SERVICES_ROOT}/research/${briefId}`;
export const importPath = (importId: string) => `${SERVICES_ROOT}/imports/${importId}`;

/** The guided builder, in order. Each step is a short page, never a giant form. */
export const BUILDER_STEPS = [
  { id: "basics", label: "Basics", blurb: "Name, kind of work and what the customer reads." },
  { id: "scope", label: "Scope", blurb: "What is included, what is not, and the crew's checklist." },
  { id: "pricing", label: "Pricing", blurb: "How it is priced, with the unit beside every amount." },
  { id: "team", label: "Time & Team", blurb: "Crew, time, skills and when a walkthrough is needed." },
  { id: "extras", label: "Extras", blurb: "Add-ons, recurring discounts and adjustments." },
  { id: "review", label: "Review", blurb: "Check it, confirm it, and send it for review." },
] as const;
export type BuilderStep = (typeof BUILDER_STEPS)[number]["id"];

export function stepOf(value: string | null | undefined): BuilderStep {
  return (BUILDER_STEPS.find((step) => step.id === value)?.id ?? "basics") as BuilderStep;
}

/** "12.50", "$1,200" or "120" to cents, or null when it is not an amount. */
export function centsFrom(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** A rate per square foot or meter, to millicents: "0.085" is 8500. */
export function millicentsFrom(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,5})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100_000 + Number(fraction.padEnd(5, "0"));
}

export const dollarsText = (cents: number) => (cents / 100).toFixed(2);
export const rateText = (millicents: number) => (millicents / 100_000).toFixed(5).replace(/0{1,3}$/, "");

/** A short id for a new list item: unique within the list it joins. */
export function newId(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const stem = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "item";
  let id = stem;
  for (let i = 2; used.has(id); i += 1) id = `${stem}-${i}`;
  return id;
}

export const CHANGE_STATE_WORDS: Record<string, { label: string; tone: "info" | "warning" | "success" | "outline" | "error" }> = {
  in_review: { label: "In review", tone: "info" },
  approved: { label: "Approved", tone: "success" },
  scheduled: { label: "Scheduled", tone: "info" },
  published: { label: "Published", tone: "success" },
  returned: { label: "Returned to draft", tone: "warning" },
  withdrawn: { label: "Withdrawn", tone: "outline" },
  superseded: { label: "Replaced", tone: "outline" },
};
