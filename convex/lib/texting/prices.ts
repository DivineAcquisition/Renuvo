/**
 * What a cleaning company pays Selestial for its texting registration. Selestial's own prices, set here,
 * never the carriers' or Telnyx's: an owner never sees a wholesale cost. Versioned like the messaging
 * rate card and never edited once published: an owner's authorization stores the version it was given,
 * so a later price change never applies to a registration already authorized. Amounts are in units of
 * $0.0001 (convex/lib/messagingBilling/money.ts).
 *
 * The number's own monthly fee and per-message prices stay on the messaging rate card.
 */
import { formatUnits } from "../messagingBilling/money";
import { rateCardAt } from "../messagingBilling/rates";

export type RegistrationPrices = {
  version: string;
  effectiveFrom: number;
  /** Once, when Selestial files the registration with the carriers. */
  setup: number;
  /** Each time a corrected registration is filed again after the carriers asked for changes. */
  resubmission: number;
  /** Each calendar month the registration is active, starting the day texting is ready. */
  monthly: number;
};

export const REGISTRATION_PRICES: readonly RegistrationPrices[] = [{ version: "reg-2026-11", effectiveFrom: Date.UTC(2026, 10, 19), setup: 190_000, resubmission: 150_000, monthly: 100_000 }];

export function registrationPricesAt(at: number): RegistrationPrices {
  const live = REGISTRATION_PRICES.filter((row) => row.effectiveFrom <= at).sort((a, b) => b.effectiveFrom - a.effectiveFrom);
  return live[0] ?? REGISTRATION_PRICES[0];
}

export function registrationPrices(version: string): RegistrationPrices | null {
  return REGISTRATION_PRICES.find((row) => row.version === version) ?? null;
}

export type Charge = { key: "setup" | "resubmission" | "monthly" | "number" | "usage"; label: string; amount: string; when: string; afterRejection: string };

/** Every charge an owner authorizes, in words, from the prices in force at `at`. Shown on Review, stored with the authorization. */
export function chargesAt(at: number): { prices: RegistrationPrices; numberMonthly: number; rows: Charge[] } {
  const prices = registrationPricesAt(at);
  const card = rateCardAt(at);
  const rows: Charge[] = [
    { key: "setup", label: "Registration setup", amount: formatUnits(prices.setup), when: "Once, when Selestial files your registration with the carriers, after Selestial review.", afterRejection: "Not refunded if the carriers turn the registration down: the filing has been made." },
    { key: "resubmission", label: "Corrected registration", amount: formatUnits(prices.resubmission), when: "Only if the carriers ask for changes, each time a corrected registration is filed again.", afterRejection: "Charged only when you choose to file again." },
    { key: "monthly", label: "Registration upkeep", amount: `${formatUnits(prices.monthly)} a month`, when: "Each month the registration is active, starting the day texting is ready.", afterRejection: "Never charged unless texting becomes ready." },
    { key: "number", label: "Texting number", amount: `${formatUnits(card.numberMonthly)} a month`, when: "Each month the number is active, starting the day texting is ready.", afterRejection: "Never charged unless texting becomes ready." },
    { key: "usage", label: "Texts", amount: `${formatUnits(card.rates.sms_out)} per outbound text segment, ${formatUnits(card.rates.mms_out)} per picture message`, when: "As texts are sent and received, from your messaging balance.", afterRejection: "Nothing is sent, so nothing is charged." },
  ];
  return { prices, numberMonthly: card.numberMonthly, rows };
}

/** The exact words an owner authorizes. The server accepts the authorization only if it matches character for character. */
export function registrationWording(at: number): string {
  const { prices, numberMonthly } = chargesAt(at);
  return `I authorize Selestial to take from my messaging balance: ${formatUnits(prices.setup)} once when my texting registration is filed with the carriers, ${formatUnits(prices.resubmission)} each time I choose to file a corrected registration, and, starting the day texting is ready, ${formatUnits(prices.monthly)} a month for the registration and ${formatUnits(numberMonthly)} a month for the number while they are active. Texts are charged at the messaging rates shown. The setup fee is not refunded if the carriers turn the registration down. A low balance never releases the number.`;
}
