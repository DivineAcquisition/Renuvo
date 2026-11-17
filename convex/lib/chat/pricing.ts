/**
 * The pricing calculator chat uses for every price. A model never does the arithmetic: it passes the
 * inputs here and reports what comes back, with the formulas shown.
 *
 * Two distinctions it keeps on purpose:
 *  - Labor-hours are people times hours. Elapsed time is how long the visit takes on the clock. A crew of
 *    three for two hours is six labor-hours and two elapsed hours.
 *  - Margin is profit as a share of the price. Markup is profit as a share of the cost. A 50% markup is a
 *    33.3% margin, not a 50% one.
 *
 * Money is whole cents. Percentages are given as numbers: 35 means 35%.
 */

export type PricingInput = {
  name?: string;
  /** People on the visit. With elapsedHours, gives labor-hours. */
  crewSize?: number;
  /** Hours on the clock for the visit. */
  elapsedHours?: number;
  /** Total person-hours, when known directly. Must agree with crewSize × elapsedHours when all three are given. */
  laborHours?: number;
  /** What one labor-hour costs the company, wages and payroll costs included. */
  laborCostPerHourCents: number;
  suppliesCents?: number;
  travelCents?: number;
  otherDirectCents?: number;
  /** Overhead as a percent of direct cost. */
  overheadPercent?: number;
  /** Overhead as a fixed amount per visit. Added to any percent. */
  overheadPerVisitCents?: number;
  /** Profit as a percent of the price. */
  targetMarginPercent?: number;
  /** Profit as a percent of the cost. */
  markupPercent?: number;
  /** For recurring service: visits in a month. For an every-N-days schedule this is an annual average (4.35 for every 7 days), never 4. */
  visitsPerMonth?: number;
  /** Round each price up to a multiple of this many cents, for example 500 for $5. */
  roundToCents?: number;
};

export type PricingResult = {
  name: string;
  crewSize: number | null;
  elapsedHours: number | null;
  laborHours: number;
  laborCents: number;
  directCents: number;
  overheadCents: number;
  totalCostCents: number;
  /** Price that leaves the target margin, when one was given. */
  priceAtMarginCents: number | null;
  /** Price at the markup, when one was given. */
  priceAtMarkupCents: number | null;
  /** For each price: profit, margin and markup it really leaves after rounding. */
  checks: { basis: "margin" | "markup"; priceCents: number; profitCents: number; marginPercent: number; markupPercent: number; perLaborHourCents: number; perElapsedHourCents: number | null }[];
  monthly: { visits: number; costCents: number; priceAtMarginCents: number | null; priceAtMarkupCents: number | null } | null;
  formulas: string[];
  assumptions: string[];
};

export class PricingError extends Error {}

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (value: number) => `${Math.round(value * 10) / 10}%`;
const hours = (value: number) => `${Math.round(value * 100) / 100}`;

function nonNegative(value: number | undefined, label: string, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) throw new PricingError(`${label} must be a number from 0 to ${max}.`);
  return value;
}

function centsOf(value: number | undefined, label: string): number {
  const checked = nonNegative(value, label, 100_000_000);
  if (checked === undefined) return 0;
  if (!Number.isInteger(checked)) throw new PricingError(`${label} must be whole cents.`);
  return checked;
}

function roundUp(cents: number, step: number): number {
  const whole = Math.ceil(cents - 1e-9);
  return step > 1 ? Math.ceil(whole / step) * step : whole;
}

export function pricing(input: PricingInput): PricingResult {
  const crewSize = nonNegative(input.crewSize, "Crew size", 100);
  const elapsedHours = nonNegative(input.elapsedHours, "Elapsed hours", 1000);
  const givenLabor = nonNegative(input.laborHours, "Labor-hours", 10_000);
  if (crewSize !== undefined && !Number.isInteger(crewSize)) throw new PricingError("Crew size must be a whole number of people.");
  if (crewSize === 0) throw new PricingError("Crew size must be at least one person.");

  let laborHours: number;
  const formulas: string[] = [];
  const assumptions: string[] = [];
  if (crewSize !== undefined && elapsedHours !== undefined) {
    laborHours = crewSize * elapsedHours;
    if (givenLabor !== undefined && Math.abs(givenLabor - laborHours) > 0.01) {
      throw new PricingError(`Labor-hours (${hours(givenLabor)}) do not match crew size × elapsed hours (${crewSize} × ${hours(elapsedHours)} = ${hours(laborHours)}). Say which is right.`);
    }
    formulas.push(`Labor-hours = crew ${crewSize} × elapsed ${hours(elapsedHours)} h = ${hours(laborHours)} labor-hours`);
  } else if (givenLabor !== undefined) {
    laborHours = givenLabor;
    if (crewSize !== undefined) formulas.push(`Elapsed time = ${hours(laborHours)} labor-hours ÷ crew ${crewSize} = ${hours(laborHours / crewSize)} h`);
    else assumptions.push("Crew size was not given, so the time on the clock is not known.");
  } else {
    throw new PricingError("Give labor-hours, or a crew size and the elapsed hours of the visit.");
  }
  if (laborHours <= 0) throw new PricingError("The visit needs some labor time.");
  const elapsed = elapsedHours ?? (crewSize !== undefined ? laborHours / crewSize : null);

  const rate = centsOf(input.laborCostPerHourCents, "Labor cost per hour");
  if (rate === 0) assumptions.push("Labor cost per hour is zero, so the price covers no wages.");
  const laborCents = Math.round(laborHours * rate);
  formulas.push(`Labor cost = ${hours(laborHours)} labor-hours × ${money(rate)} = ${money(laborCents)}`);

  const supplies = centsOf(input.suppliesCents, "Supplies");
  const travel = centsOf(input.travelCents, "Travel");
  const other = centsOf(input.otherDirectCents, "Other direct cost");
  const directCents = laborCents + supplies + travel + other;
  formulas.push(`Direct cost = labor ${money(laborCents)} + supplies ${money(supplies)} + travel ${money(travel)} + other ${money(other)} = ${money(directCents)}`);
  if (input.suppliesCents === undefined) assumptions.push("No supplies cost was given; it is counted as $0.");
  if (input.travelCents === undefined) assumptions.push("No travel cost was given; it is counted as $0.");

  const overheadPercent = nonNegative(input.overheadPercent, "Overhead percent", 500) ?? 0;
  const overheadFixed = centsOf(input.overheadPerVisitCents, "Overhead per visit");
  const overheadCents = Math.round((directCents * overheadPercent) / 100) + overheadFixed;
  formulas.push(`Overhead = ${pct(overheadPercent)} of ${money(directCents)}${overheadFixed ? ` + ${money(overheadFixed)} per visit` : ""} = ${money(overheadCents)}`);
  if (input.overheadPercent === undefined && input.overheadPerVisitCents === undefined) assumptions.push("No overhead was given; it is counted as $0, so profit is before overhead.");
  const totalCostCents = directCents + overheadCents;
  formulas.push(`Total cost = ${money(directCents)} + ${money(overheadCents)} = ${money(totalCostCents)}`);

  const step = centsOf(input.roundToCents, "Rounding step");
  const margin = nonNegative(input.targetMarginPercent, "Target margin", 99.9);
  const markup = nonNegative(input.markupPercent, "Markup", 1000);
  if (margin === undefined && markup === undefined) throw new PricingError("Give a target margin or a markup to price from.");

  const checks: PricingResult["checks"] = [];
  const check = (basis: "margin" | "markup", priceCents: number) => {
    const profitCents = priceCents - totalCostCents;
    checks.push({
      basis,
      priceCents,
      profitCents,
      marginPercent: priceCents > 0 ? Math.round((profitCents / priceCents) * 1000) / 10 : 0,
      markupPercent: totalCostCents > 0 ? Math.round((profitCents / totalCostCents) * 1000) / 10 : 0,
      perLaborHourCents: Math.round(priceCents / laborHours),
      perElapsedHourCents: elapsed ? Math.round(priceCents / elapsed) : null,
    });
  };

  let priceAtMarginCents: number | null = null;
  if (margin !== undefined) {
    priceAtMarginCents = roundUp(totalCostCents / (1 - margin / 100), step);
    formulas.push(`Price at ${pct(margin)} margin = ${money(totalCostCents)} ÷ (1 − ${margin / 100}) = ${money(priceAtMarginCents)}${step > 1 ? ` (rounded up to ${money(step)})` : ""}`);
    check("margin", priceAtMarginCents);
  }
  let priceAtMarkupCents: number | null = null;
  if (markup !== undefined) {
    priceAtMarkupCents = roundUp(totalCostCents * (1 + markup / 100), step);
    formulas.push(`Price at ${pct(markup)} markup = ${money(totalCostCents)} × (1 + ${markup / 100}) = ${money(priceAtMarkupCents)}${step > 1 ? ` (rounded up to ${money(step)})` : ""}`);
    check("markup", priceAtMarkupCents);
  }

  const visits = nonNegative(input.visitsPerMonth, "Visits per month", 100);
  const monthly =
    visits !== undefined && visits > 0
      ? { visits, costCents: Math.round(totalCostCents * visits), priceAtMarginCents: priceAtMarginCents === null ? null : Math.round(priceAtMarginCents * visits), priceAtMarkupCents: priceAtMarkupCents === null ? null : Math.round(priceAtMarkupCents * visits) }
      : null;
  if (monthly) formulas.push(`Monthly = per-visit amount × ${visits} visits a month${Number.isInteger(visits) ? "" : " (an annual average: some months have more visits than others)"}`);

  return { name: input.name?.trim().slice(0, 80) || "Scenario", crewSize: crewSize ?? null, elapsedHours: elapsed, laborHours, laborCents, directCents, overheadCents, totalCostCents, priceAtMarginCents, priceAtMarkupCents, checks, monthly, formulas, assumptions };
}

/** Margin and markup describe the same price differently. This converts one to the other. */
export function marginFromMarkup(markupPercent: number): number {
  return Math.round((markupPercent / (100 + markupPercent)) * 1000) / 10;
}
export function markupFromMargin(marginPercent: number): number {
  if (marginPercent >= 100) throw new PricingError("A margin must be under 100%.");
  return Math.round((marginPercent / (100 - marginPercent)) * 1000) / 10;
}

export function compareScenarios(scenarios: PricingInput[]): { scenarios: PricingResult[]; errors: { name: string; error: string }[] } {
  if (scenarios.length === 0 || scenarios.length > 6) throw new PricingError("Compare between one and six scenarios.");
  const out: PricingResult[] = [];
  const errors: { name: string; error: string }[] = [];
  for (const [index, scenario] of scenarios.entries()) {
    try {
      out.push(pricing({ ...scenario, name: scenario.name || `Scenario ${index + 1}` }));
    } catch (error) {
      errors.push({ name: scenario.name || `Scenario ${index + 1}`, error: error instanceof PricingError ? error.message : "Could not be calculated." });
    }
  }
  return { scenarios: out, errors };
}
