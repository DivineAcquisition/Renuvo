/**
 * "Bring your business to Selestial": the guided migration from Jobber, Housecall Pro, BookingKoala, a
 * spreadsheet or another system (docs/migration/00-migration.md).
 *
 * One saved migration per company, opened from onboarding, Settings, Customers or Home. The owner chooses a
 * source, uploads CSV exports, confirms what each column is, reviews what Selestial found, imports in the
 * background, then verifies the result and decides when agents may work with it.
 *
 * The parts:
 *  - Files are read on the server (`readFile`): type, size and rows are checked there, never trusted from
 *    the browser. Each row is staged in `migrationRows` with its original cells.
 *  - The check (`check`) runs every rule in lib/migration/analyze.ts over all rows at once, after any change,
 *    and never writes over a row a person changed while it ran.
 *  - The import (`runStep`) writes batch by batch, parents first, checkpointing in the same transaction as
 *    each batch. A retry or a second upload finds what was imported instead of copying it.
 *  - What it writes is held: no Dispatch offer, no plan booking, no message, until the Owner releases it.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { noticeInApp } from "./lib/activation/notices";
import { companyQuery, managerMutation, managerQuery, ownerMutation, ownerQuery, type MemberAccess } from "./lib/builders";
import { bookAhead, seriesDays } from "./lib/clients/plans";
import { authorityFor } from "./lib/authority";
import { rateCardAt } from "./lib/messagingBilling/rates";
import { notifyMembers } from "./lib/notify/route";
import { TABLE_KIND, UNDO_ORDER, undoBlocker, undoRecord } from "./lib/migration/undo";
import { detectSource } from "./lib/clients/importing";
import { parseCsv } from "./lib/csv";
import { applyTemplate } from "./lib/dispatch/templates";
import { userError } from "./lib/errors";
import { byMember, recordEvent, type Actor } from "./lib/events";
import { analyze, type Existing, type RowIn } from "./lib/migration/analyze";
import { CATEGORIES, FIELDS, guessKind, guessMapping, IMPORTABLE, valuesOf, type FileKind, type Importable } from "./lib/migration/rules";
import { categoryValidator, CHOICES, fileKindValidator, MIGRATION_STEPS, sourceValidator } from "./lib/migration/schema";
import { effective, writeRow, type WriteCtx } from "./lib/migration/write";
import { allow } from "./lib/rateLimit";
import { roleOf } from "./lib/roles";
import { dayOf } from "./lib/services/propertyPrices";
import { literals } from "./lib/statuses";

export const LIMITS = { files: 12, bytes: 5 * 1024 * 1024, rowsPerFile: 2000, rows: 5000, batch: 40, leaseMs: 2 * 60 * 1000, attempts: 3 } as const;
const STALE = "This migration changed in another tab or by someone else. Your view has been refreshed.";
const NEEDS_CHOICE = new Set(["duplicate", "review"]);

/** In a support session: which staff member, so their changes are attributed to them. The company sees "Selestial Support". */
function staffOf(ctx: { support: MemberAccess["support"] }) {
  return ctx.support ? { staffId: ctx.support.staff._id, sessionId: ctx.support.session._id } : undefined;
}

/** Records that Selestial staff are helping with this migration, once per staff member. */
async function noteAssist(ctx: MutationCtx & MemberAccess, migration: Doc<"migrations">) {
  if (!ctx.support) return;
  const list = migration.assistedBy ?? [];
  if (list.some((a) => a.staffId === ctx.support!.staff._id)) return;
  await ctx.db.patch(migration._id, { assistedBy: [...list, { staffId: ctx.support.staff._id, name: ctx.support.staff.name, since: Date.now() }] });
}

type Ctx = QueryCtx & MemberAccess;

async function migrationOf(ctx: QueryCtx, companyId: Id<"companies">): Promise<Doc<"migrations"> | null> {
  return ctx.db
    .query("migrations")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .first();
}

async function requireMigration(ctx: Ctx): Promise<Doc<"migrations">> {
  const row = await migrationOf(ctx, ctx.companyId);
  if (!row) throw userError("Open the migration first.");
  return row;
}

function editable(migration: Doc<"migrations">) {
  if (migration.status === "importing") throw userError("Your import is running. Changes can be made once it finishes.");
}

async function ownRow(ctx: Ctx, migration: Doc<"migrations">, id: Id<"migrationRows">): Promise<Doc<"migrationRows">> {
  const row = await ctx.db.get(id);
  if (!row || row.companyId !== ctx.companyId || row.migrationId !== migration._id) throw userError("Not found.", "not_found");
  return row;
}

async function ownFile(ctx: Ctx, migration: Doc<"migrations">, id: Id<"migrationFiles">): Promise<Doc<"migrationFiles">> {
  const file = await ctx.db.get(id);
  if (!file || file.companyId !== ctx.companyId || file.migrationId !== migration._id || file.status === "removed") throw userError("Not found.", "not_found");
  return file;
}

/** Re-checks the whole migration shortly. A newer request replaces an older one, which then writes nothing. */
async function scheduleCheck(ctx: MutationCtx & Partial<MemberAccess>, migration: Doc<"migrations">) {
  if (ctx.support) await noteAssist(ctx as MutationCtx & MemberAccess, (await ctx.db.get(migration._id))!);
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await ctx.db.patch(migration._id, { dirty: true, checking: { token, startedAt: Date.now() }, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(800, internal.migration.check, { migrationId: migration._id, token });
}

/** What a stamp is made of: everything the check reads from a row. A different stamp means it changed. */
function stampOf(row: Pick<Doc<"migrationRows">, "values" | "edits" | "decision" | "category" | "kind">): string {
  return JSON.stringify([row.kind, row.values, row.edits, row.decision?.choice ?? null, row.decision?.targetId ?? null, row.category?.confirmed ? row.category.value : null]);
}

// ── The saved migration ────────────────────────────────────────────────────────────────────────────

/** Opens the company's migration, making it on the first visit. Every entry point opens this same one. */
export const open = managerMutation({
  support: { capability: "records.edit", summary: "opened the migration workspace" },
  args: {},
  handler: async (ctx) => {
    const existing = await migrationOf(ctx, ctx.companyId);
    if (existing) return existing._id;
    const now = Date.now();
    return ctx.db.insert("migrations", {
      companyId: ctx.companyId,
      status: "open",
      step: "source",
      source: null,
      wants: ["customers"],
      timezone: ctx.company.timezone,
      timezoneConfirmed: false,
      dateOrder: null,
      serviceMap: [],
      groups: [],
      notes: [],
      dirty: false,
      revision: 1,
      createdBy: byMember(ctx),
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** For the entry points (onboarding, Settings, Clients, Home): whether there's a migration and where it stands. Anyone in the company may ask. */
export const status = companyQuery({
  args: {},
  handler: async (ctx) => {
    const role = roleOf(ctx.member.role);
    const canOpen = role === "owner" || role === "manager";
    const migration = await migrationOf(ctx, ctx.companyId);
    const hasClients = Boolean(await ctx.db.query("customers").withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "active")).first());
    if (!migration) return { canOpen, status: null, step: null, attention: 0, hasClients };
    const attention = Object.values(migration.summary ?? {}).reduce((n, s) => n + (s.awaiting ?? 0) + (s.error ?? 0), 0);
    return { canOpen, status: migration.status, step: migration.step, attention, hasClients };
  },
});

export const view = managerQuery({
  args: {},
  handler: async (ctx) => {
    const migration = await migrationOf(ctx, ctx.companyId);
    if (!migration) return null;
    const files = (await ctx.db.query("migrationFiles").withIndex("by_migration", (q) => q.eq("migrationId", migration._id)).take(LIMITS.files + 20)).filter((f) => f.status !== "removed");
    const run = await ctx.db
      .query("migrationRuns")
      .withIndex("by_migration", (q) => q.eq("migrationId", migration._id))
      .order("desc")
      .first();
    const services = (await ctx.db.query("services").withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "active")).take(200)).filter((s) => s.publishedVersionId).map((s) => ({ id: s._id, name: s.name, category: s.category }));
    return {
      migration: {
        id: migration._id,
        status: migration.status,
        step: migration.step,
        source: migration.source,
        wants: migration.wants,
        timezone: migration.timezone,
        timezoneConfirmed: migration.timezoneConfirmed,
        dateOrder: migration.dateOrder,
        dateInfo: migration.dateInfo ?? null,
        serviceMap: migration.serviceMap,
        serviceNames: migration.serviceNames ?? [],
        groups: migration.groups,
        notes: migration.notes,
        summary: migration.summary ?? {},
        dirty: migration.dirty,
        checking: Boolean(migration.checking),
        checkedAt: migration.checkedAt ?? null,
        // The company sees "Selestial Support"; which staff member helped is kept in the record and the session log.
        assisted: (migration.assistedBy ?? []).map((a) => ({ since: a.since })),
        revision: migration.revision,
        releasedAt: migration.releasedAt ?? null,
      },
      files: files.map((f) => ({ id: f._id, name: f.name, size: f.size, status: f.status, problem: f.problem ?? null, kind: f.kind, suggested: f.suggested, looksLike: f.looksLike, header: f.header, rowCount: f.rowCount, mapping: f.mapping, mappingConfirmed: f.mappingConfirmed, description: f.description ?? null, createdAt: f.createdAt })),
      run: run ? { id: run._id, status: run.status, phase: run.phase, total: run.total, done: run.done, counts: run.counts, problem: run.problem ?? null, startedAt: run.startedAt, finishedAt: run.finishedAt ?? null } : null,
      services,
      company: { timezone: ctx.company.timezone, name: ctx.company.name },
      canRelease: !ctx.support && roleOf(ctx.member.role) === "owner",
      /** Opened by Selestial staff in a support session: they prepare; the company imports and releases. */
      inSupport: Boolean(ctx.support),
      limits: LIMITS,
    };
  },
});

export const save = managerMutation({
  support: { capability: "records.edit", summary: "updated the migration settings" },
  args: {
    revision: v.number(),
    step: v.optional(literals(MIGRATION_STEPS)),
    source: v.optional(sourceValidator),
    wants: v.optional(v.array(fileKindValidator)),
    timezone: v.optional(v.string()),
    timezoneConfirmed: v.optional(v.boolean()),
    dateOrder: v.optional(v.union(v.literal("mdy"), v.literal("dmy"), v.null())),
  },
  handler: async (ctx, args) => {
    const migration = await requireMigration(ctx);
    if (migration.revision !== args.revision) throw userError(STALE);
    const patch: Partial<Doc<"migrations">> = {};
    if (args.step) patch.step = args.step;
    if (args.source) patch.source = args.source;
    if (args.wants) patch.wants = [...new Set(args.wants)];
    if (args.timezone !== undefined || args.timezoneConfirmed !== undefined || args.dateOrder !== undefined) editable(migration);
    if (args.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: args.timezone });
      } catch {
        throw userError("That isn't a timezone Selestial knows.");
      }
      patch.timezone = args.timezone;
    }
    if (args.timezoneConfirmed !== undefined) patch.timezoneConfirmed = args.timezoneConfirmed;
    if (args.dateOrder !== undefined) patch.dateOrder = args.dateOrder;
    await ctx.db.patch(migration._id, { ...patch, revision: migration.revision + 1, updatedAt: Date.now() });
    if (args.timezone !== undefined || args.dateOrder !== undefined) await scheduleCheck(ctx, (await ctx.db.get(migration._id))!);
    return migration.revision + 1;
  },
});

// ── Files ──────────────────────────────────────────────────────────────────────────────────────────

export const uploadUrl = managerMutation({
  support: { capability: "records.edit", summary: "started a file upload for the migration" },
  args: {},
  handler: async (ctx) => {
    const migration = await requireMigration(ctx);
    editable(migration);
    if (!(await allow(ctx, `migration.upload:${ctx.member._id}`, 30, 10 * 60 * 1000))) throw userError("Too many uploads in a few minutes. Wait a moment.", "limit");
    return ctx.storage.generateUploadUrl();
  },
});

const SPREADSHEET = /\.(xlsx|xlsm|xls|numbers|ods)$/i;

/** Takes an uploaded file. Its name, size and count are checked now; its contents are read on the server next. */
export const addFile = managerMutation({
  support: { capability: "records.edit", summary: "added a file to the migration" },
  args: { storageId: v.id("_storage"), name: v.string() },
  handler: async (ctx, args) => {
    const migration = await requireMigration(ctx);
    editable(migration);
    const meta = await ctx.db.system.get(args.storageId);
    if (!meta) throw userError("That upload was not found. Try again.");
    const name = args.name.trim().slice(0, 200) || "Uploaded file";
    const refuse = async (why: string) => {
      await ctx.storage.delete(args.storageId);
      throw userError(why);
    };
    if (await ctx.db.query("migrationFiles").withIndex("by_storage", (q) => q.eq("storageId", args.storageId)).first()) throw userError("That file was already added.");
    if (SPREADSHEET.test(name)) await refuse("Excel and Numbers files need saving as CSV first. In Excel: File › Save As › CSV UTF-8. In Google Sheets: File › Download › Comma-separated values.");
    if (!/\.(csv|tsv|txt)$/i.test(name)) await refuse("Upload a CSV file (.csv). Most systems can export one.");
    if (meta.size > LIMITS.bytes) await refuse(`That file is ${(meta.size / 1024 / 1024).toFixed(1)} MB. Files can be up to 5 MB; split it into smaller files.`);
    if (meta.size === 0) await refuse("That file is empty.");
    const files = (await ctx.db.query("migrationFiles").withIndex("by_migration", (q) => q.eq("migrationId", migration._id)).take(LIMITS.files + 20)).filter((f) => f.status !== "removed");
    if (files.length >= LIMITS.files) await refuse(`A migration can have up to ${LIMITS.files} files. Remove one first.`);
    if (files.some((f) => f.sha256 === meta.sha256)) await refuse("You already added this exact file.");
    const fileId = await ctx.db.insert("migrationFiles", {
      companyId: ctx.companyId,
      migrationId: migration._id,
      storageId: args.storageId,
      name,
      size: meta.size,
      sha256: meta.sha256,
      status: "reading",
      kind: "other",
      suggested: { kind: "other", because: [] },
      looksLike: null,
      header: [],
      rowCount: 0,
      mapping: {},
      mappingConfirmed: false,
      uploadedBy: byMember(ctx),
      createdAt: Date.now(),
    });
    await ctx.db.patch(migration._id, { step: migration.step === "source" ? "files" : migration.step, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.migration.readFile, { fileId });
    return fileId;
  },
});

export const fileToRead = internalQuery({
  args: { fileId: v.id("migrationFiles") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file || file.status !== "reading" || !file.storageId) return null;
    const total = (await ctx.db.query("migrationFiles").withIndex("by_migration", (q) => q.eq("migrationId", file.migrationId)).take(LIMITS.files + 20)).filter((f) => f.status === "ready").reduce((n, f) => n + f.rowCount, 0);
    return { storageId: file.storageId, rowsElsewhere: total };
  },
});

/** Reads a stored file on the server: is it text, is it a CSV, how many rows, what each column likely is. */
export const readFile = internalAction({
  args: { fileId: v.id("migrationFiles") },
  handler: async (ctx, args): Promise<null> => {
    const file = await ctx.runQuery(internal.migration.fileToRead, args);
    if (!file) return null;
    const failed = (why: string) => ctx.runMutation(internal.migration.fileFailed, { fileId: args.fileId, why });
    const blob = await ctx.storage.get(file.storageId);
    if (!blob) {
      await failed("The file could not be read from storage. Upload it again.");
      return null;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      await failed("This is an Excel or other zipped file, not a CSV. Save it as CSV and upload that.");
      return null;
    }
    if (bytes.slice(0, 4096).includes(0)) {
      await failed("This isn't a text file. Upload a CSV.");
      return null;
    }
    const textContent = new TextDecoder("utf-8").decode(bytes);
    const table = parseCsv(textContent);
    if (table.length < 2) {
      await failed("Selestial found no rows under the header. Check the file has a header row and data.");
      return null;
    }
    const header = table[0].map((cell) => cell.slice(0, 120));
    if (header.length > 120) {
      await failed("This file has more than 120 columns. Export fewer columns.");
      return null;
    }
    const rows = table.slice(1).map((row) => header.map((_, i) => (row[i] ?? "").slice(0, 2000)));
    if (rows.length > LIMITS.rowsPerFile) {
      await failed(`This file has ${rows.length} rows. Files can have up to ${LIMITS.rowsPerFile}; split it into smaller files.`);
      return null;
    }
    if (rows.length + file.rowsElsewhere > LIMITS.rows) {
      await failed(`Together your files would have more than ${LIMITS.rows} rows. Ask Selestial for help with a larger migration.`);
      return null;
    }
    const guessed = guessKind(header);
    const mapping = (IMPORTABLE as readonly string[]).includes(guessed.kind) ? guessMapping(guessed.kind as Importable, header) : {};
    await ctx.runMutation(internal.migration.fileHeader, { fileId: args.fileId, header, rowCount: rows.length, kind: guessed.kind, because: guessed.because.slice(0, 8), looksLike: detectSource(header), mapping });
    for (let start = 0; start < rows.length; start += 400) {
      const ok = await ctx.runMutation(internal.migration.fileRows, { fileId: args.fileId, start, rows: rows.slice(start, start + 400) });
      if (!ok) return null;
    }
    await ctx.runMutation(internal.migration.fileReady, { fileId: args.fileId });
    return null;
  },
});

export const fileFailed = internalMutation({
  args: { fileId: v.id("migrationFiles"), why: v.string() },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file || file.status !== "reading") return null;
    // A file that isn't a usable CSV isn't kept.
    if (file.storageId) await ctx.storage.delete(file.storageId);
    await ctx.db.patch(file._id, { status: "failed", problem: args.why, storageId: undefined });
    return null;
  },
});

export const fileHeader = internalMutation({
  args: { fileId: v.id("migrationFiles"), header: v.array(v.string()), rowCount: v.number(), kind: fileKindValidator, because: v.array(v.string()), looksLike: v.union(v.literal("jobber"), v.literal("housecall_pro"), v.literal("bookingkoala"), v.null()), mapping: v.record(v.string(), v.number()) },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file || file.status !== "reading") return null;
    await ctx.db.patch(file._id, { header: args.header, rowCount: args.rowCount, kind: args.kind, suggested: { kind: args.kind, because: args.because }, looksLike: args.looksLike, mapping: args.mapping });
    return null;
  },
});

export const fileRows = internalMutation({
  args: { fileId: v.id("migrationFiles"), start: v.number(), rows: v.array(v.array(v.string())) },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file || file.status !== "reading") return false;
    // Sent again after a retry: the rows already there are not added twice.
    const already = await ctx.db.query("migrationRows").withIndex("by_file", (q) => q.eq("fileId", file._id).eq("index", args.start)).first();
    if (already) return true;
    for (const [offset, cells] of args.rows.entries()) {
      const values = valuesOf(cells, file.mapping);
      await ctx.db.insert("migrationRows", { companyId: file.companyId, migrationId: file.migrationId, fileId: file._id, kind: file.kind, index: args.start + offset, cells, values, edits: {}, ...(values.externalId ? { sourceId: values.externalId } : {}), state: "ready", problems: [], notes: [], matches: [] });
    }
    return true;
  },
});

export const fileReady = internalMutation({
  args: { fileId: v.id("migrationFiles") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file || file.status !== "reading") return null;
    await ctx.db.patch(file._id, { status: "ready" });
    const migration = (await ctx.db.get(file.migrationId))!;
    await scheduleCheck(ctx, migration);
    return null;
  },
});

/** Re-reads every row of a file with a new kind or mapping. A person's edits are kept. */
async function remap(ctx: MutationCtx, file: Doc<"migrationFiles">, kind: FileKind, mapping: Record<string, number>) {
  const rows = await ctx.db.query("migrationRows").withIndex("by_file", (q) => q.eq("fileId", file._id)).take(LIMITS.rowsPerFile + 1);
  for (const row of rows) {
    const values = valuesOf(row.cells, mapping);
    const kindChanged = row.kind !== kind;
    await ctx.db.patch(row._id, { kind, values, sourceId: values.externalId || undefined, ...(kindChanged ? { decision: undefined, category: undefined, edits: {}, parent: undefined, parsed: undefined } : {}) });
  }
}

/** Says what a file is. Changing it re-suggests the columns for that kind. */
export const setFileKind = managerMutation({
  support: { capability: "records.edit", summary: "said what a migration file contains" },
  args: { fileId: v.id("migrationFiles"), kind: fileKindValidator, description: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const migration = await requireMigration(ctx);
    editable(migration);
    const file = await ownFile(ctx, migration, args.fileId);
    if (file.status !== "ready") throw userError("Wait until the file has been read.");
    const mapping = (IMPORTABLE as readonly string[]).includes(args.kind) ? guessMapping(args.kind as Importable, file.header) : {};
    await ctx.db.patch(file._id, { kind: args.kind, mapping, mappingConfirmed: false, ...(args.description !== undefined ? { description: args.description.trim().slice(0, 300) } : {}) });
    await remap(ctx, file, args.kind, mapping);
    await scheduleCheck(ctx, migration);
    return null;
  },
});

/** Confirms or changes which column is which field. A column is used once; unknown fields are refused. */
export const setMapping = managerMutation({
  support: { capability: "records.edit", summary: "confirmed the columns of a migration file" },
  args: { fileId: v.id("migrationFiles"), mapping: v.record(v.string(), v.number()), confirm: v.boolean() },
  handler: async (ctx, args) => {
    const migration = await requireMigration(ctx);
    editable(migration);
    const file = await ownFile(ctx, migration, args.fileId);
    if (!(IMPORTABLE as readonly string[]).includes(file.kind)) throw userError("Choose what this file contains first.");
    const known = new Set(FIELDS[file.kind as Importable].map((f) => f.key));
    const used = new Set<number>();
    for (const [key, index] of Object.entries(args.mapping)) {
      if (!known.has(key)) throw userError("That field isn't one Selestial reads for this kind of file.");
      if (!Number.isInteger(index) || index < 0 || index >= file.header.length) throw userError("That column isn't in the file.");
      if (used.has(index)) throw userError(`The column "${file.header[index]}" is used for two fields. Choose one.`);
      used.add(index);
    }
    await ctx.db.patch(file._id, { mapping: args.mapping, mappingConfirmed: args.confirm });
    await remap(ctx, file, file.kind, args.mapping);
    await scheduleCheck(ctx, migration);
    return null;
  },
});

export const removeFile = managerMutation({
  support: { capability: "records.edit", summary: "removed a migration file" },
  args: { fileId: v.id("migrationFiles") },
  handler: async (ctx, args) => {
    const migration = await requireMigration(ctx);
    editable(migration);
    const file = await ownFile(ctx, migration, args.fileId);
    const rows = await ctx.db.query("migrationRows").withIndex("by_file", (q) => q.eq("fileId", file._id)).take(LIMITS.rowsPerFile + 1);
    if (rows.some((row) => row.result && row.result.outcome !== "skipped" && row.result.outcome !== "failed")) throw userError("Records from this file were already imported, so it stays with the migration as their source.");
    for (const row of rows) await ctx.db.delete(row._id);
    if (file.storageId) await ctx.storage.delete(file.storageId);
    await ctx.db.patch(file._id, { status: "removed", storageId: undefined });
    await scheduleCheck(ctx, migration);
    return null;
  },
});

/** The original upload, for the owner or staff to look at again. */
export const fileUrl = managerQuery({
  args: { fileId: v.id("migrationFiles") },
  handler: async (ctx, args) => {
    const migration = await requireMigration(ctx);
    const file = await ownFile(ctx, migration, args.fileId);
    return file.storageId ? ctx.storage.getUrl(file.storageId) : null;
  },
});

// ── The check ──────────────────────────────────────────────────────────────────────────────────────

export const checkInput = internalQuery({
  args: { migrationId: v.id("migrations"), token: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const migration = await ctx.db.get(args.migrationId);
    if (!migration || migration.checking?.token !== args.token) return null;
    const page = await ctx.db
      .query("migrationRows")
      .withIndex("by_migration_kind", (q) => q.eq("migrationId", migration._id))
      .paginate({ numItems: 500, cursor: args.cursor });
    return {
      migration: { companyId: migration.companyId, timezone: migration.timezone, dateOrder: migration.dateOrder, serviceMap: migration.serviceMap, groups: migration.groups, source: migration.source },
      rows: page.page.map((row) => ({ id: row._id, kind: row.kind, index: row.index, values: effective(row), decision: row.decision ? { choice: row.decision.choice, ...(row.decision.targetId ? { targetId: row.decision.targetId } : {}) } : undefined, category: row.category?.confirmed ? { value: row.category.value, confirmed: true } : undefined, stamp: stampOf(row), ...(row.result?.id && row.result.outcome !== "failed" && row.result.outcome !== "skipped" ? { resultId: row.result.id } : {}), decided: Boolean(row.decision && row.decision.choice !== "review"), result: row.result?.outcome ?? null, asked: Boolean(row.question && !row.decision && !row.result) })),
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const existingFor = internalQuery({
  args: { companyId: v.id("companies"), source: v.string() },
  handler: async (ctx, args): Promise<Existing & { today: string }> => {
    const company = (await ctx.db.get(args.companyId))!;
    const today = dayOf(Date.now(), company.timezone);
    const customers = await ctx.db.query("customers").withIndex("by_company_status", (q) => q.eq("companyId", args.companyId).eq("status", "active")).take(5000);
    const contacts = await ctx.db.query("clientContacts").withIndex("by_company_customer", (q) => q.eq("companyId", args.companyId)).take(5000);
    const properties = await ctx.db.query("properties").withIndex("by_company_customer", (q) => q.eq("companyId", args.companyId)).take(5000);
    const plans = await ctx.db.query("servicePlans").withIndex("by_company_customer", (q) => q.eq("companyId", args.companyId)).take(3000);
    const jobs = await ctx.db.query("jobs").withIndex("by_company_start", (q) => q.eq("companyId", args.companyId).gte("startsAt", Date.now() - 86_400_000)).take(5000);
    const links = await ctx.db.query("migrationLinks").withIndex("by_company_source_kind_external", (q) => q.eq("companyId", args.companyId).eq("source", args.source)).take(10000);
    const older = await ctx.db.query("importedRecords").withIndex("by_company_source_external", (q) => q.eq("companyId", args.companyId).eq("source", args.source)).take(5000);
    const services = (await ctx.db.query("services").withIndex("by_company_status", (q) => q.eq("companyId", args.companyId).eq("status", "active")).take(200)).filter((s) => s.publishedVersionId);
    const team = (await Promise.all((["onboarding", "ready", "paused"] as const).map((status) => ctx.db.query("cleaners").withIndex("by_company_status", (q) => q.eq("companyId", args.companyId).eq("status", status)).take(2000)))).flat();
    const history = await ctx.db.query("importedHistory").withIndex("by_company_customer_day", (q) => q.eq("companyId", args.companyId)).take(5000);
    const owed = await ctx.db.query("openingBalances").withIndex("by_company_customer", (q) => q.eq("companyId", args.companyId)).take(5000);
    const quick = [
      ...(await ctx.db.query("migrationRecords").withIndex("by_company_kind", (q) => q.eq("companyId", args.companyId).eq("kind", "appointment")).take(3000)),
      ...(await ctx.db.query("migrationRecords").withIndex("by_company_kind", (q) => q.eq("companyId", args.companyId).eq("kind", "recurring")).take(3000)),
    ].filter((r) => r.review !== "dismissed");
    return {
      today,
      cleaners: team.map((c) => ({ id: c._id, name: c.name, ...(c.email ? { email: c.email } : {}), ...(c.phone ? { phone: c.phone } : {}) })),
      history: history.map((h) => ({ customerId: h.customerId, day: h.day, ...(h.externalId ? { externalId: h.externalId } : {}) })),
      balances: owed.map((b) => ({ customerId: b.customerId, reference: b.reference })),
      quick: quick.map((r) => ({ customerId: r.customerId, kind: r.kind as "appointment" | "recurring", ...(r.day ? { day: r.day } : {}) })),
      customers: customers.map((c) => ({ id: c._id, name: c.name, ...(c.email ? { email: c.email } : {}), ...(c.phone ? { phone: c.phone } : {}) })),
      contacts: contacts.filter((c) => c.status === "active").map((c) => ({ customerId: c.customerId, ...(c.email ? { email: c.email } : {}), ...(c.phone ? { phone: c.phone } : {}) })),
      properties: properties.filter((p) => p.status === "active").map((p) => ({ id: p._id, customerId: p.customerId, line1: p.address.line1, ...(p.address.line2 ? { line2: p.address.line2 } : {}), postalCode: p.address.postalCode, ...(p.label ? { label: p.label } : {}) })),
      plans: plans.map((p) => ({ propertyId: p.propertyId, serviceId: p.serviceId, state: p.state })),
      jobs: jobs.filter((j) => j.status !== "cancelled").map((j) => ({ propertyId: j.propertyId, day: dayOf(j.startsAt, company.timezone), serviceType: j.serviceType })),
      links: [...links.map((l) => ({ kind: l.kind, externalId: l.externalId, table: l.table, recordId: l.recordId })), ...older.map((r) => ({ kind: "customers", externalId: r.externalId, table: "customers", recordId: r.customerId }))],
      services: services.map((s) => ({ id: s._id, name: s.name })),
    };
  },
});

const rowOutValidator = v.object({
  id: v.id("migrationRows"),
  stamp: v.string(),
  state: literals(["ready", "update", "duplicate", "skip", "error", "review", "held"] as const),
  problems: v.array(v.string()),
  notes: v.array(v.string()),
  matches: v.array(v.object({ table: v.string(), id: v.string(), name: v.string(), why: v.string() })),
  parent: v.optional(v.object({ rowId: v.optional(v.string()), customerId: v.optional(v.string()), propertyRowId: v.optional(v.string()), propertyId: v.optional(v.string()), planRowId: v.optional(v.string()), planDate: v.optional(v.string()) })),
  category: v.optional(v.object({ value: categoryValidator, because: v.string(), confirmed: v.boolean() })),
  groupKey: v.optional(v.string()),
  parsed: v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null())),
});

/** Runs every rule over every row. Reads in pages, decides in memory, writes back in batches. */
export const check = internalAction({
  args: { migrationId: v.id("migrations"), token: v.string() },
  handler: async (ctx, args): Promise<null> => {
    type CheckRow = RowIn & { stamp: string; decided: boolean; result: string | null; asked: boolean };
    type CheckMigration = { companyId: Id<"companies">; timezone: string; dateOrder: "mdy" | "dmy" | null; serviceMap: { name: string; serviceId: Id<"services"> | null }[]; groups: { key: string; accepted: boolean | null }[]; source: string | null };
    const rows: CheckRow[] = [];
    let cursor: string | null = null;
    let migration: CheckMigration | null = null;
    for (;;) {
      const page: { migration: CheckMigration; rows: CheckRow[]; cursor: string | null } | null = await ctx.runQuery(internal.migration.checkInput, { migrationId: args.migrationId, token: args.token, cursor });
      if (!page) return null;
      migration = page.migration;
      rows.push(...page.rows);
      cursor = page.cursor;
      if (!cursor) break;
    }
    if (!migration) return null;
    const source = migration.source === "jobber" || migration.source === "housecall_pro" ? migration.source : "csv";
    const existing = await ctx.runQuery(internal.migration.existingFor, { companyId: migration.companyId, source });
    const result = analyze({ rows, existing, context: { today: existing.today, dateOrder: migration.dateOrder, serviceMap: migration.serviceMap, groups: migration.groups } });
    const stamps = new Map(rows.map((row) => [row.id, row.stamp]));
    // The source id is kept on the row from its mapping; the check sends back only what it decides.
    const outs = result.rows.map((row) => ({ state: row.state, problems: row.problems, notes: row.notes, matches: row.matches, parsed: row.parsed, ...(row.parent ? { parent: row.parent } : {}), ...(row.category ? { category: row.category } : {}), ...(row.groupKey ? { groupKey: row.groupKey } : {}), id: row.id as Id<"migrationRows">, stamp: stamps.get(row.id)! }));
    for (let at = 0; at < outs.length; at += 200) {
      const ok = await ctx.runMutation(internal.migration.applyCheck, { migrationId: args.migrationId, token: args.token, rows: outs.slice(at, at + 200) });
      if (!ok) return null;
    }
    // Counts for the screens, by kind and state.
    const summary: Record<string, Record<string, number>> = {};
    const states = new Map(result.rows.map((row) => [row.id, row.state]));
    for (const row of rows) {
      const bucket = (summary[row.kind] ??= { total: 0, ready: 0, update: 0, duplicate: 0, skip: 0, error: 0, review: 0, held: 0, awaiting: 0, written: 0, questions: 0 });
      if (row.asked) bucket.questions += 1;
      const state = states.get(row.id)!;
      bucket.total += 1;
      bucket[state] += 1;
      if (NEEDS_CHOICE.has(state) && !row.decided) bucket.awaiting += 1;
      if (row.result) bucket.written += 1;
    }
    const serviceNames = result.serviceNames.map((s) => ({ name: s.name.slice(0, 120), rows: s.rows, suggested: (existing.services.find((x) => x.name.trim().toLowerCase() === s.name.trim().toLowerCase())?.id ?? null) as Id<"services"> | null })).slice(0, 100);
    await ctx.runMutation(internal.migration.finishCheck, { migrationId: args.migrationId, token: args.token, groups: result.groups.slice(0, 200), serviceNames, dateInfo: { inferred: result.dateOrder.order, proof: result.dateOrder.proof, ambiguous: result.dateOrder.ambiguous }, notes: result.notes, summary });
    return null;
  },
});

export const applyCheck = internalMutation({
  args: { migrationId: v.id("migrations"), token: v.string(), rows: v.array(rowOutValidator) },
  handler: async (ctx, args) => {
    const migration = await ctx.db.get(args.migrationId);
    if (!migration || migration.checking?.token !== args.token) return false;
    let changed = false;
    for (const out of args.rows) {
      const row = await ctx.db.get(out.id);
      if (!row || row.migrationId !== migration._id) continue;
      // Changed while the check ran: left as it is, and checked again.
      if (stampOf(row) !== out.stamp) {
        changed = true;
        continue;
      }
      const parent = out.parent
        ? {
            ...(out.parent.rowId ? { rowId: out.parent.rowId as Id<"migrationRows"> } : {}),
            ...(out.parent.customerId ? { customerId: out.parent.customerId as Id<"customers"> } : {}),
            ...(out.parent.propertyRowId ? { propertyRowId: out.parent.propertyRowId as Id<"migrationRows"> } : {}),
            ...(out.parent.propertyId ? { propertyId: out.parent.propertyId as Id<"properties"> } : {}),
            ...(out.parent.planRowId ? { planRowId: out.parent.planRowId as Id<"migrationRows"> } : {}),
            ...(out.parent.planDate ? { planDate: out.parent.planDate } : {}),
          }
        : undefined;
      await ctx.db.patch(row._id, { state: out.state, problems: out.problems.slice(0, 12), notes: out.notes.slice(0, 12), matches: out.matches.slice(0, 6), parent, category: out.category, groupKey: out.groupKey, parsed: out.parsed, stamp: out.stamp });
    }
    if (changed) {
      // A row changed under this check: a fresh check replaces it, and this one writes no more.
      await scheduleCheck(ctx, migration);
      return false;
    }
    return true;
  },
});

export const finishCheck = internalMutation({
  args: {
    migrationId: v.id("migrations"),
    token: v.string(),
    groups: v.array(v.object({ key: v.string(), name: v.string(), properties: v.number() })),
    serviceNames: v.array(v.object({ name: v.string(), rows: v.number(), suggested: v.union(v.id("services"), v.null()) })),
    dateInfo: v.object({ inferred: v.union(v.literal("mdy"), v.literal("dmy"), v.null()), proof: v.union(v.string(), v.null()), ambiguous: v.number() }),
    notes: v.array(v.object({ key: v.string(), step: v.union(v.literal("organize"), v.literal("review")), words: v.string(), tone: v.union(v.literal("info"), v.literal("attention"), v.literal("done")) })),
    summary: v.record(v.string(), v.record(v.string(), v.number())),
  },
  handler: async (ctx, args) => {
    const migration = await ctx.db.get(args.migrationId);
    if (!migration || migration.checking?.token !== args.token) return null;
    const now = Date.now();
    // An owner's group decision is kept for as long as the group is in the files.
    const groups = args.groups.map((g) => ({ ...g, accepted: migration.groups.find((old) => old.key === g.key)?.accepted ?? null }));
    // The check's notes replace its earlier ones; notes from elsewhere (import, release) stay.
    const keep = migration.notes.filter((n) => n.step !== "organize" && n.step !== "review");
    const notes = [...keep, ...args.notes.map((n) => ({ ...n, at: now }))].slice(-40);
    await ctx.db.patch(migration._id, { groups, serviceNames: args.serviceNames, dateInfo: args.dateInfo, notes, summary: args.summary, checkedAt: now, checking: undefined, dirty: false });
    return null;
  },
});

/** Checks again now, for the "Check again" button. */
export const recheck = managerMutation({
  support: { capability: "records.edit", summary: "checked the migration again" },
  args: {},
  handler: async (ctx) => {
    const migration = await requireMigration(ctx);
    editable(migration);
    await scheduleCheck(ctx, migration);
    return null;
  },
});

// ── Organize and review ────────────────────────────────────────────────────────────────────────────

/** Says which Selestial service an old service name is, or that its visits aren't brought over (null). */
export const mapService = managerMutation({
  support: { capability: "records.edit", summary: "matched a service name in the migration" },
  args: { name: v.string(), serviceId: v.union(v.id("services"), v.null()) },
  handler: async (ctx, args) => {
    const migration = await requireMigration(ctx);
    editable(migration);
    const name = args.name.trim().slice(0, 120);
    if (!name) throw userError("Name the service.");
    if (args.serviceId) {
      const service = await ctx.db.get(args.serviceId);
      if (!service || service.companyId !== ctx.companyId || service.status !== "active" || !service.publishedVersionId) throw userError("Choose a live service from Services & Pricing.");
    }
    const serviceMap = [...migration.serviceMap.filter((s) => s.name.trim().toLowerCase() !== name.toLowerCase()), { name, serviceId: args.serviceId }];
    await ctx.db.patch(migration._id, { serviceMap });
    await scheduleCheck(ctx, migration);
    return null;
  },
});

/** Accepts or rejects one commercial-account grouping Selestial suggested. */
export const decideGroup = managerMutation({
  support: { capability: "records.edit", summary: "decided a commercial-account grouping in the migration" },
  args: { key: v.string(), accepted: v.boolean() },
  handler: async (ctx, args) => {
    const migration = await requireMigration(ctx);
    editable(migration);
    if (!migration.groups.some((g) => g.key === args.key)) throw userError("That grouping isn't in your files any more.");
    await ctx.db.patch(migration._id, { groups: migration.groups.map((g) => (g.key === args.key ? { ...g, accepted: args.accepted } : g)) });
    await scheduleCheck(ctx, migration);
    return null;
  },
});

/**
 * The owner's choice for one row, or for several rows with the same kind of problem. "keep_existing" and
 * "update_fields" name the existing record, which must be one the row was matched to.
 */
export const decide = managerMutation({
  support: { capability: "records.edit", summary: "decided records in the migration" },
  args: { rowIds: v.array(v.id("migrationRows")), choice: literals(CHOICES), targetId: v.optional(v.string()), fields: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const migration = await requireMigration(ctx);
    editable(migration);
    if (!args.rowIds.length) return null;
    if (args.rowIds.length > 200) throw userError("Choose up to 200 rows at a time.");
    const rows = await Promise.all(args.rowIds.map((id) => ownRow(ctx, migration, id)));
    // Bulk choices are for genuinely similar problems: one kind of record, in one state.
    if (new Set(rows.map((r) => `${r.kind}|${r.state}`)).size > 1) throw userError("Choose rows of the same kind with the same problem to decide them together.");
    const kind = rows[0].kind;
    if ((args.choice === "keep_existing" && kind !== "customers" && kind !== "properties" && kind !== "cleaners") || (args.choice === "update_fields" && kind !== "customers")) throw userError("This kind of record can be added or skipped.");
    if (args.choice === "update_fields" && !args.fields?.length) throw userError("Choose which fields to update.");
    if (args.fields?.some((f) => !["email", "phone", "notes", "category", "address"].includes(f))) throw userError("Those fields can't be updated from an import.");
    const actor = byMember(ctx);
    for (const row of rows) {
      if (row.result && row.result.outcome !== "failed") throw userError(`Row ${row.index + 2} was already imported.`);
      if (row.state === "error" && args.choice !== "skip" && args.choice !== "review") throw userError(`Row ${row.index + 2} has problems to fix first: ${row.problems[0] ?? ""}`);
      let targetId = args.targetId;
      if (args.choice === "keep_existing" || args.choice === "update_fields") {
        const candidates = row.matches.filter((m) => m.table === (kind === "customers" ? "customers" : kind === "cleaners" ? "cleaners" : "properties"));
        if (targetId && !candidates.some((m) => m.id === targetId)) throw userError(`Row ${row.index + 2} wasn't matched to that record.`);
        if (!targetId && candidates.length !== 1) throw userError(`Choose which existing record row ${row.index + 2} is.`);
        targetId ??= candidates[0].id;
      }
      // A failed row can be decided again; its old result is cleared so the next run writes it.
      const staff = staffOf(ctx);
      await ctx.db.patch(row._id, { decision: { choice: args.choice, ...(targetId ? { targetId } : {}), ...(args.fields ? { fields: args.fields } : {}), by: actor, at: Date.now(), ...(staff ? { staff } : {}) }, ...(row.result?.outcome === "failed" ? { result: undefined } : {}), ...(!staff ? { question: undefined } : {}) });
    }
    await scheduleCheck(ctx, migration);
    return null;
  },
});

/** Takes back a choice. */
export const undecide = managerMutation({
  support: { capability: "records.edit", summary: "took back a migration decision" },
  args: { rowIds: v.array(v.id("migrationRows")) },
  handler: async (ctx, args) => {
    const migration = await requireMigration(ctx);
    editable(migration);
    for (const id of args.rowIds.slice(0, 200)) {
      const row = await ownRow(ctx, migration, id);
      if (row.result && row.result.outcome !== "failed") continue;
      await ctx.db.patch(row._id, { decision: undefined });
    }
    await scheduleCheck(ctx, migration);
    return null;
  },
});

/** Sets customers' type, confirmed by a person. */
export const setCategory = managerMutation({
  support: { capability: "records.edit", summary: "set customer types in the migration" },
  args: { rowIds: v.array(v.id("migrationRows")), category: categoryValidator },
  handler: async (ctx, args) => {
    const migration = await requireMigration(ctx);
    editable(migration);
    for (const id of args.rowIds.slice(0, 200)) {
      const row = await ownRow(ctx, migration, id);
      if (row.kind !== "customers") throw userError("Only customers have a type.");
      if (row.result) continue;
      await ctx.db.patch(row._id, { category: { value: args.category, because: "You chose it.", confirmed: true } });
    }
    await scheduleCheck(ctx, migration);
    return null;
  },
});

/**
 * Corrects a value. The original cell is kept beside it; the correction is the owner's and is never
 * overwritten by a re-check or a new mapping. Several rows can get the same value (a missing start time).
 */
export const edit = managerMutation({
  support: { capability: "records.edit", summary: "corrected values in the migration" },
  args: { rowIds: v.array(v.id("migrationRows")), field: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    const migration = await requireMigration(ctx);
    editable(migration);
    if (!args.rowIds.length || args.rowIds.length > 200) throw userError("Choose up to 200 rows.");
    const value = args.value.replace(/\s+/g, " ").trim().slice(0, 500);
    const actor = byMember(ctx);
    for (const id of args.rowIds) {
      const row = await ownRow(ctx, migration, id);
      if (!(IMPORTABLE as readonly string[]).includes(row.kind)) throw userError("This kind of record isn't imported yet.");
      if (!FIELDS[row.kind as Importable].some((f) => f.key === args.field)) throw userError("That field isn't one Selestial reads for this record.");
      if (row.result && row.result.outcome !== "failed") throw userError(`Row ${row.index + 2} was already imported. Change it on the record itself.`);
      const staff = staffOf(ctx);
      await ctx.db.patch(row._id, { edits: { ...row.edits, [args.field]: value }, editedBy: actor, editedByStaff: staff, ...(row.result?.outcome === "failed" ? { result: undefined } : {}) });
    }
    await scheduleCheck(ctx, migration);
    return null;
  },
});

/** Puts back the original value of a field. */
export const revertEdit = managerMutation({
  support: { capability: "records.edit", summary: "put back an original value in the migration" },
  args: { rowId: v.id("migrationRows"), field: v.string() },
  handler: async (ctx, args) => {
    const migration = await requireMigration(ctx);
    editable(migration);
    const row = await ownRow(ctx, migration, args.rowId);
    const edits = { ...row.edits };
    delete edits[args.field];
    await ctx.db.patch(row._id, { edits });
    await scheduleCheck(ctx, migration);
    return null;
  },
});

/**
 * Selestial staff, in a support session, leave the owner a question about rows they can't settle alone:
 * which of two customers a booking is for, whether a person still works there. It waits for the owner.
 */
export const askOwner = managerMutation({
  support: { capability: "records.edit", summary: "asked the owner about records in the migration" },
  args: { rowIds: v.array(v.id("migrationRows")), text: v.string() },
  handler: async (ctx, args) => {
    const migration = await requireMigration(ctx);
    editable(migration);
    const staff = staffOf(ctx);
    if (!staff) throw userError("Questions are for Selestial staff helping with your migration. You can decide these rows yourself.");
    const words = args.text.replace(/\s+/g, " ").trim().slice(0, 500);
    if (!words) throw userError("Write the question.");
    for (const id of args.rowIds.slice(0, 200)) {
      const row = await ownRow(ctx, migration, id);
      await ctx.db.patch(row._id, { question: { text: words, staff, at: Date.now() } });
    }
    await noteAssist(ctx, migration);
    await scheduleCheck(ctx, migration);
    return null;
  },
});

const FILTERS = ["all", "attention", "questions", "ready", "update", "duplicate", "review", "error", "skip", "held", "failed"] as const;

function rowView(row: Doc<"migrationRows">) {
  return {
    id: row._id,
    fileId: row.fileId,
    kind: row.kind,
    index: row.index,
    cells: row.cells,
    values: effective(row),
    edited: Object.keys(row.edits),
    state: row.state,
    problems: row.problems,
    notes: row.notes,
    matches: row.matches,
    parent: row.parent ?? null,
    category: row.category ?? null,
    groupKey: row.groupKey ?? null,
    parsed: row.parsed ?? {},
    decision: row.decision ? { choice: row.decision.choice, targetId: row.decision.targetId ?? null, fields: row.decision.fields ?? [], bySupport: Boolean(row.decision.staff) } : null,
    editedBySupport: Boolean(row.editedByStaff),
    question: row.question ? { text: row.question.text, at: row.question.at } : null,
    undone: row.undone ? { at: row.undone.at } : null,
    undoBlocked: row.undoBlocked ?? null,
    result: row.result ?? null,
  };
}

/** One kind of record, a page at a time, filtered by what needs attention or by state. Search reads up to the file limit. */
export const rows = managerQuery({
  args: { kind: fileKindValidator, filter: literals(FILTERS), search: v.optional(v.string()), offset: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    const migration = await migrationOf(ctx, ctx.companyId);
    if (!migration) return { rows: [], total: 0 };
    const limit = Math.min(Math.max(1, args.limit), 100);
    const all = await ctx.db.query("migrationRows").withIndex("by_migration_kind", (q) => q.eq("migrationId", migration._id).eq("kind", args.kind)).take(LIMITS.rows);
    const words = args.search?.trim().toLowerCase();
    const picked = all.filter((row) => {
      const ok =
        args.filter === "all" ||
        (args.filter === "attention" && (row.state === "error" || (NEEDS_CHOICE.has(row.state) && (!row.decision || row.decision.choice === "review")))) ||
        (args.filter === "failed" && row.result?.outcome === "failed") ||
        (args.filter === "questions" && Boolean(row.question) && !row.result) ||
        row.state === args.filter;
      if (!ok) return false;
      if (!words) return true;
      return Object.values(effective(row)).some((value) => value.toLowerCase().includes(words));
    });
    return { rows: picked.slice(args.offset, args.offset + limit).map(rowView), total: picked.length };
  },
});

// ── Import ─────────────────────────────────────────────────────────────────────────────────────────

/** What would be written, and what still stops it, for the Import step. */
export const readiness = managerQuery({
  args: {},
  handler: async (ctx) => {
    const migration = await migrationOf(ctx, ctx.companyId);
    if (!migration) return null;
    const summary = migration.summary ?? {};
    const blockers: string[] = [];
    if (migration.checking || migration.dirty) blockers.push("Selestial is still checking your latest changes.");
    const scheduled = (summary.recurring?.total ?? 0) + (summary.bookings?.total ?? 0);
    if (scheduled && !migration.timezoneConfirmed) blockers.push("Confirm your business timezone, so visit times are read correctly.");
    const files = (await ctx.db.query("migrationFiles").withIndex("by_migration", (q) => q.eq("migrationId", migration._id)).take(LIMITS.files + 20)).filter((f) => f.status === "ready" && (IMPORTABLE as readonly string[]).includes(f.kind));
    for (const file of files) if (!file.mappingConfirmed) blockers.push(`Confirm the columns of ${file.name}.`);
    if (!files.length) blockers.push("Add at least one file with customers, properties, recurring services or bookings.");
    const kinds = IMPORTABLE.map((kind) => {
      const s = summary[kind] ?? {};
      return { kind, total: s.total ?? 0, ready: s.ready ?? 0, update: s.update ?? 0, duplicate: s.duplicate ?? 0, review: s.review ?? 0, error: s.error ?? 0, skip: s.skip ?? 0, awaiting: s.awaiting ?? 0, written: s.written ?? 0 };
    });
    return { blockers, kinds, held: summary };
  },
});

/** Starts the background import. A second press finds the run already going. */
export const startImport = managerMutation({
  args: {},
  handler: async (ctx) => {
    const migration = await requireMigration(ctx);
    const running = await ctx.db.query("migrationRuns").withIndex("by_migration", (q) => q.eq("migrationId", migration._id)).order("desc").first();
    if (running?.status === "running") return running._id;
    if (migration.checking || migration.dirty) throw userError("Selestial is still checking your latest changes. Try again in a moment.");
    const summary = migration.summary ?? {};
    if (((summary.recurring?.total ?? 0) + (summary.bookings?.total ?? 0)) > 0 && !migration.timezoneConfirmed) throw userError("Confirm your business timezone first.");
    const total = IMPORTABLE.reduce((n, kind) => n + (summary[kind]?.total ?? 0) - (summary[kind]?.written ?? 0), 0);
    const now = Date.now();
    const runId = await ctx.db.insert("migrationRuns", { companyId: ctx.companyId, migrationId: migration._id, status: "running", phase: 0, cursor: -1, counts: { created: 0, updated: 0, linked: 0, skipped: 0, failed: 0 }, total, done: 0, attempts: 0, leaseUntil: now + LIMITS.leaseMs, startedBy: byMember(ctx), startedAt: now });
    await ctx.db.patch(migration._id, { status: "importing", step: "import", updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "migration.import_started", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { rows: total } });
    await ctx.scheduler.runAfter(0, internal.migration.runStep, { runId });
    return runId;
  },
});

/** The member a run writes as: the person who started it, while they're still an active Owner or Manager. */
async function runner(ctx: MutationCtx, run: Doc<"migrationRuns">): Promise<WriteCtx | null> {
  if (run.startedBy.kind !== "member") return null;
  const member = await ctx.db.get(run.startedBy.memberId);
  const company = await ctx.db.get(run.companyId);
  if (!member || !company || member.status !== "active" || member.companyId !== company._id || company.suspendedAt) return null;
  const role = roleOf(member.role);
  if (role !== "owner" && role !== "manager") return null;
  return { ...ctx, member, company, companyId: company._id, role, identity: { subject: member.userId ?? "", issuer: member.userIssuer ?? "", tokenIdentifier: `${member.userIssuer ?? ""}|${member.userId ?? ""}` } } as unknown as WriteCtx;
}

/** One batch: up to 40 rows of the current kind, written and checkpointed together. Then the next batch. */
export const runStep = internalMutation({
  args: { runId: v.id("migrationRuns"), batch: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running") return null;
    const migration = await ctx.db.get(run.migrationId);
    if (!migration) return null;
    const as = await runner(ctx, run);
    if (!as) {
      await ctx.db.patch(run._id, { status: "failed", problem: "The person who started this import can no longer import for this company. An Owner or Manager can start it again; nothing is written twice.", finishedAt: Date.now() });
      await ctx.db.patch(migration._id, { status: "open", updatedAt: Date.now() });
      return null;
    }
    const actor: Actor = run.startedBy;
    let { phase, cursor, done } = run;
    const counts = { ...run.counts };
    const kind = IMPORTABLE[phase];
    const rows = await ctx.db
      .query("migrationRows")
      .withIndex("by_migration_kind", (q) => q.eq("migrationId", migration._id).eq("kind", kind).gt("index", cursor))
      .take(args.batch ?? LIMITS.batch);
    for (const row of rows) {
      const result = await writeRow(as, migration, row, actor);
      cursor = row.index;
      if (!result) continue;
      await ctx.db.patch(row._id, { result: { ...result, at: Date.now() } });
      counts[result.outcome] += 1;
      done += 1;
    }
    if (rows.length < (args.batch ?? LIMITS.batch)) {
      phase += 1;
      cursor = -1;
    }
    const finished = phase >= IMPORTABLE.length;
    await ctx.db.patch(run._id, { phase, cursor, counts, done, attempts: rows.length ? 0 : run.attempts, leaseUntil: Date.now() + LIMITS.leaseMs, ...(finished ? { status: "done" as const, finishedAt: Date.now() } : {}) });
    if (!finished) {
      await ctx.scheduler.runAfter(0, internal.migration.runStep, { runId: run._id });
      return null;
    }
    await finishRun(ctx, migration, { ...run, counts, done });
    return null;
  },
});

async function finishRun(ctx: MutationCtx, migration: Doc<"migrations">, run: Doc<"migrationRuns">) {
  const now = Date.now();
  const c = run.counts;
  const attention = c.failed > 0;
  const words = `${c.created} created, ${c.updated} updated, ${c.linked} matched to existing records, ${c.skipped} skipped${c.failed ? `, ${c.failed} failed` : ""}.`;
  const notes = [...migration.notes.filter((n) => n.key !== "import"), { key: "import", step: "verify" as const, words: `Import finished: ${words} Nothing has been sent to customers or cleaners.`, tone: attention ? ("attention" as const) : ("done" as const), at: now }];
  await ctx.db.patch(migration._id, { status: "imported", step: "verify", notes, updatedAt: now });
  // The counts on screen include what was just written.
  await scheduleCheck(ctx, (await ctx.db.get(migration._id))!);
  await recordEvent(ctx, { companyId: migration.companyId, type: "migration.imported", actor: run.startedBy, subject: { table: "companies", id: migration.companyId }, data: { created: c.created, updated: c.updated, linked: c.linked, skipped: c.skipped, failed: c.failed } });
  await noticeInApp(ctx, { companyId: migration.companyId, kind: attention ? "needs_information" : "batch_finished", headline: "Your import is ready to review", summary: `${words} Some records may need attention before your agents can use them.`, key: `migration.imported:${run._id}` });
  // The branded email goes to the Owner, through the shared notice router (its preferences, quiet hours and outbox).
  await notifyMembers(ctx, { companyId: migration.companyId, event: "migration_complete", ref: migration._id, key: run._id, facts: { created: c.created, updated: c.updated, linked: c.linked, skipped: c.skipped, failed: c.failed } });
}

/** Every few minutes: a run whose step stopped (a deploy, a crash) is picked up where its checkpoint left it. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stuck = await ctx.db.query("migrationRuns").withIndex("by_status_lease", (q) => q.eq("status", "running").lt("leaseUntil", now)).take(20);
    for (const run of stuck) {
      const attempts = run.attempts + 1;
      if (attempts > LIMITS.attempts) {
        // The same batch kept failing: the next row is marked failed on its own, and the run moves past it.
        const kind = IMPORTABLE[run.phase];
        const next = kind ? await ctx.db.query("migrationRows").withIndex("by_migration_kind", (q) => q.eq("migrationId", run.migrationId).eq("kind", kind).gt("index", run.cursor)).first() : null;
        if (next && !next.result) await ctx.db.patch(next._id, { result: { outcome: "failed", reason: "Selestial couldn't write this record. It's in your error report; fix or skip it, then import again.", at: now } });
        await ctx.db.patch(run._id, { attempts: 0, cursor: next ? next.index : run.cursor, counts: { ...run.counts, failed: run.counts.failed + (next && !next.result ? 1 : 0) }, leaseUntil: now + LIMITS.leaseMs });
      } else await ctx.db.patch(run._id, { attempts, leaseUntil: now + LIMITS.leaseMs });
      await ctx.scheduler.runAfter(0, internal.migration.runStep, { runId: run._id, ...(attempts > 1 ? { batch: 1 } : {}) });
    }
    // An undo whose step stopped picks up from its checkpoint too.
    const migrations = await ctx.db.query("migrations").take(500);
    for (const m of migrations) {
      if (m.undo?.status === "running" && m.undo.leaseUntil < now) {
        await ctx.db.patch(m._id, { undo: { ...m.undo, leaseUntil: now + LIMITS.leaseMs } });
        await ctx.scheduler.runAfter(0, internal.migration.undoStep, { migrationId: m._id });
      }
    }
    return stuck.length;
  },
});

/** Stops a running import. What it already wrote stays, listed in the report; running it again continues. */
export const stopImport = managerMutation({
  args: {},
  handler: async (ctx) => {
    const migration = await requireMigration(ctx);
    const run = await ctx.db.query("migrationRuns").withIndex("by_migration", (q) => q.eq("migrationId", migration._id)).order("desc").first();
    if (!run || run.status !== "running") return null;
    await ctx.db.patch(run._id, { status: "cancelled", finishedAt: Date.now(), problem: "Stopped by a person. Records written before it stopped are kept." });
    await ctx.db.patch(migration._id, { status: run.done ? "imported" : "open", step: run.done ? "verify" : "review", updatedAt: Date.now() });
    return null;
  },
});

/** Goes back to Review & fix after an import, to fix what failed and import those rows. */
export const reopen = managerMutation({
  support: { capability: "records.edit", summary: "reopened the migration for review" },
  args: {},
  handler: async (ctx) => {
    const migration = await requireMigration(ctx);
    if (migration.status === "importing") throw userError("Your import is running.");
    await ctx.db.patch(migration._id, { status: migration.status === "released" ? "released" : "open", step: "review", updatedAt: Date.now() });
    return null;
  },
});

// ── Verify ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The completion report: for each kind, how many rows the files had and what became of every one. The
 * outcomes add up to the rows in the files; a row nothing happened to is counted as awaiting review.
 */
export const report = managerQuery({
  args: {},
  handler: async (ctx) => {
    const migration = await migrationOf(ctx, ctx.companyId);
    if (!migration) return null;
    const files = (await ctx.db.query("migrationFiles").withIndex("by_migration", (q) => q.eq("migrationId", migration._id)).take(LIMITS.files + 20)).filter((f) => f.status === "ready");
    const kinds: { kind: FileKind; source: number; created: number; updated: number; linked: number; skipped: number; failed: number; awaiting: number; undone: number; balanced: boolean }[] = [];
    const problems: { kind: FileKind; file: string; row: number; name: string; outcome: string; reason: string }[] = [];
    const recent: { kind: FileKind; table: string; id: string; name: string }[] = [];
    const fileName = new Map(files.map((f) => [f._id, f.name]));
    for (const kind of [...IMPORTABLE, "services", "agreements", "other"] as FileKind[]) {
      const rows = await ctx.db.query("migrationRows").withIndex("by_migration_kind", (q) => q.eq("migrationId", migration._id).eq("kind", kind)).take(LIMITS.rows);
      if (!rows.length) continue;
      const tally = { kind, source: rows.length, created: 0, updated: 0, linked: 0, skipped: 0, failed: 0, awaiting: 0, undone: 0, balanced: true };
      for (const row of rows) {
        const values = effective(row);
        const scheduled = kind === "recurring" || kind === "bookings";
        const name = (scheduled || kind === "history" ? [values.service, values.customerName].filter(Boolean).join(" · ") : kind === "balances" ? [values.externalId, values.customerName].filter(Boolean).join(" · ") : values.name || [values.firstName, values.lastName].filter(Boolean).join(" ") || values.company || values.label || values.line1) || `Row ${row.index + 2}`;
        if (row.undone) {
          tally.undone += 1;
          continue;
        }
        if (row.result) {
          tally[row.result.outcome] += 1;
          if (row.undoBlocked) problems.push({ kind, file: fileName.get(row.fileId) ?? "", row: row.index + 2, name, outcome: "Kept by undo", reason: row.undoBlocked });
          if (row.result.outcome === "failed") problems.push({ kind, file: fileName.get(row.fileId) ?? "", row: row.index + 2, name, outcome: "Failed", reason: row.result.reason ?? "" });
          else if (row.result.table && row.result.id && recent.length < 60 && row.result.outcome !== "skipped") recent.push({ kind, table: row.result.table, id: row.result.id, name });
        } else {
          tally.awaiting += 1;
          const reason = row.state === "held" ? "Selestial doesn't import this kind of record yet." : row.state === "error" ? row.problems.join(" ") : NEEDS_CHOICE.has(row.state) ? "Waiting for your choice." : "Not imported yet.";
          problems.push({ kind, file: fileName.get(row.fileId) ?? "", row: row.index + 2, name, outcome: row.state === "held" ? "Not transferred" : row.state === "error" ? "Needs correction" : "Awaiting review", reason });
        }
      }
      tally.balanced = tally.created + tally.updated + tally.linked + tally.skipped + tally.failed + tally.awaiting + tally.undone === tally.source;
      kinds.push(tally);
    }
    const links = await ctx.db.query("migrationLinks").withIndex("by_migration", (q) => q.eq("migrationId", migration._id)).take(10000);
    let heldVisits = 0;
    let heldPlans = 0;
    let heldCleaners = 0;
    for (const link of links) {
      if (link.table === "jobs") {
        const job = await ctx.db.get(link.recordId as Id<"jobs">);
        if (job?.migration?.held) heldVisits += 1;
      }
      if (link.table === "cleaners") {
        const cleaner = await ctx.db.get(link.recordId as Id<"cleaners">);
        if (cleaner?.migration?.held) heldCleaners += 1;
      }
      if (link.table === "servicePlans") {
        const plan = await ctx.db.get(link.recordId as Id<"servicePlans">);
        if (plan?.migration?.held) heldPlans += 1;
      }
    }
    return { kinds, problems: problems.slice(0, 2000), recent, held: { visits: heldVisits, plans: heldPlans, cleaners: heldCleaners }, status: migration.status, releasedAt: migration.releasedAt ?? null };
  },
});

// ── Release ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The Owner's explicit decision to let agents work with the imported schedule: imported visits go to
 * Dispatch to be offered to cleaners, and imported plans start booking ahead. Until then nothing about
 * them is sent to anyone. Releasing doesn't message customers.
 */
export const release = ownerMutation({
  args: { confirm: v.literal(true), visits: v.boolean(), plans: v.boolean(), team: v.boolean() },
  handler: async (ctx, args) => {
    const migration = await requireMigration(ctx);
    if (migration.status !== "imported" && migration.status !== "released") throw userError("Import your records before releasing them.");
    if (migration.undo?.status === "running") throw userError("An undo is running. Release once it finishes.");
    if (!args.visits && !args.plans && !args.team) throw userError("Choose what to release.");
    const now = Date.now();
    const released = { ...(migration.released ?? {}), ...(args.visits ? { visits: now } : {}), ...(args.plans ? { plans: now } : {}), ...(args.team ? { team: now } : {}) };
    await ctx.db.patch(migration._id, { status: "released", releasedAt: now, releasedBy: ctx.member._id, released, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "migration.released", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { visits: args.visits, plans: args.plans, team: args.team } });
    await ctx.scheduler.runAfter(0, internal.migration.releaseChunk, { migrationId: migration._id, cursor: null, memberId: ctx.member._id, visits: args.visits, plans: args.plans, team: args.team });
    return null;
  },
});

export const releaseChunk = internalMutation({
  args: { migrationId: v.id("migrations"), cursor: v.union(v.string(), v.null()), memberId: v.id("members"), visits: v.boolean(), plans: v.boolean(), team: v.boolean() },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("migrationLinks").withIndex("by_migration", (q) => q.eq("migrationId", args.migrationId)).paginate({ numItems: 100, cursor: args.cursor });
    const actor: Actor = { kind: "member", memberId: args.memberId };
    if (args.team) {
      // Imported cleaners stay onboarding: released, they get the usual onboarding follow-ups, and work only once a person makes them active.
      for (const link of page.page.filter((l) => l.table === "cleaners")) {
        const cleaner = await ctx.db.get(link.recordId as Id<"cleaners">);
        if (cleaner?.migration?.held) await ctx.db.patch(cleaner._id, { migration: { ...cleaner.migration, held: false } });
      }
    }
    if (args.visits) {
      for (const link of page.page.filter((l) => l.table === "jobs")) {
        const job = await ctx.db.get(link.recordId as Id<"jobs">);
        if (!job?.migration?.held) continue;
        await ctx.db.patch(job._id, { migration: { ...job.migration, held: false } });
        await applyTemplate(ctx, (await ctx.db.get(job._id))!);
        await ctx.scheduler.runAfter(0, internal.dispatch.cover, { jobId: job._id });
      }
    }
    if (args.plans) {
      // A released plan books ahead and skips days an imported visit already holds, released or not.
      for (const link of page.page.filter((l) => l.table === "servicePlans")) {
        const plan = await ctx.db.get(link.recordId as Id<"servicePlans">);
        if (!plan?.migration?.held) continue;
        await ctx.db.patch(plan._id, { migration: { ...plan.migration, held: false }, state: plan.pausedFrom ? "paused" : "active", revision: plan.revision + 1, updatedAt: Date.now() });
        await bookAhead(ctx, (await ctx.db.get(plan._id))!, actor);
      }
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migration.releaseChunk, { ...args, cursor: page.continueCursor });
    return null;
  },
});

// ── Activation review ──────────────────────────────────────────────────────────────────────────────

const LEVEL_WORDS: Record<string, string> = { off: "Off", propose: "Ask me first", execute_and_report: "Act and notify me", execute: "Act on its own" };

/**
 * Before anything is released: for each workflow, what it would do, to which records, what's missing,
 * how many messages it would likely send and what they'd cost, and what still needs the Owner's approval.
 * Estimates say they're estimates; nothing here sends or charges anything.
 */
export const activationReview = managerQuery({
  args: {},
  handler: async (ctx) => {
    const migration = await migrationOf(ctx, ctx.companyId);
    if (!migration) return null;
    const now = Date.now();
    const company = ctx.company;
    const today = dayOf(now, company.timezone);
    const card = rateCardAt(now);
    const textCents = card.rates.sms_out / 100;
    const links = await ctx.db.query("migrationLinks").withIndex("by_migration", (q) => q.eq("migrationId", migration._id)).take(10000);
    const held = { jobs: [] as Doc<"jobs">[], plans: [] as Doc<"servicePlans">[], cleaners: [] as Doc<"cleaners">[] };
    for (const link of links) {
      if (link.table === "jobs") {
        const job = await ctx.db.get(link.recordId as Id<"jobs">);
        if (job?.migration?.held && job.status === "scheduled") held.jobs.push(job);
      } else if (link.table === "servicePlans") {
        const plan = await ctx.db.get(link.recordId as Id<"servicePlans">);
        if (plan?.migration?.held) held.plans.push(plan);
      } else if (link.table === "cleaners") {
        const cleaner = await ctx.db.get(link.recordId as Id<"cleaners">);
        if (cleaner?.migration?.held) held.cleaners.push(cleaner);
      }
    }
    const level = async (action: string) => {
      const a = await authorityFor(ctx, ctx.companyId, action);
      return a.kind === "level" ? a.level : a.kind;
    };
    const readyCleaners = await ctx.db.query("cleaners").withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "ready")).take(500);
    const texting = await ctx.db.query("textingRequests").withIndex("by_company_requested", (q) => q.eq("companyId", ctx.companyId)).order("desc").first();
    const textingReady = texting?.status === "active";
    const dispatchPaused = company.pausedAgents.includes("dispatch");
    const offerLevel = await level("dispatch.request_acceptance");
    const dispatchMissing = [
      ...(dispatchPaused ? ["Dispatch is paused for your company. Nothing is offered until you resume it in Agent controls."] : []),
      ...(offerLevel === "off" ? ["Dispatch's first offers are set to Off, so it won't offer these visits until you change that in Agent controls."] : []),
      ...(readyCleaners.length === 0 ? ["No cleaner is active yet, so there's no one to offer visits to. Dispatch will list the visits that need cover."] : []),
      ...(!textingReady ? ["Business texting isn't set up, so offers go by email where cleaners have one."] : []),
    ];
    const dispatchApprovals = offerLevel === "propose" ? ["Dispatch is set to Ask me first for offers: each offer waits for your approval in Approvals."] : [];
    const next14 = held.jobs.filter((j) => j.startsAt < now + 14 * 86_400_000).length;
    const firstVisit = held.jobs.map((j) => j.startsAt).sort((a, b) => a - b)[0] ?? null;

    // Plans: the visits they'd book in the next four weeks that no imported visit already covers.
    let planVisits = 0;
    const pendingPrices: string[] = [];
    for (const plan of held.plans) {
      const days = seriesDays({ ...plan, state: "active" }, today, dayOf(now + 28 * 86_400_000, company.timezone));
      const covered = new Set(held.jobs.filter((j) => j.planId === plan._id).map((j) => j.planDate));
      const booked = await ctx.db.query("jobs").withIndex("by_company_plan", (q) => q.eq("companyId", ctx.companyId).eq("planId", plan._id)).take(100);
      for (const j of booked) covered.add(j.planDate);
      planVisits += plan.pausedFrom ? 0 : days.filter((d) => !covered.has(d)).length;
      const changes = await ctx.db.query("serviceChanges").withIndex("by_company_service", (q) => q.eq("companyId", ctx.companyId).eq("serviceId", plan.serviceId)).order("desc").take(50);
      const waiting = changes.find((c) => c.kind === "property_price" && c.state === "in_review" && c.propertyPrice?.propertyId === plan.propertyId);
      if (waiting) pendingPrices.push(waiting.title);
    }

    // Team: who'd get onboarding follow-ups, and who can't be reached.
    const reminderLevel = await level("recruiter.onboarding_reminder");
    const unreachable = held.cleaners.filter((c) => !c.email && !c.phone).length;

    const cost = (messages: number) => Math.round(messages * textCents);
    const workflows = [
      {
        id: "visits" as const,
        title: "Dispatch offers your imported visits",
        agent: "Dispatch",
        count: held.jobs.length,
        records: held.jobs.length ? `${held.jobs.length} imported ${held.jobs.length === 1 ? "visit" : "visits"}${next14 ? `, ${next14} in the next two weeks` : ""}${firstVisit ? `, the first on ${new Date(firstVisit).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: company.timezone })}` : ""}.` : "No imported visits are waiting.",
        does: ["Offers each visit to an eligible cleaner, following your Dispatch settings, and finds cover when someone declines.", "Applies each service's checklist to the visit."],
        missing: dispatchMissing,
        approvals: dispatchApprovals,
        level: LEVEL_WORDS[offerLevel] ?? offerLevel,
        messages: held.jobs.length,
        messagesWords: held.jobs.length ? `At least ${held.jobs.length} offer ${held.jobs.length === 1 ? "text" : "texts"} to cleaners (one per visit), more when someone declines or doesn't answer.` : "None.",
        costCents: cost(held.jobs.length),
        released: migration.released?.visits ?? null,
      },
      {
        id: "plans" as const,
        title: "Recurring services start booking",
        agent: "Operations",
        count: held.plans.length,
        records: held.plans.length ? `${held.plans.length} imported recurring ${held.plans.length === 1 ? "service" : "services"}${held.plans.some((p) => p.pausedFrom) ? " (paused ones stay paused)" : ""}.` : "No imported recurring services are waiting.",
        does: [`Books about ${planVisits} more ${planVisits === 1 ? "visit" : "visits"} over the next four weeks, skipping days an imported visit already covers, then keeps booking ahead.`, dispatchPaused ? "Dispatch is paused, so those visits wait for cover until it resumes." : "Dispatch offers those new visits to your team like any other booking."],
        missing: held.plans.length && pendingPrices.length ? [] : [],
        approvals: pendingPrices.length ? [`${pendingPrices.length} imported ${pendingPrices.length === 1 ? "price is" : "prices are"} waiting for your approval in Services & Pricing. Until approved, visits are priced by your services.`] : [],
        level: "Books on schedule",
        messages: dispatchPaused ? 0 : planVisits,
        messagesWords: planVisits && !dispatchPaused ? `About ${planVisits} offer ${planVisits === 1 ? "text" : "texts"} to cleaners for the new visits over four weeks.` : "None right away.",
        costCents: dispatchPaused ? 0 : cost(planVisits),
        released: migration.released?.plans ?? null,
      },
      {
        id: "team" as const,
        title: "Your imported team gets onboarding follow-ups",
        agent: "Recruiter",
        count: held.cleaners.length,
        records: held.cleaners.length ? `${held.cleaners.length} imported team ${held.cleaners.length === 1 ? "member" : "members"}, all onboarding.` : "No imported team members are waiting.",
        does: ["Sends each person the usual reminders about the onboarding steps they still owe, as your cleaner settings say.", "Doesn't make anyone active or offer them work: you do that on each profile once their requirements are met."],
        missing: [...(unreachable ? [`${unreachable} ${unreachable === 1 ? "has" : "have"} no phone or email, so they can't be reminded.`] : []), ...(reminderLevel === "off" ? ["Onboarding reminders are set to Off in Agent controls."] : []), ...(!textingReady ? ["Business texting isn't set up, so reminders go by email where people have one."] : [])],
        approvals: reminderLevel === "propose" ? ["Onboarding reminders are set to Ask me first: each waits for your approval."] : [],
        level: LEVEL_WORDS[reminderLevel] ?? reminderLevel,
        messages: held.cleaners.length - unreachable,
        messagesWords: held.cleaners.length ? `About ${held.cleaners.length - unreachable} first ${held.cleaners.length - unreachable === 1 ? "reminder" : "reminders"}, then follow-ups on your cleaner settings' schedule.` : "None.",
        costCents: cost(held.cleaners.length - unreachable),
        released: migration.released?.team ?? null,
      },
    ];
    return {
      workflows,
      rate: { textCents, card: card.version },
      untouched: [
        "Customers aren't messaged by any of this. Sales and Customer care don't reach out to imported customers because they were imported.",
        "Finance never reminds anyone about opening balances, and imported history never becomes invoices or pay.",
        "No permission to text or email customers was created; documented opt-outs stay in force.",
      ],
      canRelease: !ctx.support && roleOf(ctx.member.role) === "owner",
      status: migration.status,
      undoRunning: migration.undo?.status === "running",
    };
  },
});

// ── Undo ───────────────────────────────────────────────────────────────────────────────────────────

/** Ids of every record this migration created and still has, so its own records don't block each other. */
async function createdBy(ctx: QueryCtx, migrationId: Id<"migrations">) {
  const links = await ctx.db.query("migrationLinks").withIndex("by_migration", (q) => q.eq("migrationId", migrationId)).take(10000);
  const created: Doc<"migrationLinks">[] = [];
  for (const link of links) {
    const row = await ctx.db.get(link.rowId);
    // Only what this migration made is ever undone; a record it matched or updated was already yours.
    if (row?.result?.outcome === "created" && row.result.id === link.recordId) created.push(link);
  }
  return { created, ids: new Set(created.map((l) => l.recordId)) };
}

/**
 * What an undo would do: for each kind, how many untouched records it would remove, and each record it
 * would keep with the reason. Owners and Managers can look; only the Owner can undo.
 */
export const undoPreview = managerQuery({
  args: {},
  handler: async (ctx) => {
    const migration = await migrationOf(ctx, ctx.companyId);
    if (!migration) return null;
    const { created, ids } = await createdBy(ctx, migration._id);
    const kinds: Record<string, { undoable: number; kept: { name: string; reason: string; table: string; id: string }[] }> = {};
    // Blocked dependents keep their parents: work in undo order and treat what would be removed as gone.
    const going = new Set<string>();
    for (const table of UNDO_ORDER) {
      for (const link of created.filter((l) => l.table === table)) {
        const kind = TABLE_KIND[table];
        const bucket = (kinds[kind] ??= { undoable: 0, kept: [] });
        const blocker = await undoBlocker(ctx, link, { own: ids, going });
        if (blocker) {
          const row = await ctx.db.get(link.rowId);
          const values = row ? effective(row) : {};
          bucket.kept.push({ name: values.name || [values.firstName, values.lastName].filter(Boolean).join(" ") || values.company || values.service || values.externalId || values.line1 || "Record", reason: blocker, table, id: link.recordId });
        } else {
          bucket.undoable += 1;
          going.add(link.recordId);
        }
      }
    }
    return { kinds, undo: migration.undo ?? null, canUndo: !ctx.support && roleOf(ctx.member.role) === "owner" };
  },
});

/** Starts an undo of the chosen kinds. Dependents of a chosen kind that are untouched go too, first. */
export const undo = ownerMutation({
  args: { confirm: v.literal(true), kinds: v.array(fileKindValidator) },
  handler: async (ctx, args) => {
    const migration = await requireMigration(ctx);
    if (migration.status === "importing") throw userError("Your import is running. Undo once it finishes.");
    if (migration.undo?.status === "running") return null;
    const kinds = [...new Set(args.kinds)].filter((k) => (IMPORTABLE as readonly string[]).includes(k));
    if (!kinds.length) throw userError("Choose what to undo.");
    // A customer goes only with what it owns, so choosing customers includes everything that belongs to them.
    const withDependents = kinds.includes("customers") ? [...IMPORTABLE] : kinds.includes("properties") ? [...new Set([...kinds, "recurring", "bookings"] as const)] : kinds;
    const now = Date.now();
    await ctx.db.patch(migration._id, { undo: { status: "running", kinds: withDependents as FileKind[], pass: 0, cursor: null, undone: 0, kept: 0, by: ctx.member._id, startedAt: now, leaseUntil: now + LIMITS.leaseMs }, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "migration.undo_started", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { kinds: withDependents.join(",") } });
    await ctx.scheduler.runAfter(0, internal.migration.undoStep, { migrationId: migration._id });
    return null;
  },
});

/** One batch of an undo, checkpointed with its writes. Restarted by the sweep if it stops. */
export const undoStep = internalMutation({
  args: { migrationId: v.id("migrations") },
  handler: async (ctx, args) => {
    const migration = await ctx.db.get(args.migrationId);
    const state = migration?.undo;
    if (!migration || !state || state.status !== "running") return null;
    let { pass, cursor, undone, kept } = state;
    const table = UNDO_ORDER[pass];
    if (!table) return null;
    const page = await ctx.db.query("migrationLinks").withIndex("by_migration", (q) => q.eq("migrationId", migration._id)).paginate({ numItems: 25, cursor });
    const { ids } = await createdBy(ctx, migration._id);
    for (const link of page.page) {
      if (link.table !== table || !state.kinds.includes(TABLE_KIND[table] as FileKind)) continue;
      const row = await ctx.db.get(link.rowId);
      if (!row || row.result?.outcome !== "created" || row.result.id !== link.recordId) continue;
      // Dependents were handled in earlier passes: what was removed is gone, what was kept still counts.
      const blocker = await undoBlocker(ctx, link, { own: ids, going: new Set() });
      if (blocker) {
        await ctx.db.patch(row._id, { undoBlocked: blocker });
        kept += 1;
        continue;
      }
      await undoRecord(ctx, link);
      await ctx.db.delete(link._id);
      // The row stays decided "skip", so importing again doesn't bring it back unless someone chooses to.
      await ctx.db.patch(row._id, { result: undefined, undoBlocked: undefined, undone: { at: Date.now(), by: state.by }, decision: { choice: "skip", by: { kind: "member", memberId: state.by }, at: Date.now() } });
      undone += 1;
    }
    if (page.isDone) {
      pass += 1;
      cursor = null;
    } else cursor = page.continueCursor;
    const finished = pass >= UNDO_ORDER.length;
    const now = Date.now();
    await ctx.db.patch(migration._id, { undo: { ...state, pass, cursor, undone, kept, leaseUntil: now + LIMITS.leaseMs, ...(finished ? { status: "done" as const, finishedAt: now } : {}) } });
    if (!finished) {
      await ctx.scheduler.runAfter(0, internal.migration.undoStep, { migrationId: migration._id });
      return null;
    }
    const remaining = await ctx.db.query("migrationLinks").withIndex("by_migration", (q) => q.eq("migrationId", migration._id)).first();
    const notes = [...migration.notes.filter((n) => n.key !== "undo"), { key: "undo", step: "verify" as const, words: `Undo finished: ${undone} ${undone === 1 ? "record" : "records"} removed${kept ? `, ${kept} kept because they were changed or used since. Each says why in Review & fix` : ""}. Opt-outs from your files stay in force.`, tone: kept ? ("attention" as const) : ("done" as const), at: now }];
    await ctx.db.patch(migration._id, { notes, ...(remaining ? {} : { status: "open" as const, step: "review" as const }) });
    await recordEvent(ctx, { companyId: migration.companyId, type: "migration.undone", actor: { kind: "member", memberId: state.by }, subject: { table: "companies", id: migration.companyId }, data: { undone, kept } });
    await scheduleCheck(ctx, (await ctx.db.get(migration._id))!);
    return null;
  },
});

// ── On the client's profile ────────────────────────────────────────────────────────────────────────

/** Past visits brought over from the old system: read-only, never jobs. */
export const clientHistory = companyQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.companyId !== ctx.companyId) return [];
    const rows = await ctx.db.query("importedHistory").withIndex("by_company_customer_day", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id)).order("desc").take(200);
    return rows.map((h) => ({ id: h._id, day: h.day, service: h.service ?? null, priceCents: h.priceCents ?? null, cleaner: h.cleaner ?? null, outcome: h.outcome ?? null, notes: h.notes ?? null, source: h.source }));
  },
});

/** What the customer owed in the old system, by old invoice number. The Owner's, like the rest of billing. */
export const clientBalances = ownerQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.companyId !== ctx.companyId) return { rows: [], totalCents: 0 };
    const rows = await ctx.db.query("openingBalances").withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id)).take(200);
    return { rows: rows.map((b) => ({ id: b._id, amountCents: b.amountCents, reference: b.reference, issuedOn: b.issuedOn ?? null, dueOn: b.dueOn ?? null, notes: b.notes ?? null, source: b.source })), totalCents: rows.reduce((n, b) => n + b.amountCents, 0) };
  },
});

export const categories = CATEGORIES;
