/**
 * Structural templates: a starting scope, the pricing methods that fit, the questions a price needs, the
 * usual extras, staffing and time inputs, when a walkthrough is needed, and the crew's checklist.
 *
 * They are not rates. Every amount is illustrative and marked so (`illustrative: true`), and a service
 * made from one cannot be published until the owner confirms or replaces those amounts for their market.
 * Specialized work lists what the company must confirm it has (training, insurance, equipment); nothing
 * here implies a company holds them.
 */
import { defaultModifiers, defaultStr, type AddOn, type Category, type PricingMethod, type Question, type ScopeItem, type Spec } from "./spec";
import { blankSpec } from "./spec";

export type Template = {
  id: string;
  category: Category;
  name: string;
  blurb: string;
  /** Methods that suit this work, best fit first. The spec starts with the first. */
  methods: PricingMethod[];
  /** What usually decides staffing and time, for the owner to set. */
  staffing: string;
  spec: Spec;
};

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** Scope items from rooms: { Kitchen: ["Wipe counters", ...] }. Items ending in "*" need a photo. */
function scope(rooms: Record<string, string[]>): ScopeItem[] {
  const out: ScopeItem[] = [];
  for (const [section, items] of Object.entries(rooms)) {
    for (const raw of items) {
      const photo = raw.endsWith("*");
      const label = photo ? raw.slice(0, -1) : raw;
      out.push({ id: slug(`${section}-${label}`), label, section, requiresPhoto: photo });
    }
  }
  return out;
}

function extra(label: string, priceCents: number, laborMinutes: number, options: Partial<AddOn> = {}): AddOn {
  return { id: slug(label), label, priceCents, per: "visit", laborMinutes, maxQuantity: 1, ...options };
}

function ask(label: string, kind: Question["kind"], options: Partial<Question> = {}): Question {
  return { id: slug(label), label, kind, required: false, options: [], walkthroughIf: null, ...options };
}

const requirement = (label: string) => ({ id: slug(label), label, confirmed: false });

function tpl(input: { id: string; category: Category; name: string; blurb: string; methods: PricingMethod[]; staffing: string; spec: Partial<Spec> }): Template {
  const base = blankSpec(input.category);
  return { id: input.id, category: input.category, name: input.name, blurb: input.blurb, methods: input.methods, staffing: input.staffing, spec: { ...base, name: input.name, ...input.spec, illustrative: true } };
}

const homeKitchen = ["Wipe counters and backsplash", "Clean outside of appliances", "Clean sink and faucet", "Wipe cabinet fronts", "Empty trash"];
const homeBath = ["Clean toilet, tub and shower", "Clean sink, mirror and counters", "Mop floor", "Replace liners"];
const homeLiving = ["Dust reachable surfaces", "Vacuum carpets and rugs", "Mop hard floors", "Make beds (linens on site)"];

const recurring = (weekly: number, biweekly: number, monthly: number): Spec["modifiers"]["recurring"] => ({
  enabled: true,
  options: [
    { schedule: "every_7_days", discount: { kind: "percent", value: weekly } },
    { schedule: "every_14_days", discount: { kind: "percent", value: biweekly } },
    { schedule: "once_per_month", discount: { kind: "percent", value: monthly } },
  ],
});

const homeQuestions = [
  ask("Pets in the home", "number", { walkthroughIf: { atLeast: 4 } }),
  ask("How would you describe the home's condition", "choice", { options: ["Kept up", "Needs extra attention", "Heavy build-up"], walkthroughIf: { equals: "Heavy build-up" } }),
  ask("How will the crew get in", "text", { required: true }),
];

const conditionOn = (): Spec["modifiers"]["condition"] => ({ ...defaultModifiers().condition, enabled: true });

export const TEMPLATES: readonly Template[] = [
  // ── Residential ──
  tpl({
    id: "res-standard",
    category: "residential",
    name: "Standard clean",
    blurb: "The regular clean of a lived-in home: kitchen, bathrooms, living areas and bedrooms.",
    methods: ["bed_bath", "size_bands", "hourly_per_cleaner", "fixed"],
    staffing: "Time grows with bedrooms and bathrooms. One cleaner for smaller homes; two once a visit passes your longest-visit limit.",
    spec: {
      summary: "A thorough regular clean of the kitchen, bathrooms, bedrooms and living areas.",
      included: scope({ Kitchen: homeKitchen, Bathrooms: homeBath, "Living areas": homeLiving }),
      excluded: ["Inside the oven or fridge unless added", "Inside cabinets", "Exterior windows", "Moving heavy furniture", "Biohazards"],
      pricing: { method: "bed_bath", baseCents: 12000, includedBedrooms: 1, includedBathrooms: 1, perBedroomCents: 2000, perBathroomCents: 2500, perHalfBathCents: 1200, baseLaborMinutes: 120, perBedroomMinutes: 30, perBathroomMinutes: 35, perHalfBathMinutes: 15 },
      modifiers: { ...defaultModifiers(), condition: conditionOn(), firstClean: { enabled: true, price: { kind: "percent", value: 25 }, timePercent: 30 }, recurring: recurring(15, 10, 5), minimumCents: 12000 },
      addOns: [extra("Inside the oven", 3500, 30), extra("Inside the fridge", 3500, 30), extra("Inside cabinets", 4500, 45), extra("Interior windows", 500, 5, { per: "item", itemWord: "window", maxQuantity: 40 }), extra("Fold one load of laundry", 1500, 15, { per: "item", itemWord: "load", maxQuantity: 4 })],
      questions: homeQuestions,
      walkthroughNotes: ["Hoarding or heavy clutter", "Biohazards, mold or pest activity", "Homes over 5,000 sq ft"],
    },
  }),
  tpl({
    id: "res-deep",
    category: "residential",
    name: "Deep clean",
    blurb: "Detail work beyond a regular clean: baseboards, fixtures, inside the microwave, built-up areas.",
    methods: ["size_bands", "bed_bath", "hourly_per_cleaner"],
    staffing: "Usually two cleaners. Time is roughly one and a half to two times a standard clean for the same home.",
    spec: {
      summary: "A detailed top-to-bottom clean for homes that need more than upkeep.",
      included: scope({ Kitchen: [...homeKitchen, "Inside the microwave", "Degrease range hood"], Bathrooms: [...homeBath, "Scrub grout*", "Descale fixtures"], "Whole home": [...homeLiving, "Wipe baseboards", "Dust ceiling fans and vents", "Wipe doors, frames and switch plates"] }),
      excluded: ["Inside cabinets unless added", "Exterior windows", "Carpet shampoo", "Biohazards"],
      pricing: { method: "size_bands", unit: "sq_ft", bands: [{ from: 0, to: 1000, amountCents: 22000, laborMinutes: 300 }, { from: 1000, to: 2000, amountCents: 30000, laborMinutes: 420 }, { from: 2000, to: 3000, amountCents: 38000, laborMinutes: 540 }, { from: 3000, to: 4500, amountCents: 48000, laborMinutes: 690 }] },
      modifiers: { ...defaultModifiers(), condition: conditionOn() },
      team: { crewSize: 2, maxCrew: 4, maxVisitMinutes: 360, skills: [], arrivalWindowMinutes: 0 },
      addOns: [extra("Inside the oven", 3500, 30), extra("Inside the fridge", 3500, 30), extra("Inside cabinets", 4500, 45)],
      questions: [ask("Home size (sq ft)", "number", { required: true }), ...homeQuestions],
      walkthroughNotes: ["Homes above the largest size band", "Heavy build-up, smoke residue or mold"],
    },
  }),
  tpl({
    id: "res-move",
    category: "residential",
    name: "Move-in / move-out clean",
    blurb: "An empty-home clean, inside cabinets and appliances included, for a handover.",
    methods: ["size_bands", "bed_bath", "custom_quote"],
    staffing: "Two cleaners for most homes. The home should be empty; furniture left behind changes the time.",
    spec: {
      summary: "A full clean of an empty home, including inside cabinets, the oven and the fridge.",
      included: scope({ Kitchen: [...homeKitchen, "Inside all cabinets and drawers*", "Inside the oven*", "Inside the fridge*"], Bathrooms: [...homeBath, "Inside vanities"], "Whole home": ["Wipe baseboards", "Wipe doors, frames and switch plates", "Vacuum and mop all floors", "Interior windows and tracks"] }),
      excluded: ["Furniture or debris removal", "Wall washing or paint touch-ups", "Exterior windows", "Carpet shampoo"],
      pricing: { method: "size_bands", unit: "sq_ft", bands: [{ from: 0, to: 1000, amountCents: 26000, laborMinutes: 330 }, { from: 1000, to: 2000, amountCents: 35000, laborMinutes: 450 }, { from: 2000, to: 3000, amountCents: 45000, laborMinutes: 600 }] },
      modifiers: { ...defaultModifiers(), condition: conditionOn() },
      team: { crewSize: 2, maxCrew: 4, maxVisitMinutes: 360, skills: [], arrivalWindowMinutes: 0 },
      // Sold as extras on other services; included here, so linked and never charged.
      addOns: [extra("Inside the oven", 3500, 30, { coversItemId: "kitchen-inside-the-oven" }), extra("Inside the fridge", 3500, 30, { coversItemId: "kitchen-inside-the-fridge" }), extra("Inside cabinets", 4500, 45, { coversItemId: "kitchen-inside-all-cabinets-and-drawers" })],
      questions: [ask("Home size (sq ft)", "number", { required: true }), ask("Will the home be empty", "yes_no", { required: true, walkthroughIf: { equals: "no" } })],
      walkthroughNotes: ["Belongings or debris left behind", "Damage that may be disputed with a landlord"],
    },
  }),
  tpl({
    id: "res-recurring",
    category: "residential",
    name: "Recurring maintenance plan",
    blurb: "A monthly price for visits on a set schedule, billed per calendar month.",
    methods: ["recurring_package", "bed_bath", "fixed"],
    staffing: "The same cleaner or crew each visit where possible. Time is a standard visit's.",
    spec: {
      summary: "Regular visits on a fixed schedule for one monthly price.",
      included: scope({ Kitchen: homeKitchen, Bathrooms: homeBath, "Living areas": homeLiving }),
      excluded: ["Deep-clean tasks", "Inside appliances unless added"],
      pricing: { method: "recurring_package", monthlyCents: 52000, basis: "schedule", schedule: "every_14_days", includedVisits: 2, extraVisitCents: 18000, laborMinutesPerVisit: 150 },
      addOns: [extra("Inside the oven", 3500, 30), extra("Inside the fridge", 3500, 30)],
      questions: homeQuestions,
      walkthroughNotes: ["A first visit in heavy condition: price it as a deep clean first"],
    },
  }),

  // ── Commercial ──
  tpl({
    id: "com-office",
    category: "commercial",
    name: "Office cleaning",
    blurb: "Janitorial service for offices: workstations, restrooms, break rooms and floors.",
    methods: ["per_area", "hourly_per_crew", "recurring_package", "custom_quote"],
    staffing: "Usually after hours. Crew size follows square footage and the service window.",
    spec: {
      summary: "Routine janitorial cleaning of work areas, restrooms, break rooms and floors.",
      included: scope({ "Work areas": ["Empty trash and recycling", "Dust and wipe desks (cleared areas)", "Vacuum carpets", "Mop hard floors"], Restrooms: ["Clean and disinfect fixtures*", "Restock paper and soap from client supply"], "Break room": ["Wipe counters and tables", "Clean sink", "Wipe outside of appliances"] }),
      excluded: ["Inside refrigerators", "Carpet extraction", "Floor stripping and waxing", "Window exteriors", "Electronics"],
      pricing: { method: "per_area", unit: "sq_ft", rateMillicents: 9000, laborMinutesPer1000: 45, walkthroughAbove: 10000 },
      modifiers: { ...defaultModifiers(), recurring: recurring(10, 5, 0), afterHours: { enabled: true, adjustment: { kind: "percent", value: 15 } }, minimumCents: 15000 },
      team: { crewSize: 2, maxCrew: 6, maxVisitMinutes: 300, skills: [], arrivalWindowMinutes: 60 },
      questions: [ask("Office size (sq ft)", "number", { required: true }), ask("Restrooms", "number", { required: true }), ask("Service window", "choice", { options: ["During business hours", "After hours", "Weekends"] }), ask("Security or alarm access", "text", { required: true })],
      walkthroughNotes: ["Every site before a contract", "Sites over 10,000 sq ft", "Medical, lab or secure areas"],
    },
  }),
  tpl({
    id: "com-retail",
    category: "commercial",
    name: "Retail store cleaning",
    blurb: "Sales floor, fitting rooms, restrooms and entry, before or after trading hours.",
    methods: ["per_area", "hourly_per_crew", "fixed"],
    staffing: "Outside trading hours. Entry glass and high-traffic floors drive time.",
    spec: {
      summary: "Cleaning of the sales floor, entry, fitting rooms and restrooms outside trading hours.",
      included: scope({ "Sales floor": ["Dust fixtures and shelving (cleared)", "Vacuum or mop floors", "Spot-clean entry glass*"], "Fitting rooms": ["Clean mirrors", "Empty trash"], Restrooms: ["Clean and disinfect fixtures"] }),
      excluded: ["Merchandise handling", "Stockroom deep cleaning", "Exterior signage"],
      pricing: { method: "per_area", unit: "sq_ft", rateMillicents: 10000, laborMinutesPer1000: 50, walkthroughAbove: 8000 },
      modifiers: { ...defaultModifiers(), afterHours: { enabled: true, adjustment: { kind: "percent", value: 15 } }, minimumCents: 12000 },
      team: { crewSize: 2, maxCrew: 4, maxVisitMinutes: 240, skills: [], arrivalWindowMinutes: 30 },
      questions: [ask("Store size (sq ft)", "number", { required: true }), ask("Trading hours", "text", { required: true })],
      walkthroughNotes: ["Every new store", "Stores over 8,000 sq ft"],
    },
  }),
  tpl({
    id: "com-common",
    category: "commercial",
    name: "Common-area cleaning",
    blurb: "Lobbies, hallways, stairwells and shared restrooms in multi-tenant buildings.",
    methods: ["per_unit", "hourly_per_crew", "recurring_package"],
    staffing: "Priced per floor; one cleaner covers a few floors per visit.",
    spec: {
      summary: "Routine cleaning of lobbies, hallways, stairwells and shared restrooms.",
      included: scope({ Lobby: ["Clean entry glass*", "Mop or vacuum floors", "Dust surfaces"], "Hallways and stairs": ["Vacuum or mop", "Wipe handrails"], "Shared restrooms": ["Clean and disinfect fixtures"] }),
      excluded: ["Tenant spaces", "Elevator machine rooms", "Exterior areas"],
      pricing: { method: "per_unit", unitWord: "floor", unitCents: 4500, baseCents: 6000, minimumUnits: 1, laborMinutesPerUnit: 30, baseLaborMinutes: 45 },
      modifiers: { ...defaultModifiers(), recurring: recurring(10, 5, 0) },
      questions: [ask("Floors", "number", { required: true }), ask("Elevators", "number")],
      walkthroughNotes: ["Buildings with more than 10 floors"],
    },
  }),
  tpl({
    id: "com-warehouse",
    category: "commercial",
    name: "Warehouse cleaning",
    blurb: "Large floors, break areas and restrooms in industrial spaces. Always seen before pricing.",
    methods: ["custom_quote", "per_area", "hourly_per_crew"],
    staffing: "Depends on floor type, equipment and access. Decided at the walkthrough.",
    spec: {
      summary: "Cleaning of warehouse floors, offices, break areas and restrooms, scoped on site.",
      included: scope({ "Break areas and offices": ["Empty trash", "Wipe surfaces", "Clean restrooms"], Floors: ["Sweep or scrub open floor areas*"] }),
      excluded: ["Racking above reach", "Hazardous materials", "Machinery"],
      pricing: { method: "custom_quote", fromCents: null, laborMinutes: null },
      team: { crewSize: 3, maxCrew: 8, maxVisitMinutes: 480, skills: ["floor machine"], arrivalWindowMinutes: 0 },
      walkthroughNotes: ["Always: floor type, equipment and safety rules are decided on site"],
      requirements: [requirement("Floor scrubber or sweeper, and trained operators"), requirement("Insurance that covers industrial sites")],
    },
  }),

  // ── Short-term rentals ──
  tpl({
    id: "str-turnover",
    category: "short_term_rental",
    name: "Turnover clean",
    blurb: "A guest-ready reset between checkout and check-in: clean, beds, laundry and restock.",
    methods: ["bed_bath", "fixed", "per_unit"],
    staffing: "Set the crew so the turnover fits between checkout and check-in. Laundry loads add hands-on time.",
    spec: {
      summary: "A full reset between guests: clean, make beds with fresh linens, restock and report damage.",
      included: scope({ Kitchen: [...homeKitchen, "Run and empty dishwasher", "Check for left-behind food"], Bathrooms: [...homeBath, "Stage fresh towels*"], Bedrooms: ["Strip and make beds with fresh linens*", "Dust surfaces", "Vacuum floors"], "Guest-ready check": ["Photograph each room when done*", "Report damage or missing items*"] }),
      excluded: ["Deep-clean tasks", "Exterior and pool", "Restocking items the host has not supplied"],
      pricing: { method: "bed_bath", baseCents: 9000, includedBedrooms: 1, includedBathrooms: 1, perBedroomCents: 2000, perBathroomCents: 2000, perHalfBathCents: 1000, baseLaborMinutes: 90, perBedroomMinutes: 25, perBathroomMinutes: 25, perHalfBathMinutes: 10 },
      team: { crewSize: 2, maxCrew: 4, maxVisitMinutes: 300, skills: [], arrivalWindowMinutes: 0 },
      str: { ...defaultStr(), laundry: { location: "on_site", loadCents: 0, loadMinutes: 15, maxLoads: 3 }, restock: [{ id: "toilet-paper", label: "Toilet paper", perTurnover: 4, rule: "at_cost", markupPercent: 0 }, { id: "coffee", label: "Coffee pods", perTurnover: 6, rule: "host_supplied", markupPercent: 0 }], deepCleanEveryTurnovers: 10, conditionCharges: [{ id: "excess-trash", label: "Excess trash removal", amountCents: 4000 }, { id: "smoke", label: "Smoke odor treatment", amountCents: 7500 }] },
      questions: [ask("Beds to make", "number", { required: true }), ask("Where is laundry done", "choice", { options: ["On site", "Off site", "Host's linen service"] })],
      walkthroughNotes: ["A first turnover at a new property", "Excessive condition: photos first, charges only after a person reviews them"],
    },
  }),
  tpl({
    id: "str-linen",
    category: "short_term_rental",
    name: "Linen service",
    blurb: "Washing, drying and folding a property's linens, priced by the load.",
    methods: ["per_unit", "fixed"],
    staffing: "One person; time is hands-on per load, not machine time.",
    spec: {
      summary: "Linens washed, dried, folded and staged for the next guest.",
      included: scope({ Laundry: ["Wash and dry linens and towels", "Fold and stage sets*", "Report stains or damage*"] }),
      excluded: ["Replacing damaged linens", "Dry cleaning"],
      pricing: { method: "per_unit", unitWord: "load", unitCents: 1800, baseCents: 0, minimumUnits: 2, laborMinutesPerUnit: 15, baseLaborMinutes: 0 },
      questions: [ask("Loads", "number", { required: true })],
    },
  }),
  tpl({
    id: "str-restock",
    category: "short_term_rental",
    name: "Restocking",
    blurb: "Checking and refilling guest supplies, with the items billed by the host's rule.",
    methods: ["fixed", "per_unit"],
    staffing: "Usually done during a turnover; a standalone visit is short.",
    spec: {
      summary: "Guest supplies checked and refilled to the host's list.",
      included: scope({ Supplies: ["Count and refill guest supplies*", "Note anything running low"] }),
      excluded: ["Buying items the host has not approved"],
      pricing: { method: "fixed", amountCents: 3000, laborMinutes: 20 },
      str: { ...defaultStr(), laundry: { location: "none", loadCents: 0, loadMinutes: 0, maxLoads: 0 }, restock: [{ id: "toiletries", label: "Toiletries", perTurnover: 1, rule: "cost_plus", markupPercent: 10 }] },
    },
  }),
  tpl({
    id: "str-deep",
    category: "short_term_rental",
    name: "Periodic deep clean",
    blurb: "A scheduled deep clean for a rental, every so many turnovers.",
    methods: ["bed_bath", "size_bands"],
    staffing: "Two cleaners; schedule it on a vacant night.",
    spec: {
      summary: "A deep clean of the rental between bookings, on a regular cycle.",
      included: scope({ Kitchen: ["Inside the oven", "Inside the fridge", "Inside cabinets"], Bathrooms: ["Scrub grout*", "Descale fixtures"], "Whole home": ["Wipe baseboards", "Dust vents and fans", "Wash mattress protectors"] }),
      excluded: ["Carpet extraction", "Exterior"],
      pricing: { method: "bed_bath", baseCents: 20000, includedBedrooms: 1, includedBathrooms: 1, perBedroomCents: 4000, perBathroomCents: 4000, perHalfBathCents: 2000, baseLaborMinutes: 240, perBedroomMinutes: 45, perBathroomMinutes: 45, perHalfBathMinutes: 20 },
      team: { crewSize: 2, maxCrew: 4, maxVisitMinutes: 360, skills: [], arrivalWindowMinutes: 0 },
      str: { ...defaultStr(), laundry: { location: "on_site", loadCents: 0, loadMinutes: 15, maxLoads: 4 } },
      questions: [ask("Beds to make", "number", { required: true })],
    },
  }),

  // ── Property management ──
  tpl({
    id: "pm-vacant",
    category: "property_management",
    name: "Vacant-unit turnover",
    blurb: "Making an empty unit rent-ready between tenants, with photos for the manager.",
    methods: ["custom_quote", "size_bands", "bed_bath"],
    staffing: "Two cleaners. Condition varies widely between tenants; see it first.",
    spec: {
      summary: "An empty unit cleaned rent-ready, with before and after photos for the property manager.",
      included: scope({ Kitchen: ["Inside all cabinets*", "Inside the oven*", "Inside the fridge*", "Counters and sink"], Bathrooms: ["Clean and disinfect fixtures*", "Inside vanities"], "Whole unit": ["Baseboards and doors", "Interior windows and tracks", "Vacuum and mop floors*"] }),
      excluded: ["Trash-out of belongings", "Paint, repairs or carpet replacement", "Pest treatment"],
      pricing: { method: "custom_quote", fromCents: 25000, laborMinutes: 420 },
      team: { crewSize: 2, maxCrew: 4, maxVisitMinutes: 420, skills: [], arrivalWindowMinutes: 0 },
      questions: [ask("Bedrooms", "number", { required: true }), ask("Bathrooms", "number", { required: true }), ask("Belongings left behind", "yes_no", { walkthroughIf: { equals: "yes" } })],
      walkthroughNotes: ["Every unit until the manager's condition standard is agreed", "Belongings, pests or damage"],
    },
  }),
  tpl({
    id: "pm-multi",
    category: "property_management",
    name: "Multi-property services",
    blurb: "One agreed price per unit across a manager's portfolio.",
    methods: ["per_unit", "fixed", "recurring_package"],
    staffing: "Routes across properties; travel between them belongs in the price or the area settings.",
    spec: {
      summary: "Routine cleaning across a manager's units at one agreed price per unit.",
      included: scope({ "Each unit": ["Kitchen and bathrooms cleaned", "Floors vacuumed and mopped", "Photo report*"] }),
      excluded: ["Turnover deep cleaning", "Repairs"],
      pricing: { method: "per_unit", unitWord: "unit", unitCents: 9000, baseCents: 0, minimumUnits: 3, laborMinutesPerUnit: 90, baseLaborMinutes: 0 },
      modifiers: { ...defaultModifiers(), area: { enabled: true, zones: [], outside: "standard" } },
      questions: [ask("Units this visit", "number", { required: true })],
    },
  }),
  tpl({
    id: "pm-common",
    category: "property_management",
    name: "Community common areas",
    blurb: "Clubhouses, mail rooms, gyms and shared spaces in managed communities.",
    methods: ["hourly_per_crew", "recurring_package", "fixed"],
    staffing: "A set crew for a set number of hours on a schedule.",
    spec: {
      summary: "Scheduled cleaning of a community's shared spaces.",
      included: scope({ Clubhouse: ["Floors and surfaces", "Restrooms*"], Gym: ["Wipe equipment surfaces", "Floors"], "Mail room": ["Floors and counters", "Empty trash"] }),
      excluded: ["Pool chemical care", "Exterior grounds"],
      pricing: { method: "hourly_per_crew", rateCents: 9000, crewSize: 2, minimumHours: 2, incrementMinutes: 30, estimatedElapsedMinutes: 180 },
      team: { crewSize: 2, maxCrew: 4, maxVisitMinutes: 360, skills: [], arrivalWindowMinutes: 0 },
    },
  }),

  // ── Post-construction ──
  tpl({
    id: "pc-rough",
    category: "post_construction",
    name: "Post-construction rough clean",
    blurb: "Debris and dust removal while trades are still finishing.",
    methods: ["per_area", "custom_quote", "hourly_per_crew"],
    staffing: "Crews of three or more; dust and debris vary by phase. See the site first.",
    spec: {
      summary: "Removal of construction debris and heavy dust so finishing work can proceed.",
      included: scope({ Site: ["Remove loose debris to the site container", "Sweep and vacuum all floors", "Wipe heavy dust from surfaces*"] }),
      excluded: ["Hauling debris off site", "Hazardous materials", "Work at height without the right equipment"],
      pricing: { method: "per_area", unit: "sq_ft", rateMillicents: 15000, laborMinutesPer1000: 75, walkthroughAbove: 5000 },
      team: { crewSize: 3, maxCrew: 8, maxVisitMinutes: 480, skills: [], arrivalWindowMinutes: 0 },
      walkthroughNotes: ["Every site", "Sites over 5,000 sq ft"],
      requirements: [requirement("Personal protective equipment for active construction sites"), requirement("Insurance that covers construction sites")],
    },
  }),
  tpl({
    id: "pc-final",
    category: "post_construction",
    name: "Post-construction final clean",
    blurb: "The detailed clean before handover: fixtures, glass, cabinets and floors.",
    methods: ["per_area", "custom_quote"],
    staffing: "Usually two passes' worth of time; schedule after trades leave.",
    spec: {
      summary: "A detailed clean after construction, ready for the owner or tenant.",
      included: scope({ "Whole site": ["Remove stickers and residue from fixtures and glass*", "Clean inside cabinets and drawers", "Detail-clean fixtures and hardware", "Clean interior glass and tracks*", "Vacuum and mop all floors*"] }),
      excluded: ["Paint removal beyond residue", "Exterior windows above ground floor", "Floor refinishing"],
      pricing: { method: "per_area", unit: "sq_ft", rateMillicents: 25000, laborMinutesPer1000: 120, walkthroughAbove: 5000 },
      team: { crewSize: 3, maxCrew: 8, maxVisitMinutes: 480, skills: [], arrivalWindowMinutes: 0 },
      walkthroughNotes: ["Every site"],
      requirements: [requirement("Insurance that covers construction sites")],
    },
  }),
  tpl({
    id: "pc-touchup",
    category: "post_construction",
    name: "Touch-up visit",
    blurb: "A short return visit after punch-list work or a walkthrough.",
    methods: ["hourly_per_crew", "fixed"],
    staffing: "Two cleaners for a few hours.",
    spec: {
      summary: "A short visit to clean areas touched by final punch-list work.",
      included: scope({ "Listed areas": ["Dust and wipe touched areas*", "Vacuum and mop affected floors"] }),
      excluded: ["Areas not on the punch list"],
      pricing: { method: "hourly_per_crew", rateCents: 9000, crewSize: 2, minimumHours: 2, incrementMinutes: 30, estimatedElapsedMinutes: 120 },
    },
  }),

  // ── Specialty ──
  tpl({
    id: "sp-windows",
    category: "specialty",
    name: "Window cleaning",
    blurb: "Interior and exterior glass, priced per window.",
    methods: ["per_unit", "hourly_per_crew"],
    staffing: "Ground-floor work only until ladder or height work is confirmed.",
    spec: {
      summary: "Glass, frames and sills cleaned inside and out.",
      included: scope({ Windows: ["Clean glass inside and out*", "Wipe frames and sills", "Clean tracks"] }),
      excluded: ["Windows above the ground floor unless confirmed", "Screens repair", "Hard-water stain removal"],
      pricing: { method: "per_unit", unitWord: "window", unitCents: 800, baseCents: 5000, minimumUnits: 8, laborMinutesPerUnit: 8, baseLaborMinutes: 15 },
      walkthroughNotes: ["Any window above one story", "Skylights or specialty glass"],
      requirements: [requirement("Ladder or height-work training for windows above one story"), requirement("Insurance that covers work at height")],
    },
  }),
  tpl({
    id: "sp-carpet",
    category: "specialty",
    name: "Carpet and upholstery cleaning",
    blurb: "Hot-water extraction for carpets and furniture, priced per room or piece.",
    methods: ["per_unit", "per_area"],
    staffing: "One trained technician with extraction equipment.",
    spec: {
      summary: "Carpets and upholstery cleaned by hot-water extraction.",
      included: scope({ Carpets: ["Pre-treat traffic areas", "Hot-water extraction*", "Groom and set to dry"] }),
      excluded: ["Guaranteed removal of permanent stains", "Moving heavy furniture", "Water damage restoration"],
      pricing: { method: "per_unit", unitWord: "room", unitCents: 4500, baseCents: 0, minimumUnits: 2, laborMinutesPerUnit: 30, baseLaborMinutes: 20 },
      addOns: [extra("Sofa", 9000, 45, { per: "item", itemWord: "sofa", maxQuantity: 4 }), extra("Pet-odor treatment", 2500, 15, { per: "item", itemWord: "room", maxQuantity: 10 })],
      requirements: [requirement("Hot-water extraction equipment"), requirement("Carpet-cleaning training or certification")],
    },
  }),
  tpl({
    id: "sp-floor",
    category: "specialty",
    name: "Floor care (strip and wax)",
    blurb: "Stripping, sealing and finishing hard floors, priced by area.",
    methods: ["per_area", "custom_quote"],
    staffing: "Two trained technicians with floor machines; the area must be empty.",
    spec: {
      summary: "Hard floors stripped, sealed and finished.",
      included: scope({ Floors: ["Move light furniture", "Strip old finish*", "Apply sealer and finish coats*"] }),
      excluded: ["Stone restoration", "Floors needing repair"],
      pricing: { method: "per_area", unit: "sq_ft", rateMillicents: 45000, laborMinutesPer1000: 240, walkthroughAbove: 3000 },
      team: { crewSize: 2, maxCrew: 4, maxVisitMinutes: 480, skills: ["floor machine"], arrivalWindowMinutes: 0 },
      walkthroughNotes: ["Every floor type before a first job"],
      requirements: [requirement("Floor machines and the products for each floor type"), requirement("Chemical-handling training")],
    },
  }),
  tpl({
    id: "sp-event",
    category: "specialty",
    name: "Event cleanup",
    blurb: "Before, during or after an event, priced by crew hour.",
    methods: ["hourly_per_crew", "custom_quote"],
    staffing: "Crew size follows guest count and the time the venue allows.",
    spec: {
      summary: "Venue cleanup around an event, on the venue's schedule.",
      included: scope({ Venue: ["Collect and bag trash and recycling", "Wipe tables and surfaces", "Sweep and mop floors", "Clean restrooms*"] }),
      excluded: ["Hauling trash off site", "Biohazard cleanup", "Rental returns"],
      pricing: { method: "hourly_per_crew", rateCents: 12000, crewSize: 3, minimumHours: 3, incrementMinutes: 30, estimatedElapsedMinutes: 180 },
      modifiers: { ...defaultModifiers(), afterHours: { enabled: true, adjustment: { kind: "percent", value: 20 } } },
      team: { crewSize: 3, maxCrew: 10, maxVisitMinutes: 480, skills: [], arrivalWindowMinutes: 0 },
      questions: [ask("Guest count", "number", { required: true, walkthroughIf: { atLeast: 500 } }), ask("Venue end time", "text", { required: true })],
    },
  }),
];

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((template) => template.id === id);
}
