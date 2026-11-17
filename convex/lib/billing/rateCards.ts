/**
 * The task rate card: how many Selestial Credits one defined unit of AI work costs.
 *
 * A credit is a unit of defined AI work. It is not a token, not money, and not a promise of a business
 * result. Each task below names exactly one billable unit, and that unit is charged when it is
 * completed, whatever number of model calls, tool uses or internal retries it took.
 *
 * Cards are versioned and never edited once published: a change is a new version. Each execution stores
 * the version and the credits it was priced at, so completed work is never repriced.
 *
 * Which card is in force is the deployment setting BILLING_RATE_CARD. A fixture card exists only to test
 * the whole flow in Autumn's sandbox; it can never be used with a live key. The production card has no
 * values until Selestial approves them, and until it does, no paid AI work and no credit purchase can
 * happen in production.
 */

export const TASK_IDS = ["chat_response_standard", "chat_response_advanced", "hiring_message_reading", "image_generation", "image_edit", "video_generation", "applicant_evaluation", "follow_up_draft", "dispatch_exception_analysis", "retention_assessment", "agreement_draft", "campaign_generation", "research_brief", "sales_message_reading"] as const;
export type Task = (typeof TASK_IDS)[number];

export const TASKS: Record<Task, { label: string; unit: string; available: boolean }> = {
  chat_response_standard: {
    label: "Chat response",
    unit: "One completed Company Chat response on a standard model, within the response limits (at most 8 tool steps).",
    available: true,
  },
  chat_response_advanced: {
    label: "Chat response, advanced model",
    unit: "One completed Company Chat response on a higher-cost model, within the same limits.",
    available: true,
  },
  hiring_message_reading: {
    label: "Hiring email read by AI",
    unit: "One hiring email read by the AI reader for Recruiter. Mail the reader is not used for (rule-read job-board notices, unrelated mail) is not charged.",
    available: true,
  },
  image_generation: {
    label: "Image generated",
    unit: "One finished image from Creative Studio. A batch is charged per image delivered.",
    available: true,
  },
  image_edit: {
    label: "Image edited",
    unit: "One finished edited image from Creative Studio.",
    available: true,
  },
  video_generation: {
    label: "Video generated",
    unit: "One finished video from Creative Studio, up to the length the request allows.",
    available: true,
  },
  applicant_evaluation: {
    label: "Applicant evaluation",
    unit: "One applicant's application evaluated against one role. Evaluating ten applicants is ten units.",
    available: false,
  },
  follow_up_draft: {
    label: "Personalized follow-up draft",
    unit: "One personalized message drafted for one recipient. Sending it, by email or text, is measured separately.",
    available: false,
  },
  dispatch_exception_analysis: {
    label: "Dispatch exception analysis",
    unit: "One analysis of one visit's exception (a decline, a delay, a missed check-in).",
    available: false,
  },
  retention_assessment: {
    label: "Retention assessment",
    unit: "One assessment of one customer's relationship.",
    available: false,
  },
  agreement_draft: {
    label: "Agreement draft",
    unit: "One agreement drafted with AI guidance, as one Chat response.",
    available: false,
  },
  campaign_generation: {
    label: "Campaign generation",
    unit: "One campaign's content generated.",
    available: false,
  },
  research_brief: {
    label: "Pricing research brief",
    unit: "One research brief for Services & Pricing: up to 5 web searches and one written brief with its sources. A brief that finds nothing usable is still one unit; one that fails to finish is not charged.",
    available: true,
  },
  sales_message_reading: {
    label: "Sales message read by AI",
    unit: "One customer message read and one reply worded by the AI reader for Sales. Messages the reader is not used for (read by the company's rules, or never answered) are not charged.",
    available: true,
  },
};

/** The exact setup a media rate covers. Work outside it has no published price, so it cannot run. */
export type Spec = { sizes?: readonly string[]; durations?: readonly number[]; fastAllowed?: boolean; describe: string };

export type RateCard = {
  version: string;
  /** Only for Autumn's sandbox. Refused with a live key. */
  fixture: boolean;
  /** Credits per unit. Null means not approved: that work cannot be charged, so it cannot run. */
  rates: Record<Task, number | null>;
  /** For media, what the rate covers. Absent: every setup Creative Studio offers. */
  specs?: Partial<Record<Task, Spec>>;
  /** Shown as "starting at" until an exact estimate is made for the chosen setup. */
  startingAt?: Partial<Record<Task, boolean>>;
  note: string;
};

/** The setup of one piece of media work, for pricing it exactly. */
export type Variant = { size?: string; fast?: boolean; durationSeconds?: number };

export const RATE_CARDS: readonly RateCard[] = [
  {
    version: "fixture-2026-11",
    fixture: true,
    note: "Test values for verifying the full flow in Autumn's sandbox. Not an offer and never shown as one.",
    rates: {
      chat_response_standard: 1,
      chat_response_advanced: 3,
      hiring_message_reading: 1,
      image_generation: 10,
      image_edit: 8,
      video_generation: 60,
      applicant_evaluation: 2,
      follow_up_draft: 1,
      dispatch_exception_analysis: 2,
      retention_assessment: 2,
      agreement_draft: 5,
      campaign_generation: 20,
      research_brief: 5,
      sales_message_reading: 1,
    },
  },
  {
    version: "2026-11",
    fixture: false,
    note: "The production card, approved by the owner on November 16, 2026. Never in force with other values.",
    rates: {
      chat_response_standard: 1,
      chat_response_advanced: 5,
      hiring_message_reading: 1,
      image_generation: 20,
      image_edit: 15,
      video_generation: 200,
      applicant_evaluation: null,
      follow_up_draft: null,
      dispatch_exception_analysis: null,
      retention_assessment: null,
      agreement_draft: null,
      campaign_generation: null,
      /** Research briefs did not exist when this card was approved. Under this card they have no rate, so they cannot run. */
      research_brief: null,
      /** Sales did not exist when this card was approved, so its AI reading has no rate here and the company's rules read instead. */
      sales_message_reading: null,
    },
    specs: {
      image_generation: { sizes: ["1024x1024"], fastAllowed: false, describe: "Standard quality, 1024 × 1024, one image per charge." },
      image_edit: { sizes: ["1024x1024"], describe: "Standard quality, 1024 × 1024, one edited image per charge." },
      video_generation: { durations: [6], describe: "One 6-second clip at the standard resolution with the model's default audio. Other lengths have no published price yet." },
    },
    startingAt: { video_generation: true },
  },
  {
    version: "2026-11b",
    fixture: false,
    note: "The 2026-11 rates unchanged, plus pricing research briefs at 10 credits, approved by the owner on November 16, 2026. Put in force by setting BILLING_RATE_CARD to 2026-11b.",
    rates: {
      chat_response_standard: 1,
      chat_response_advanced: 5,
      hiring_message_reading: 1,
      image_generation: 20,
      image_edit: 15,
      video_generation: 200,
      applicant_evaluation: null,
      follow_up_draft: null,
      dispatch_exception_analysis: null,
      retention_assessment: null,
      agreement_draft: null,
      campaign_generation: null,
      research_brief: 10,
      /** Not approved on this card either: until a card gives it a rate, Sales reads by rule and charges nothing. */
      sales_message_reading: null,
    },
    specs: {
      image_generation: { sizes: ["1024x1024"], fastAllowed: false, describe: "Standard quality, 1024 × 1024, one image per charge." },
      image_edit: { sizes: ["1024x1024"], describe: "Standard quality, 1024 × 1024, one edited image per charge." },
      video_generation: { durations: [6], describe: "One 6-second clip at the standard resolution with the model's default audio. Other lengths have no published price yet." },
    },
    startingAt: { video_generation: true },
  },
];

export function rateCard(version: string | undefined): RateCard | null {
  return RATE_CARDS.find((card) => card.version === version?.trim()) ?? null;
}

export function activeRateCard(): RateCard | null {
  return rateCard(process.env.BILLING_RATE_CARD);
}

/** Whether a media setup is inside what the card's rate covers. */
export function withinSpec(card: RateCard, task: Task, variant: Variant = {}): boolean {
  const spec = card.specs?.[task];
  if (!spec) return true;
  if (spec.sizes && variant.size !== undefined && !spec.sizes.includes(variant.size)) return false;
  if (spec.sizes && variant.size === undefined && !spec.sizes.includes("1024x1024")) return false;
  if (spec.fastAllowed === false && variant.fast) return false;
  if (spec.durations && !spec.durations.includes(variant.durationSeconds ?? 6)) return false;
  return true;
}

/** Credits for `units` of a task on a card, or null when the card has no approved rate for it (or for this setup). */
export function priceOf(card: RateCard, task: Task, units: number, variant: Variant = {}): number | null {
  const rate = card.rates[task];
  if (rate === null || !Number.isFinite(rate) || rate < 0 || !Number.isInteger(units) || units < 1) return null;
  if (!withinSpec(card, task, variant)) return null;
  return rate * units;
}
