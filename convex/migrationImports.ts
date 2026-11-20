/**
 * Importing appointments, recurring service and history from a spreadsheet or another system's export
 * (lib/migration/records.ts), the same way clients are imported: check every row first, then commit in
 * batches kept under the key the screen sent, so a retry never imports twice.
 *
 * Each row must match one client already in Selestial, by email, then phone, then exact name. A row that
 * matches none, or more than one, is held back with the reason: a record is never attached to a guess.
 *
 * Nothing here books a visit, starts a plan, assigns a cleaner, prices anything or contacts anyone. An
 * imported appointment or schedule waits for the owner to set it up; history is kept for reference.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { managerMutation, managerQuery } from "./lib/builders";
import { digits } from "./lib/clients/directory";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { recordKindValidator, recordSourceValidator } from "./lib/migration/schema";
import {
  KIND_WORDS,
  readCadence,
  readCents,
  readDay,
  readMinutes,
  readTime,
  RECORD_COMMIT_LIMIT,
  RECORD_ROW_LIMIT,
  recordKey,
  recordNotes,
  recordProblems,
  type RecordKind,
  type RecordRow,
} from "./lib/migration/records";
import { dayOf } from "./lib/services/propertyPrices";
import { text } from "./lib/text";

const rowValidator = v.object({
  clientName: v.optional(v.string()),
  clientEmail: v.optional(v.string()),
  clientPhone: v.optional(v.string()),
  street: v.optional(v.string()),
  date: v.optional(v.string()),
  time: v.optional(v.string()),
  endDate: v.optional(v.string()),
  duration: v.optional(v.string()),
  frequency: v.optional(v.string()),
  amount: v.optional(v.string()),
  reference: v.optional(v.string()),
  description: v.optional(v.string()),
  status: v.optional(v.string()),
  assignedTo: v.optional(v.string()),
});

type Directory = {
  byEmail: Map<string, Id<"customers">[]>;
  byPhone: Map<string, Id<"customers">[]>;
  byName: Map<string, Id<"customers">[]>;
  names: Map<Id<"customers">, string>;
};

const norm = (value: string | undefined) => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const add = (map: Map<string, Id<"customers">[]>, key: string, id: Id<"customers">) => {
  if (!key) return;
  const list = map.get(key) ?? [];
  if (!list.includes(id)) list.push(id);
  map.set(key, list);
};

/** The company's active clients, indexed once per call so every row is matched the same way. */
async function directoryOf(ctx: QueryCtx, companyId: Id<"companies">): Promise<Directory> {
  const out: Directory = { byEmail: new Map(), byPhone: new Map(), byName: new Map(), names: new Map() };
  const customers = await ctx.db
    .query("customers")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "active"))
    .take(5000);
  for (const customer of customers) {
    out.names.set(customer._id, customer.name);
    add(out.byEmail, norm(customer.email), customer._id);
    if (digits(customer.phone).length === 10) add(out.byPhone, digits(customer.phone), customer._id);
    add(out.byName, norm(customer.name), customer._id);
  }
  const contacts = await ctx.db.query("clientContacts").withIndex("by_company_customer", (q) => q.eq("companyId", companyId)).take(5000);
  for (const contact of contacts) {
    if (!out.names.has(contact.customerId)) continue;
    add(out.byEmail, norm(contact.email), contact.customerId);
    if (digits(contact.phone).length === 10) add(out.byPhone, digits(contact.phone), contact.customerId);
  }
  return out;
}

type Match = { customerId: Id<"customers">; name: string; by: string } | { problem: string };

/** One client for the row, or why there isn't one. Email, then phone, then exact name. */
function matchClient(directory: Directory, row: RecordRow): Match {
  const tries: [string, Id<"customers">[] | undefined][] = [
    ["email", row.clientEmail ? directory.byEmail.get(norm(row.clientEmail.split(/[,;\s]/)[0])) : undefined],
    ["phone", digits(row.clientPhone).length === 10 ? directory.byPhone.get(digits(row.clientPhone)) : undefined],
    ["name", row.clientName ? directory.byName.get(norm(row.clientName)) : undefined],
  ];
  for (const [by, ids] of tries) {
    if (!ids?.length) continue;
    if (ids.length > 1) return { problem: `More than one client has this ${by}. Add the client's email to the row so it matches one.` };
    return { customerId: ids[0], name: directory.names.get(ids[0]) ?? "", by };
  }
  return { problem: "No client in Selestial matches this name, email or phone. Import the client first, or correct the row." };
}

async function propertyAt(ctx: QueryCtx, companyId: Id<"companies">, customerId: Id<"customers">, street: string | undefined): Promise<Id<"properties"> | undefined> {
  const properties = (await ctx.db.query("properties").withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customerId)).take(50)).filter((p) => p.status === "active");
  if (!street?.trim()) return properties.length === 1 ? properties[0]._id : undefined;
  const wanted = norm(street);
  return properties.find((p) => norm(p.address.line1) === wanted || wanted.startsWith(norm(p.address.line1)))?._id;
}

/** What importing these rows would do, row by row. Nothing is written. */
export const check = managerQuery({
  args: { kind: recordKindValidator, rows: v.array(rowValidator) },
  handler: async (ctx, args) => {
    if (args.rows.length > RECORD_ROW_LIMIT) throw userError(`Import up to ${RECORD_ROW_LIMIT} rows at a time.`);
    const directory = await directoryOf(ctx, ctx.companyId);
    const today = dayOf(Date.now(), ctx.company.timezone);
    const seen = new Map<string, number>();
    const rows = [];
    for (const [index, row] of args.rows.entries()) {
      const problems = recordProblems(args.kind, row);
      const match = problems.length ? null : matchClient(directory, row);
      if (match && "problem" in match) problems.push(match.problem);
      const key = recordKey(args.kind, row);
      const before = problems.length
        ? null
        : await ctx.db
            .query("migrationRecords")
            .withIndex("by_company_key", (q) => q.eq("companyId", ctx.companyId).eq("key", key))
            .first();
      const sameAsRow = seen.get(key) ?? null;
      if (sameAsRow === null) seen.set(key, index);
      rows.push({
        index,
        label: row.clientName?.trim() || row.clientEmail?.trim() || `Row ${index + 2}`,
        client: match && !("problem" in match) ? { name: match.name, by: match.by } : null,
        problems,
        notes: recordNotes(args.kind, row, today),
        importedBefore: before !== null,
        sameAsRow,
      });
    }
    return { rows, willCreate: rows.filter((row) => !row.problems.length && !row.importedBefore && row.sameAsRow === null).length };
  },
});

/** Imports one batch. Sent twice under the same key, it returns the first result and writes nothing. */
export const commit = managerMutation({
  args: { importKey: v.string(), kind: recordKindValidator, source: recordSourceValidator, label: v.string(), rows: v.array(v.object({ index: v.number(), row: rowValidator })) },
  handler: async (ctx, args) => {
    const importKey = text(args.importKey, "The import key", 160);
    const existing = await ctx.db
      .query("migrationImportRuns")
      .withIndex("by_company_key", (q) => q.eq("companyId", ctx.companyId).eq("importKey", importKey))
      .first();
    if (existing) return { repeated: true, created: existing.created, skipped: existing.skipped, failed: existing.failed, results: existing.results };
    if (args.rows.length > RECORD_COMMIT_LIMIT) throw userError(`Send up to ${RECORD_COMMIT_LIMIT} rows in one batch.`);
    const now = Date.now();
    const today = dayOf(now, ctx.company.timezone);
    const directory = await directoryOf(ctx, ctx.companyId);
    const runId = await ctx.db.insert("migrationImportRuns", { companyId: ctx.companyId, importKey, kind: args.kind, source: args.source, label: text(args.label || "Spreadsheet", "The import name", 120), results: [], created: 0, skipped: 0, failed: 0, by: ctx.member._id, createdAt: now });
    const results: Doc<"migrationImportRuns">["results"] = [];
    const inBatch = new Set<string>();
    for (const { index, row } of args.rows) {
      const name = (row.clientName ?? row.clientEmail ?? `Row ${index + 2}`).trim().slice(0, 160);
      const problems = recordProblems(args.kind, row);
      if (problems.length) {
        results.push({ index, name, outcome: "failed", reason: problems.join(" ") });
        continue;
      }
      const match = matchClient(directory, row);
      if ("problem" in match) {
        results.push({ index, name, outcome: "failed", reason: match.problem });
        continue;
      }
      const key = recordKey(args.kind, row);
      const before = await ctx.db
        .query("migrationRecords")
        .withIndex("by_company_key", (q) => q.eq("companyId", ctx.companyId).eq("key", key))
        .first();
      if (before || inBatch.has(key)) {
        results.push({ index, name, outcome: "skipped", reason: before ? "Already imported." : "The same record is in the file twice." });
        continue;
      }
      inBatch.add(key);
      const day = readDay(row.date) ?? undefined;
      // A past appointment is history: it is kept for reference, never offered as a visit to book.
      const kind: RecordKind = args.kind === "appointment" && day && day < today ? "history" : args.kind;
      const clip = (value: string | undefined, max = 500) => (value?.trim() ? value.trim().slice(0, max) : undefined);
      await ctx.db.insert("migrationRecords", {
        companyId: ctx.companyId,
        customerId: match.customerId,
        propertyId: await propertyAt(ctx, ctx.companyId, match.customerId, row.street),
        kind,
        source: args.source,
        key,
        day,
        time: readTime(row.time) ?? undefined,
        endDay: readDay(row.endDate) ?? undefined,
        durationMinutes: readMinutes(row.duration) ?? undefined,
        frequency: clip(row.frequency, 120),
        ...(args.kind === "recurring" ? { cadence: readCadence(row.frequency) } : {}),
        amountCents: readCents(row.amount) ?? undefined,
        reference: clip(row.reference, 120),
        description: clip(row.description, 1000),
        status: clip(row.status, 120),
        assignedTo: clip(row.assignedTo, 200),
        review: kind === "history" ? "reference" : "review",
        runId,
        createdAt: now,
      });
      results.push({ index, name: match.name, outcome: "created" });
    }
    const count = (outcome: string) => results.filter((row) => row.outcome === outcome).length;
    await ctx.db.patch(runId, { results, created: count("created"), skipped: count("skipped"), failed: count("failed") });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "migration.records_imported", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { kind: args.kind, source: args.source, created: count("created"), skipped: count("skipped"), failed: count("failed") } });
    return { repeated: false, created: count("created"), skipped: count("skipped"), failed: count("failed"), results };
  },
});

/** For the migration review: how many of each kind came in, and how many still wait for the owner. */
export const summary = managerQuery({
  args: {},
  handler: async (ctx) => {
    const count = async (kind: RecordKind, review: Doc<"migrationRecords">["review"]) =>
      (await ctx.db.query("migrationRecords").withIndex("by_company_kind", (q) => q.eq("companyId", ctx.companyId).eq("kind", kind).eq("review", review)).take(5000)).length;
    const clientRuns = await ctx.db.query("clientImportRuns").withIndex("by_company_key", (q) => q.eq("companyId", ctx.companyId)).take(500);
    return {
      clients: clientRuns.reduce((sum, run) => sum + run.created, 0),
      appointments: { waiting: await count("appointment", "review"), setUp: await count("appointment", "set_up") },
      recurring: { waiting: await count("recurring", "review"), setUp: await count("recurring", "set_up") },
      history: await count("history", "reference"),
    };
  },
});

/** Imported appointments and schedules still waiting for the owner, with their client, for the review screen. */
export const waiting = managerQuery({
  args: { kind: v.union(v.literal("appointment"), v.literal("recurring")) },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("migrationRecords").withIndex("by_company_kind", (q) => q.eq("companyId", ctx.companyId).eq("kind", args.kind).eq("review", "review")).take(200);
    const out = [];
    for (const row of rows) {
      const customer = await ctx.db.get(row.customerId);
      out.push({ id: row._id, customerId: row.customerId, client: customer?.name ?? "", day: row.day ?? null, time: row.time ?? null, durationMinutes: row.durationMinutes ?? null, frequency: row.frequency ?? null, cadence: row.cadence ?? null, amountCents: row.amountCents ?? null, description: row.description ?? null, assignedTo: row.assignedTo ?? null, hasProperty: Boolean(row.propertyId) });
    }
    return out.sort((a, b) => (a.day ?? "").localeCompare(b.day ?? ""));
  },
});

/** A client's imported records, newest first, for the client page. */
export const forClient = managerQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("migrationRecords").withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", args.customerId)).take(200);
    return rows
      .map((row) => ({ id: row._id, kind: row.kind, day: row.day ?? null, time: row.time ?? null, frequency: row.frequency ?? null, cadence: row.cadence ?? null, amountCents: row.amountCents ?? null, reference: row.reference ?? null, description: row.description ?? null, status: row.status ?? null, review: row.review, source: row.source }))
      .sort((a, b) => (b.day ?? "").localeCompare(a.day ?? ""));
  },
});

/**
 * The owner marks an imported appointment or schedule as set up (they made the visit or plan) or sets it
 * aside. Only the record's own review state changes: no visit or plan is made or changed here.
 */
export const decide = managerMutation({
  args: { recordId: v.id("migrationRecords"), review: v.union(v.literal("set_up"), v.literal("dismissed"), v.literal("review")) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.recordId);
    if (!row || row.companyId !== ctx.companyId) throw userError("That record is no longer here.", "not_found");
    if (row.kind === "history") throw userError(`A ${KIND_WORDS.history.one} is kept for reference only.`);
    await ctx.db.patch(row._id, { review: args.review });
    return null;
  },
});
