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

export const TASK_IDS = ["chat_response_standard", "chat_response_advanced", "hiring_message_reading", "image_generation", "image_edit", "video_generation", "applicant_evaluation", "follow_up_draft", "dispatch_exception_analysis", "retention_assessment", "agreement_draft", "campaign_generation"] as const;
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
};

export type RateCard = {
  version: string;
  /** Only for Autumn's sandbox. Refused with a live key. */
  fixture: boolean;
  /** Credits per unit. Null means not approved: that work cannot be charged, so it cannot run. */
  rates: Record<Task, number | null>;
  note: string;
};

const unapproved = Object.fromEntries(TASK_IDS.map((task) => [task, null])) as Record<Task, null>;

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
    },
  },
  {
    version: "2026-11",
    fixture: false,
    note: "The production card. Rates are not approved yet.",
    rates: unapproved,
  },
];

export function rateCard(version: string | undefined): RateCard | null {
  return RATE_CARDS.find((card) => card.version === version?.trim()) ?? null;
}

export function activeRateCard(): RateCard | null {
  return rateCard(process.env.BILLING_RATE_CARD);
}

/** Credits for `units` of a task on a card, or null when the card has no approved rate for it. */
export function priceOf(card: RateCard, task: Task, units: number): number | null {
  const rate = card.rates[task];
  if (rate === null || !Number.isFinite(rate) || rate < 0 || !Number.isInteger(units) || units < 1) return null;
  return rate * units;
}
