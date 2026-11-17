/**
 * Bringing existing pricing into Services & Pricing. Reading is code (no credits). Rows wait for a person:
 * each can become a draft or be skipped. A draft from an import carries the row's source as evidence into
 * its review, and a flagged value is held as illustrative until confirmed.
 */
import { v } from "convex/values";

import { companyQuery, managerMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { isManager } from "./lib/roles";
import { FLAG_WORDS, flagDuplicates, IMPORT_LIMITS, rowsFromCsv, rowsFromText, specFromRow } from "./lib/services/imports";
import { categoryValidator } from "./lib/services/spec";
import { draftOf, normalizeSpec } from "./lib/services/store";
import { createDraft } from "./lib/services/workflow";

/** Imports, newest first. */
export const list = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("serviceImports")
      .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(20);
    return rows.map((row) => ({ id: row._id, name: row.name, kind: row.kind, state: row.state, error: row.error ?? null, rows: row.rows.length, pending: row.rows.filter((r) => r.decision === "pending").length, createdAt: row.createdAt }));
  },
});

/** One import: every row with its source, what was read, and what is unclear. */
export const get = companyQuery({
  args: { importId: v.id("serviceImports") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.importId);
    if (!row || row.companyId !== ctx.companyId) throw userError("Not found.", "not_found");
    return { id: row._id, name: row.name, kind: row.kind, state: row.state, error: row.error ?? null, source: row.source, rows: row.rows.map((r) => ({ ...r, flagWords: r.flags.map((f) => FLAG_WORDS[f]) })), canEdit: isManager(ctx.role) };
  },
});

/** Reads a spreadsheet's text or pasted text. A file that cannot be read is kept as a failed import with the reason, never as half a catalog. */
export const create = managerMutation({
  args: { kind: v.union(v.literal("csv"), v.literal("text")), name: v.string(), source: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const name = args.name.trim().slice(0, 120) || (args.kind === "csv" ? "Spreadsheet" : "Pasted pricing");
    const fail = async (error: string) => {
      const importId = await ctx.db.insert("serviceImports", { companyId: ctx.companyId, kind: args.kind, name, source: args.source.slice(0, IMPORT_LIMITS.characters), state: "failed", error, rows: [], createdBy: byMember(ctx), createdAt: now, updatedAt: now });
      return { importId, state: "failed" as const, error };
    };
    if (!args.source.trim()) return fail("The file or text was empty.");
    if (args.source.length > IMPORT_LIMITS.characters) return fail(`That is more than ${IMPORT_LIMITS.characters.toLocaleString("en-US")} characters. Split it into smaller imports.`);
    if (/[\u0000-\u0008\u000e-\u001f]/.test(args.source.slice(0, 2000))) return fail("That does not look like a spreadsheet saved as CSV or plain text. Save it as CSV and try again.");
    const read = args.kind === "csv" ? rowsFromCsv(args.source) : rowsFromText(args.source);
    if (read.length === 0) return fail(args.kind === "csv" ? "No service names were found. The first column, or a column named Service, should hold the names." : "No services were found. Put one service per line, with its price.");
    if (read.length > IMPORT_LIMITS.rows) return fail(`That has ${read.length} rows; up to ${IMPORT_LIMITS.rows} can be imported at once.`);
    const existing = await ctx.db
      .query("services")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "active"))
      .take(200);
    const rows = flagDuplicates(read, existing.map((s) => s.name));
    const importId = await ctx.db.insert("serviceImports", { companyId: ctx.companyId, kind: args.kind, name, source: args.source, state: "review", rows, createdBy: byMember(ctx), createdAt: now, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "service.import_read", actor: byMember(ctx), subject: { table: "serviceImports", id: importId }, data: { rows: rows.length, flagged: rows.filter((r) => r.flags.length).length } });
    return { importId, state: "review" as const, error: null };
  },
});

/** A person's decision on one row: make it a draft (with edits to what was read), or skip it. */
export const decide = managerMutation({
  args: {
    importId: v.id("serviceImports"),
    rowId: v.string(),
    decision: v.union(v.literal("draft"), v.literal("skip")),
    category: v.optional(categoryValidator),
    /** What the person corrected before drafting. */
    name: v.optional(v.string()),
    priceCents: v.optional(v.union(v.number(), v.null())),
    method: v.optional(v.union(v.literal("fixed"), v.literal("hourly_per_cleaner"), v.literal("hourly_per_crew"), v.literal("per_area"), v.literal("per_unit"), v.literal("recurring_package"), v.null())),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.importId);
    if (!record || record.companyId !== ctx.companyId) throw userError("Not found.", "not_found");
    if (record.state !== "review") throw userError("This import is closed.");
    const index = record.rows.findIndex((r) => r.id === args.rowId);
    if (index < 0) throw userError("That row is not in this import.");
    const current = record.rows[index];
    if (current.decision !== "pending") throw userError("That row was already decided.");
    let next = { ...current, decision: args.decision === "draft" ? ("drafted" as const) : ("skipped" as const) };
    if (args.decision === "draft") {
      const corrected = { ...current, ...(args.name?.trim() ? { name: args.name.trim().slice(0, 80) } : {}), ...(args.priceCents !== undefined ? { priceCents: args.priceCents } : {}), ...(args.method !== undefined ? { method: args.method } : {}) };
      // A corrected unit or price clears that flag: the person has now said what it is.
      if (args.method !== undefined && args.method !== null) corrected.flags = corrected.flags.filter((f) => f !== "unclear_unit");
      if (args.priceCents !== undefined && args.priceCents !== null) corrected.flags = corrected.flags.filter((f) => f !== "missing_price");
      const spec = normalizeSpec(specFromRow(corrected, args.category ?? "residential"));
      const { serviceId } = await createDraft(ctx, { category: spec.category, spec, origin: "import", via: "workspace", actor: byMember(ctx) });
      const draft = await draftOf(ctx, ctx.companyId, serviceId);
      if (draft) await ctx.db.patch(draft._id, { evidence: [{ kind: "import", label: `Imported from ${record.name}`, detail: `${current.sourceRef}: ${current.raw}`.slice(0, 600), ref: record._id }] });
      next = { ...corrected, decision: "drafted", serviceId };
    }
    const rows = record.rows.map((r, i) => (i === index ? next : r));
    const done = rows.every((r) => r.decision !== "pending");
    await ctx.db.patch(record._id, { rows, state: done ? "done" : "review", updatedAt: Date.now() });
    return { serviceId: next.serviceId ?? null };
  },
});

export const discard = managerMutation({
  args: { importId: v.id("serviceImports") },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.importId);
    if (!record || record.companyId !== ctx.companyId) throw userError("Not found.", "not_found");
    if (record.state === "review") await ctx.db.patch(record._id, { state: "discarded", updatedAt: Date.now() });
    return null;
  },
});
