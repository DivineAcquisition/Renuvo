/**
 * A company's own data rights, used by its Owner: a copy of the company's records, erasing one
 * customer's or one cleaner's personal details, and asking Selestial to delete the whole company.
 *
 * Everything here is the Owner's alone and reaches only the Owner's own company. Nothing here is
 * started by a public request: a person who writes in through the website is answered by staff, who
 * pass the request to the business (convex/requests.ts).
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { PaginationOptions, PaginationResult } from "convex/server";
import schema from "./schema";
import { owned } from "./lib/access";
import { ownerMutation, ownerQuery } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { allow } from "./lib/rateLimit";
import { optionalText } from "./lib/text";
import { refreshClient } from "./lib/clients/directory";
import { eraseCleanerRecords, eraseCustomerRecords, openVisitsOf, openWorkOf, type EraseStep } from "./lib/trust/erase";
import { COMPANY_OMIT, EXPORT_TABLES, without } from "./lib/trust/exportTables";
import { saveRequest } from "./lib/trust/requests";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long a finished export can be downloaded. Selestial's own choice, not a legal requirement: long
 * enough to download, short enough that a copy of every record does not sit in file storage.
 */
export const EXPORT_LIFETIME_MS = 24 * HOUR;
/** Exports one company may ask for in a day. */
export const EXPORTS_PER_COMPANY_PER_DAY = 3;
/** An export still preparing after this long is marked failed. */
const PREPARING_GIVES_UP_AFTER = HOUR;
/** Requests to delete the company in a day. */
const DELETION_REQUESTS_PER_DAY = 3;
/** A company that leaves has its records deleted within this many days (Privacy notice, "How long we keep it"). */
export const COMPANY_DELETION_DAYS = 90;
const PAGE_SIZE = 500;

// ── Exports ───────────────────────────────────────────────────────────────────────────────────────

export const requestExport = ownerMutation({
  args: {},
  handler: async (ctx): Promise<{ exportId: Id<"dataExports"> }> => {
    const recent = await ctx.db
      .query("dataExports")
      .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(5);
    // One at a time: asking again while one is being made returns that one.
    const preparing = recent.find((row) => row.status === "preparing");
    if (preparing) return { exportId: preparing._id };
    if (!(await allow(ctx, `exports:company:${ctx.companyId}`, EXPORTS_PER_COMPANY_PER_DAY, DAY))) {
      throw userError(`A company can ask for ${EXPORTS_PER_COMPANY_PER_DAY} exports a day. Try again tomorrow.`, "limit");
    }
    const now = Date.now();
    const exportId = await ctx.db.insert("dataExports", { companyId: ctx.companyId, requestedBy: ctx.member._id, status: "preparing", expiresAt: now + EXPORT_LIFETIME_MS, createdAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "export.requested", actor: byMember(ctx), subject: { table: "dataExports", id: exportId } });
    await ctx.scheduler.runAfter(0, internal.dataRights.buildExport, { exportId });
    return { exportId };
  },
});

export const exports = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("dataExports")
      .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(20);
    return rows.map((row) => ({
      id: row._id,
      status: row.status === "ready" && row.expiresAt <= now ? ("expired" as const) : row.status,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      sizeBytes: row.sizeBytes ?? null,
      downloadedAt: row.downloadedAt ?? null,
      problem: row.problem ?? null,
    }));
  },
});

/** A download address for a ready export of this company. Recorded each time it is asked for. */
export const downloadUrl = ownerMutation({
  args: { exportId: v.id("dataExports") },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const row = await owned(ctx, args.exportId);
    const now = Date.now();
    if (row.status === "preparing") throw userError("This export is still being prepared.");
    if (row.status !== "ready" || !row.storageId || row.expiresAt <= now) throw userError("This export has expired. Ask for a new one.");
    const url = await ctx.storage.getUrl(row.storageId);
    if (!url) throw userError("This export has expired. Ask for a new one.");
    await ctx.db.patch(row._id, { downloadedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "export.downloaded", actor: byMember(ctx), subject: { table: "dataExports", id: row._id } });
    return { url };
  },
});

type ExportStart = { companyId: Id<"companies">; company: Record<string, unknown> } | null;

export const exportStart = internalQuery({
  args: { exportId: v.id("dataExports") },
  handler: async (ctx, args): Promise<ExportStart> => {
    const row = await ctx.db.get(args.exportId);
    if (!row || row.status !== "preparing") return null;
    const company = await ctx.db.get(row.companyId);
    if (!company) return null;
    return { companyId: row.companyId, company: without(company, COMPANY_OMIT) };
  },
});

/** A loose view of a query on a table chosen at run time. Every table read here is listed in EXPORT_TABLES. */
type LooseQuery = {
  withIndex(name: string, range: (q: { eq(field: string, value: unknown): unknown }) => unknown): { paginate(options: PaginationOptions): Promise<PaginationResult<Record<string, unknown>>> };
};

/** Tables in EXPORT_TABLES that exist in this deployment's schema. */
export function exportableTables() {
  const tables = schema.tables as Record<string, unknown>;
  return EXPORT_TABLES.filter((entry) => entry.table in tables);
}

/** One page of one table, for one company, without the fields that never leave. */
export const exportPage = internalQuery({
  args: { companyId: v.id("companies"), table: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const entry = exportableTables().find((row) => row.table === args.table);
    if (!entry) throw new Error(`Not an exported table: ${args.table}`);
    const query = ctx.db.query(entry.table as TableNames) as unknown as LooseQuery;
    const page = await query.withIndex(entry.index, (q) => q.eq("companyId", args.companyId)).paginate({ cursor: args.cursor, numItems: PAGE_SIZE });
    // Checked again on every row: a row from another company never reaches the file, whatever the index says.
    const rows = page.page.filter((row) => row.companyId === args.companyId).map((row) => without(row, entry.omit));
    return { rows, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const finishExport = internalMutation({
  args: { exportId: v.id("dataExports"), storageId: v.id("_storage"), sizeBytes: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.exportId);
    // Withdrawn or given up on while it was being made: the file is not kept.
    if (!row || row.status !== "preparing") {
      await ctx.storage.delete(args.storageId);
      return null;
    }
    await ctx.db.patch(row._id, { status: "ready", storageId: args.storageId, sizeBytes: args.sizeBytes, expiresAt: Date.now() + EXPORT_LIFETIME_MS });
    await recordEvent(ctx, { companyId: row.companyId, type: "export.ready", actor: { kind: "system" }, subject: { table: "dataExports", id: row._id }, data: { sizeBytes: args.sizeBytes } });
    return null;
  },
});

export const failExport = internalMutation({
  args: { exportId: v.id("dataExports") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.exportId);
    if (!row || row.status !== "preparing") return null;
    await ctx.db.patch(row._id, { status: "failed", problem: "The export could not be made. Ask for a new one." });
    await recordEvent(ctx, { companyId: row.companyId, type: "export.failed", actor: { kind: "system" }, subject: { table: "dataExports", id: row._id } });
    return null;
  },
});

/** Builds the JSON file of one company's records and puts it in file storage. */
export const buildExport = internalAction({
  args: { exportId: v.id("dataExports") },
  handler: async (ctx, args): Promise<null> => {
    const start: ExportStart = await ctx.runQuery(internal.dataRights.exportStart, { exportId: args.exportId });
    if (!start) return null;
    try {
      const tables: Record<string, Record<string, unknown>[]> = {};
      const omitted: Record<string, string> = {};
      for (const entry of exportableTables()) {
        const rows: Record<string, unknown>[] = [];
        let cursor: string | null = null;
        for (;;) {
          const page: { rows: Record<string, unknown>[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.dataRights.exportPage, { companyId: start.companyId, table: entry.table, cursor });
          rows.push(...page.rows);
          if (page.isDone) break;
          cursor = page.continueCursor;
        }
        tables[entry.table] = rows;
        if (entry.omit?.length) omitted[entry.table] = `${entry.omit.join(", ")}: ${entry.why ?? "Internal."}`;
      }
      const file = JSON.stringify(
        {
          format: "selestial.company-export.v1",
          exportedAt: new Date().toISOString(),
          companyId: start.companyId,
          company: start.company,
          tables,
          leftOut: {
            ...omitted,
            actionLinks: "Not included: each is half of a cleaner's link.",
            photos: "Photo files are not in this file; the evidence rows list which photos exist.",
          },
        },
        null,
        2,
      );
      const blob = new Blob([file], { type: "application/json" });
      const storageId = await ctx.storage.store(blob);
      await ctx.runMutation(internal.dataRights.finishExport, { exportId: args.exportId, storageId, sizeBytes: blob.size });
    } catch {
      await ctx.runMutation(internal.dataRights.failExport, { exportId: args.exportId });
    }
    return null;
  },
});

/** Run on a schedule: exports past their time lose their file; exports stuck preparing are marked failed. */
export const expireExports = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("dataExports")
      .withIndex("by_status_expires", (q) => q.eq("status", "ready").lte("expiresAt", now))
      .take(100);
    for (const row of due) {
      if (row.storageId) await ctx.storage.delete(row.storageId);
      await ctx.db.patch(row._id, { status: "expired", storageId: undefined });
      await recordEvent(ctx, { companyId: row.companyId, type: "export.expired", actor: { kind: "system" }, subject: { table: "dataExports", id: row._id } });
    }
    const stuck = await ctx.db
      .query("dataExports")
      .withIndex("by_status_expires", (q) => q.eq("status", "preparing"))
      .take(100);
    let failed = 0;
    for (const row of stuck) {
      if (now - row.createdAt < PREPARING_GIVES_UP_AFTER) continue;
      await ctx.db.patch(row._id, { status: "failed", problem: "The export took too long and was stopped. Ask for a new one." });
      failed += 1;
    }
    return { expired: due.length, failed };
  },
});

// ── Erasing a person ──────────────────────────────────────────────────────────────────────────────

async function record(ctx: Parameters<typeof eraseCustomerRecords>[0] & { member: Doc<"members"> }, subject: Doc<"deletionRecords">["subject"], steps: EraseStep[]) {
  const recordId = await ctx.db.insert("deletionRecords", {
    companyId: ctx.companyId,
    subject,
    requestedBy: ctx.member._id,
    at: Date.now(),
    steps,
    keptReasons: steps.filter((step) => step.state === "kept").map((step) => `${step.step}: ${step.detail}`),
  });
  return recordId;
}

export const eraseCustomer = ownerMutation({
  args: { customerId: v.id("customers"), confirm: v.literal("ERASE") },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const open = await openVisitsOf(ctx, customer);
    if (open.length > 0) {
      throw userError(`This customer has ${open.length} upcoming or active visit${open.length === 1 ? "" : "s"}. Cancel ${open.length === 1 ? "it" : "them"} first, then erase the customer.`);
    }
    const steps = await eraseCustomerRecords(ctx, customer);
    const recordId = await record(ctx, { kind: "customer", id: customer._id }, steps);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "customer.erased", actor: byMember(ctx), subject: { table: "customers", id: customer._id }, data: { deletionRecordId: recordId } });
    await refreshClient(ctx, customer._id);
    return { deletionRecordId: recordId, steps };
  },
});

export const eraseCleaner = ownerMutation({
  args: { cleanerId: v.id("cleaners"), confirm: v.literal("ERASE") },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const open = await openWorkOf(ctx, cleaner);
    if (open.length > 0) {
      throw userError("This cleaner has an open offer or an upcoming job. Cancel the job or release the cleaner from it first, then erase the cleaner.");
    }
    const steps = await eraseCleanerRecords(ctx, cleaner, byMember(ctx));
    const recordId = await record(ctx, { kind: "cleaner", id: cleaner._id }, steps);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.erased", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { deletionRecordId: recordId } });
    return { deletionRecordId: recordId, steps };
  },
});

export const deletions = ownerQuery({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("deletionRecords")
      .withIndex("by_company_at", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(100),
});

// ── Deleting the whole company ────────────────────────────────────────────────────────────────────

/**
 * Not self-serve: it asks Selestial staff, who handle it as a privacy request. The Owner is already
 * signed in, so that is recorded as how they were verified.
 */
export const requestCompanyDeletion = ownerMutation({
  args: { note: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ reference: string; alreadyOpen: boolean }> => {
    const note = optionalText(args.note, "The note", 2000);
    const earlier = await ctx.db
      .query("trustRequests")
      .withIndex("by_company_received", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(50);
    const open = earlier.find((row) => row.kind === "privacy" && row.subtype === "deletion" && !["completed", "closed_with_limitation", "spam"].includes(row.status));
    if (open) return { reference: open.reference, alreadyOpen: true };
    if (!(await allow(ctx, `company-deletion:${ctx.companyId}`, DELETION_REQUESTS_PER_DAY, DAY))) throw userError("Try again tomorrow.", "limit");
    const { reference } = await saveRequest(
      ctx,
      {
        kind: "privacy",
        subtype: "deletion",
        requester: { name: ctx.member.name, email: ctx.member.email, relationship: "cleaning_company_customer" },
        businessName: ctx.company.name,
        details: note ?? "The Owner asked for the company and all its records to be deleted.",
        companyId: ctx.companyId,
        routing: "selestial",
        verification: { method: "Signed in as the company's Owner.", verifiedAt: Date.now(), by: "system" },
        // The Privacy notice promises deletion within this many days of a company leaving.
        dueOn: new Date(Date.now() + COMPANY_DELETION_DAYS * DAY).toISOString().slice(0, 10),
      },
      { by: "owner", action: "received", detail: "Asked for from the company's settings by its Owner." },
    );
    await recordEvent(ctx, { companyId: ctx.companyId, type: "company.deletion_requested", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId } });
    return { reference, alreadyOpen: false };
  },
});
