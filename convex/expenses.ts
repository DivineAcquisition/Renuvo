/**
 * Finance › Expenses (docs/finance/00-plan.md, phase 4). The company's costs: receipts the Owner snaps or
 * uploads (read by Selestial into a draft), expenses typed by hand, and rows from a bank or card statement.
 *
 * A draft waits in "To review" until the Owner records it, or until one of the Owner's own rules files it
 * (only when everything it needs was read clearly). A suggested category or visit stays a suggestion until
 * accepted. A possible repeat is flagged, never merged. Paying personally is tracked as owed back to the
 * Owner. Nothing is deleted: a mistake is voided with a reason.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { ownerMutation, ownerQuery, type MemberAccess } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { categoryById, type ExpenseCategory } from "./lib/finance/categories";
import { findRepeat, isDateKey, missingFor, PAID_WITH_WORDS, ruleFor, rulesOf, runAutomation, shortDate, SOURCE_WORDS, vendorKey } from "./lib/finance/expenses";
import { requireFinance } from "./lib/finance/authority";
import { MAX_RECEIPT_BYTES } from "./lib/finance/receiptReader";
import { expenseCategoryValidator, expenseLinkValidator, paidWithValidator, PAID_WITH } from "./lib/finance/schema";
import { companyServices } from "./lib/finance/services";
import { localDateKey, periodRange, periodValidator, settingsOf, settingsRow } from "./lib/finance/settings";
import { allow } from "./lib/rateLimit";

type Ctx = (QueryCtx | MutationCtx) & MemberAccess;
const DAY = 86_400_000;
const MAX_AMOUNT = 10_000_000; // $100,000

const STATUS_WORDS: Record<Doc<"expenses">["status"], string> = { to_review: "To review", recorded: "Recorded", void: "Voided" };
const UNCLEAR_WORDS: Record<string, string> = { vendor: "who it was paid to", date: "the date", amount: "the amount", tax: "the tax" };

async function categoriesOf(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">): Promise<ExpenseCategory[]> {
  return settingsOf(await settingsRow(ctx, companyId)).expenseCategories;
}

async function linkLabel(ctx: QueryCtx, link: Doc<"expenses">["link"], timezone: string, services: { id: string; name: string }[]): Promise<string | null> {
  if (!link) return null;
  if (link.kind === "overhead") return "General overhead";
  if (link.kind === "service") return services.find((s) => s.id === link.serviceKey)?.name ?? "A service";
  if (link.kind === "property") {
    const property = await ctx.db.get(link.propertyId);
    return property ? `${property.address.line1}, ${property.address.city}` : "A property";
  }
  const job = await ctx.db.get(link.jobId);
  if (!job) return "A visit";
  const customer = await ctx.db.get(job.customerId);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric" }).format(new Date(job.startsAt));
  return `${job.serviceSnapshot?.name ?? job.serviceType} · ${day}${customer ? ` · ${customer.name}` : ""}`;
}

/** What needs the Owner's eye on an expense, in words. */
function flagsOf(e: Doc<"expenses">): string[] {
  const out: string[] = [];
  const unclear = (e.unclear ?? []).filter((f) => UNCLEAR_WORDS[f]);
  if (e.status === "to_review" && unclear.length) out.push(`Check ${unclear.map((f) => UNCLEAR_WORDS[f]).join(", ")}: the receipt wasn't clear.`);
  if (e.duplicateOf && !e.duplicateCleared && e.status !== "void") out.push("Possible repeat of an expense already added.");
  return out;
}

function rowOf(e: Doc<"expenses">, categories: readonly ExpenseCategory[], receipt: Doc<"expenseReceipts"> | null) {
  const category = categoryById(categories, e.categoryId);
  const suggested = categoryById(categories, e.suggestion?.categoryId);
  return {
    id: e._id,
    status: e.status,
    statusWords: STATUS_WORDS[e.status],
    source: e.source,
    sourceWords: SOURCE_WORDS[e.source],
    vendor: e.vendor ?? null,
    spentOn: e.spentOn ?? null,
    amountCents: e.amountCents ?? null,
    category: category ? { id: category.id, name: category.name, by: e.categoryBy ?? "person" } : null,
    suggestion: !category && suggested ? { id: suggested.id, name: suggested.name, why: e.suggestion!.why } : null,
    paidWith: e.paidWith ?? null,
    paidWithWords: e.paidWith ? PAID_WITH_WORDS[e.paidWith] : null,
    owedBack: e.status === "recorded" && e.paidWith === "personal" && !e.repaid,
    repaidOn: e.repaid?.on ?? null,
    linked: Boolean(e.link),
    hasJobSuggestion: Boolean(e.jobSuggestion && !e.link),
    reading: receipt ? receipt.reading.state : null,
    flags: flagsOf(e),
    missing: missingFor(e),
    byRule: e.recordedBy?.kind === "rule",
    revision: e.revision,
  };
}

const FILTERS = ["review", "recorded", "owed_back", "void", "all"] as const;

/** The Expenses tab: the period's spending by category, what waits for review, and what is owed back to the Owner. */
export const overview = ownerQuery({
  args: { period: periodValidator, filter: v.union(...FILTERS.map((f) => v.literal(f))) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "read");
    const tz = ctx.company.timezone;
    const range = periodRange(args.period, Date.now(), tz);
    const fromKey = localDateKey(range.from, tz);
    const toKey = localDateKey(range.to, tz);
    const categories = await categoriesOf(ctx, ctx.companyId);
    const waiting = await ctx.db
      .query("expenses")
      .withIndex("by_company_status_spent", (q) => q.eq("companyId", ctx.companyId).eq("status", "to_review"))
      .take(500);
    const inPeriod = await ctx.db
      .query("expenses")
      .withIndex("by_company_status_spent", (q) => q.eq("companyId", ctx.companyId).eq("status", "recorded").gte("spentOn", fromKey).lte("spentOn", toKey))
      .take(3000);
    const allRecorded = await ctx.db
      .query("expenses")
      .withIndex("by_company_status_spent", (q) => q.eq("companyId", ctx.companyId).eq("status", "recorded"))
      .order("desc")
      .take(5000);
    const owedBack = allRecorded.filter((e) => e.paidWith === "personal" && !e.repaid);
    let list: Doc<"expenses">[];
    if (args.filter === "review") list = [...waiting].sort((a, b) => b.createdAt - a.createdAt);
    else if (args.filter === "recorded") list = [...inPeriod].sort((a, b) => (b.spentOn ?? "").localeCompare(a.spentOn ?? "") || b.createdAt - a.createdAt);
    else if (args.filter === "owed_back") list = owedBack;
    else if (args.filter === "void")
      list = await ctx.db
        .query("expenses")
        .withIndex("by_company_status_spent", (q) => q.eq("companyId", ctx.companyId).eq("status", "void"))
        .order("desc")
        .take(200);
    else list = [...waiting.sort((a, b) => b.createdAt - a.createdAt), ...[...inPeriod].sort((a, b) => (b.spentOn ?? "").localeCompare(a.spentOn ?? ""))];
    const rows = [];
    for (const e of list.slice(0, 400)) rows.push(rowOf(e, categories, e.receiptId ? await ctx.db.get(e.receiptId) : null));

    const byCategory = new Map<string, { id: string; name: string; kind: string; cents: number; count: number }>();
    for (const e of inPeriod) {
      const category = categoryById(categories, e.categoryId);
      const key = category?.id ?? "none";
      const row = byCategory.get(key) ?? { id: key, name: category?.name ?? "No category", kind: category?.kind ?? "overhead", cents: 0, count: 0 };
      row.cents += e.amountCents ?? 0;
      row.count += 1;
      byCategory.set(key, row);
    }
    const reading = waiting.filter((e) => e.source === "receipt" && e.amountCents === undefined && !e.unclear).length;
    return {
      period: { id: args.period, label: range.label, from: fromKey, to: toKey },
      totals: {
        spentCents: inPeriod.reduce((s, e) => s + (e.amountCents ?? 0), 0),
        spentCount: inPeriod.length,
        jobCostCents: inPeriod.filter((e) => categoryById(categories, e.categoryId)?.kind === "job").reduce((s, e) => s + (e.amountCents ?? 0), 0),
        overheadCents: inPeriod.filter((e) => categoryById(categories, e.categoryId)?.kind !== "job").reduce((s, e) => s + (e.amountCents ?? 0), 0),
        reviewCount: waiting.length,
        reviewCents: waiting.reduce((s, e) => s + (e.amountCents ?? 0), 0),
        reviewMissing: waiting.filter((e) => e.amountCents === undefined).length,
        reading,
        repeats: waiting.filter((e) => e.duplicateOf && !e.duplicateCleared).length,
        owedBackCents: owedBack.reduce((s, e) => s + (e.amountCents ?? 0), 0),
        owedBackCount: owedBack.length,
      },
      byCategory: [...byCategory.values()].sort((a, b) => b.cents - a.cents),
      rows,
      counts: { review: waiting.length, recorded: inPeriod.length, owed_back: owedBack.length },
      categories: categories.filter((c) => !c.hidden).map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
      readyToRecord: waiting.filter((e) => missingFor({ ...e, categoryId: e.categoryId ?? e.suggestion?.categoryId }).length === 0 && !(e.duplicateOf && !e.duplicateCleared) && !(e.unclear ?? []).some((f) => f === "amount" || f === "date" || f === "vendor")).map((e) => ({ expenseId: e._id, revision: e.revision, acceptSuggestion: !e.categoryId })),
    };
  },
});

/** One expense in full, for its drawer. */
export const expense = ownerQuery({
  args: { expenseId: v.id("expenses") },
  handler: async (ctx, args) => {
    requireFinance(ctx, "read");
    const e = await owned(ctx, args.expenseId);
    const tz = ctx.company.timezone;
    const categories = await categoriesOf(ctx, ctx.companyId);
    const services = await companyServices(ctx);
    const receipt = e.receiptId ? await ctx.db.get(e.receiptId) : null;
    const repeat = e.duplicateOf ? await ctx.db.get(e.duplicateOf) : null;
    const rule = e.ruleId ? await ctx.db.get(e.ruleId) : null;
    const history = await ctx.db
      .query("events")
      .withIndex("by_company_subject_at", (q) => q.eq("companyId", ctx.companyId).eq("subjectId", e._id))
      .order("desc")
      .take(30);
    const members = new Map<string, string>();
    const memberName = async (id: Id<"members">) => {
      if (!members.has(id)) members.set(id, id === ctx.member._id ? "You" : ((await ctx.db.get(id))?.name ?? "A team member"));
      return members.get(id)!;
    };
    return {
      ...rowOf(e, categories, receipt),
      taxCents: e.taxCents ?? null,
      description: e.description ?? null,
      paidWithNote: e.paidWithNote ?? null,
      unclear: e.unclear ?? [],
      link: e.link ?? null,
      linkLabel: await linkLabel(ctx, e.link, tz, services),
      jobSuggestion: e.jobSuggestion && !e.link ? { jobId: e.jobSuggestion.jobId, why: e.jobSuggestion.why, label: await linkLabel(ctx, { kind: "job", jobId: e.jobSuggestion.jobId }, tz, services) } : null,
      receipt: receipt
        ? {
            url: await ctx.storage.getUrl(receipt.storageId),
            name: receipt.name,
            contentType: receipt.contentType,
            reading: receipt.reading.state,
            note: receipt.reading.note ?? null,
            read: receipt.reading.fields ? { vendor: receipt.reading.fields.vendor, date: receipt.reading.fields.date, totalCents: receipt.reading.fields.totalCents, taxCents: receipt.reading.fields.taxCents } : null,
          }
        : null,
      repeat: repeat && e.duplicateOf && !e.duplicateCleared ? { id: repeat._id, vendor: repeat.vendor ?? null, spentOn: repeat.spentOn ?? null, amountCents: repeat.amountCents ?? null, statusWords: STATUS_WORDS[repeat.status], sourceWords: SOURCE_WORDS[repeat.source] } : null,
      statementLine: e.statementLine ?? null,
      rule: rule ? { id: rule._id, vendorContains: rule.vendorContains, categoryName: categoryById(categories, rule.categoryId)?.name ?? "a category", autoFile: rule.autoFile } : null,
      recordedWords: e.recordedBy ? (e.recordedBy.kind === "rule" ? `Filed by your rule "${rule?.vendorContains ?? ""}"` : `Recorded by ${await memberName(e.recordedBy.memberId)}`) : null,
      recordedAt: e.recordedAt ?? null,
      voided: e.voided ? { at: e.voided.at, reason: e.voided.reason, by: await memberName(e.voided.by) } : null,
      repaid: e.repaid ? { on: e.repaid.on, by: await memberName(e.repaid.by) } : null,
      categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, hidden: Boolean(c.hidden) })),
      services,
      timeline: history.map((row) => ({ id: row._id, at: row.at, type: row.type, amountCents: typeof row.data?.amountCents === "number" ? row.data.amountCents : null })),
    };
  },
});

/** What an expense can be linked to: visits near its date, properties and services. */
export const linkOptions = ownerQuery({
  args: { around: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "read");
    const tz = ctx.company.timezone;
    const center = args.around && isDateKey(args.around) ? Date.UTC(Number(args.around.slice(0, 4)), Number(args.around.slice(5, 7)) - 1, Number(args.around.slice(8, 10)), 12) : Date.now();
    const jobs = (
      await ctx.db
        .query("jobs")
        .withIndex("by_company_start", (q) => q.eq("companyId", ctx.companyId).gte("startsAt", center - 8 * DAY).lte("startsAt", center + 8 * DAY))
        .take(80)
    ).filter((j) => j.status !== "cancelled");
    const services = await companyServices(ctx);
    const jobRows = [];
    for (const job of jobs) jobRows.push({ id: job._id, label: (await linkLabel(ctx, { kind: "job", jobId: job._id }, tz, services))!, startsAt: job.startsAt });
    const properties = await ctx.db
      .query("properties")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId))
      .take(300);
    return {
      jobs: jobRows.sort((a, b) => a.startsAt - b.startsAt),
      properties: properties.filter((p) => p.status !== "archived").map((p) => ({ id: p._id, label: `${p.address.line1}, ${p.address.city}` })),
      services,
    };
  },
});

// ── Adding ───────────────────────────────────────────────────────────────────────────────────────

export const generateUploadUrl = ownerMutation({
  args: {},
  handler: async (ctx) => {
    requireFinance(ctx, "edit");
    if (!(await allow(ctx, `receipt.upload:${ctx.member._id}`, 60, 10 * 60_000))) throw userError("Too many uploads in a few minutes. Wait a moment.");
    return ctx.storage.generateUploadUrl();
  },
});

const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

/** Receipts uploaded: each becomes a waiting expense, and Selestial reads it. The same file twice is noticed. */
export const addReceipts = ownerMutation({
  args: { files: v.array(v.object({ storageId: v.id("_storage"), name: v.string() })), paidWith: v.optional(paidWithValidator) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    if (!args.files.length || args.files.length > 20) throw userError("Add up to 20 receipts at a time.");
    const results: { name: string; expenseId: Id<"expenses"> | null; problem: string | null }[] = [];
    const now = Date.now();
    for (const file of args.files) {
      const name = file.name.trim().slice(0, 120) || "Receipt";
      const meta = await ctx.db.system.get(file.storageId);
      if (!meta) {
        results.push({ name, expenseId: null, problem: "The upload wasn't found. Try again." });
        continue;
      }
      const taken = await ctx.db
        .query("expenseReceipts")
        .withIndex("by_storage", (q) => q.eq("storageId", file.storageId))
        .first();
      if (taken) {
        results.push({ name, expenseId: taken.expenseId ?? null, problem: null });
        continue;
      }
      const type = (meta.contentType ?? "").split(";")[0].trim().toLowerCase();
      if (!RECEIPT_TYPES.includes(type)) {
        await ctx.storage.delete(file.storageId);
        results.push({ name, expenseId: null, problem: "Only photos (JPEG, PNG, WebP) and PDFs can be added as receipts." });
        continue;
      }
      if (meta.size <= 0 || meta.size > MAX_RECEIPT_BYTES) {
        await ctx.storage.delete(file.storageId);
        results.push({ name, expenseId: null, problem: meta.size <= 0 ? "The file is empty." : "The file is larger than 15 MB." });
        continue;
      }
      const same = meta.sha256
        ? await ctx.db
            .query("expenseReceipts")
            .withIndex("by_company_sha", (q) => q.eq("companyId", ctx.companyId).eq("sha256", meta.sha256))
            .first()
        : null;
      if (same) {
        await ctx.storage.delete(file.storageId);
        const when = localDateKey(same.createdAt, ctx.company.timezone);
        results.push({ name, expenseId: same.expenseId ?? null, problem: `This receipt was already added (${when}).` });
        continue;
      }
      const expenseId = await ctx.db.insert("expenses", { companyId: ctx.companyId, status: "to_review", source: "receipt", paidWith: args.paidWith, revision: 0, createdBy: ctx.member._id, createdAt: now, updatedAt: now });
      const receiptId = await ctx.db.insert("expenseReceipts", { companyId: ctx.companyId, storageId: file.storageId, name, contentType: type, size: meta.size, sha256: meta.sha256, source: "upload", uploadedBy: ctx.member._id, reading: { state: "pending" }, expenseId, createdAt: now });
      await ctx.db.patch(expenseId, { receiptId });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "expense.added", actor: byMember(ctx), subject: { table: "expenses", id: expenseId }, data: { source: "receipt" } });
      await ctx.scheduler.runAfter(0, internal.expenseReading.read, { receiptId });
      results.push({ name, expenseId, problem: null });
    }
    return { results };
  },
});

const fieldsValidator = {
  vendor: v.union(v.string(), v.null()),
  spentOn: v.union(v.string(), v.null()),
  amountCents: v.union(v.number(), v.null()),
  taxCents: v.union(v.number(), v.null()),
  description: v.union(v.string(), v.null()),
  categoryId: v.union(v.string(), v.null()),
  link: v.union(expenseLinkValidator, v.null()),
  paidWith: v.union(paidWithValidator, v.null()),
  paidWithNote: v.union(v.string(), v.null()),
};
type Fields = { vendor: string | null; spentOn: string | null; amountCents: number | null; taxCents: number | null; description: string | null; categoryId: string | null; link: Doc<"expenses">["link"] | null; paidWith: Doc<"expenses">["paidWith"] | null; paidWithNote: string | null };

/** Checks what a person entered and turns it into fields to store. Missing is allowed for a draft. */
async function cleanFields(ctx: Ctx, f: Fields, current?: Doc<"expenses">) {
  const vendor = f.vendor?.trim().slice(0, 120) || undefined;
  if (f.spentOn !== null && !isDateKey(f.spentOn)) throw userError("Choose the date it was paid.");
  if (f.spentOn && f.spentOn > localDateKey(Date.now() + DAY, ctx.company.timezone)) throw userError("The date can't be in the future.");
  if (f.amountCents !== null && (!Number.isSafeInteger(f.amountCents) || f.amountCents <= 0 || f.amountCents > MAX_AMOUNT)) throw userError("Enter the amount paid, more than $0 and up to $100,000.");
  if (f.taxCents !== null && (!Number.isSafeInteger(f.taxCents) || f.taxCents < 0 || (f.amountCents !== null && f.taxCents > f.amountCents))) throw userError("The tax can't be more than the amount.");
  const categories = await categoriesOf(ctx, ctx.companyId);
  if (f.categoryId !== null) {
    const category = categoryById(categories, f.categoryId);
    if (!category || (category.hidden && current?.categoryId !== f.categoryId)) throw userError("Choose one of your categories.");
  }
  if (f.link?.kind === "job") await owned(ctx, f.link.jobId);
  if (f.link?.kind === "property") await owned(ctx, f.link.propertyId);
  if (f.link?.kind === "service" && !(await companyServices(ctx)).some((s) => s.id === (f.link as { serviceKey: string }).serviceKey)) throw userError("Choose one of your services.");
  if (f.link?.kind === "job" && f.categoryId && categoryById(categories, f.categoryId)?.kind === "overhead") throw userError("An overhead category can't be linked to one visit. Choose a job cost category, or link it to general overhead.");
  return {
    vendor,
    vendorKey: vendorKey(vendor),
    spentOn: f.spentOn ?? undefined,
    amountCents: f.amountCents ?? undefined,
    taxCents: f.taxCents ?? undefined,
    description: f.description?.trim().slice(0, 300) || undefined,
    categoryId: f.categoryId ?? undefined,
    link: f.link ?? undefined,
    jobId: f.link?.kind === "job" ? f.link.jobId : undefined,
    paidWith: f.paidWith ?? undefined,
    paidWithNote: f.paidWithNote?.trim().slice(0, 60) || undefined,
  };
}

/** An expense typed by hand. Recorded straight away when it's complete and the Owner asks; otherwise waits. */
export const addExpense = ownerMutation({
  args: { ...fieldsValidator, record: v.boolean(), clientKey: v.string() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    if (!/^[\w-]{8,80}$/.test(args.clientKey)) throw userError("Reload the page and try again.");
    const repeat = await ctx.db
      .query("expenses")
      .withIndex("by_company_clientKey", (q) => q.eq("companyId", ctx.companyId).eq("clientKey", args.clientKey))
      .unique();
    if (repeat) return { expenseId: repeat._id, recorded: repeat.status === "recorded", repeatOf: null };
    const fields = await cleanFields(ctx, args);
    const now = Date.now();
    const id = await ctx.db.insert("expenses", { companyId: ctx.companyId, status: "to_review", source: "manual", ...fields, categoryBy: fields.categoryId ? "person" : undefined, clientKey: args.clientKey, revision: 0, createdBy: ctx.member._id, createdAt: now, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "expense.added", actor: byMember(ctx), subject: { table: "expenses", id }, data: { source: "manual", amountCents: fields.amountCents ?? null } });
    const existing = await findRepeat(ctx, ctx.companyId, { _id: id, ...fields });
    if (existing) {
      // A possible repeat is never recorded without the Owner seeing it.
      await ctx.db.patch(id, { duplicateOf: existing._id });
      return { expenseId: id, recorded: false, repeatOf: existing._id };
    }
    if (args.record && missingFor(fields).length === 0) {
      await recordNow(ctx, (await ctx.db.get(id))!);
      return { expenseId: id, recorded: true, repeatOf: null };
    }
    if (!fields.categoryId) await runAutomation(ctx, ctx.company, id, await categoriesOf(ctx, ctx.companyId));
    const after = (await ctx.db.get(id))!;
    return { expenseId: id, recorded: after.status === "recorded", repeatOf: null };
  },
});

async function recordNow(ctx: MutationCtx & MemberAccess, e: Doc<"expenses">) {
  const categories = await categoriesOf(ctx, ctx.companyId);
  const category = categoryById(categories, e.categoryId);
  const now = Date.now();
  await ctx.db.patch(e._id, {
    status: "recorded",
    recordedAt: now,
    recordedBy: { kind: "member", memberId: ctx.member._id },
    categoryBy: e.categoryBy === "rule" ? "rule" : "person",
    suggestion: undefined,
    link: e.link ?? (category?.kind === "overhead" ? { kind: "overhead" } : undefined),
    revision: e.revision + 1,
    updatedAt: now,
  });
  await recordEvent(ctx, { companyId: ctx.companyId, type: "expense.recorded", actor: byMember(ctx), subject: { table: "expenses", id: e._id }, data: { amountCents: e.amountCents ?? null, categoryId: e.categoryId ?? null } });
}

/**
 * Saves the Owner's changes to an expense, and records it when asked. The revision must match what they
 * opened, so a receipt read or a rule that changed it meanwhile isn't overwritten unseen.
 */
export const saveExpense = ownerMutation({
  args: { expenseId: v.id("expenses"), revision: v.number(), ...fieldsValidator, record: v.boolean(), notARepeat: v.optional(v.boolean()), rule: v.optional(v.union(v.null(), v.object({ autoFile: v.boolean() }))) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const e = await owned(ctx, args.expenseId);
    if (e.status === "void") throw userError("This expense was voided.");
    if (e.revision !== args.revision) return { ok: false as const, words: "This expense changed since you opened it. Check it again." };
    const fields = await cleanFields(ctx, args, e);
    const now = Date.now();
    const categoryChanged = fields.categoryId !== e.categoryId;
    await ctx.db.patch(e._id, {
      ...fields,
      categoryBy: fields.categoryId ? (categoryChanged || e.categoryBy !== "rule" ? "person" : "rule") : undefined,
      ruleId: categoryChanged ? undefined : e.ruleId,
      suggestion: fields.categoryId ? undefined : e.suggestion,
      jobSuggestion: fields.link ? undefined : e.jobSuggestion,
      duplicateCleared: args.notARepeat ? true : e.duplicateCleared,
      unclear: [],
      revision: e.revision + 1,
      updatedAt: now,
    });
    if (args.notARepeat && e.duplicateOf) await recordEvent(ctx, { companyId: ctx.companyId, type: "expense.not_a_repeat", actor: byMember(ctx), subject: { table: "expenses", id: e._id } });
    let saved = (await ctx.db.get(e._id))!;
    // The same amount and day as another expense: ask again unless the Owner already said it isn't a repeat.
    if (!saved.duplicateCleared) {
      const repeat = await findRepeat(ctx, ctx.companyId, saved);
      await ctx.db.patch(e._id, { duplicateOf: repeat?._id });
      saved = (await ctx.db.get(e._id))!;
    }
    if (e.status === "recorded") {
      await recordEvent(ctx, { companyId: ctx.companyId, type: "expense.edited", actor: byMember(ctx), subject: { table: "expenses", id: e._id }, data: { amountCents: fields.amountCents ?? null, was: e.amountCents ?? null } });
    }
    let ruleId: Id<"expenseRules"> | null = null;
    if (args.rule && saved.vendorKey && saved.categoryId) {
      ruleId = await upsertRule(ctx, { vendorContains: saved.vendorKey, categoryId: saved.categoryId, paidWith: saved.paidWith, autoFile: args.rule.autoFile });
      await ctx.db.patch(saved._id, { ruleId });
    }
    if (args.record && e.status === "to_review") {
      const missing = missingFor(saved);
      if (missing.length) return { ok: false as const, words: `Add ${missing.join(", ")} before recording it.` };
      if (saved.duplicateOf && !saved.duplicateCleared) return { ok: false as const, words: "This looks like a repeat of an expense already added. Say it isn't a repeat, or void this one." };
      await recordNow(ctx, saved);
    }
    return { ok: true as const, words: args.record ? "Recorded" : "Saved", ruleId };
  },
});

/** Records several waiting expenses, each exactly as reviewed. Accepting the suggestion is the Owner's choice per call. */
export const recordMany = ownerMutation({
  args: { items: v.array(v.object({ expenseId: v.id("expenses"), revision: v.number(), acceptSuggestion: v.boolean() })) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    if (args.items.length > 100) throw userError("Record up to 100 at a time.");
    let recorded = 0;
    const skipped: string[] = [];
    for (const item of args.items) {
      const e = await owned(ctx, item.expenseId);
      if (e.status !== "to_review") continue;
      if (e.revision !== item.revision) {
        skipped.push(`${e.vendor ?? "An expense"} changed since you looked`);
        continue;
      }
      const categoryId = e.categoryId ?? (item.acceptSuggestion ? e.suggestion?.categoryId : undefined);
      if (missingFor({ ...e, categoryId }).length || (e.duplicateOf && !e.duplicateCleared) || (e.unclear ?? []).some((f) => f === "amount" || f === "date" || f === "vendor")) {
        skipped.push(`${e.vendor ?? "An expense"} needs a look`);
        continue;
      }
      if (!e.categoryId && categoryId) await ctx.db.patch(e._id, { categoryId, categoryBy: "person" });
      await recordNow(ctx, (await ctx.db.get(e._id))!);
      recorded += 1;
    }
    return { recorded, skipped };
  },
});

export const voidExpense = ownerMutation({
  args: { expenseId: v.id("expenses"), reason: v.string() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const e = await owned(ctx, args.expenseId);
    if (e.status === "void") return { already: true };
    const reason = args.reason.trim();
    if (!reason) throw userError("Say why, so the history makes sense.");
    if (e.repaid) throw userError("You were already paid back for this. Record a correction instead of voiding it.");
    await ctx.db.patch(e._id, { status: "void", voided: { at: Date.now(), by: ctx.member._id, reason: reason.slice(0, 300) }, revision: e.revision + 1, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "expense.voided", actor: byMember(ctx), subject: { table: "expenses", id: e._id }, data: { amountCents: e.amountCents ?? null } });
    return { already: false };
  },
});

/** Expenses the Owner paid personally, marked as paid back by the business. */
export const markRepaid = ownerMutation({
  args: { expenseIds: v.array(v.id("expenses")), on: v.string() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    if (!isDateKey(args.on) || args.on > localDateKey(Date.now() + DAY, ctx.company.timezone)) throw userError("Choose the day you were paid back.");
    if (!args.expenseIds.length || args.expenseIds.length > 100) throw userError("Choose the expenses you were paid back for.");
    let total = 0;
    for (const id of args.expenseIds) {
      const e = await owned(ctx, id);
      if (e.status !== "recorded" || e.paidWith !== "personal" || e.repaid) continue;
      await ctx.db.patch(e._id, { repaid: { on: args.on, at: Date.now(), by: ctx.member._id }, revision: e.revision + 1, updatedAt: Date.now() });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "expense.repaid", actor: byMember(ctx), subject: { table: "expenses", id: e._id }, data: { amountCents: e.amountCents ?? null } });
      total += e.amountCents ?? 0;
    }
    return { totalCents: total };
  },
});

// ── Rules ────────────────────────────────────────────────────────────────────────────────────────

async function upsertRule(ctx: MutationCtx & MemberAccess, input: { vendorContains: string; categoryId: string; paidWith?: Doc<"expenses">["paidWith"]; autoFile: boolean; active?: boolean }, ruleId?: Id<"expenseRules"> | null) {
  const contains = vendorKey(input.vendorContains);
  if (!contains || contains.length < 2) throw userError("Enter part of the vendor's name, at least 2 letters.");
  const categories = await categoriesOf(ctx, ctx.companyId);
  if (!categoryById(categories, input.categoryId)) throw userError("Choose one of your categories.");
  const rules = await rulesOf(ctx, ctx.companyId);
  const now = Date.now();
  const existing = ruleId ? rules.find((r) => r._id === ruleId) : rules.find((r) => r.vendorContains === contains);
  if (ruleId && !existing) throw userError("That rule wasn't found.");
  const fields = { vendorContains: contains, categoryId: input.categoryId, paidWith: input.paidWith ?? undefined, autoFile: input.autoFile, active: input.active ?? true, updatedAt: now };
  let id: Id<"expenseRules">;
  if (existing) {
    await ctx.db.patch(existing._id, fields);
    id = existing._id;
  } else id = await ctx.db.insert("expenseRules", { companyId: ctx.companyId, ...fields, matches: 0, createdBy: ctx.member._id, createdAt: now });
  await recordEvent(ctx, { companyId: ctx.companyId, type: "expense_rule.saved", actor: byMember(ctx), subject: { table: "expenseRules", id }, data: { vendor: contains, categoryId: input.categoryId, autoFile: input.autoFile, active: fields.active } });
  return id;
}

export const rules = ownerQuery({
  args: {},
  handler: async (ctx) => {
    requireFinance(ctx, "read");
    const categories = await categoriesOf(ctx, ctx.companyId);
    const waiting = await ctx.db
      .query("expenses")
      .withIndex("by_company_status_spent", (q) => q.eq("companyId", ctx.companyId).eq("status", "to_review"))
      .take(500);
    return (await rulesOf(ctx, ctx.companyId)).map((r) => ({
      id: r._id,
      vendorContains: r.vendorContains,
      categoryId: r.categoryId,
      categoryName: categoryById(categories, r.categoryId)?.name ?? "A category that no longer exists",
      paidWith: r.paidWith ?? null,
      autoFile: r.autoFile,
      active: r.active,
      matches: r.matches,
      lastMatchedAt: r.lastMatchedAt ?? null,
      waitingMatches: waiting.filter((e) => e.vendorKey?.includes(r.vendorContains)).length,
    }));
  },
});

export const saveRule = ownerMutation({
  args: { ruleId: v.union(v.id("expenseRules"), v.null()), vendorContains: v.string(), categoryId: v.string(), paidWith: v.union(paidWithValidator, v.null()), autoFile: v.boolean(), active: v.boolean() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const id = await upsertRule(ctx, { vendorContains: args.vendorContains, categoryId: args.categoryId, paidWith: args.paidWith ?? undefined, autoFile: args.autoFile, active: args.active }, args.ruleId);
    return { ruleId: id };
  },
});

/** Runs the Owner's rules over everything waiting, for example right after making a rule. */
export const applyRules = ownerMutation({
  args: {},
  handler: async (ctx) => {
    requireFinance(ctx, "edit");
    const categories = await categoriesOf(ctx, ctx.companyId);
    const waiting = await ctx.db
      .query("expenses")
      .withIndex("by_company_status_spent", (q) => q.eq("companyId", ctx.companyId).eq("status", "to_review"))
      .take(300);
    let filed = 0;
    let categorized = 0;
    const rules = await rulesOf(ctx, ctx.companyId);
    for (const e of waiting) {
      if (!ruleFor(rules, e.vendorKey) || e.categoryBy === "person") continue;
      const result = await runAutomation(ctx, ctx.company, e._id, categories);
      if (result?.filedBy) filed += 1;
      else categorized += 1;
    }
    return { filed, categorized };
  },
});

// ── Categories ───────────────────────────────────────────────────────────────────────────────────

export const saveCategories = ownerMutation({
  args: { categories: v.array(expenseCategoryValidator) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    if (args.categories.length > 60) throw userError("Up to 60 categories.");
    const current = await categoriesOf(ctx, ctx.companyId);
    const names = new Set<string>();
    const ids = new Set<string>();
    const next: ExpenseCategory[] = args.categories.map((c) => {
      const name = c.name.trim();
      if (!name || name.length > 40) throw userError("Give each category a short name.");
      if (names.has(name.toLowerCase())) throw userError(`Two categories are called "${name}".`);
      names.add(name.toLowerCase());
      const id = c.id && /^[a-z0-9-]{2,40}$/.test(c.id) ? c.id : `cat-${crypto.randomUUID().slice(0, 8)}`;
      if (ids.has(id)) throw userError("Two categories share an id. Reload and try again.");
      ids.add(id);
      const before = current.find((x) => x.id === id);
      return { id, name, kind: c.kind, costKey: c.costKey ?? before?.costKey, accountName: c.accountName?.trim().slice(0, 60) || before?.accountName, hidden: c.hidden || undefined };
    });
    // A category in use can be hidden, never removed, so past expenses keep their meaning.
    for (const old of current) if (!next.some((c) => c.id === old.id)) next.push({ ...old, hidden: true });
    if (!next.some((c) => !c.hidden)) throw userError("Keep at least one category.");
    const row = await settingsRow(ctx, ctx.companyId);
    const settings = settingsOf(row);
    const fields = { expenseCategories: next, revision: settings.revision + 1, updatedBy: ctx.member._id, updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert("financeSettings", { companyId: ctx.companyId, taxableServiceIds: [], paymentTermsDays: settings.paymentTermsDays, allowPartialPayments: settings.allowPartialPayments, nextInvoiceNumber: settings.nextInvoiceNumber, invoicePrefix: settings.invoicePrefix, ...fields });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "finance_settings.saved", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { categories: next.filter((c) => !c.hidden).length } });
    return { ok: true };
  },
});

// ── Statement import ─────────────────────────────────────────────────────────────────────────────

const statementRow = v.object({ on: v.string(), description: v.string(), amountCents: v.number(), moneyIn: v.boolean() });
type StatementRow = { on: string; description: string; amountCents: number; moneyIn: boolean };

/** One row's identity within a statement: the same file imported twice is recognized row by row. */
function rowKeys(rows: StatementRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `${r.on}|${r.amountCents}|${(vendorKey(r.description) ?? "").slice(0, 60)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}|${n}`;
  });
}

async function previewRows(ctx: Ctx, rows: StatementRow[]) {
  if (rows.length > 500) throw userError("Import up to 500 rows at a time. Split the file by month.");
  const keys = rowKeys(rows);
  const categories = await categoriesOf(ctx, ctx.companyId);
  const rules = await rulesOf(ctx, ctx.companyId);
  const out = [];
  for (const [i, r] of rows.entries()) {
    const key = keys[i];
    const base = { index: i, on: r.on, description: r.description.slice(0, 120), amountCents: r.amountCents, key };
    if (!isDateKey(r.on) || !Number.isSafeInteger(r.amountCents) || r.amountCents <= 0 || r.amountCents > MAX_AMOUNT) {
      out.push({ ...base, status: "invalid" as const, words: "The date or amount couldn't be read." });
      continue;
    }
    if (r.moneyIn) {
      out.push({ ...base, status: "money_in" as const, words: "Money in, not an expense." });
      continue;
    }
    const already = await ctx.db
      .query("expenses")
      .withIndex("by_company_import_key", (q) => q.eq("companyId", ctx.companyId).eq("importKey", key))
      .first();
    if (already) {
      out.push({ ...base, status: "imported" as const, words: "Already imported." });
      continue;
    }
    const match = await findRepeat(ctx, ctx.companyId, { amountCents: r.amountCents, spentOn: r.on, vendorKey: undefined });
    if (match && !match.statementLine) {
      out.push({ ...base, status: "matches" as const, words: `Matches ${match.vendor ?? "an expense"} on ${shortDate(match.spentOn!)}, already added${match.source === "receipt" ? " from a receipt" : ""}.`, matchId: match._id });
      continue;
    }
    const rule = ruleFor(rules, vendorKey(r.description));
    const category = rule ? categoryById(categories, rule.categoryId) : null;
    out.push({ ...base, status: "new" as const, words: rule && category ? `Your rule files it as ${category.name}${rule.autoFile ? "" : " (you'll review it)"}.` : "Added for you to review.", ruleCategory: category?.name ?? null, autoFile: Boolean(rule?.autoFile) });
  }
  return out;
}

export const statementPreview = ownerQuery({
  args: { rows: v.array(statementRow) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "read");
    const rows = await previewRows(ctx, args.rows);
    const count = (status: string) => rows.filter((r) => r.status === status).length;
    return { rows, counts: { new: count("new"), matches: count("matches"), imported: count("imported"), money_in: count("money_in"), invalid: count("invalid") }, newCents: rows.filter((r) => r.status === "new").reduce((s, r) => s + r.amountCents, 0) };
  },
});

/** Adds a statement's new rows as expenses to review (or filed by the Owner's rules) and ties matching rows to the expenses already there. */
export const importStatement = ownerMutation({
  args: { name: v.string(), paidWith: paidWithValidator, paidWithNote: v.union(v.string(), v.null()), rows: v.array(statementRow), clientKey: v.string() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    if (!/^[\w-]{8,80}$/.test(args.clientKey)) throw userError("Reload the page and try again.");
    if (!PAID_WITH.includes(args.paidWith)) throw userError("Choose what this statement is for.");
    const again = await ctx.db
      .query("expenseImports")
      .withIndex("by_company_clientKey", (q) => q.eq("companyId", ctx.companyId).eq("clientKey", args.clientKey))
      .unique();
    if (again) return { importId: again._id, added: again.added, matched: again.matched, skipped: again.skipped, filed: 0, repeated: true };
    const preview = await previewRows(ctx, args.rows);
    const now = Date.now();
    const note = args.paidWithNote?.trim().slice(0, 60) || undefined;
    const importId = await ctx.db.insert("expenseImports", { companyId: ctx.companyId, name: args.name.trim().slice(0, 120) || "Statement", paidWith: args.paidWith, paidWithNote: note, rows: args.rows.length, added: 0, matched: 0, skipped: 0, clientKey: args.clientKey, createdBy: ctx.member._id, createdAt: now });
    const categories = await categoriesOf(ctx, ctx.companyId);
    let added = 0;
    let matched = 0;
    let filed = 0;
    for (const row of preview) {
      const source = args.rows[row.index];
      if (row.status === "matches" && "matchId" in row && row.matchId) {
        const existing = (await ctx.db.get(row.matchId))!;
        await ctx.db.patch(existing._id, { statementLine: { description: row.description, amountCents: row.amountCents, on: row.on, importId }, paidWith: existing.paidWith ?? args.paidWith, paidWithNote: existing.paidWithNote ?? note, importKey: existing.importKey ?? row.key, updatedAt: now });
        matched += 1;
        continue;
      }
      if (row.status !== "new") continue;
      const vendor = source.description.trim().slice(0, 120);
      const id = await ctx.db.insert("expenses", { companyId: ctx.companyId, status: "to_review", source: "statement", vendor, vendorKey: vendorKey(vendor), spentOn: row.on, amountCents: row.amountCents, paidWith: args.paidWith, paidWithNote: note, importId, importKey: row.key, statementLine: { description: row.description, amountCents: row.amountCents, on: row.on, importId }, revision: 0, createdBy: ctx.member._id, createdAt: now, updatedAt: now });
      added += 1;
      const result = await runAutomation(ctx, ctx.company, id, categories);
      if (result?.filedBy) filed += 1;
    }
    const skipped = args.rows.length - added - matched;
    await ctx.db.patch(importId, { added, matched, skipped });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "expense.imported", actor: byMember(ctx), subject: { table: "expenseImports", id: importId }, data: { added, matched, skipped, filed } });
    return { importId, added, matched, skipped, filed, repeated: false };
  },
});
