/**
 * What a service is, defined once. The same shape is a saved draft, an immutable version, a template and
 * the input to the pricing engine (engine.ts). Validators here are the source of the TypeScript types, so
 * the database, the engine and the screens can never disagree about a field.
 *
 * Money is whole cents. Percentages are numbers: 15 means 15%. A rate per square foot or square meter is
 * stored in millicents (thousandths of a cent), because $0.085 per square foot is not a whole cent.
 */
import { v } from "convex/values";

import { literals } from "../statuses";

// ── Lists ───────────────────────────────────────────────────────────────────────────────────────────

export const CATEGORIES = ["residential", "commercial", "short_term_rental", "property_management", "post_construction", "specialty"] as const;
export type Category = (typeof CATEGORIES)[number];
export const categoryValidator = literals(CATEGORIES);

/** Launch support (the owner's decision of November 16, 2026): homes, short-term rentals and commercial are fully supported; the rest are templates that default to a walkthrough. */
export const FULLY_SUPPORTED: readonly Category[] = ["residential", "short_term_rental", "commercial"];

export const CATEGORY_LABELS: Record<Category, string> = {
  residential: "Residential",
  commercial: "Commercial",
  short_term_rental: "Short-term rentals",
  property_management: "Property management",
  post_construction: "Post-construction",
  specialty: "Specialty",
};

export const AREA_UNITS = ["sq_ft", "sq_m"] as const;
export type AreaUnit = (typeof AREA_UNITS)[number];
export const areaUnitValidator = literals(AREA_UNITS);

/** How often a recurring visit happens. These are calendars, not "N visits a month". */
export const SCHEDULES = ["every_7_days", "every_14_days", "every_28_days", "twice_per_month", "once_per_month"] as const;
export type Schedule = (typeof SCHEDULES)[number];
export const scheduleValidator = literals(SCHEDULES);

/** What one price buys: a visit, a turnover or a job. Used in every label, so a price always says what it is for. */
export const VISIT_WORDS = ["visit", "turnover", "job"] as const;
export type VisitWord = (typeof VISIT_WORDS)[number];

export const PRICING_METHODS = ["fixed", "hourly_per_cleaner", "hourly_per_crew", "size_bands", "per_area", "bed_bath", "per_unit", "recurring_package", "custom_quote"] as const;
export type PricingMethod = (typeof PRICING_METHODS)[number];

export const METHOD_LABELS: Record<PricingMethod, { label: string; blurb: string }> = {
  fixed: { label: "Fixed price", blurb: "One price for the whole visit." },
  hourly_per_cleaner: { label: "Hourly, per cleaner", blurb: "Each cleaner's hours are charged. Two cleaners for two hours is four billed hours." },
  hourly_per_crew: { label: "Hourly, for the crew", blurb: "One rate per hour for the whole crew, however many people it is." },
  size_bands: { label: "Size bands", blurb: "A price for each range of property size." },
  per_area: { label: "Rate per area", blurb: "A rate per square foot or square meter." },
  bed_bath: { label: "Bedrooms and bathrooms", blurb: "A base price plus an amount for each bedroom and bathroom." },
  per_unit: { label: "Per unit", blurb: "A price per room, unit, load, window or turnover." },
  recurring_package: { label: "Recurring package", blurb: "A price per calendar month for a schedule of visits." },
  custom_quote: { label: "Custom quote", blurb: "Priced after a walkthrough. An optional starting price is shown as an estimate." },
};

// ── Pieces ──────────────────────────────────────────────────────────────────────────────────────────

/** A percentage of an amount, or a fixed number of cents. */
export const adjustmentValidator = v.object({ kind: v.union(v.literal("percent"), v.literal("fixed")), value: v.number() });
export type Adjustment = typeof adjustmentValidator.type;

export const scopeItemValidator = v.object({
  id: v.string(),
  label: v.string(),
  /** A room or area, for example "Kitchen". The team's checklist is grouped by it. */
  section: v.optional(v.string()),
  /** The crew must upload a photo of it before the visit is reported done. */
  requiresPhoto: v.boolean(),
});
export type ScopeItem = typeof scopeItemValidator.type;

export const addOnValidator = v.object({
  id: v.string(),
  label: v.string(),
  priceCents: v.number(),
  /** What one of `priceCents` buys. "item" uses `itemWord` ("oven", "window"). */
  per: v.union(v.literal("visit"), v.literal("item"), v.literal("hour")),
  itemWord: v.optional(v.string()),
  /** Labor-minutes one unit adds. */
  laborMinutes: v.number(),
  maxQuantity: v.number(),
  /**
   * The scope item this add-on is. When the service already includes that item, the add-on is never
   * charged: it is shown as included instead. This is how a service never charges twice for one task.
   */
  coversItemId: v.optional(v.string()),
});
export type AddOn = typeof addOnValidator.type;

export const sizeBandValidator = v.object({
  /** Inclusive lower bound. */
  from: v.number(),
  /** Exclusive upper bound. Null: no upper bound. */
  to: v.union(v.number(), v.null()),
  amountCents: v.number(),
  laborMinutes: v.number(),
});
export type SizeBand = typeof sizeBandValidator.type;

export const pricingValidator = v.union(
  v.object({ method: v.literal("fixed"), amountCents: v.number(), laborMinutes: v.number() }),
  v.object({
    method: v.literal("hourly_per_cleaner"),
    /** Charged for each cleaner's hour. */
    rateCents: v.number(),
    /** The least number of cleaner-hours billed for one visit. */
    minimumHours: v.number(),
    /** Billed time is rounded up to this many minutes. */
    incrementMinutes: v.number(),
    /** The usual labor-minutes for one visit, for estimates. */
    estimatedLaborMinutes: v.number(),
  }),
  v.object({
    method: v.literal("hourly_per_crew"),
    /** Charged for each hour on the clock, for the whole crew. */
    rateCents: v.number(),
    crewSize: v.number(),
    /** The least number of clock hours billed for one visit. */
    minimumHours: v.number(),
    incrementMinutes: v.number(),
    estimatedElapsedMinutes: v.number(),
  }),
  v.object({ method: v.literal("size_bands"), unit: areaUnitValidator, bands: v.array(sizeBandValidator) }),
  v.object({
    method: v.literal("per_area"),
    unit: areaUnitValidator,
    /** Thousandths of a cent per square foot or meter: 8500 is $0.085. */
    rateMillicents: v.number(),
    /** Labor-minutes for every 1,000 units of area. */
    laborMinutesPer1000: v.number(),
    /** Areas at or above this need a walkthrough. Null: no limit. */
    walkthroughAbove: v.union(v.number(), v.null()),
  }),
  v.object({
    method: v.literal("bed_bath"),
    baseCents: v.number(),
    includedBedrooms: v.number(),
    includedBathrooms: v.number(),
    perBedroomCents: v.number(),
    perBathroomCents: v.number(),
    perHalfBathCents: v.number(),
    baseLaborMinutes: v.number(),
    perBedroomMinutes: v.number(),
    perBathroomMinutes: v.number(),
    perHalfBathMinutes: v.number(),
  }),
  v.object({
    method: v.literal("per_unit"),
    /** One word, singular: "room", "unit", "load", "window", "turnover". */
    unitWord: v.string(),
    unitCents: v.number(),
    baseCents: v.number(),
    minimumUnits: v.number(),
    laborMinutesPerUnit: v.number(),
    baseLaborMinutes: v.number(),
  }),
  v.object({
    method: v.literal("recurring_package"),
    /** Charged once per calendar month, however many visits that month holds. */
    monthlyCents: v.number(),
    /**
     * "schedule": visits follow `schedule` (every 7 days is 4 or 5 a month). "included": a fixed number
     * of visits each calendar month, arranged with the customer.
     */
    basis: v.union(v.literal("schedule"), v.literal("included")),
    schedule: scheduleValidator,
    includedVisits: v.number(),
    /** A visit beyond the included ones. Null: not offered. */
    extraVisitCents: v.union(v.number(), v.null()),
    laborMinutesPerVisit: v.number(),
  }),
  v.object({
    method: v.literal("custom_quote"),
    /** An advertised starting price, always shown as "from" and never as a quote. Null: none shown. */
    fromCents: v.union(v.number(), v.null()),
    laborMinutes: v.union(v.number(), v.null()),
  }),
);
export type Pricing = typeof pricingValidator.type;

export const conditionLevelValidator = v.object({
  id: v.string(),
  label: v.string(),
  /** Price change, as a percent of the base price. Ignored for hourly methods: there the time changes, and the price with it. */
  pricePercent: v.number(),
  /** Time change, as a percent of the base time. */
  timePercent: v.number(),
  requiresWalkthrough: v.boolean(),
});
export type ConditionLevel = typeof conditionLevelValidator.type;

export const areaZoneValidator = v.object({ id: v.string(), label: v.string(), postalCodes: v.array(v.string()), adjustment: adjustmentValidator });
export type AreaZone = typeof areaZoneValidator.type;

export const promotionValidator = v.object({
  id: v.string(),
  label: v.string(),
  discount: adjustmentValidator,
  /** YYYY-MM-DD on the company's calendar, inclusive. */
  startsOn: v.union(v.string(), v.null()),
  endsOn: v.union(v.string(), v.null()),
  /** Only a promotion the Owner approved is ever applied. */
  approved: v.boolean(),
});
export type Promotion = typeof promotionValidator.type;

export const peakDayValidator = v.object({
  id: v.string(),
  label: v.string(),
  /** 0 is Sunday. Empty: any weekday inside the dates. */
  weekdays: v.array(v.number()),
  from: v.union(v.string(), v.null()),
  to: v.union(v.string(), v.null()),
  percent: v.number(),
});
export type PeakDay = typeof peakDayValidator.type;

export const modifiersValidator = v.object({
  condition: v.object({ enabled: v.boolean(), levels: v.array(conditionLevelValidator) }),
  firstClean: v.object({ enabled: v.boolean(), price: adjustmentValidator, timePercent: v.number() }),
  recurring: v.object({ enabled: v.boolean(), options: v.array(v.object({ schedule: scheduleValidator, discount: adjustmentValidator })) }),
  area: v.object({
    enabled: v.boolean(),
    zones: v.array(areaZoneValidator),
    /** A postal code in no zone: priced as standard, or refused. */
    outside: v.union(v.literal("standard"), v.literal("refuse")),
  }),
  rush: v.object({ enabled: v.boolean(), adjustment: adjustmentValidator }),
  afterHours: v.object({ enabled: v.boolean(), adjustment: adjustmentValidator }),
  /** The least a visit is charged. Null: no minimum. */
  minimumCents: v.union(v.number(), v.null()),
  promotions: v.array(promotionValidator),
  /**
   * "best_only": the recurring discount and a promotion never combine; the larger one applies.
   * "stack": the recurring discount first, then the promotion on what remains. Either way the total
   * discount never passes `maxTotalPercent` of the cleaning amount.
   */
  discounts: v.object({ stacking: v.union(v.literal("best_only"), v.literal("stack")), maxTotalPercent: v.number() }),
  /**
   * Off until the owner switches it on (the owner's decision of November 16, 2026). Two triggers: days
   * the owner marks, and how full the day already is. When both apply, the larger is used, never both.
   * Nothing about the customer is an input.
   */
  demand: v.object({
    enabled: v.boolean(),
    peakDays: v.array(peakDayValidator),
    busyDay: v.object({ enabled: v.boolean(), thresholdPercent: v.number(), percent: v.number() }),
    capPercent: v.number(),
    endsOn: v.union(v.string(), v.null()),
  }),
  /** Rounds the final price. 0: no rounding. */
  rounding: v.object({ stepCents: v.number(), mode: v.union(v.literal("nearest"), v.literal("up")) }),
});
export type Modifiers = typeof modifiersValidator.type;

export const questionValidator = v.object({
  id: v.string(),
  label: v.string(),
  kind: v.union(v.literal("number"), v.literal("choice"), v.literal("yes_no"), v.literal("text")),
  required: v.boolean(),
  options: v.array(v.string()),
  /** An answer that means a firm price is not possible without seeing the property. */
  walkthroughIf: v.union(v.null(), v.object({ equals: v.optional(v.string()), atLeast: v.optional(v.number()) })),
});
export type Question = typeof questionValidator.type;

export const restockItemValidator = v.object({
  id: v.string(),
  label: v.string(),
  perTurnover: v.number(),
  /** included: in the price. at_cost / cost_plus: billed after the visit, never part of the quote. guest_supplied: the host provides it. */
  rule: v.union(v.literal("included"), v.literal("at_cost"), v.literal("cost_plus"), v.literal("host_supplied")),
  markupPercent: v.number(),
});
export type RestockItem = typeof restockItemValidator.type;

export const strValidator = v.object({
  enabled: v.boolean(),
  linenSetsPerBed: v.number(),
  /** Linen sets one laundry load holds. */
  setsPerLoad: v.number(),
  laundry: v.object({
    location: v.union(v.literal("on_site"), v.literal("off_site"), v.literal("none")),
    /** Charged per load. 0: included. */
    loadCents: v.number(),
    /** Hands-on minutes per load (loading, folding). Machine time is not labor. */
    loadMinutes: v.number(),
    /** Loads the site's machines can finish in one turnover. */
    maxLoads: v.number(),
  }),
  restock: v.array(restockItemValidator),
  /** HH:MM on the company's clock. */
  checkoutTime: v.string(),
  checkinTime: v.string(),
  /** A deep clean every this many turnovers. Null: arranged separately. */
  deepCleanEveryTurnovers: v.union(v.number(), v.null()),
  /** Extra charges for excessive condition. Each is applied only after a person reviews the evidence. */
  conditionCharges: v.array(v.object({ id: v.string(), label: v.string(), amountCents: v.number() })),
});
export type Str = typeof strValidator.type;

export const specValidator = v.object({
  // Basics
  name: v.string(),
  category: categoryValidator,
  /** What a customer reads. */
  summary: v.string(),
  visitWord: literals(VISIT_WORDS),
  // Scope
  included: v.array(scopeItemValidator),
  excluded: v.array(v.string()),
  /** What the team needs that is not the scope: access, products, order of work. */
  teamNotes: v.string(),
  // Pricing
  pricing: pricingValidator,
  modifiers: modifiersValidator,
  // Time & team
  team: v.object({
    crewSize: v.number(),
    maxCrew: v.number(),
    /** The longest a visit should run on the clock. Longer gets a warning to add a cleaner or split the visit. */
    maxVisitMinutes: v.number(),
    skills: v.array(v.string()),
    arrivalWindowMinutes: v.number(),
  }),
  // Extras
  addOns: v.array(addOnValidator),
  // Quoting
  questions: v.array(questionValidator),
  /** Situations that always need a walkthrough, in words for the team. Machine rules are in questions and condition levels. */
  walkthroughNotes: v.array(v.string()),
  str: v.union(v.null(), strValidator),
  /** What the company must have confirmed it holds (training, insurance, equipment, certification) before the service is offered. */
  requirements: v.array(v.object({ id: v.string(), label: v.string(), confirmed: v.boolean() })),
  /**
   * True while any amount came from a template or an import and the owner has not confirmed it for their
   * market. A service cannot be published while it is true.
   */
  illustrative: v.boolean(),
});
export type Spec = typeof specValidator.type;

// ── Defaults ────────────────────────────────────────────────────────────────────────────────────────

export function defaultModifiers(): Modifiers {
  return {
    condition: {
      enabled: false,
      levels: [
        { id: "standard", label: "Maintained", pricePercent: 0, timePercent: 0, requiresWalkthrough: false },
        { id: "heavy", label: "Needs extra work", pricePercent: 25, timePercent: 25, requiresWalkthrough: false },
        { id: "severe", label: "Severe build-up", pricePercent: 0, timePercent: 0, requiresWalkthrough: true },
      ],
    },
    firstClean: { enabled: false, price: { kind: "percent", value: 0 }, timePercent: 0 },
    recurring: { enabled: false, options: [] },
    area: { enabled: false, zones: [], outside: "standard" },
    rush: { enabled: false, adjustment: { kind: "percent", value: 0 } },
    afterHours: { enabled: false, adjustment: { kind: "percent", value: 0 } },
    minimumCents: null,
    promotions: [],
    discounts: { stacking: "best_only", maxTotalPercent: 30 },
    demand: { enabled: false, peakDays: [], busyDay: { enabled: false, thresholdPercent: 85, percent: 0 }, capPercent: 0, endsOn: null },
    rounding: { stepCents: 0, mode: "nearest" },
  };
}

export function defaultPricing(method: PricingMethod): Pricing {
  switch (method) {
    case "fixed":
      return { method, amountCents: 0, laborMinutes: 120 };
    case "hourly_per_cleaner":
      return { method, rateCents: 0, minimumHours: 2, incrementMinutes: 30, estimatedLaborMinutes: 180 };
    case "hourly_per_crew":
      return { method, rateCents: 0, crewSize: 2, minimumHours: 2, incrementMinutes: 30, estimatedElapsedMinutes: 120 };
    case "size_bands":
      return { method, unit: "sq_ft", bands: [{ from: 0, to: 1000, amountCents: 0, laborMinutes: 120 }] };
    case "per_area":
      return { method, unit: "sq_ft", rateMillicents: 0, laborMinutesPer1000: 60, walkthroughAbove: null };
    case "bed_bath":
      return { method, baseCents: 0, includedBedrooms: 1, includedBathrooms: 1, perBedroomCents: 0, perBathroomCents: 0, perHalfBathCents: 0, baseLaborMinutes: 90, perBedroomMinutes: 30, perBathroomMinutes: 30, perHalfBathMinutes: 15 };
    case "per_unit":
      return { method, unitWord: "room", unitCents: 0, baseCents: 0, minimumUnits: 1, laborMinutesPerUnit: 30, baseLaborMinutes: 0 };
    case "recurring_package":
      return { method, monthlyCents: 0, basis: "schedule", schedule: "every_7_days", includedVisits: 4, extraVisitCents: null, laborMinutesPerVisit: 120 };
    case "custom_quote":
      return { method, fromCents: null, laborMinutes: null };
  }
}

export function defaultStr(): Str {
  return {
    enabled: true,
    linenSetsPerBed: 1,
    setsPerLoad: 2,
    laundry: { location: "on_site", loadCents: 0, loadMinutes: 15, maxLoads: 3 },
    restock: [],
    checkoutTime: "11:00",
    checkinTime: "16:00",
    deepCleanEveryTurnovers: null,
    conditionCharges: [],
  };
}

export function blankSpec(category: Category = "residential"): Spec {
  return {
    name: "",
    category,
    summary: "",
    visitWord: category === "short_term_rental" ? "turnover" : category === "post_construction" ? "job" : "visit",
    included: [],
    excluded: [],
    teamNotes: "",
    pricing: defaultPricing(FULLY_SUPPORTED.includes(category) ? "fixed" : "custom_quote"),
    modifiers: defaultModifiers(),
    team: { crewSize: 1, maxCrew: 4, maxVisitMinutes: 6 * 60, skills: [], arrivalWindowMinutes: 0 },
    addOns: [],
    questions: [],
    walkthroughNotes: [],
    str: category === "short_term_rental" ? defaultStr() : null,
    requirements: [],
    illustrative: false,
  };
}
