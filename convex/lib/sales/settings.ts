/**
 * The Sales Playbook: how Sales works for one company. Every value is the Owner's, with a default here.
 * Authority (what Sales may send without asking) is not in this file: it is the shared permission
 * catalog and Settings, like every other agent's.
 */
import type { Doc } from "../../_generated/dataModel";
import { userError } from "../errors";
import { optionalText, text } from "../text";
import { SERVICE_KINDS, TONES, type DepositRule, type SalesSettingsInput, type ServiceKind } from "./agentSchema";

export type SalesSettings = {
  voice: { tone: (typeof TONES)[number]; signature: string | null };
  eligibility: { kinds: ServiceKind[]; textInquiries: boolean; commercialNeedsWalkthrough: boolean };
  answers: { id: string; topic: string; question: string; answer: string }[];
  followUp: { missingInfoHours: number[]; quoteHours: number[]; bookingHours: number[] };
  discounts: { maxPercent: number; reasons: string[] };
  booking: { agreementRequired: boolean; deposit: DepositRule; holdMinutes: number; minimumNoticeHours: number };
  quotes: { validDays: number; paymentTerms: string; cancellationTerms: string; reviewAboveCents: number | null };
  escalation: { keywords: string[] };
  firstBatchDecidedAt: number | null;
  revision: number;
};

export const SALES_DEFAULTS: Omit<SalesSettings, "firstBatchDecidedAt" | "revision"> = {
  voice: { tone: "warm", signature: null },
  eligibility: { kinds: ["residential", "short_term_rental", "commercial"], textInquiries: true, commercialNeedsWalkthrough: true },
  answers: [],
  // One day, then three days: two reminders and no more. A reply, a decline, an opt-out or a person stepping in ends them sooner.
  followUp: { missingInfoHours: [24, 72], quoteHours: [48, 120], bookingHours: [24, 72] },
  discounts: { maxPercent: 0, reasons: [] },
  booking: { agreementRequired: false, deposit: { kind: "none" }, holdMinutes: 120, minimumNoticeHours: 24 },
  quotes: {
    validDays: 14,
    paymentTerms: "Payment is due when the service is complete, unless your quote names a deposit.",
    cancellationTerms: "Tell us at least 24 hours before your appointment if you need to cancel or move it.",
    reviewAboveCents: null,
  },
  escalation: { keywords: [] },
};

/** Things that always go to a person, whatever the Playbook lists (the brief, section 7). */
export const ALWAYS_ESCALATE = /\b(damage[ds]?|broke|broken|injur(y|ed|ies)|lawsuit|lawyer|attorney|sue|legal|dispute|chargeback|refund|complain(t|ing)?|theft|stolen|insurance claim)\b/i;

export const LIMITS = { answers: 40, reminders: 4, keywords: 30, reasons: 10, maxDiscountPercent: 30, holdMinutes: 24 * 60, validDays: 90 } as const;

export function salesSettings(company: Pick<Doc<"companies">, "sales">): SalesSettings {
  const stored = company.sales ?? {};
  return {
    voice: { tone: stored.voice?.tone ?? SALES_DEFAULTS.voice.tone, signature: stored.voice?.signature ?? null },
    eligibility: stored.eligibility ?? SALES_DEFAULTS.eligibility,
    answers: stored.answers ?? [],
    followUp: stored.followUp ?? SALES_DEFAULTS.followUp,
    discounts: stored.discounts ?? SALES_DEFAULTS.discounts,
    booking: stored.booking ?? SALES_DEFAULTS.booking,
    quotes: stored.quotes ?? SALES_DEFAULTS.quotes,
    escalation: stored.escalation ?? SALES_DEFAULTS.escalation,
    firstBatchDecidedAt: stored.firstBatchDecidedAt ?? null,
    revision: stored.revision ?? 0,
  };
}

const hours = (values: number[], label: string): number[] => {
  if (values.length > LIMITS.reminders) throw userError(`${label}: at most ${LIMITS.reminders} reminders.`);
  let last = 0;
  for (const value of values) {
    if (!Number.isInteger(value) || value < 1 || value > 24 * 60) throw userError(`${label}: each reminder is a whole number of hours, from 1 hour to 60 days.`);
    if (value <= last) throw userError(`${label}: each reminder must come later than the one before it.`);
    last = value;
  }
  return values;
};

/** Checks a Playbook the Owner is saving and answers with exactly what is stored. Anything out of range is refused, never silently changed. */
export function normalizeSales(input: SalesSettingsInput, current: SalesSettings): NonNullable<Doc<"companies">["sales"]> {
  const voice = input.voice ?? current.voice;
  const eligibility = input.eligibility ?? current.eligibility;
  if (eligibility.kinds.some((kind) => !(SERVICE_KINDS as readonly string[]).includes(kind))) throw userError("Choose from homes, short-term rentals and commercial.");
  const answers = (input.answers ?? current.answers).map((row) => ({ id: text(row.id, "The answer's id", 40), topic: text(row.topic, "The topic", 60), question: text(row.question, "The question", 300), answer: text(row.answer, "The answer", 1200) }));
  if (answers.length > LIMITS.answers) throw userError(`Keep it to ${LIMITS.answers} approved answers.`);
  if (new Set(answers.map((row) => row.id)).size !== answers.length) throw userError("Two approved answers share an id.");
  const followUp = input.followUp ?? current.followUp;
  const discounts = input.discounts ?? current.discounts;
  if (!Number.isFinite(discounts.maxPercent) || discounts.maxPercent < 0 || discounts.maxPercent > LIMITS.maxDiscountPercent) throw userError(`The discount band is a percent from 0 to ${LIMITS.maxDiscountPercent}.`);
  if (discounts.reasons.length > LIMITS.reasons) throw userError(`Keep it to ${LIMITS.reasons} discount reasons.`);
  if (discounts.maxPercent > 0 && discounts.reasons.length === 0) throw userError("Say when a discount is allowed. Sales never discounts because a prospect hesitates.");
  const booking = input.booking ?? current.booking;
  if (!Number.isInteger(booking.holdMinutes) || booking.holdMinutes < 15 || booking.holdMinutes > LIMITS.holdMinutes) throw userError("A hold lasts from 15 minutes to 24 hours.");
  if (!Number.isInteger(booking.minimumNoticeHours) || booking.minimumNoticeHours < 0 || booking.minimumNoticeHours > 24 * 30) throw userError("Minimum notice is a whole number of hours, up to 30 days.");
  if (booking.deposit.kind === "percent" && (!Number.isFinite(booking.deposit.percent) || booking.deposit.percent <= 0 || booking.deposit.percent >= 100)) throw userError("A deposit percent is above 0 and below 100.");
  if (booking.deposit.kind === "fixed" && (!Number.isInteger(booking.deposit.cents) || booking.deposit.cents <= 0)) throw userError("A fixed deposit is an amount above zero.");
  const quotes = input.quotes ?? current.quotes;
  if (!Number.isInteger(quotes.validDays) || quotes.validDays < 1 || quotes.validDays > LIMITS.validDays) throw userError(`A quote stays open from 1 to ${LIMITS.validDays} days.`);
  if (quotes.reviewAboveCents !== null && (!Number.isInteger(quotes.reviewAboveCents) || quotes.reviewAboveCents < 0)) throw userError("The review threshold is an amount, or none.");
  const escalation = input.escalation ?? current.escalation;
  if (escalation.keywords.length > LIMITS.keywords) throw userError(`Keep it to ${LIMITS.keywords} words.`);
  return {
    voice: { tone: voice.tone, ...(optionalText(voice.signature ?? undefined, "The signature", 120) ? { signature: optionalText(voice.signature ?? undefined, "The signature", 120) } : {}) },
    eligibility: { kinds: [...new Set(eligibility.kinds)], textInquiries: eligibility.textInquiries, commercialNeedsWalkthrough: eligibility.commercialNeedsWalkthrough },
    answers,
    followUp: { missingInfoHours: hours(followUp.missingInfoHours, "Missing details"), quoteHours: hours(followUp.quoteHours, "Quote follow-ups"), bookingHours: hours(followUp.bookingHours, "Booking steps") },
    discounts: { maxPercent: discounts.maxPercent, reasons: discounts.reasons.map((reason) => text(reason, "A discount reason", 160)) },
    booking,
    quotes: { validDays: quotes.validDays, paymentTerms: text(quotes.paymentTerms, "Payment terms", 600), cancellationTerms: text(quotes.cancellationTerms, "Cancellation terms", 600), reviewAboveCents: quotes.reviewAboveCents },
    escalation: { keywords: [...new Set(escalation.keywords.map((word) => text(word, "A word", 40).toLowerCase()))] },
    ...(current.firstBatchDecidedAt !== null ? { firstBatchDecidedAt: current.firstBatchDecidedAt } : {}),
    revision: current.revision + 1,
  };
}

/** The deposit a quote asks for, from the Owner's rule. Never more than the total, and nothing when the rule is none. */
export function depositFor(rule: DepositRule, totalCents: number): number | undefined {
  if (rule.kind === "none" || totalCents <= 0) return undefined;
  const cents = rule.kind === "percent" ? Math.round((totalCents * rule.percent) / 100) : rule.cents;
  return cents > 0 && cents < totalCents ? cents : undefined;
}
