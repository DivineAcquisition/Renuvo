/**
 * Expenses (docs/finance/00-plan.md, phase 4). What Selestial does with an expense before the Owner sees
 * it, all from the records:
 *
 *  - A category is either chosen by a person, set by one of the Owner's own rules, or only *suggested*
 *    (from how the same vendor was filed before, or from what the receipt shows). A suggestion is shown
 *    as a suggestion and never filed on its own.
 *  - A rule that auto-files records an expense only when its vendor, date and amount were read clearly
 *    and it isn't a possible repeat of one already recorded. Otherwise it waits for the Owner.
 *  - A possible repeat is the same amount within three days, from the same vendor or with no vendor to
 *    tell them apart. It's flagged, never merged or dropped.
 *  - A visit is suggested only when the evidence points at one: the only visit that day.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { recordEvent, type Actor } from "../events";
import { categoryById, categoryByName, type ExpenseCategory } from "./categories";
import { endOfLocalDate } from "./settings";

const DAY = 86_400_000;
export const REPEAT_WINDOW_DAYS = 3;

/** "The Home Depot #4521" → "home depot". Store numbers, punctuation and company suffixes are dropped. */
export function vendorKey(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  const key = name
    .toLowerCase()
    .replace(/#\s*\d+/g, " ")
    .replace(/\b(store|str|no)\s*\d+\b/g, " ")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\b(the|inc|llc|ltd|co|corp|company|incorporated)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return key || undefined;
}

/** Whole days between two calendar dates ("2026-11-14", "2026-11-17" → 3). */
export function daysBetween(a: string, b: string): number {
  const at = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round(Math.abs(at(a) - at(b)) / DAY);
}

/** "2026-11-14" → "Nov 14". */
export function shortDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function isDateKey(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function sameVendor(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
}

/** A recorded or waiting expense this one may repeat: same amount, within three days, same vendor or no vendor to tell. */
export async function findRepeat(
  ctx: QueryCtx | MutationCtx,
  companyId: Id<"companies">,
  e: { _id?: Id<"expenses">; amountCents?: number; spentOn?: string; vendorKey?: string; receiptId?: Id<"expenseReceipts"> },
): Promise<Doc<"expenses"> | null> {
  if (e.amountCents === undefined || !e.spentOn) return null;
  const same = await ctx.db
    .query("expenses")
    .withIndex("by_company_amount", (q) => q.eq("companyId", companyId).eq("amountCents", e.amountCents))
    .take(100);
  const candidates = same.filter((o) => o._id !== e._id && o.status !== "void" && o.spentOn && daysBetween(o.spentOn, e.spentOn!) <= REPEAT_WINDOW_DAYS && sameVendor(o.vendorKey, e.vendorKey));
  // A recorded one is the better match: it's the one already in the books.
  candidates.sort((x, y) => (x.status === "recorded" ? 0 : 1) - (y.status === "recorded" ? 0 : 1) || x.createdAt - y.createdAt);
  return candidates[0] ?? null;
}

/** How the same vendor was filed before, when the Owner has been consistent: "You filed Home Depot as Supplies 4 times." */
export async function historySuggestion(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, key: string | undefined, categories: readonly ExpenseCategory[], vendor: string | undefined) {
  if (!key) return null;
  const past = (
    await ctx.db
      .query("expenses")
      .withIndex("by_company_vendor", (q) => q.eq("companyId", companyId).eq("vendorKey", key))
      .order("desc")
      .take(30)
  ).filter((e) => e.status === "recorded" && e.categoryId);
  if (!past.length) return null;
  const counts = new Map<string, number>();
  for (const e of past) counts.set(e.categoryId!, (counts.get(e.categoryId!) ?? 0) + 1);
  const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const category = categoryById(categories, best);
  if (!category || category.hidden) return null;
  // Only when most of the past filings agree.
  if (n / past.length < 0.6) return null;
  return { categoryId: category.id, why: `You filed ${vendor ?? "this vendor"} as ${category.name} ${n === 1 ? "once" : `${n} times`} before.`, from: "history" as const };
}

/** The Owner's active rules, in the order they were made. */
export async function rulesOf(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">) {
  return (
    await ctx.db
      .query("expenseRules")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(200)
  ).sort((a, b) => a.createdAt - b.createdAt);
}

export function ruleFor(rules: readonly Doc<"expenseRules">[], key: string | undefined): Doc<"expenseRules"> | null {
  if (!key) return null;
  return rules.find((r) => r.active && key.includes(r.vendorContains)) ?? null;
}

/** The only visit on that day, if there was exactly one. */
export async function jobSuggestionFor(ctx: QueryCtx | MutationCtx, company: Doc<"companies">, spentOn: string | undefined) {
  if (!spentOn || !isDateKey(spentOn)) return null;
  const end = endOfLocalDate(spentOn, company.timezone);
  const jobs = (
    await ctx.db
      .query("jobs")
      .withIndex("by_company_start", (q) => q.eq("companyId", company._id).gt("startsAt", end - DAY).lte("startsAt", end))
      .take(20)
  ).filter((j) => j.status !== "cancelled");
  if (jobs.length !== 1) return null;
  const job = jobs[0];
  const customer = await ctx.db.get(job.customerId);
  const service = job.serviceSnapshot?.name ?? job.serviceType;
  return { jobId: job._id, why: `Your only visit that day: ${service}${customer ? ` for ${customer.name}` : ""}.` };
}

export type Automation = {
  /** Fields to write on the expense. */
  patch: Partial<Doc<"expenses">>;
  /** The rule that filed it, when one did. */
  filedBy: Doc<"expenseRules"> | null;
};

/**
 * Works out what Selestial does with an expense that is still waiting: the rule's category or a
 * suggestion, a visit suggestion, a possible repeat, and whether the Owner's rule may record it now.
 * Fields the Owner set are never changed.
 */
export async function automate(ctx: MutationCtx, company: Doc<"companies">, expense: Doc<"expenses">, categories: readonly ExpenseCategory[], hint?: { categoryName?: string | null; categoryWhy?: string | null }): Promise<Automation> {
  const patch: Partial<Doc<"expenses">> = {};
  const rules = await rulesOf(ctx, company._id);
  const rule = ruleFor(rules, expense.vendorKey);
  const categoryChosenByPerson = expense.categoryBy === "person";
  if (rule && !categoryChosenByPerson && categoryById(categories, rule.categoryId)) {
    patch.categoryId = rule.categoryId;
    patch.categoryBy = "rule";
    patch.ruleId = rule._id;
    patch.suggestion = undefined;
    if (!expense.paidWith && rule.paidWith) patch.paidWith = rule.paidWith;
  } else if (!expense.categoryId) {
    const fromHistory = await historySuggestion(ctx, company._id, expense.vendorKey, categories, expense.vendor);
    const fromReceipt = !fromHistory && hint?.categoryName ? categoryByName(categories, hint.categoryName) : null;
    patch.suggestion = fromHistory ?? (fromReceipt ? { categoryId: fromReceipt.id, why: hint?.categoryWhy?.slice(0, 200) || `The receipt looks like ${fromReceipt.name.toLowerCase()}.`, from: "receipt" as const } : undefined);
  }
  const categoryId = patch.categoryId ?? expense.categoryId ?? patch.suggestion?.categoryId ?? expense.suggestion?.categoryId;
  const category = categoryById(categories, categoryId);
  if (!expense.link && category?.kind !== "overhead") {
    const job = await jobSuggestionFor(ctx, company, expense.spentOn);
    patch.jobSuggestion = job ?? undefined;
  }
  const repeat = expense.duplicateCleared ? null : await findRepeat(ctx, company._id, expense);
  patch.duplicateOf = repeat?._id;

  const clear = !(expense.unclear ?? []).some((f) => f === "vendor" || f === "date" || f === "amount");
  const complete = expense.amountCents !== undefined && expense.amountCents > 0 && Boolean(expense.spentOn) && Boolean(expense.vendor);
  const filedBy = rule && rule.autoFile && !categoryChosenByPerson && expense.status === "to_review" && clear && complete && !repeat ? rule : null;
  if (filedBy) {
    const filedCategory = categoryById(categories, filedBy.categoryId);
    patch.status = "recorded";
    patch.recordedAt = Date.now();
    patch.recordedBy = { kind: "rule", ruleId: filedBy._id };
    if (!expense.link && filedCategory?.kind === "overhead") patch.link = { kind: "overhead" };
  }
  return { patch, filedBy };
}

/** Applies the automation to a waiting expense and records what happened. */
export async function runAutomation(ctx: MutationCtx, company: Doc<"companies">, expenseId: Id<"expenses">, categories: readonly ExpenseCategory[], hint?: { categoryName?: string | null; categoryWhy?: string | null }) {
  const expense = await ctx.db.get(expenseId);
  if (!expense || expense.status !== "to_review") return null;
  const { patch, filedBy } = await automate(ctx, company, expense, categories, hint);
  await ctx.db.patch(expense._id, { ...patch, updatedAt: Date.now() });
  if (filedBy) {
    await ctx.db.patch(filedBy._id, { matches: filedBy.matches + 1, lastMatchedAt: Date.now() });
    const actor: Actor = { kind: "system" };
    await recordEvent(ctx, { companyId: company._id, type: "expense.filed_by_rule", actor, subject: { table: "expenses", id: expense._id }, data: { amountCents: expense.amountCents ?? null, ruleId: filedBy._id, categoryId: filedBy.categoryId } });
  }
  return { filedBy };
}

/** What still keeps an expense from being recorded, in words. Empty when it can be. */
export function missingFor(e: Pick<Doc<"expenses">, "amountCents" | "spentOn" | "categoryId" | "vendor">): string[] {
  const out: string[] = [];
  if (e.amountCents === undefined) out.push("the amount");
  if (!e.spentOn) out.push("the date");
  if (!e.vendor) out.push("who it was paid to");
  if (!e.categoryId) out.push("a category");
  return out;
}

export const PAID_WITH_WORDS = { business_card: "Business card", bank: "Bank account", cash: "Cash", personal: "Paid personally", other: "Other" } as const;
export const SOURCE_WORDS = { receipt: "Receipt", manual: "Added by hand", statement: "Statement import", gmail: "Gmail", cleaner: "Cleaner" } as const;
