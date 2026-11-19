/**
 * Money for messaging, in whole units of $0.0001 (a hundredth of a cent). Every rate on the launch card is
 * a whole number in this unit (an outbound text segment is 250, an email recipient is 20), so charges
 * smaller than a cent are exact and nothing is ever a floating-point dollar. Autumn's `messaging_balance`
 * feature counts in the same unit: a $25 top-up is 250,000 units.
 */

/** Units per US dollar. */
export const UNITS_PER_DOLLAR = 10_000;
/** Units per US cent. */
export const UNITS_PER_CENT = 100;

export function assertUnits(value: number, what = "An amount"): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${what} must be a whole number of $0.0001 units.`);
  return value;
}

export function dollarsToUnits(dollars: number): number {
  // Only for whole cents typed by a person or a configured pack; refuse anything finer.
  const cents = Math.round(dollars * 100);
  if (Math.abs(cents / 100 - dollars) > 1e-9) throw new Error("Use whole cents.");
  return cents * UNITS_PER_CENT;
}

export function centsToUnits(cents: number): number {
  return assertUnits(cents, "Cents") * UNITS_PER_CENT;
}

/** Whole cents, rounded up: what a card would be charged for this many units. */
export function unitsToCentsCeil(units: number): number {
  return Math.ceil(assertUnits(units) / UNITS_PER_CENT);
}

/**
 * "$25.00", "$0.025", "$0.0025", "-$1.50". At least two decimals, and as many more (up to four) as the
 * amount needs, so a fraction of a cent is never rounded away on screen.
 */
export function formatUnits(units: number): string {
  assertUnits(units);
  const negative = units < 0;
  const abs = Math.abs(units);
  const whole = Math.floor(abs / UNITS_PER_DOLLAR);
  let fraction = String(abs % UNITS_PER_DOLLAR).padStart(4, "0");
  while (fraction.length > 2 && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  const grouped = whole.toLocaleString("en-US");
  return `${negative ? "-" : ""}$${grouped}.${fraction}`;
}

/** Rate × count, checked for overflow. */
export function times(rate: number, count: number): number {
  return assertUnits(assertUnits(rate, "A rate") * assertUnits(count, "A count"), "A charge");
}
