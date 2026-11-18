/**
 * What Sales needs to know before it can quote or book, worked out from the service itself, and what is
 * already known. Nothing is asked that the price, the scope or the schedule does not depend on, and
 * nothing already answered is asked again.
 *
 * The questions come from the published service: its pricing method says whether size, rooms or units
 * matter; its condition levels, recurring options and quoting questions add theirs. A model never
 * decides what is required.
 */
import type { QuoteInput } from "../services/engine";
import { SCHEDULES, type Schedule, type Spec } from "../services/spec";
import { areaWord, scheduleLabel } from "../services/words";
import type { Fact, ServiceKind } from "./agentSchema";

export type Requirement = {
  key: string;
  /** For the owner's checklist. */
  label: string;
  /** How Sales asks the customer. */
  ask: string;
  type: "number" | "choice" | "yes_no" | "text";
  options?: { value: string; label: string }[];
  /** What the answer changes. */
  why: "price" | "area" | "scope" | "schedule";
  /** quote: needed before a price can be given. booking: needed before a time can be confirmed. */
  phase: "quote" | "booking";
};

export const ONE_TIME = "one_time";

export function factOf(facts: Fact[], key: string): Fact | undefined {
  return facts.find((fact) => fact.key === key);
}

export function known(facts: Fact[], key: string): boolean {
  const fact = factOf(facts, key);
  // An unverified value (an import, an old record) is shown but never relied on.
  return fact !== undefined && fact.status !== "unverified" && fact.value !== "";
}

/**
 * Adds or replaces one fact. What a person at the company recorded is not overwritten by a reading of a
 * message: the two are shown side by side and a person says which is right. A customer correcting what
 * they themselves said earlier (on the form, or in an earlier message) simply updates it.
 */
export function withFact(facts: Fact[], next: Fact): { facts: Fact[]; changed: boolean; conflict: Fact | null } {
  const current = factOf(facts, next.key);
  if (current && current.value === next.value && (current.status === next.status || current.status === "confirmed")) return { facts, changed: false, conflict: null };
  if (current && current.source.kind === "member" && next.source.kind !== "member" && current.value !== next.value) return { facts, changed: false, conflict: current };
  return { facts: [...facts.filter((fact) => fact.key !== next.key), next].slice(-60), changed: true, conflict: current && current.value !== next.value ? current : null };
}

const kindOf = (spec: Spec): ServiceKind => (spec.category === "commercial" || spec.category === "post_construction" ? "commercial" : spec.category === "short_term_rental" || spec.category === "property_management" ? "short_term_rental" : "residential");
export { kindOf as kindOfService };

/**
 * Everything this service needs answered, in the order Sales asks it. With no service chosen yet, only
 * which service is wanted and where.
 */
export function requirementsFor(spec: Spec | null, kind: ServiceKind): Requirement[] {
  const out: Requirement[] = [];
  out.push({ key: "postalCode", label: "Postal code", ask: "What is the ZIP or postal code of the property?", type: "text", why: "area", phase: "quote" });
  if (!spec) return out;
  const p = spec.pricing;
  if (p.method === "size_bands" || p.method === "per_area") {
    out.push({ key: "area", label: `Size (${areaWord(p.unit)})`, ask: `About how many ${areaWord(p.unit)} is the ${kind === "commercial" ? "space" : "home"}?`, type: "number", why: "price", phase: "quote" });
  }
  if (p.method === "bed_bath") {
    out.push({ key: "bedrooms", label: "Bedrooms", ask: "How many bedrooms?", type: "number", why: "price", phase: "quote" });
    out.push({ key: "bathrooms", label: "Bathrooms", ask: "How many bathrooms (count a half bath as .5)?", type: "number", why: "price", phase: "quote" });
  }
  if (p.method === "per_unit") {
    out.push({ key: "units", label: `Number of ${p.unitWord}s`, ask: `How many ${p.unitWord}s?`, type: "number", why: "price", phase: "quote" });
  }
  if (spec.str?.enabled) out.push({ key: "beds", label: "Beds to make", ask: "How many beds need to be made up at each turnover?", type: "number", why: "price", phase: "quote" });
  const levels = spec.modifiers.condition.enabled ? spec.modifiers.condition.levels : [];
  if (levels.length > 1) {
    out.push({ key: "condition", label: "Condition", ask: `How would you describe its current condition: ${levels.map((level) => level.label.toLowerCase()).join(", ")}?`, type: "choice", options: levels.map((level) => ({ value: level.id, label: level.label })), why: "price", phase: "quote" });
  }
  const recurring = spec.modifiers.recurring.enabled ? spec.modifiers.recurring.options : [];
  if (recurring.length > 0 && p.method !== "recurring_package") {
    const options = [{ value: ONE_TIME, label: "One time" }, ...recurring.map((option) => ({ value: option.schedule as string, label: scheduleLabel(option.schedule) }))];
    out.push({ key: "schedule", label: "How often", ask: `Is this a one-time ${spec.visitWord}, or would you like it ${recurring.map((option) => scheduleLabel(option.schedule).toLowerCase()).join(" or ")}?`, type: "choice", options, why: "price", phase: "quote" });
  }
  for (const question of spec.questions) {
    if (!question.required) continue;
    out.push({
      key: `answer:${question.id}`,
      label: question.label,
      ask: question.label.endsWith("?") ? question.label : `${question.label}?`,
      type: question.kind === "number" ? "number" : question.kind === "yes_no" ? "yes_no" : question.kind === "choice" ? "choice" : "text",
      options: question.kind === "choice" ? question.options.map((option) => ({ value: option, label: option })) : undefined,
      why: "price",
      phase: "quote",
    });
  }
  // Booking needs a place and a time; a commercial or rental job also needs to know when the space is free.
  out.push({ key: "timing", label: "Preferred timing", ask: kind === "short_term_rental" ? "When is the next checkout, and when does the next guest arrive?" : "When would you like the service?", type: "text", why: "schedule", phase: "booking" });
  if (kind === "commercial") out.push({ key: "operatingHours", label: "When the space can be cleaned", ask: "When can the space be cleaned: after hours, weekends, or during the day?", type: "text", why: "schedule", phase: "booking" });
  out.push({ key: "access", label: "Access", ask: "How will our team get in (someone home, a key, a code)?", type: "text", why: "scope", phase: "booking" });
  return out;
}

export function missingFor(requirements: Requirement[], facts: Fact[], phase: "quote" | "booking"): Requirement[] {
  return requirements.filter((requirement) => (phase === "booking" || requirement.phase === "quote") && !known(facts, requirement.key));
}

const num = (facts: Fact[], key: string): number | undefined => {
  const fact = factOf(facts, key);
  return fact && fact.status !== "unverified" && typeof fact.value === "number" && Number.isFinite(fact.value) ? fact.value : undefined;
};

/** The pricing inputs the known facts give. Only facts go in: nothing is assumed here, and the engine says what is still missing. */
export function quoteInputFrom(spec: Spec, facts: Fact[], options: { firstVisit: boolean }): QuoteInput {
  const input: QuoteInput = {};
  const area = num(facts, "area");
  if (area !== undefined) input.area = area;
  const bedrooms = num(facts, "bedrooms");
  if (bedrooms !== undefined) input.bedrooms = bedrooms;
  const bathrooms = num(facts, "bathrooms");
  if (bathrooms !== undefined) {
    input.bathrooms = Math.floor(bathrooms);
    if (bathrooms % 1 !== 0) input.halfBaths = 1;
  }
  const halfBaths = num(facts, "halfBaths");
  if (halfBaths !== undefined) input.halfBaths = halfBaths;
  const units = num(facts, "units");
  if (units !== undefined) input.units = units;
  const beds = num(facts, "beds");
  if (beds !== undefined) input.beds = beds;
  const condition = factOf(facts, "condition");
  if (condition && typeof condition.value === "string" && known(facts, "condition")) input.condition = condition.value;
  const schedule = factOf(facts, "schedule");
  if (schedule && known(facts, "schedule") && (SCHEDULES as readonly string[]).includes(String(schedule.value))) input.schedule = schedule.value as Schedule;
  const postal = factOf(facts, "postalCode");
  if (postal && known(facts, "postalCode")) input.postalCode = String(postal.value);
  if (spec.modifiers.firstClean.enabled) input.firstVisit = options.firstVisit;
  const answers: Record<string, string | number | boolean> = {};
  for (const fact of facts) if (fact.key.startsWith("answer:") && fact.status !== "unverified") answers[fact.key.slice(7)] = fact.value;
  if (Object.keys(answers).length > 0) input.answers = answers;
  const addOns = facts.filter((fact) => fact.key.startsWith("addOn:") && fact.status !== "unverified" && typeof fact.value === "number" && fact.value > 0).map((fact) => ({ id: fact.key.slice(6), quantity: fact.value as number }));
  if (addOns.length > 0) input.addOns = addOns.filter((chosen) => spec.addOns.some((addOn) => addOn.id === chosen.id));
  return input;
}

/** A fact's value as a person reads it. */
export function factWords(fact: Fact, requirements: Requirement[]): string {
  const requirement = requirements.find((row) => row.key === fact.key);
  const option = requirement?.options?.find((row) => row.value === fact.value);
  if (option) return option.label;
  if (typeof fact.value === "boolean") return fact.value ? "Yes" : "No";
  return String(fact.value);
}

export const FACT_LABELS: Record<string, string> = {
  postalCode: "Postal code",
  area: "Size",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  halfBaths: "Half baths",
  units: "Units",
  beds: "Beds to make",
  condition: "Condition",
  schedule: "How often",
  timing: "Preferred timing",
  access: "Access",
  address: "Service address",
  pets: "Pets",
  operatingHours: "When the space can be cleaned",
  facilityType: "Type of facility",
};
