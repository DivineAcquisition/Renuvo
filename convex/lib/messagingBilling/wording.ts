/**
 * Words the Owner reads about messaging money. Pure, so the settings page shows exactly what the server
 * checks: the automatic top-up authorization is accepted only if it matches these words character for character.
 */
import { formatUnits } from "./money";

export function autoTopUpWording(input: { threshold: number; amount: number; monthlyMax: number }): string {
  const times = Math.floor(input.monthlyMax / input.amount);
  return `I authorize Selestial to charge my saved payment method ${formatUnits(input.amount)} (plus any applicable tax) whenever my messaging balance falls below ${formatUnits(input.threshold)}, up to ${times} time${times === 1 ? "" : "s"} (${formatUnits(times * input.amount)}) per calendar month, until I turn automatic top-up off. Each top-up appears on its own receipt.`;
}

/** What is included with the plan and never taken from the messaging balance. */
export const INCLUDED_MESSAGING = [
  "Sign-in, security and verification messages",
  "Receipts and billing notices from Selestial",
  "Team invitations and onboarding emails",
  "Approval alerts and daily digests",
  "Low-balance and disconnection alerts",
  "Email sent through your connected Gmail (Google delivers it)",
  "Reading your inbox and replies",
  "STOP, HELP and opt-out replies",
] as const;

/** Routes that are not offered: messages to them are refused before anything is charged. */
export const UNAVAILABLE_ROUTES = ["International numbers, including Canada", "Short codes and premium numbers", "Toll-free numbers", "US territories and Caribbean numbers"] as const;

export const CHARGE_STATE_WORDS: Record<string, string> = {
  estimated: "Estimate",
  reserving: "Setting aside",
  reserved: "Set aside while sending",
  pending: "Waiting for the carrier",
  captured: "Charged",
  released: "Not charged",
  refunded: "Refunded",
};

export const TOP_UP_STATE_WORDS: Record<string, string> = {
  payment_needed: "Waiting for payment",
  paid: "Paid",
  failed: "Payment failed",
  refunded: "Refunded",
  partly_refunded: "Partly refunded",
  disputed: "Disputed",
  dispute_won: "Paid (dispute resolved)",
};
