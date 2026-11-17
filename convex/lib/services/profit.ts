/**
 * Profitability of one quote, from the costs the company entered. Nothing here is guessed: a cost the
 * owner has not entered is listed as missing, and the result says what that means.
 *
 * Words kept apart on purpose:
 *  - Margin is a share of the price. Markup is a share of the cost. A 50% markup is a 33.3% margin.
 *  - Contribution is what remains after this visit's direct costs. It is not net profit. When the owner
 *    has entered an overhead allocation, the amount after it is "estimated operating profit before
 *    taxes", and it is never called net profit.
 *  - Pay is one model at a time (hourly, per visit, or a share of the price); the models never mix.
 */
import { v } from "convex/values";

import type { Quote, Warning } from "./engine";
import { percentOf, roundCents, trimNumber } from "./engine";
import { formatCents } from "./words";

export const payValidator = v.union(
  /** An hourly wage plus payroll costs (taxes, insurance, benefits) as a percent of the wage. */
  v.object({ model: v.literal("hourly"), hourlyCents: v.number(), burdenPercent: v.number() }),
  /** A fixed amount per cleaner per visit. */
  v.object({ model: v.literal("per_visit"), amountCents: v.number() }),
  /** A share of the price the customer pays for the visit. */
  v.object({ model: v.literal("revenue_share"), sharePercent: v.number() }),
);
export type Pay = typeof payValidator.type;

/** Null means "not entered" (the owner chose "I'm not sure"), never zero. */
export const costsValidator = v.object({
  pay: v.union(payValidator, v.null()),
  suppliesPerVisitCents: v.union(v.number(), v.null()),
  travelPerVisitCents: v.union(v.number(), v.null()),
  equipmentPerVisitCents: v.union(v.number(), v.null()),
  laundryPerLoadCents: v.union(v.number(), v.null()),
  paymentFeePercent: v.union(v.number(), v.null()),
  paymentFeeFixedCents: v.union(v.number(), v.null()),
  /** The share of fixed company costs each visit carries. */
  overheadPerVisitCents: v.union(v.number(), v.null()),
  /** The margin the owner aims for. */
  targetMarginPercent: v.union(v.number(), v.null()),
  /** The owner's floor: a price leaving less than this margin is flagged. */
  floorMarginPercent: v.union(v.number(), v.null()),
  /** The least a job should bring in. */
  minimumJobCents: v.union(v.number(), v.null()),
});
export type Costs = typeof costsValidator.type;

export function emptyCosts(): Costs {
  return {
    pay: null,
    suppliesPerVisitCents: null,
    travelPerVisitCents: null,
    equipmentPerVisitCents: null,
    laundryPerLoadCents: null,
    paymentFeePercent: null,
    paymentFeeFixedCents: null,
    overheadPerVisitCents: null,
    targetMarginPercent: null,
    floorMarginPercent: null,
    minimumJobCents: null,
  };
}

export const DEFINITIONS = {
  margin: "Margin is the share of the price left after direct costs: (price − direct costs) ÷ price.",
  markup: "Markup compares the same amount to the costs instead: (price − direct costs) ÷ direct costs. A 50% markup is a 33.3% margin.",
  contribution: "Contribution is what remains after this visit's direct costs. It is not net profit: overhead, taxes and the owner's pay still come out of it.",
  afterOverhead: "Estimated operating profit before taxes: contribution minus the overhead you allocated to each visit.",
} as const;

export type CostLine = { key: string; label: string; cents: number; detail: string };

export type Profitability = {
  revenueCents: number;
  /** How many visits the price covers: 1, or a month's average for a monthly package. */
  visits: number;
  costs: CostLine[];
  directCents: number;
  contributionCents: number;
  contributionMarginPercent: number | null;
  markupPercent: number | null;
  overheadCents: number | null;
  afterOverheadCents: number | null;
  perLaborHourCents: number | null;
  perElapsedHourCents: number | null;
  /** The least price that keeps the owner's floor margin (and minimum job), for this job. */
  floorCents: number | null;
  /** The price that reaches the target margin, for this job. */
  targetCents: number | null;
  missing: string[];
  warnings: Warning[];
};

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/**
 * The price that leaves `marginPercent` after direct costs. Costs that grow with the price (a revenue
 * share, a card fee percent) are solved for, not estimated. Null when no price can reach it.
 */
export function priceForMargin(fixedCents: number, proportionalPercent: number, marginPercent: number): number | null {
  const remaining = 1 - proportionalPercent / 100 - marginPercent / 100;
  if (remaining <= 0) return null;
  return Math.ceil(fixedCents / remaining - 1e-9);
}

export function profitability(quote: Quote, costs: Costs): Profitability | null {
  if (quote.totalCents === null || quote.outcome === "incomplete") return null;
  const revenue = quote.totalCents;
  const visits = quote.visits;
  const missing: string[] = [];
  const warnings: Warning[] = [];
  const lines: CostLine[] = [];
  let fixed = 0;
  let proportional = 0;

  const laborHours = (quote.time.laborMinutes / 60) * visits;
  const pay = costs.pay;
  if (!pay) missing.push("What you pay cleaners");
  else if (pay.model === "hourly") {
    const rate = roundCents(pay.hourlyCents * (1 + pay.burdenPercent / 100));
    const cents = roundCents(laborHours * rate);
    lines.push({ key: "labor", label: "Labor", cents, detail: `${trimNumber(laborHours)} labor-hours × ${formatCents(rate)} (${formatCents(pay.hourlyCents)} wage + ${trimNumber(pay.burdenPercent)}% payroll costs)` });
    fixed += cents;
  } else if (pay.model === "per_visit") {
    const cents = pay.amountCents * quote.time.crewSize * visits;
    lines.push({ key: "labor", label: "Labor", cents, detail: `${quote.time.crewSize} cleaner${quote.time.crewSize === 1 ? "" : "s"} × ${formatCents(pay.amountCents)} per visit${visits !== 1 ? ` × ${trimNumber(visits)} visits` : ""}` });
    fixed += cents;
  } else {
    const cents = percentOf(revenue, pay.sharePercent);
    lines.push({ key: "labor", label: "Labor", cents, detail: `${trimNumber(pay.sharePercent)}% of the ${formatCents(revenue)} price` });
    proportional += pay.sharePercent;
  }

  const perVisit = (key: string, label: string, value: number | null, what: string) => {
    if (value === null) return missing.push(what);
    const cents = roundCents(value * visits);
    if (cents === 0) return;
    lines.push({ key, label, cents, detail: `${formatCents(value)} per visit${visits !== 1 ? ` × ${trimNumber(visits)}` : ""}` });
    fixed += cents;
  };
  perVisit("supplies", "Supplies", costs.suppliesPerVisitCents, "Supplies per visit");
  perVisit("travel", "Travel", costs.travelPerVisitCents, "Travel cost per visit");
  perVisit("equipment", "Equipment", costs.equipmentPerVisitCents, "Equipment per visit");

  if (quote.str && quote.str.loads > 0) {
    if (costs.laundryPerLoadCents === null) missing.push("Laundry cost per load");
    else if (costs.laundryPerLoadCents > 0) {
      const cents = costs.laundryPerLoadCents * quote.str.loads * visits;
      lines.push({ key: "laundry", label: "Laundry", cents, detail: `${quote.str.loads} load${quote.str.loads === 1 ? "" : "s"} × ${formatCents(costs.laundryPerLoadCents)}` });
      fixed += cents;
    }
  }

  if (costs.paymentFeePercent === null && costs.paymentFeeFixedCents === null) missing.push("Card or payment fees");
  else {
    const percent = costs.paymentFeePercent ?? 0;
    const fixedFee = costs.paymentFeeFixedCents ?? 0;
    const cents = percentOf(revenue, percent) + fixedFee;
    if (cents > 0) lines.push({ key: "fees", label: "Payment fees", cents, detail: `${trimNumber(percent)}% of ${formatCents(revenue)}${fixedFee ? ` + ${formatCents(fixedFee)}` : ""}` });
    proportional += percent;
    fixed += fixedFee;
  }

  const direct = lines.reduce((sum, line) => sum + line.cents, 0);
  const contribution = revenue - direct;
  const overhead = costs.overheadPerVisitCents === null ? null : roundCents(costs.overheadPerVisitCents * visits);
  const elapsedHours = (quote.time.elapsedMinutes / 60) * visits;

  const floorMargin = costs.floorMarginPercent;
  let floor = floorMargin === null ? null : priceForMargin(fixed, proportional, floorMargin);
  if (costs.minimumJobCents !== null && quote.per !== "month") floor = Math.max(floor ?? 0, costs.minimumJobCents);
  const target = costs.targetMarginPercent === null ? null : priceForMargin(fixed, proportional, costs.targetMarginPercent);
  const margin = pct(contribution, revenue);

  if (contribution < 0) warnings.push({ code: "negative_margin", severity: "critical", message: `This price is ${formatCents(-contribution)} short of its own direct costs.` });
  else if (floorMargin !== null && margin !== null && margin < floorMargin) warnings.push({ code: "below_floor", severity: "critical", message: `Only ${margin}% remains after direct costs; your floor is ${trimNumber(floorMargin)}%.${floor !== null ? ` The floor price for this job is ${formatCents(floor)}.` : ""}` });
  else if (costs.targetMarginPercent !== null && margin !== null && margin < costs.targetMarginPercent) warnings.push({ code: "low_margin", severity: "warning", message: `${margin}% remains after direct costs, under your ${trimNumber(costs.targetMarginPercent)}% target.` });
  if (costs.minimumJobCents !== null && quote.per !== "month" && revenue < costs.minimumJobCents) warnings.push({ code: "below_floor", severity: "critical", message: `${formatCents(revenue)} is under your ${formatCents(costs.minimumJobCents)} minimum job.` });
  if (floorMargin !== null && floor === null) warnings.push({ code: "below_floor", severity: "critical", message: "No price reaches your floor margin: the costs that grow with price already take too large a share." });
  if (overhead === null) warnings.push({ code: "no_overhead", severity: "info", message: "No overhead is entered, so this shows contribution after direct costs, not profit." });
  if (missing.length) warnings.push({ code: "missing_info", severity: "warning", message: `Not entered: ${missing.join(", ")}. The amount remaining is overstated by whatever those cost.` });

  return {
    revenueCents: revenue,
    visits,
    costs: lines,
    directCents: direct,
    contributionCents: contribution,
    contributionMarginPercent: margin,
    markupPercent: pct(contribution, direct),
    overheadCents: overhead,
    afterOverheadCents: overhead === null ? null : contribution - overhead,
    perLaborHourCents: laborHours > 0 ? roundCents(revenue / laborHours) : null,
    perElapsedHourCents: elapsedHours > 0 ? roundCents(revenue / elapsedHours) : null,
    floorCents: floor,
    targetCents: target,
    missing,
    warnings,
  };
}
