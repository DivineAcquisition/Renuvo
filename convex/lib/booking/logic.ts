/**
 * The booking flow's rules, as pure functions shared by the server, the public page and the builder's
 * preview. No clock, no database, no randomness: the same facts give the same answer everywhere.
 *
 *  - Size cards are derived from the offered services' published pricing, so a card always means a
 *    price the engine can give. A label is the owner's; the numbers behind it are never.
 *  - A quote input is built from the session's facts. The price itself always comes from the one
 *    pricing engine (convex/lib/services/engine.ts).
 *  - The steps a session has are worked out from the mode, the services and the facts, so progress
 *    ("02/05") always counts the steps this customer will actually see.
 *  - Confirmation checks every requirement separately and says what is missing.
 */
import { quote as runQuote, type Quote, type QuoteInput } from "../services/engine";
import type { Schedule, Spec } from "../services/spec";
import { conditionHolds, STEP_LABELS, type BookingMode, type CustomQuestion, type Definition, type StepId } from "./definition";
import { dueNow } from "./settings";
import type { PaymentPolicy } from "./schema";

// ── Sizes ───────────────────────────────────────────────────────────────────────────────────────────

export type HomeFacts = { sizeKey?: string; area?: number; bedrooms?: number; bathrooms?: number; halfBaths?: number; units?: number; beds?: number };

export type SizeCard = { key: string; label: string; sublabel: string; facts: HomeFacts; customQuote: boolean };

export type SizePlan = {
  /** "cards": illustrated cards. "area": an exact size is asked. "rooms": bedrooms and bathrooms. "none": no size is needed. */
  area: { kind: "cards"; unit: "sq_ft" | "sq_m"; cards: SizeCard[]; customQuoteFrom: number | null } | { kind: "input"; unit: "sq_ft" | "sq_m" } | null;
  rooms: boolean;
  beds: boolean;
  /** Something must be asked on the size step. */
  needed: boolean;
};

const fmt = (n: number) => n.toLocaleString("en-US");
const unitWord = (unit: "sq_ft" | "sq_m") => (unit === "sq_ft" ? "sq ft" : "m²");

/**
 * The size step for a set of published services. Cards are the union of every size-band boundary, so any
 * card falls inside exactly one band of every service and prices exactly. A service that prices per
 * square foot needs the real number, so then the size is typed instead.
 */
export function sizePlan(specs: Spec[], labels: Definition["sizes"]["labels"], customQuoteAboveArea: number | null): SizePlan {
  const banded = specs.filter((s) => s.pricing.method === "size_bands") as (Spec & { pricing: Extract<Spec["pricing"], { method: "size_bands" } > })[];
  const perArea = specs.some((s) => s.pricing.method === "per_area");
  const rooms = specs.some((s) => s.pricing.method === "bed_bath");
  const beds = specs.some((s) => s.str?.enabled === true);
  let area: SizePlan["area"] = null;
  const unit = (banded[0]?.pricing.unit ?? (specs.find((s) => s.pricing.method === "per_area")?.pricing as { unit?: "sq_ft" | "sq_m" } | undefined)?.unit) ?? "sq_ft";
  if (perArea || (banded.length && banded.some((s) => s.pricing.unit !== unit))) {
    area = { kind: "input", unit };
  } else if (banded.length) {
    const points = new Set<number>();
    let top: number | null = null;
    for (const s of banded) {
      let serviceTop = 0;
      for (const band of s.pricing.bands) {
        points.add(band.from);
        if (band.to !== null) points.add(band.to);
        serviceTop = band.to === null ? Infinity : Math.max(serviceTop, band.to);
      }
      if (serviceTop !== Infinity) top = top === null ? serviceTop : Math.min(top, serviceTop);
    }
    const limit = customQuoteAboveArea !== null ? (top === null ? customQuoteAboveArea : Math.min(top, customQuoteAboveArea)) : top;
    const sorted = [...points].filter((p) => limit === null || p < limit).sort((a, b) => a - b);
    const cards: SizeCard[] = [];
    for (let i = 0; i < sorted.length; i += 1) {
      const from = sorted[i];
      const to = i + 1 < sorted.length ? sorted[i + 1] : limit;
      const key = `area-${from}-${to ?? "up"}`;
      const own = labels.find((l) => l.key === key);
      const label = from === 0 && to !== null ? `Under ${fmt(to)} ${unitWord(unit)}` : to === null ? `${fmt(from)}+ ${unitWord(unit)}` : `${fmt(from)}–${fmt(to - 1)} ${unitWord(unit)}`;
      cards.push({ key, label: own?.label || label, sublabel: own?.sublabel ?? "", facts: { sizeKey: key, area: Math.max(from, 1) }, customQuote: false });
    }
    if (limit !== null) {
      const key = `area-${limit}-custom`;
      const own = labels.find((l) => l.key === key);
      cards.push({ key, label: own?.label || `${fmt(limit)}+ ${unitWord(unit)}`, sublabel: own?.sublabel ?? "", facts: { sizeKey: key, area: limit }, customQuote: true });
    }
    area = { kind: "cards", unit, cards: cards.filter((c) => !c.customQuote), customQuoteFrom: limit };
  }
  return { area, rooms, beds, needed: Boolean(area) || rooms || beds };
}

/** The room counts a bedroom card offers. Bathrooms are chosen beside them. */
export const BEDROOM_CHOICES = [1, 2, 3, 4, 5, 6] as const;
export const BATHROOM_CHOICES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5] as const;

export function bathroomFacts(value: number): Pick<HomeFacts, "bathrooms" | "halfBaths"> {
  const full = Math.floor(value);
  return { bathrooms: full, halfBaths: value - full >= 0.5 ? 1 : 0 };
}

/** Whether the size facts answer everything the plan asks. */
export function sizeComplete(plan: SizePlan, home: HomeFacts): boolean {
  if (plan.area && home.area === undefined) return false;
  if (plan.rooms && (home.bedrooms === undefined || home.bathrooms === undefined)) return false;
  if (plan.beds && home.beds === undefined) return false;
  return true;
}

/** True when the chosen size is past what can be priced online: the request flow takes over. */
export function sizeNeedsRequest(plan: SizePlan, home: HomeFacts, customQuoteAboveArea: number | null): boolean {
  if (home.area === undefined) return false;
  if (customQuoteAboveArea !== null && home.area >= customQuoteAboveArea) return true;
  if (plan.area?.kind === "cards" && plan.area.customQuoteFrom !== null && home.area >= plan.area.customQuoteFrom) return true;
  return false;
}

// ── Quotes ──────────────────────────────────────────────────────────────────────────────────────────

export type Selection = { serviceKey: string; condition?: string; schedule?: string; units?: number; addOns: { id: string; quantity: number }[]; answers: Record<string, string | number | boolean> };

/** The engine's input for one service, from what the session knows. Only facts the customer gave, and the date once chosen. */
export function quoteInputFor(spec: Spec, facts: { home: HomeFacts; selection: Selection | null; postalCode?: string; date?: string; promotionId?: string | null }): QuoteInput {
  const input: QuoteInput = {};
  const home = facts.home;
  if (home.area !== undefined && (spec.pricing.method === "size_bands" || spec.pricing.method === "per_area")) input.area = home.area;
  if (spec.pricing.method === "bed_bath") {
    if (home.bedrooms !== undefined) input.bedrooms = home.bedrooms;
    if (home.bathrooms !== undefined) input.bathrooms = home.bathrooms;
    if (home.halfBaths !== undefined) input.halfBaths = home.halfBaths;
  }
  if (spec.str?.enabled && home.beds !== undefined) input.beds = home.beds;
  const sel = facts.selection && facts.selection.serviceKey ? facts.selection : null;
  if (spec.pricing.method === "per_unit" && sel?.units !== undefined) input.units = sel.units;
  if (sel) {
    // An unstated condition would make the engine call the price an estimate. The first level is shown as
    // chosen on the card, and the customer can change it, so it is a stated answer rather than an assumption.
    if (spec.modifiers.condition.enabled && spec.modifiers.condition.levels.length) input.condition = sel.condition ?? spec.modifiers.condition.levels[0].id;
    if (sel.schedule && spec.modifiers.recurring.enabled && spec.modifiers.recurring.options.some((o) => o.schedule === sel.schedule)) input.schedule = sel.schedule as Schedule;
    const addOns = sel.addOns.filter((a) => a.quantity > 0 && spec.addOns.some((x) => x.id === a.id));
    if (addOns.length) input.addOns = addOns.map((a) => ({ id: a.id, quantity: Math.min(a.quantity, spec.addOns.find((x) => x.id === a.id)!.maxQuantity) }));
    const answers: Record<string, string | number | boolean> = {};
    for (const q of spec.questions) if (sel.answers[q.id] !== undefined) answers[q.id] = sel.answers[q.id];
    if (Object.keys(answers).length) input.answers = answers;
  }
  if (spec.modifiers.firstClean.enabled) input.firstVisit = true;
  if (facts.postalCode) input.postalCode = facts.postalCode;
  if (facts.date) input.date = facts.date;
  if (facts.promotionId && spec.modifiers.promotions.some((p) => p.id === facts.promotionId)) input.promotionId = facts.promotionId;
  return input;
}

/** Whether a promotion is one the engine will apply on that date: approved and inside its dates. */
export function promotionUsable(spec: Spec, promotionId: string | null, date: string | undefined): { ok: boolean; why: string | null } {
  if (!promotionId) return { ok: true, why: null };
  const promo = spec.modifiers.promotions.find((p) => p.id === promotionId);
  if (!promo) return { ok: false, why: "That offer isn't available for this service." };
  if (!promo.approved) return { ok: false, why: "That offer hasn't been approved yet." };
  if (date && ((promo.startsOn && date < promo.startsOn) || (promo.endsOn && date > promo.endsOn))) return { ok: false, why: "That offer isn't valid on the chosen date." };
  return { ok: true, why: null };
}

export type Priced = {
  quote: Quote;
  taxCents: number;
  grandTotalCents: number | null;
  dueNowCents: number;
  balanceCents: number;
};

/** The engine's quote, plus tax and the payment split. The total is the sum of the lines, then tax. */
export function price(spec: Spec, input: QuoteInput, money: { taxRateBps: number; taxable: boolean; policy: Pick<PaymentPolicy, "kind" | "percent" | "cents"> | null }): Priced {
  const quote = runQuote(spec, input);
  if (quote.totalCents === null) return { quote, taxCents: 0, grandTotalCents: null, dueNowCents: 0, balanceCents: 0 };
  const taxCents = money.taxable && money.taxRateBps > 0 ? Math.round((quote.totalCents * money.taxRateBps) / 10_000) : 0;
  const grand = quote.totalCents + taxCents;
  const now = quote.outcome === "firm" ? dueNow(money.policy, grand) : 0;
  return { quote, taxCents, grandTotalCents: grand, dueNowCents: now, balanceCents: grand - now };
}

/** Whether the service can be booked instantly at all. Recurring packages and visit plans need billing that doesn't exist yet. */
export function instantBlocker(spec: Spec, selection: Selection | null): string | null {
  if (spec.pricing.method === "recurring_package") return "Monthly plans are requested online and set up by the team, because recurring billing isn't connected yet.";
  if (selection?.schedule) return "A recurring schedule is requested online and set up by the team, because recurring visits and billing aren't connected yet.";
  if (spec.pricing.method === "custom_quote") return "This service is priced after a walkthrough.";
  return null;
}

// ── The flow ────────────────────────────────────────────────────────────────────────────────────────

export type FlowFacts = {
  mode: BookingMode;
  /** The size step has something to ask. */
  sizeNeeded: boolean;
  /** The visitor is outside the company's areas. */
  outOfArea: boolean;
  /** The session became a request (size too large, walkthrough, recurring): no payment, no reserved time. */
  request: boolean;
  /** Payment is required for this booking. */
  pays: boolean;
};

/**
 * The steps this session will actually show, in the experience's order. Fixes the reference's
 * inconsistent counts: progress is always this list's position and length.
 */
export function stepsFor(def: Definition, facts: FlowFacts): StepId[] {
  const out: StepId[] = [];
  for (const step of def.steps) {
    if (step.id === "size" && !facts.sizeNeeded) continue;
    if (facts.outOfArea && step.id !== "location") continue;
    out.push(step.id);
  }
  return out;
}

export function progress(steps: StepId[], current: StepId): { index: number; total: number; label: string; percent: number } {
  const index = Math.max(0, steps.indexOf(current)) + 1;
  return { index, total: steps.length, label: STEP_LABELS[current], percent: Math.round((index / steps.length) * 100) };
}

/** The experience's own questions that apply now, given earlier answers and the chosen service. */
export function visibleQuestions(questions: CustomQuestion[], facts: { answers: Record<string, unknown>; serviceKey: string | null; mode: BookingMode }): CustomQuestion[] {
  return questions.filter((q) => conditionHolds(q.showIf, facts));
}

// ── Confirmation ────────────────────────────────────────────────────────────────────────────────────

export type ConfirmationFacts = {
  request: boolean;
  answersComplete: boolean;
  quote: { outcome: string; grandTotalCents: number | null; inputHash: string } | null;
  accepted: { inputHash: string; grandTotalCents: number } | null;
  agreementRequired: boolean;
  agreementAccepted: boolean;
  paymentRequired: boolean;
  /** Verified by the payment provider, never by a page. */
  paymentSucceeded: boolean;
  /** Money was received, but not for this booking as it now stands (a different price, or it became a request). */
  paymentMismatch?: boolean;
  capacity: "none" | "held" | "expired" | "committed" | "requested" | "unavailable";
  /** The company can take this booking: still publishing, still serving the area, not suspended. */
  eligible: boolean;
  eligibilityWhy?: string;
};

export type Gate = { ready: boolean; blockers: string[] };

/**
 * Every requirement, checked on its own. Each failure says what is missing in words a customer or the
 * office can act on. Paid does not mean confirmed; held does not mean committed.
 */
export function confirmationGate(f: ConfirmationFacts): Gate {
  const blockers: string[] = [];
  if (!f.eligible) blockers.push(f.eligibilityWhy ?? "The company isn't taking online bookings right now.");
  if (!f.answersComplete) blockers.push("Some required details are missing.");
  if (!f.request) {
    if (!f.quote || f.quote.outcome !== "firm" || f.quote.grandTotalCents === null) blockers.push("There is no firm price for this booking.");
    else if (!f.accepted || f.accepted.inputHash !== f.quote.inputHash || f.accepted.grandTotalCents !== f.quote.grandTotalCents) blockers.push("The price changed and needs to be accepted again.");
    if (f.capacity !== "held" && f.capacity !== "committed") blockers.push(f.capacity === "expired" ? "The reserved time expired." : f.capacity === "unavailable" ? "The chosen time is no longer available." : "No time is reserved.");
  }
  if (f.agreementRequired && !f.agreementAccepted) blockers.push("The service agreement hasn't been signed.");
  if (f.paymentMismatch) blockers.push("The payment received doesn't match this booking as it now stands.");
  else if (!f.request && f.paymentRequired && !f.paymentSucceeded) blockers.push("The payment hasn't been received.");
  return { ready: blockers.length === 0, blockers };
}
