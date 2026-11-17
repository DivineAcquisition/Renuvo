/**
 * The categories a cleaning company files expenses under. The starting set is named for cleaning work and
 * lines up with the costs Services & Pricing estimates per visit (supplies, travel, equipment, laundry), so
 * Profitability can compare what was estimated with what was spent. Each also names the QuickBooks account
 * it would go to. The Owner renames, adds and hides categories; an id never changes once used.
 */
import type { Infer } from "convex/values";

import type { expenseCategoryValidator } from "./schema";

export type ExpenseCategory = Infer<typeof expenseCategoryValidator>;

export const DEFAULT_CATEGORIES: ExpenseCategory[] = [
  { id: "supplies", name: "Supplies", kind: "job", costKey: "supplies", accountName: "Supplies & Materials" },
  { id: "equipment", name: "Equipment", kind: "job", costKey: "equipment", accountName: "Equipment" },
  { id: "laundry", name: "Laundry", kind: "job", costKey: "laundry", accountName: "Laundry" },
  { id: "vehicle", name: "Vehicle & fuel", kind: "job", costKey: "travel", accountName: "Car & Truck" },
  { id: "parking", name: "Parking & tolls", kind: "job", costKey: "travel", accountName: "Parking & Tolls" },
  { id: "subcontractors", name: "Subcontractors", kind: "job", accountName: "Contract Labor" },
  { id: "insurance", name: "Insurance", kind: "overhead", accountName: "Insurance" },
  { id: "software", name: "Software", kind: "overhead", accountName: "Software & Apps" },
  { id: "marketing", name: "Marketing", kind: "overhead", accountName: "Advertising & Marketing" },
  { id: "rent", name: "Rent & utilities", kind: "overhead", accountName: "Rent & Utilities" },
  { id: "licenses", name: "Licenses & fees", kind: "overhead", accountName: "Taxes & Licenses" },
  { id: "training", name: "Training", kind: "overhead", accountName: "Training" },
  { id: "office", name: "Office", kind: "overhead", accountName: "Office Expenses" },
  { id: "other", name: "Other", kind: "overhead", accountName: "Other Business Expenses" },
];

export function categoryById(categories: readonly ExpenseCategory[], id: string | undefined | null): ExpenseCategory | null {
  return id ? (categories.find((c) => c.id === id) ?? null) : null;
}

/** The category a model or a person named, matched loosely ("cleaning supplies" → Supplies). */
export function categoryByName(categories: readonly ExpenseCategory[], name: string | null | undefined): ExpenseCategory | null {
  if (!name) return null;
  const want = name.trim().toLowerCase();
  const live = categories.filter((c) => !c.hidden);
  return live.find((c) => c.name.toLowerCase() === want) ?? live.find((c) => want.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(want)) ?? null;
}
