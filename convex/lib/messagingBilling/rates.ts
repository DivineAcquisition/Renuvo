/**
 * The messaging rate card. Versioned and never edited after publication: each charge stores the version and
 * unit price it was authorized under, so queued or completed messages are never repriced. Amounts are in
 * units of $0.0001 (money.ts). USD. Standard US carrier surcharges are included in the SMS and MMS rates.
 *
 * Applies only to supported standard US routes (routes.ts). International destinations, premium and short
 * codes, toll-free and other unsupported number types have no rate and are refused before sending.
 */

export const MESSAGING_KINDS = ["sms_out", "sms_in", "mms_out", "mms_in", "email_out"] as const;
export type MessagingKind = (typeof MESSAGING_KINDS)[number];

export type RateCard = {
  version: string;
  /** When this card starts applying to newly authorized messages (ms since epoch). */
  effectiveFrom: number;
  /** Per segment for SMS, per message for MMS, per recipient for email. */
  rates: Record<MessagingKind, number>;
  /** Per active dedicated US local number, per month. */
  numberMonthly: number;
  /** A test card: never chosen by date, only when pinned with MESSAGING_RATE_CARD. Never offered to customers. */
  fixture?: boolean;
};

export const RATE_CARDS: readonly RateCard[] = [
  {
    version: "msg-2026-11",
    effectiveFrom: Date.UTC(2026, 10, 18),
    rates: { sms_out: 250, sms_in: 150, mms_out: 500, mms_in: 400, email_out: 20 },
    numberMonthly: 30_000,
  },
  {
    // For tests of a price change while messages are in flight. Never in force by date.
    version: "msg-fixture-higher",
    effectiveFrom: Number.MAX_SAFE_INTEGER,
    rates: { sms_out: 400, sms_in: 300, mms_out: 800, mms_in: 600, email_out: 40 },
    numberMonthly: 40_000,
    fixture: true,
  },
];

export const KIND_WORDS: Record<MessagingKind, { label: string; unit: string; units: string }> = {
  sms_out: { label: "Outbound text", unit: "segment", units: "segments" },
  sms_in: { label: "Inbound text", unit: "segment", units: "segments" },
  mms_out: { label: "Outbound picture message", unit: "message", units: "messages" },
  mms_in: { label: "Inbound picture message", unit: "message", units: "messages" },
  email_out: { label: "Business email (Selestial delivery)", unit: "recipient", units: "recipients" },
};

/** The card in force at `at`. A card set by MESSAGING_RATE_CARD pins the version (for tests and staged changes). */
export function rateCardAt(at: number): RateCard {
  const pinned = process.env.MESSAGING_RATE_CARD?.trim();
  if (pinned) {
    const card = RATE_CARDS.find((c) => c.version === pinned);
    if (card) return card;
  }
  const live = RATE_CARDS.filter((c) => !c.fixture && c.effectiveFrom <= at).sort((a, b) => b.effectiveFrom - a.effectiveFrom);
  return live[0] ?? RATE_CARDS[0];
}

export function rateCard(version: string): RateCard | null {
  return RATE_CARDS.find((c) => c.version === version) ?? null;
}

/** Whole-number price for `count` billable units of `kind` on `card`. */
export function priceOf(card: RateCard, kind: MessagingKind, count: number): { unitPrice: number; amount: number } {
  const unitPrice = card.rates[kind];
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("A count must be a whole number.");
  return { unitPrice, amount: unitPrice * count };
}
