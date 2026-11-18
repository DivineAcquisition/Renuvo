/**
 * A booking experience, defined once (docs/booking/00-architecture.md).
 *
 * Three things are kept apart on purpose:
 *  1. Presentation: theme, copy, imagery, sections, order and visibility. That is this file.
 *  2. Business rules: services, prices, eligibility, scheduling, payment requirements and agreements.
 *     They live where they already live (Services & Pricing, Business settings, Finance, Agreements) and
 *     in the shared booking rules (`bookingSettings`). An experience only *chooses* among them, by id.
 *  3. Booking state: a customer's answers, quote, reservation, payment, signature and completion. That is
 *     `bookingSessions`, never stored here.
 *
 * Nothing in a definition can compute a price, authorize a booking or run code: there are no formulas,
 * no scripts and no HTML. Text is plain text. Every field has a limit, and `normalizeDefinition` checks
 * the whole definition before a draft is saved, so a stored definition is always one the renderer can
 * draw. The validators below are the source of the TypeScript types the renderer uses.
 */
import { v } from "convex/values";

import { userError } from "../errors";
import { literals } from "../statuses";

/** Bumped when the shape changes. A stored definition with a lower number is upgraded by `upgradeDefinition`. */
export const DEFINITION_VERSION = 1;

// ── Lists ───────────────────────────────────────────────────────────────────────────────────────────

export const EXPERIENCE_KINDS = ["residential", "commercial", "short_term_rental", "recurring", "campaign"] as const;
export type ExperienceKind = (typeof EXPERIENCE_KINDS)[number];
export const experienceKindValidator = literals(EXPERIENCE_KINDS);

export const KIND_LABELS: Record<ExperienceKind, { label: string; blurb: string }> = {
  residential: { label: "Residential booking", blurb: "Homes and apartments, booked and scheduled online." },
  commercial: { label: "Commercial estimate or walkthrough", blurb: "Offices and facilities ask for an estimate or a walkthrough." },
  short_term_rental: { label: "Short-term rental turnover", blurb: "Hosts book turnovers between guests." },
  recurring: { label: "Recurring service enrollment", blurb: "Customers ask to start a regular schedule." },
  campaign: { label: "Campaign booking", blurb: "A page for one promotion or ad campaign, with its own attribution." },
};

/**
 * What finishing the flow does. "instant": a firm, paid or unpaid booking with a reserved time.
 * "estimate_request" and "walkthrough_request": the customer asks, and a person follows up. A request
 * never takes payment and never reserves a crew.
 */
export const BOOKING_MODES = ["instant", "estimate_request", "walkthrough_request"] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];
export const bookingModeValidator = literals(BOOKING_MODES);

/**
 * The steps, in the reference order. The service step holds the offer cards and the date picker, as
 * Novara's does. Location, size, service and checkout are always present when the mode needs them; the
 * flow (flow.ts) works out which steps a given session actually has.
 */
export const STEP_IDS = ["location", "size", "service", "details", "checkout", "confirmation"] as const;
export type StepId = (typeof STEP_IDS)[number];
export const stepIdValidator = literals(STEP_IDS);

export const STEP_LABELS: Record<StepId, string> = {
  location: "Location",
  size: "Home size",
  service: "Service",
  details: "Details",
  checkout: "Checkout",
  confirmation: "Confirmed",
};

/** Optional blocks a step can show. Each is drawn by one component in src/components/booking. */
export const SECTION_IDS = ["comparison", "trust", "faq", "next_steps", "included", "promo_banner"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const sectionIdValidator = literals(SECTION_IDS);

export const SECTION_LABELS: Record<SectionId, string> = {
  comparison: "Service comparison",
  trust: "Trust statements",
  faq: "Questions and answers",
  next_steps: "What happens next",
  included: "What's included",
  promo_banner: "Offer banner",
};

/** Where each optional block may appear. Moving a block to a step not listed is refused. */
export const SECTION_PLACES: Record<SectionId, readonly StepId[]> = {
  comparison: ["service"],
  trust: ["location", "service", "checkout", "confirmation"],
  faq: ["location", "service", "checkout"],
  next_steps: ["checkout", "confirmation"],
  included: ["checkout"],
  promo_banner: ["location", "service"],
};

export const TYPOGRAPHY = ["inter", "humanist", "serif", "rounded"] as const;
export type Typography = (typeof TYPOGRAPHY)[number];
export const TYPOGRAPHY_LABELS: Record<Typography, string> = { inter: "Clean (Inter)", humanist: "Friendly", serif: "Classic serif", rounded: "Rounded" };

export const BACKGROUNDS = ["glow", "plain", "tinted"] as const;
export type Background = (typeof BACKGROUNDS)[number];
export const SURFACES = ["raised", "outlined", "flat"] as const;
export type Surface = (typeof SURFACES)[number];
export const RADII = ["rounded", "soft", "square"] as const;
export type Radius = (typeof RADII)[number];
export const BUTTONS = ["gradient", "solid", "outline"] as const;
export type ButtonStyle = (typeof BUTTONS)[number];

/** Validated kinds of a custom question. There is no free-form type and no script. */
export const FIELD_TYPES = ["short_text", "long_text", "number", "choice", "multi_choice", "yes_no", "date"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const fieldTypeValidator = literals(FIELD_TYPES);

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  short_text: "Short answer",
  long_text: "Paragraph",
  number: "Number",
  choice: "One choice",
  multi_choice: "Several choices",
  yes_no: "Yes or no",
  date: "Date",
};

/** What a custom question is for. "access" answers go only to the crew, through Dispatch, never to analytics. */
export const FIELD_PURPOSES = ["general", "access", "property", "scheduling"] as const;
export type FieldPurpose = (typeof FIELD_PURPOSES)[number];

/** Out-of-area visitors: a short request form, or a polite "not yet" with the company's contact. */
export const OUT_OF_AREA = ["request", "contact_only"] as const;
export type OutOfArea = (typeof OUT_OF_AREA)[number];

/** When non-price details are taken. "after_payment" keeps the reference order and is tracked as its own state. */
export const DETAILS_TIMING = ["before_payment", "after_payment"] as const;
export type DetailsTiming = (typeof DETAILS_TIMING)[number];

const HEX = /^#[0-9a-f]{6}$/;

// ── Shapes ──────────────────────────────────────────────────────────────────────────────────────────

const copyValidator = v.object({
  title: v.string(),
  subtitle: v.string(),
  /** The main button's words. Empty: the step's default. */
  button: v.string(),
});
export type StepCopy = typeof copyValidator.type;

/** A condition a custom question or a section can depend on: an earlier answer, or the chosen service. */
export const conditionValidator = v.union(
  v.object({ kind: v.literal("answer_equals"), questionId: v.string(), value: v.string() }),
  v.object({ kind: v.literal("service_is"), serviceKey: v.string() }),
  v.object({ kind: v.literal("mode_is"), mode: bookingModeValidator }),
);
export type Condition = typeof conditionValidator.type;

export const customQuestionValidator = v.object({
  id: v.string(),
  label: v.string(),
  help: v.string(),
  type: fieldTypeValidator,
  purpose: literals(FIELD_PURPOSES),
  required: v.boolean(),
  /** For choice and multi-choice. */
  options: v.array(v.string()),
  /** Longest answer, in characters, for text. Highest value for number. */
  max: v.number(),
  /** Shown only when this holds. Absent: always. */
  showIf: v.optional(conditionValidator),
});
export type CustomQuestion = typeof customQuestionValidator.type;

export const offeredServiceValidator = v.object({
  /** The service's key in Services & Pricing. Its price, scope and questions always come from there. */
  serviceKey: v.string(),
  /** Display name. Empty: the service's own name. Never changes what is sold. */
  displayName: v.string(),
  /** One line under the name. Empty: the service's own summary. */
  blurb: v.string(),
  /** Short benefit lines on the card. Empty: the service's included scope. */
  benefits: v.array(v.string()),
  /** A small label on the card ("Most popular"). Shown only on the featured card. */
  badge: v.string(),
  hidden: v.boolean(),
});
export type OfferedService = typeof offeredServiceValidator.type;

export const comparisonRowValidator = v.object({ label: v.string(), group: v.string(), included: v.array(v.string()) });
export type ComparisonRow = typeof comparisonRowValidator.type;

/** A size card the owner may relabel. Its values come from the services' pricing (sizes.ts), never from here. */
export const sizeLabelValidator = v.object({ key: v.string(), label: v.string(), sublabel: v.string() });

export const definitionValidator = v.object({
  version: v.number(),
  theme: v.object({
    /** Use the colors and logo from the company's public profile. */
    useCompanyBrand: v.boolean(),
    brandColor: v.string(),
    accentColor: v.string(),
    typography: literals(TYPOGRAPHY),
    background: literals(BACKGROUNDS),
    surface: literals(SURFACES),
    radius: literals(RADII),
    buttonStyle: literals(BUTTONS),
    /** An image the owner uploaded for the size step and confirmation, shown decoratively. */
    heroImage: v.optional(v.id("_storage")),
    showIllustrations: v.boolean(),
  }),
  header: v.object({
    showPhone: v.boolean(),
    showWebsite: v.boolean(),
    showProgress: v.boolean(),
    helpLabel: v.string(),
  }),
  steps: v.array(
    v.object({
      id: stepIdValidator,
      copy: copyValidator,
      /** Optional blocks on this step, in order. */
      sections: v.array(v.object({ id: sectionIdValidator, hidden: v.boolean() })),
    }),
  ),
  services: v.object({
    offered: v.array(offeredServiceValidator),
    featuredKey: v.union(v.string(), v.null()),
    comparison: v.object({ title: v.string(), rows: v.array(comparisonRowValidator) }),
    /** Show the extras of a selected service. */
    showExtras: v.boolean(),
    showFrequencies: v.boolean(),
  }),
  sizes: v.object({ labels: v.array(sizeLabelValidator), customQuoteTitle: v.string(), customQuoteButton: v.string() }),
  content: v.object({
    /** Statements about the company. Each must be confirmed true by the owner before it is published. */
    trust: v.array(v.object({ id: v.string(), text: v.string(), confirmed: v.boolean() })),
    faqs: v.array(v.object({ id: v.string(), question: v.string(), answer: v.string() })),
    nextSteps: v.array(v.object({ id: v.string(), title: v.string(), body: v.string() })),
    promo: v.object({ text: v.string() }),
    outOfAreaTitle: v.string(),
    outOfAreaBody: v.string(),
    requestTitle: v.string(),
    requestBody: v.string(),
    footerNote: v.string(),
  }),
  behavior: v.object({
    mode: bookingModeValidator,
    /** Above this many square feet the visitor is sent to the request flow, whatever the price says. Null: the services decide. */
    customQuoteAboveArea: v.union(v.number(), v.null()),
    /** A payment policy from the shared booking rules, by id. Null: no payment in this flow. */
    paymentPolicyId: v.union(v.string(), v.null()),
    /** A booking agreement from the shared booking rules, by id. Null: none required. */
    agreementId: v.union(v.string(), v.null()),
    detailsTiming: literals(DETAILS_TIMING),
    outOfArea: literals(OUT_OF_AREA),
    /** An approved promotion on the offered services that this experience applies, by id. */
    promotionId: v.union(v.string(), v.null()),
    questions: v.array(customQuestionValidator),
    /** Notices and recovery. Recovery messages are never sent without a person (Sales is not released). */
    notifyOfficeOnRequest: v.boolean(),
    offerRecovery: v.boolean(),
  }),
  /** Campaign attribution the experience adds to every session it starts. No personal information. */
  attribution: v.object({ source: v.string(), campaign: v.string() }),
});
export type Definition = typeof definitionValidator.type;
export type Theme = Definition["theme"];
export type StepDef = Definition["steps"][number];

// ── Defaults: the Novara layout, with no Novara content ───────────────────────────────────────────

const copy = (title: string, subtitle: string, button = ""): StepCopy => ({ title, subtitle, button });

function stepsFor(kind: ExperienceKind): StepDef[] {
  const request = kind === "commercial";
  return [
    { id: "location", copy: copy(request ? "Tell us about your facility." : "Book a cleaning in minutes.", "Enter your ZIP code to check that we serve your area. It does not change the price.", "Continue"), sections: [{ id: "promo_banner", hidden: true }, { id: "trust", hidden: false }] },
    { id: "size", copy: copy(kind === "short_term_rental" ? "How big is the rental?" : kind === "commercial" ? "How large is the space?" : "How big is your home?", "The price on the next step uses this size. Choose the range that matches."), sections: [] },
    {
      id: "service",
      copy: copy(request ? "Choose what you need." : "Choose a clean.", request ? "We'll confirm scope and price after we look at the space." : "Prices below are for this property, from our published rates."),
      sections: [
        { id: "comparison", hidden: kind === "commercial" },
        { id: "faq", hidden: true },
      ],
    },
    { id: "details", copy: copy("Tell us about the property.", "A few details so the team arrives ready. Nothing here changes the price."), sections: [] },
    {
      id: "checkout",
      copy: copy(request ? "Review your request." : "Review and reserve.", request ? "Nothing is charged. We'll reply with next steps." : "Check the details, then confirm.", request ? "Send request" : ""),
      sections: [
        { id: "included", hidden: false },
        { id: "next_steps", hidden: false },
        { id: "trust", hidden: false },
      ],
    },
    { id: "confirmation", copy: copy(request ? "Request received." : "Your clean is booked.", request ? "We'll be in touch shortly with next steps." : "We've saved everything. A confirmation is on its way."), sections: [{ id: "next_steps", hidden: false }] },
  ];
}

const RESIDENTIAL_QUESTIONS: CustomQuestion[] = [
  { id: "pets", label: "Pets at the property", help: "", type: "choice", purpose: "property", required: true, options: ["No pets", "Dogs", "Cats", "Other pets"], max: 0 },
  { id: "parking", label: "Parking", help: "Where can the team park?", type: "short_text", purpose: "access", required: false, options: [], max: 200 },
  { id: "access", label: "How the team gets in", help: "Gate code, key location or who will be home. Only the assigned crew sees this.", type: "long_text", purpose: "access", required: false, options: [], max: 1000 },
];

const COMMERCIAL_QUESTIONS: CustomQuestion[] = [
  { id: "facility_type", label: "Type of facility", help: "", type: "choice", purpose: "property", required: true, options: ["Office", "Retail", "Medical office", "Warehouse", "Other"], max: 0 },
  { id: "operating_hours", label: "When is the space open?", help: "So cleaning can be scheduled around it.", type: "short_text", purpose: "scheduling", required: true, options: [], max: 200 },
  { id: "walkthrough_times", label: "Good times for a walkthrough", help: "", type: "short_text", purpose: "scheduling", required: false, options: [], max: 200 },
  { id: "scope_notes", label: "What needs cleaning", help: "Areas, frequency and anything specific.", type: "long_text", purpose: "general", required: false, options: [], max: 2000 },
];

const STR_QUESTIONS: CustomQuestion[] = [
  { id: "checkout_time", label: "Guest checkout time", help: "", type: "short_text", purpose: "scheduling", required: true, options: [], max: 40 },
  { id: "next_checkin", label: "Next guest check-in time", help: "The turnover must be finished before this.", type: "short_text", purpose: "scheduling", required: true, options: [], max: 40 },
  { id: "laundry", label: "Laundry", help: "", type: "choice", purpose: "property", required: true, options: ["Washer and dryer on site", "Off-site laundry", "Host handles linens"], max: 0 },
  { id: "supplies", label: "Restocking supplies", help: "", type: "choice", purpose: "property", required: false, options: ["Supplies are on site", "Please bring supplies", "No restocking"], max: 0 },
  { id: "access", label: "Lockbox or door code", help: "Only the assigned crew sees this.", type: "long_text", purpose: "access", required: true, options: [], max: 500 },
];

export function questionsFor(kind: ExperienceKind): CustomQuestion[] {
  if (kind === "commercial") return COMMERCIAL_QUESTIONS.map((q) => ({ ...q }));
  if (kind === "short_term_rental") return STR_QUESTIONS.map((q) => ({ ...q }));
  return RESIDENTIAL_QUESTIONS.map((q) => ({ ...q }));
}

/**
 * The starting definition for a kind of experience: Novara's layout and rhythm, with neutral words and
 * no company's phone number, claims, prices, discounts, membership names or policy text. Services,
 * prices, payment and agreements are chosen from the company's own published records afterwards.
 */
export function defaultDefinition(kind: ExperienceKind): Definition {
  const request = kind === "commercial" || kind === "recurring";
  return {
    version: DEFINITION_VERSION,
    theme: { useCompanyBrand: true, brandColor: "#6838ef", accentColor: "#8e5bff", typography: "inter", background: "glow", surface: "raised", radius: "rounded", buttonStyle: "gradient", showIllustrations: true },
    header: { showPhone: true, showWebsite: true, showProgress: true, helpLabel: "Questions?" },
    steps: stepsFor(kind),
    services: { offered: [], featuredKey: null, comparison: { title: "What's the difference?", rows: [] }, showExtras: true, showFrequencies: true },
    sizes: { labels: [], customQuoteTitle: "Larger than these?", customQuoteButton: "Request a custom quote" },
    content: {
      trust: [],
      faqs: [],
      nextSteps: [
        { id: "confirmation", title: "Confirmation", body: "You get one confirmation with a private link to your booking." },
        { id: "visit", title: "Your visit", body: "The team arrives inside the window you picked and works from the written scope." },
        { id: "after", title: "After the visit", body: "Anything left to pay is invoiced after the visit." },
      ],
      promo: { text: "" },
      outOfAreaTitle: "We don't serve this area yet.",
      outOfAreaBody: "Leave your details and we'll reach out if that changes.",
      requestTitle: "We'll prepare a quote.",
      requestBody: "This property needs a person to look at it before we can give a firm price.",
      footerNote: "",
    },
    behavior: {
      mode: kind === "commercial" ? "walkthrough_request" : request ? "estimate_request" : "instant",
      customQuoteAboveArea: null,
      paymentPolicyId: null,
      agreementId: null,
      detailsTiming: "before_payment",
      outOfArea: "request",
      promotionId: null,
      questions: questionsFor(kind),
      notifyOfficeOnRequest: true,
      offerRecovery: true,
    },
    attribution: { source: kind === "campaign" ? "campaign" : "", campaign: "" },
  };
}

/** Upgrades a stored definition to the current shape. Version 1 is current; this is where later versions add defaults. */
export function upgradeDefinition(stored: Definition): Definition {
  if (stored.version === DEFINITION_VERSION) return stored;
  return { ...stored, version: DEFINITION_VERSION };
}

// ── Checking ────────────────────────────────────────────────────────────────────────────────────────

export const LIMITS = {
  title: 120,
  subtitle: 400,
  button: 40,
  name: 80,
  blurb: 240,
  benefit: 120,
  benefits: 8,
  offered: 12,
  comparisonRows: 40,
  trust: 8,
  trustText: 160,
  faqs: 12,
  faqQuestion: 160,
  faqAnswer: 800,
  nextSteps: 6,
  questions: 20,
  questionLabel: 160,
  options: 12,
  option: 80,
  textMax: 4000,
  numberMax: 1_000_000,
  footer: 400,
  sizeLabels: 12,
} as const;

const ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/** Plain text only: no markup, no control characters, trimmed, bounded. */
export function plain(value: string, label: string, max: number, allowEmpty = true): string {
  const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!allowEmpty && !cleaned) throw userError(`${label} can't be empty.`);
  if (cleaned.length > max) throw userError(`${label} can be at most ${max} characters.`);
  if (/<\s*\/?\s*[a-z!]/i.test(cleaned)) throw userError(`${label} must be plain text, without HTML.`);
  return cleaned;
}

function color(value: string, label: string): string {
  const hex = value.trim().toLowerCase();
  if (!HEX.test(hex)) throw userError(`${label} must be a color like #6838ef.`);
  return hex;
}

function id(value: string, label: string): string {
  const trimmed = value.trim();
  if (!ID.test(trimmed)) throw userError(`${label} needs a short id of lower-case letters, numbers, dashes or underscores.`);
  return trimmed;
}

function unique<T>(rows: T[], key: (row: T) => string, label: string): T[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const k = key(row);
    if (seen.has(k)) throw userError(`Two ${label} share the id "${k}".`);
    seen.add(k);
  }
  return rows;
}

function condition(input: Condition | undefined, questionIds: Set<string>): Condition | undefined {
  if (!input) return undefined;
  if (input.kind === "answer_equals") {
    if (!questionIds.has(input.questionId)) throw userError("A question depends on an answer to a question that isn't asked before it.");
    return { kind: input.kind, questionId: input.questionId, value: plain(input.value, "A condition's answer", LIMITS.option, false) };
  }
  if (input.kind === "service_is") return { kind: input.kind, serviceKey: plain(input.serviceKey, "A condition's service", 80, false) };
  return input;
}

function question(input: CustomQuestion, earlier: Set<string>): CustomQuestion {
  const qid = id(input.id, "A question");
  const options = input.options.map((option) => plain(option, "An answer choice", LIMITS.option, false));
  if (options.length > LIMITS.options) throw userError(`A question can offer at most ${LIMITS.options} choices.`);
  if ((input.type === "choice" || input.type === "multi_choice") && options.length < 2) throw userError(`"${input.label || qid}" needs at least two choices.`);
  if (new Set(options).size !== options.length) throw userError(`"${input.label || qid}" lists the same choice twice.`);
  const textual = input.type === "short_text" || input.type === "long_text";
  const max = textual ? Math.min(Math.max(1, Math.round(input.max || (input.type === "short_text" ? 200 : 2000))), LIMITS.textMax) : input.type === "number" ? Math.min(Math.max(1, Math.round(input.max || 10_000)), LIMITS.numberMax) : 0;
  return {
    id: qid,
    label: plain(input.label, "A question", LIMITS.questionLabel, false),
    help: plain(input.help, "A question's help", LIMITS.subtitle),
    type: input.type,
    purpose: input.purpose,
    required: input.required,
    options: input.type === "choice" || input.type === "multi_choice" ? options : [],
    max,
    ...(input.showIf ? { showIf: condition(input.showIf, earlier) } : {}),
  };
}

/**
 * Checks and tidies a whole definition. Throws a person-readable error for the first problem. Business
 * dependencies (a service that isn't published, a policy that doesn't exist) are not errors here: they
 * are publish blockers, shown in the builder and checked again at publish (readiness.ts).
 */
export function normalizeDefinition(input: Definition): Definition {
  if (input.version > DEFINITION_VERSION) throw userError("This experience was saved by a newer version of Selestial. Reload the page.");
  const def = upgradeDefinition(input);
  // Steps: each once, in an order the flow can follow. Location first, confirmation last, checkout before confirmation.
  const ids = def.steps.map((step) => step.id);
  if (new Set(ids).size !== ids.length || ids.length !== STEP_IDS.length || STEP_IDS.some((stepId) => !ids.includes(stepId))) throw userError("Each step must appear exactly once.");
  if (ids[0] !== "location") throw userError("Location comes first: the area decides what can be offered.");
  if (ids[ids.length - 1] !== "confirmation") throw userError("Confirmation comes last.");
  const order = (stepId: StepId) => ids.indexOf(stepId);
  if (!(order("size") < order("service"))) throw userError("Size comes before the service step, because prices depend on it.");
  if (!(order("service") < order("checkout"))) throw userError("The service step comes before checkout, because checkout shows its price.");
  const steps = def.steps.map((step) => {
    const sections = unique(step.sections, (s) => s.id, "blocks on one step");
    for (const section of sections) {
      if (!SECTION_PLACES[section.id].includes(step.id)) throw userError(`${SECTION_LABELS[section.id]} can't go on the ${STEP_LABELS[step.id]} step.`);
    }
    return {
      id: step.id,
      copy: { title: plain(step.copy.title, `The ${STEP_LABELS[step.id]} title`, LIMITS.title), subtitle: plain(step.copy.subtitle, `The ${STEP_LABELS[step.id]} supporting text`, LIMITS.subtitle), button: plain(step.copy.button, "A button label", LIMITS.button) },
      sections: sections.map((s) => ({ id: s.id, hidden: s.hidden })),
    };
  });

  const offered = unique(def.services.offered, (s) => s.serviceKey, "offered services");
  if (offered.length > LIMITS.offered) throw userError(`An experience can offer at most ${LIMITS.offered} services.`);
  const serviceKeys = new Set(offered.map((s) => s.serviceKey));
  const featuredKey = def.services.featuredKey && serviceKeys.has(def.services.featuredKey) ? def.services.featuredKey : null;
  if (def.services.featuredKey && !featuredKey) throw userError("The featured service must be one of the offered services.");

  const earlier = new Set<string>();
  const questions = unique(def.behavior.questions, (q) => q.id, "questions").map((q) => {
    const checked = question(q, earlier);
    earlier.add(checked.id);
    return checked;
  });
  if (questions.length > LIMITS.questions) throw userError(`An experience can ask at most ${LIMITS.questions} of its own questions.`);

  if (def.behavior.customQuoteAboveArea !== null && (!Number.isFinite(def.behavior.customQuoteAboveArea) || def.behavior.customQuoteAboveArea <= 0 || def.behavior.customQuoteAboveArea > LIMITS.numberMax)) {
    throw userError("The custom-quote size must be a positive number of square feet.");
  }
  if (def.behavior.mode !== "instant" && def.behavior.paymentPolicyId !== null) throw userError("A request doesn't take payment. Remove the payment policy or switch to instant booking.");

  const trust = unique(def.content.trust, (t) => t.id, "trust statements").map((t) => ({ id: id(t.id, "A trust statement"), text: plain(t.text, "A trust statement", LIMITS.trustText, false), confirmed: t.confirmed }));
  if (trust.length > LIMITS.trust) throw userError(`An experience can show at most ${LIMITS.trust} trust statements.`);
  const faqs = unique(def.content.faqs, (f) => f.id, "questions and answers").map((f) => ({ id: id(f.id, "A question and answer"), question: plain(f.question, "A question", LIMITS.faqQuestion, false), answer: plain(f.answer, "An answer", LIMITS.faqAnswer, false) }));
  if (faqs.length > LIMITS.faqs) throw userError(`An experience can show at most ${LIMITS.faqs} questions and answers.`);
  const nextSteps = unique(def.content.nextSteps, (n) => n.id, "next steps").map((n) => ({ id: id(n.id, "A next step"), title: plain(n.title, "A next step's title", LIMITS.title, false), body: plain(n.body, "A next step's text", LIMITS.subtitle) }));
  if (nextSteps.length > LIMITS.nextSteps) throw userError(`An experience can show at most ${LIMITS.nextSteps} next steps.`);

  const rows = def.services.comparison.rows.map((row) => ({ label: plain(row.label, "A comparison row", LIMITS.benefit, false), group: plain(row.group, "A comparison group", LIMITS.name), included: row.included.filter((key) => serviceKeys.has(key)) }));
  if (rows.length > LIMITS.comparisonRows) throw userError(`A comparison can have at most ${LIMITS.comparisonRows} rows.`);
  const labels = unique(def.sizes.labels, (l) => l.key, "size labels").map((l) => ({ key: plain(l.key, "A size", 40, false), label: plain(l.label, "A size label", LIMITS.name), sublabel: plain(l.sublabel, "A size's second line", LIMITS.name) }));
  if (labels.length > LIMITS.sizeLabels) throw userError(`At most ${LIMITS.sizeLabels} size labels.`);

  return {
    version: DEFINITION_VERSION,
    theme: {
      useCompanyBrand: def.theme.useCompanyBrand,
      brandColor: color(def.theme.brandColor, "The brand color"),
      accentColor: color(def.theme.accentColor, "The accent color"),
      typography: def.theme.typography,
      background: def.theme.background,
      surface: def.theme.surface,
      radius: def.theme.radius,
      buttonStyle: def.theme.buttonStyle,
      ...(def.theme.heroImage ? { heroImage: def.theme.heroImage } : {}),
      showIllustrations: def.theme.showIllustrations,
    },
    header: { showPhone: def.header.showPhone, showWebsite: def.header.showWebsite, showProgress: def.header.showProgress, helpLabel: plain(def.header.helpLabel, "The help label", LIMITS.button) },
    steps,
    services: {
      offered: offered.map((s) => {
        if (s.benefits.length > LIMITS.benefits) throw userError(`A service card can list at most ${LIMITS.benefits} benefits.`);
        return {
          serviceKey: plain(s.serviceKey, "A service", 80, false),
          displayName: plain(s.displayName, "A service's display name", LIMITS.name),
          blurb: plain(s.blurb, "A service's description", LIMITS.blurb),
          benefits: s.benefits.map((b) => plain(b, "A benefit", LIMITS.benefit, false)),
          badge: plain(s.badge, "A card label", 30),
          hidden: s.hidden,
        };
      }),
      featuredKey,
      comparison: { title: plain(def.services.comparison.title, "The comparison title", LIMITS.title), rows },
      showExtras: def.services.showExtras,
      showFrequencies: def.services.showFrequencies,
    },
    sizes: { labels, customQuoteTitle: plain(def.sizes.customQuoteTitle, "The custom-quote title", LIMITS.title), customQuoteButton: plain(def.sizes.customQuoteButton, "The custom-quote button", LIMITS.button) },
    content: {
      trust,
      faqs,
      nextSteps,
      promo: { text: plain(def.content.promo.text, "The offer banner", LIMITS.subtitle) },
      outOfAreaTitle: plain(def.content.outOfAreaTitle, "The out-of-area title", LIMITS.title),
      outOfAreaBody: plain(def.content.outOfAreaBody, "The out-of-area text", LIMITS.subtitle),
      requestTitle: plain(def.content.requestTitle, "The request title", LIMITS.title),
      requestBody: plain(def.content.requestBody, "The request text", LIMITS.subtitle),
      footerNote: plain(def.content.footerNote, "The footer note", LIMITS.footer),
    },
    behavior: {
      mode: def.behavior.mode,
      customQuoteAboveArea: def.behavior.customQuoteAboveArea,
      paymentPolicyId: def.behavior.paymentPolicyId,
      agreementId: def.behavior.agreementId,
      detailsTiming: def.behavior.detailsTiming,
      outOfArea: def.behavior.outOfArea,
      promotionId: def.behavior.promotionId ? plain(def.behavior.promotionId, "The promotion", 80) || null : null,
      questions,
      notifyOfficeOnRequest: def.behavior.notifyOfficeOnRequest,
      offerRecovery: def.behavior.offerRecovery,
    },
    attribution: { source: plain(def.attribution.source, "The source", 60), campaign: plain(def.attribution.campaign, "The campaign", 80) },
  };
}

/** True when a condition holds for these answers. A missing answer never satisfies a condition. */
export function conditionHolds(cond: Condition | undefined, facts: { answers: Record<string, unknown>; serviceKey: string | null; mode: BookingMode }): boolean {
  if (!cond) return true;
  if (cond.kind === "service_is") return facts.serviceKey === cond.serviceKey;
  if (cond.kind === "mode_is") return facts.mode === cond.mode;
  const answer = facts.answers[cond.questionId];
  if (Array.isArray(answer)) return answer.includes(cond.value);
  return answer !== undefined && String(answer) === cond.value;
}

/** Checks one custom answer against its question. Returns the stored value, or throws a person-readable error. */
export function checkAnswer(q: CustomQuestion, value: unknown): string | number | boolean | string[] | null {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
    return null;
  }
  switch (q.type) {
    case "short_text":
    case "long_text":
      if (typeof value !== "string") throw userError(`"${q.label}" needs text.`);
      return plain(value, q.label, q.max);
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n) || n < 0 || n > q.max) throw userError(`"${q.label}" must be a number from 0 to ${q.max}.`);
      return n;
    }
    case "yes_no":
      if (typeof value !== "boolean") throw userError(`Answer "${q.label}" with yes or no.`);
      return value;
    case "choice":
      if (typeof value !== "string" || !q.options.includes(value)) throw userError(`Choose one of the answers for "${q.label}".`);
      return value;
    case "multi_choice":
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !q.options.includes(item))) throw userError(`Choose from the answers for "${q.label}".`);
      return [...new Set(value as string[])];
    case "date":
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw userError(`"${q.label}" needs a date.`);
      return value;
  }
}
