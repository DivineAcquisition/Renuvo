/** How amounts and units are written, everywhere a service is shown. Every amount carries its unit. */
import type { AddOn, AreaUnit, Schedule } from "./spec";

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A rate in thousandths of a cent: 8500 is "$0.085". At least two decimals, at most five. */
export function formatMillicents(millicents: number): string {
  const dollars = millicents / 100_000;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 })}`;
}

export function areaWord(unit: AreaUnit, count = 2): string {
  if (unit === "sq_m") return count === 1 ? "square meter" : "m²";
  return count === 1 ? "square foot" : "sq ft";
}

export const SCHEDULE_LABELS: Record<Schedule, string> = {
  every_7_days: "Every 7 days",
  every_14_days: "Every 14 days",
  every_28_days: "Every 28 days",
  twice_per_month: "Twice per calendar month",
  once_per_month: "Once per calendar month",
};

export function scheduleLabel(schedule: Schedule): string {
  return SCHEDULE_LABELS[schedule];
}

export function addOnWord(addOn: Pick<AddOn, "per" | "itemWord">): string {
  if (addOn.per === "hour") return "per hour";
  if (addOn.per === "item") return `per ${addOn.itemWord?.trim() || "item"}`;
  return "per visit";
}

export function minutesWords(minutes: number): string {
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60);
  const m = rounded - h * 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** A phrase such as "Ends after June 30, 2027" inside a sentence: only the first letter changes. */
export const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
