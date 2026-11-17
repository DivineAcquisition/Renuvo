/**
 * The company's invoice settings and the calendar arithmetic Finance needs, on the company's clock.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import { addLocalDays, startOfLocalDay } from "../time";
import { userError } from "../errors";

export const DEFAULTS = {
  paymentTermsDays: 7,
  allowPartialPayments: false,
  invoicePrefix: "INV",
  nextInvoiceNumber: 1001,
} as const;

export type FinanceSettings = {
  taxRateBps: number | null;
  taxLabel: string;
  taxableServiceIds: string[];
  paymentTermsDays: number;
  allowPartialPayments: boolean;
  invoiceNote: string | null;
  invoicePrefix: string;
  nextInvoiceNumber: number;
  revision: number;
};

export async function settingsRow(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">): Promise<Doc<"financeSettings"> | null> {
  return ctx.db
    .query("financeSettings")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .unique();
}

export function settingsOf(row: Doc<"financeSettings"> | null): FinanceSettings {
  return {
    taxRateBps: row?.taxRateBps ?? null,
    taxLabel: row?.taxLabel ?? "Sales tax",
    taxableServiceIds: row?.taxableServiceIds ?? [],
    paymentTermsDays: row?.paymentTermsDays ?? DEFAULTS.paymentTermsDays,
    allowPartialPayments: row?.allowPartialPayments ?? DEFAULTS.allowPartialPayments,
    invoiceNote: row?.invoiceNote ?? null,
    invoicePrefix: row?.invoicePrefix ?? DEFAULTS.invoicePrefix,
    nextInvoiceNumber: row?.nextInvoiceNumber ?? DEFAULTS.nextInvoiceNumber,
    revision: row?.revision ?? 0,
  };
}

/** "2026-11-17" on the company's clock. */
export function localDateKey(at: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

/** The last moment of a calendar date on the company's clock. Refuses a date that is not a date. */
export function endOfLocalDate(date: string, timezone: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw userError("Choose a date.");
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const noon = Date.UTC(y, m - 1, d, 12);
  if (Number.isNaN(noon) || new Date(noon).getUTCDate() !== d) throw userError("Choose a date.");
  let start = startOfLocalDay(noon, timezone);
  // Noon UTC can sit on the neighbouring day far from Greenwich; step to the day that has this date.
  for (let i = 0; i < 2 && localDateKey(start, timezone) !== date; i += 1) start = addLocalDays(start, localDateKey(start, timezone) < date ? 1 : -1, timezone);
  return addLocalDays(start, 1, timezone) - 1;
}

/** The end of the day `days` after today, on the company's clock. */
export function dueAfterDays(now: number, days: number, timezone: string): number {
  return addLocalDays(startOfLocalDay(now, timezone), days + 1, timezone) - 1;
}

export function invoiceNumber(settings: Pick<FinanceSettings, "invoicePrefix" | "nextInvoiceNumber">): string {
  return `${settings.invoicePrefix}-${settings.nextInvoiceNumber}`;
}
