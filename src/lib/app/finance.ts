/**
 * Words, formats and tabs shared by the Finance screens (src/components/app/finance). The server decides
 * every state; this file only says how each one reads and looks, the same way everywhere.
 */

/** Dollars and cents, always with cents: on a money page, $240 and $240.00 must never both appear. */
export function usd(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Math.abs(cents) / 100)}`;
}

/** Whole dollars for chart axes and large headline figures. */
export function usdShort(cents: number): string {
  const dollars = Math.round(cents / 100);
  if (Math.abs(dollars) >= 10_000) return `$${(dollars / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`;
  return `$${dollars.toLocaleString("en-US")}`;
}

/** "Nov 17, 2026" from "2026-11-17", read as a calendar date (no clock, no time zone shift). */
export function calendarDate(date: string | null | undefined, withYear = true): string {
  if (!date) return "—";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

/** A moment, on the company's clock. */
export function moment(at: number | null | undefined, timezone: string, withTime = false): string {
  if (!at) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) }).format(new Date(at));
}

/** "2026-11-17" on the company's clock, for date fields. */
export function todayKey(timezone: string, at = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

export type InvoiceStateId = "draft" | "deposit_requested" | "deposit_paid" | "requested" | "partially_paid" | "processing" | "overdue" | "paid" | "overpaid" | "void";

/** One look per state. The word is always shown; the color only repeats it. */
export const STATE_LOOK: Record<InvoiceStateId, { tone: "muted" | "info" | "warning" | "danger" | "success" | "progress"; icon: "draft" | "clock" | "half" | "spin" | "alert" | "check" | "slash" | "plus" }> = {
  draft: { tone: "muted", icon: "draft" },
  deposit_requested: { tone: "info", icon: "clock" },
  deposit_paid: { tone: "info", icon: "half" },
  requested: { tone: "info", icon: "clock" },
  partially_paid: { tone: "warning", icon: "half" },
  processing: { tone: "progress", icon: "spin" },
  overdue: { tone: "danger", icon: "alert" },
  paid: { tone: "success", icon: "check" },
  overpaid: { tone: "warning", icon: "plus" },
  void: { tone: "muted", icon: "slash" },
};

export const FINANCE_PATH = "/app/finance";

export const FINANCE_TABS = [
  { id: "overview", label: "Overview", built: true },
  { id: "invoices", label: "Invoices & Payments", built: true },
  { id: "expenses", label: "Expenses", built: false },
  { id: "team-pay", label: "Team Pay", built: false },
  { id: "profitability", label: "Profitability", built: false },
] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number]["id"];

export const PERIODS = [
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "last_90_days", label: "Last 90 days" },
  { id: "this_year", label: "This year" },
] as const;
export type PeriodId = (typeof PERIODS)[number]["id"];

export const MANUAL_METHODS = [
  { id: "cash", label: "Cash" },
  { id: "check", label: "Check" },
  { id: "bank_transfer", label: "Bank transfer" },
  { id: "zelle", label: "Zelle" },
  { id: "venmo", label: "Venmo" },
  { id: "other", label: "Other" },
] as const;

/** A key for one click, so a request sent twice is carried out once. */
export function clientKey(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `k-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** "12.50" → 1250. Null when it is not an amount. */
export function parseMoney(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function moneyInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
