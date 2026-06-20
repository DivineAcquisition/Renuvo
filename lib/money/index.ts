// ============================================================================
// RENUVO — MONEY CORE. Canonical unit: microdollars (µ$). Integers only.
// 1 USD = 1_000_000 µ$ · 1 cent = 10_000 µ$
// ============================================================================
export const USD = 1_000_000;
export const CENT = 10_000;

export type Microdollars = number; // canonical
export type Cents = number;

/** Constructors → µ$ */
export const fromUsd = (usd: number): Microdollars => Math.round(usd * USD);
export const fromCents = (c: Cents): Microdollars => Math.round(c * CENT);
export const fromMicro = (m: number): Microdollars => Math.round(m);

/** Conversions out of µ$ */
export const toCents = (m: Microdollars): Cents => Math.round(m / CENT);
export const toUsd = (m: Microdollars): number => m / USD;

/** Safe arithmetic (integer µ$) */
export const add = (...xs: Microdollars[]) => xs.reduce((a, b) => a + b, 0);
export const sub = (a: Microdollars, b: Microdollars) => a - b;
export const mul = (m: Microdollars, factor: number) => Math.round(m * factor);

/** Single formatter used EVERYWHERE. */
export function formatMoney(
  m: Microdollars,
  opts: { currency?: string; cents?: boolean } = {}
): string {
  const { currency = "USD", cents = true } = opts;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(toUsd(m));
}

/** Stripe boundary helpers (Stripe wants integer cents). */
export const toStripeAmount = (m: Microdollars): number => toCents(m);
export const fromStripeAmount = (cents: number): Microdollars => fromCents(cents);
