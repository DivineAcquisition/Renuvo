/**
 * Invoice arithmetic, in whole cents. Pure functions: the same sums run when a draft is saved, when an
 * invoice is read, in the pay page and in tests. Every rounding is half away from zero, once, at the
 * line and at the tax, never on a running total.
 */
import { userError } from "../errors";
import type { InvoiceLine, InvoiceTotals } from "./schema";

export const LIMITS = {
  /** The most one invoice may total: $100,000. */
  invoiceCents: 100_000_00,
  lines: 50,
  description: 200,
  memo: 1000,
  reason: 500,
  quantity: 10_000,
  /** 25% is the highest sales tax rate accepted. */
  taxRateBps: 2500,
  termsDays: { min: 0, max: 120 },
} as const;

/** Half away from zero, so −0.5 and 0.5 both move away from zero. */
export function roundCents(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** A quantity with at most two decimals, above zero. */
export function validQuantity(quantity: number): boolean {
  return Number.isFinite(quantity) && quantity > 0 && quantity <= LIMITS.quantity && Math.abs(Math.round(quantity * 100) - quantity * 100) < 1e-6;
}

export function isCents(value: number): boolean {
  return Number.isInteger(value) && Math.abs(value) <= LIMITS.invoiceCents;
}

export function lineAmount(quantity: number, unitCents: number): number {
  // Two-decimal quantities: work in hundredths so 0.1 × 3 is exactly 0.3.
  return roundCents((Math.round(quantity * 100) * unitCents) / 100);
}

/** Tax on the taxable lines, after the discounts that are themselves taxable. Never below zero. */
export function taxOn(lines: readonly Pick<InvoiceLine, "amountCents" | "taxable">[], rateBps: number): number {
  const taxable = lines.filter((line) => line.taxable).reduce((sum, line) => sum + line.amountCents, 0);
  if (taxable <= 0 || rateBps <= 0) return 0;
  return roundCents((taxable * rateBps) / 10_000);
}

/** The lines checked and their amounts worked out again from quantity and unit price. */
export function cleanLines(lines: readonly InvoiceLine[]): InvoiceLine[] {
  if (lines.length > LIMITS.lines) throw userError(`An invoice can have up to ${LIMITS.lines} lines.`);
  const seen = new Set<string>();
  return lines.map((line) => {
    const description = line.description.trim().replace(/\s+/g, " ");
    if (!description) throw userError("Every line needs a description.");
    if (description.length > LIMITS.description) throw userError(`Keep each line under ${LIMITS.description} characters.`);
    if (!line.id || seen.has(line.id)) throw userError("Two lines have the same id. Reload and try again.");
    seen.add(line.id);
    if (!validQuantity(line.quantity)) throw userError(`“${description}” needs a quantity above zero, with at most two decimals.`);
    if (!Number.isInteger(line.unitCents) || Math.abs(line.unitCents) > LIMITS.invoiceCents) throw userError(`“${description}” has a price that isn't an amount of money.`);
    if (line.kind === "discount" ? line.unitCents > 0 : line.unitCents < 0) {
      throw userError(line.kind === "discount" ? `The discount “${description}” must take money off.` : `“${description}” can't be below zero. Add a discount line instead.`);
    }
    return { ...line, description, amountCents: lineAmount(line.quantity, line.unitCents) };
  });
}

/** What the lines add up to before any money has moved. */
export function linesTotal(lines: readonly InvoiceLine[], taxRateBps: number) {
  const subtotalCents = lines.filter((line) => line.kind !== "discount").reduce((sum, line) => sum + line.amountCents, 0);
  const discountCents = -lines.filter((line) => line.kind === "discount").reduce((sum, line) => sum + line.amountCents, 0);
  const taxCents = taxOn(lines, taxRateBps);
  const totalCents = subtotalCents - discountCents + taxCents;
  return { subtotalCents, discountCents, taxCents, totalCents };
}

export function totalsFor(input: {
  lines: readonly InvoiceLine[];
  taxRateBps: number;
  paidCents: number;
  refundedCents: number;
  creditedCents: number;
  processingCents: number;
}): InvoiceTotals {
  const base = linesTotal(input.lines, input.taxRateBps);
  return {
    ...base,
    paidCents: input.paidCents,
    refundedCents: input.refundedCents,
    creditedCents: input.creditedCents,
    processingCents: input.processingCents,
    balanceCents: base.totalCents - input.creditedCents - input.paidCents + input.refundedCents,
  };
}

/** "8.25%" from basis points. */
export function percentLabel(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

export function dollars(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}
