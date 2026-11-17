/**
 * Reading a receipt the Owner uploaded (Finance › Expenses). Internal only: the upload schedules it.
 *
 * The file's own first bytes decide what it is; only a photo or PDF is sent to the model, once. What was
 * read is kept on the receipt as read, and copied into the waiting expense only where the Owner hasn't
 * filled that field already. Nothing read is ever recorded on its own: the expense waits for the Owner,
 * unless one of the Owner's own rules covers it and every field it needs was read clearly.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { REGISTRY } from "./lib/ai/registry";
import { recordUsage } from "./lib/ai/usage";
import { recordEvent } from "./lib/events";
import { isDateKey, runAutomation, vendorKey } from "./lib/finance/expenses";
import { MAX_IMAGE_BYTES, readReceiptFile, sniffReceipt } from "./lib/finance/receiptReader";
import { settingsOf, settingsRow } from "./lib/finance/settings";

export const toRead = internalQuery({
  args: { receiptId: v.id("expenseReceipts") },
  handler: async (ctx, args) => {
    const receipt = await ctx.db.get(args.receiptId);
    if (!receipt || receipt.reading.state !== "pending") return null;
    const settings = settingsOf(await settingsRow(ctx, receipt.companyId));
    return { storageId: receipt.storageId, categories: settings.expenseCategories.filter((c) => !c.hidden).map((c) => c.name) };
  },
});

const textField = v.object({ value: v.union(v.string(), v.null()), clear: v.boolean() });
const numberField = v.object({ value: v.union(v.number(), v.null()), clear: v.boolean() });

export const read = internalAction({
  args: { receiptId: v.id("expenseReceipts") },
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.runQuery(internal.expenseReading.toRead, args);
    if (!job) return null;
    const blob = await ctx.storage.get(job.storageId);
    if (!blob) {
      await ctx.runMutation(internal.expenseReading.done, { receiptId: args.receiptId, state: "failed", note: "The file couldn't be opened. Enter the details from the receipt." });
      return null;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mimeType = sniffReceipt(bytes.slice(0, 16));
    if (!mimeType) {
      await ctx.runMutation(internal.expenseReading.done, { receiptId: args.receiptId, state: "failed", note: "This isn't a photo or PDF Selestial can read. The file is kept; enter the details from it." });
      return null;
    }
    if (mimeType !== "application/pdf" && bytes.length > MAX_IMAGE_BYTES) {
      await ctx.runMutation(internal.expenseReading.done, { receiptId: args.receiptId, state: "failed", note: "The photo is too large to read. Enter the details, or upload a smaller photo." });
      return null;
    }
    const outcome = await readReceiptFile({ bytes, mimeType }, job.categories);
    if (!outcome.ok) {
      await ctx.runMutation(internal.expenseReading.done, { receiptId: args.receiptId, state: outcome.state, note: outcome.note, model: outcome.model ? { provider: outcome.model.provider, model: outcome.model.model } : undefined });
      return null;
    }
    const r = outcome.reading;
    await ctx.runMutation(internal.expenseReading.done, {
      receiptId: args.receiptId,
      state: r.isReceipt ? "read" : "not_a_receipt",
      note: r.isReceipt ? undefined : "This doesn't look like a receipt. Check it, or enter the details yourself.",
      fields: {
        vendor: { value: r.vendor.value?.trim().slice(0, 120) || null, clear: r.vendor.clear },
        date: { value: r.date.value, clear: r.date.clear },
        totalCents: { value: typeof r.total.value === "number" && Number.isFinite(r.total.value) ? Math.round(r.total.value * 100) : null, clear: r.total.clear },
        taxCents: { value: typeof r.tax.value === "number" && Number.isFinite(r.tax.value) ? Math.round(r.tax.value * 100) : null, clear: r.tax.clear },
        paidWith: { value: r.paidWith.value?.trim().slice(0, 60) || null, clear: r.paidWith.clear },
        items: r.items?.slice(0, 160),
        categoryName: r.category?.name ?? undefined,
        categoryWhy: r.category?.why?.slice(0, 200),
      },
      model: { provider: outcome.model.provider, model: outcome.model.model },
      usage: outcome.usage,
    });
    return null;
  },
});

export const done = internalMutation({
  args: {
    receiptId: v.id("expenseReceipts"),
    state: v.union(v.literal("read"), v.literal("failed"), v.literal("not_available"), v.literal("not_a_receipt")),
    note: v.optional(v.string()),
    fields: v.optional(v.object({ vendor: textField, date: textField, totalCents: numberField, taxCents: numberField, paidWith: textField, items: v.optional(v.string()), categoryName: v.optional(v.string()), categoryWhy: v.optional(v.string()) })),
    model: v.optional(v.object({ provider: v.string(), model: v.string() })),
    usage: v.optional(v.object({ inputTokens: v.number(), outputTokens: v.number() })),
  },
  handler: async (ctx, args) => {
    const receipt = await ctx.db.get(args.receiptId);
    if (!receipt || receipt.reading.state !== "pending") return null;
    const now = Date.now();
    await ctx.db.patch(receipt._id, { reading: { state: args.state, note: args.note, at: now, fields: args.fields } });
    if (args.model && args.usage) {
      const entry = REGISTRY.image_understanding.primary;
      await recordUsage(ctx, { companyId: receipt.companyId, memberId: receipt.uploadedBy, feature: "receipt_read", capability: "image_understanding", model: { provider: entry.provider, model: args.model.model, rates: entry.rates }, units: args.usage, outcome: "ok" });
    }
    const expense = receipt.expenseId ? await ctx.db.get(receipt.expenseId) : null;
    const company = await ctx.db.get(receipt.companyId);
    if (!expense || !company || expense.status !== "to_review") return null;

    // Fill only what the Owner hasn't: a value they typed while it was being read stays.
    const f = args.fields;
    const patch: Partial<Doc<"expenses">> = {};
    const unclear: string[] = [];
    if (f && args.state === "read") {
      if (!expense.vendor && f.vendor.value) {
        patch.vendor = f.vendor.value;
        patch.vendorKey = vendorKey(f.vendor.value);
      }
      if (!f.vendor.clear || !f.vendor.value) unclear.push("vendor");
      if (!expense.spentOn && isDateKey(f.date.value)) patch.spentOn = f.date.value;
      if (!f.date.clear || !isDateKey(f.date.value)) unclear.push("date");
      if (expense.amountCents === undefined && f.totalCents.value !== null && f.totalCents.value > 0) patch.amountCents = f.totalCents.value;
      if (!f.totalCents.clear || f.totalCents.value === null || f.totalCents.value <= 0) unclear.push("amount");
      if (expense.taxCents === undefined && f.taxCents.value !== null && f.taxCents.value >= 0 && (f.totalCents.value === null || f.taxCents.value <= f.totalCents.value)) patch.taxCents = f.taxCents.value;
      if (f.taxCents.value !== null && !f.taxCents.clear) unclear.push("tax");
      if (!expense.paidWithNote && f.paidWith.value) patch.paidWithNote = f.paidWith.value;
      if (!expense.description && f.items) patch.description = f.items;
      patch.unclear = unclear;
    }
    await ctx.db.patch(expense._id, { ...patch, updatedAt: now, revision: expense.revision + 1 });
    await recordEvent(ctx, { companyId: company._id, type: args.state === "read" ? "expense.read" : "expense.read_failed", actor: { kind: "system" }, subject: { table: "expenses", id: expense._id }, data: { amountCents: patch.amountCents ?? null, unclear: unclear.join(",") || null } });
    const settings = settingsOf(await settingsRow(ctx, company._id));
    await runAutomation(ctx, company, expense._id, settings.expenseCategories, f ? { categoryName: f.categoryName, categoryWhy: f.categoryWhy } : undefined);
    return null;
  },
});
