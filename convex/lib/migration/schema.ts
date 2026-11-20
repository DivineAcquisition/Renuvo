/**
 * "Bring your business to Selestial": one saved migration per company, its uploaded files, every source row
 * staged with what Selestial proposes and what the owner decided, the background run that writes them, and
 * links from each source record to what it became (provenance, and the key that stops a second copy).
 *
 * Staged rows are not the customer database. Nothing in them is a customer, a booking or a plan until the
 * run writes it through the same tables the rest of Selestial uses.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { actorValidator } from "../events";
import { scheduleValidator } from "../services/spec";
import { literals } from "../statuses";
import { CATEGORIES, FILE_KINDS } from "./rules";
import { SOURCES } from "./sources";

export const MIGRATION_STEPS = ["source", "files", "organize", "review", "import", "verify"] as const;
export type MigrationStep = (typeof MIGRATION_STEPS)[number];

export const fileKindValidator = literals(FILE_KINDS);
export const sourceValidator = literals(SOURCES);
export const categoryValidator = literals(CATEGORIES);

/** What Selestial proposes for a row after checking it. */
export const ROW_STATES = ["ready", "update", "duplicate", "skip", "error", "review", "held"] as const;
/** What the owner chose for a row that needed a choice. */
export const CHOICES = ["create", "keep_existing", "update_fields", "separate", "skip", "review"] as const;
export const OUTCOMES = ["created", "updated", "linked", "skipped", "failed"] as const;

export const migrationTables = {
  migrations: defineTable({
    companyId: v.id("companies"),
    /** open: being prepared. importing: a run is writing. imported: written, being verified. released: the owner let agents work with it. */
    status: literals(["open", "importing", "imported", "released"] as const),
    step: literals(MIGRATION_STEPS),
    source: v.union(sourceValidator, v.null()),
    /** What the owner wants to bring. */
    wants: v.array(fileKindValidator),
    /** The business's timezone, as the owner confirmed it for reading times in the files. */
    timezone: v.string(),
    timezoneConfirmed: v.boolean(),
    /** How ambiguous dates like 03/04/2027 are read. Null until the files prove it or the owner chooses. */
    dateOrder: v.union(literals(["mdy", "dmy"] as const), v.null()),
    /** The old system's service names and the Selestial service each one is. Null: not matched yet. */
    serviceMap: v.array(v.object({ name: v.string(), serviceId: v.union(v.id("services"), v.null()), schedule: v.optional(scheduleValidator) })),
    /** Commercial accounts Selestial grouped from several properties, and whether the owner accepted each. */
    groups: v.array(v.object({ key: v.string(), name: v.string(), properties: v.number(), accepted: v.union(v.boolean(), v.null()) })),
    /** The assistant's findings, keyed so a re-check replaces rather than repeats them. */
    notes: v.array(v.object({ key: v.string(), step: literals(MIGRATION_STEPS), words: v.string(), tone: literals(["info", "attention", "done"] as const), at: v.number() })),
    /** Rows changed since the last check: the review is stale until checked again. */
    dirty: v.boolean(),
    checkedAt: v.optional(v.number()),
    /** Counts per record kind and state, from the last check: what the screens show without reading every row. */
    summary: v.optional(v.record(v.string(), v.record(v.string(), v.number()))),
    /** Service names found in the files, how many rows use each, and the Selestial service with the same name. */
    serviceNames: v.optional(v.array(v.object({ name: v.string(), rows: v.number(), suggested: v.union(v.id("services"), v.null()) }))),
    /** How the files write dates, as far as they prove it. */
    dateInfo: v.optional(v.object({ inferred: v.union(literals(["mdy", "dmy"] as const), v.null()), proof: v.union(v.string(), v.null()), ambiguous: v.number() })),
    /** A check in progress, by token: a newer check replaces an older one, which then writes nothing. */
    checking: v.optional(v.object({ token: v.string(), startedAt: v.number() })),
    /** Selestial staff who helped through a support session, by staff id. Their changes are attributed to them. */
    assistedBy: v.optional(v.array(v.object({ staffId: v.id("staff"), name: v.string(), since: v.number() }))),
    revision: v.number(),
    createdBy: actorValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
    releasedAt: v.optional(v.number()),
    releasedBy: v.optional(v.id("members")),
  }).index("by_company", ["companyId"]),

  migrationFiles: defineTable({
    companyId: v.id("companies"),
    migrationId: v.id("migrations"),
    storageId: v.optional(v.id("_storage")),
    name: v.string(),
    size: v.number(),
    sha256: v.string(),
    status: literals(["reading", "ready", "failed", "removed"] as const),
    problem: v.optional(v.string()),
    kind: fileKindValidator,
    /** What Selestial thought the file was, and the columns that said so. */
    suggested: v.object({ kind: fileKindValidator, because: v.array(v.string()) }),
    /** The system whose export this looks like, only for wording. */
    looksLike: v.union(literals(["jobber", "housecall_pro", "bookingkoala"] as const), v.null()),
    header: v.array(v.string()),
    rowCount: v.number(),
    /** Field key → column index. Suggested, then confirmed or changed by the owner. */
    mapping: v.record(v.string(), v.number()),
    mappingConfirmed: v.boolean(),
    /** What the owner says the file is, in their words, when it's "other". */
    description: v.optional(v.string()),
    uploadedBy: actorValidator,
    createdAt: v.number(),
  })
    .index("by_migration", ["migrationId"])
    .index("by_storage", ["storageId"]),

  migrationRows: defineTable({
    companyId: v.id("companies"),
    migrationId: v.id("migrations"),
    fileId: v.id("migrationFiles"),
    kind: fileKindValidator,
    /** The row's place in its file, from 0 (the header is not counted). */
    index: v.number(),
    cells: v.array(v.string()),
    /** The mapped values, read from the cells. Replaced when the mapping changes. */
    values: v.record(v.string(), v.string()),
    /** What a person typed over a value. Kept across re-checks and re-mappings: an owner's edit is never overwritten. */
    edits: v.record(v.string(), v.string()),
    editedBy: v.optional(actorValidator),
    /** The record's id in the old system, for finding it again. */
    sourceId: v.optional(v.string()),
    state: literals(ROW_STATES),
    problems: v.array(v.string()),
    /** Explanations of how a value was read, with the source value. */
    notes: v.array(v.string()),
    /** Existing Selestial records, or other rows, this may be the same as, and why. */
    matches: v.array(v.object({ table: v.string(), id: v.string(), name: v.string(), why: v.string() })),
    /** For a property, plan or booking: the customer (row or existing record) it belongs to, once certain. */
    parent: v.optional(
      v.object({
        rowId: v.optional(v.id("migrationRows")),
        customerId: v.optional(v.id("customers")),
        propertyRowId: v.optional(v.id("migrationRows")),
        propertyId: v.optional(v.id("properties")),
        /** A booking that is a visit of an imported recurring service, and the series day it stands for. */
        planRowId: v.optional(v.id("migrationRows")),
        planDate: v.optional(v.string()),
      }),
    ),
    /** What the check read from the values, deterministically: days, times, cents, schedule, service. Used to write. */
    parsed: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()))),
    /** The values and edits the check read, so a check never writes over a row changed meanwhile. */
    stamp: v.optional(v.string()),
    category: v.optional(v.object({ value: categoryValidator, because: v.string(), confirmed: v.boolean() })),
    /** Rows sharing a commercial account. */
    groupKey: v.optional(v.string()),
    decision: v.optional(v.object({ choice: literals(CHOICES), fields: v.optional(v.array(v.string())), targetId: v.optional(v.string()), by: actorValidator, at: v.number() })),
    result: v.optional(v.object({ outcome: literals(OUTCOMES), table: v.optional(v.string()), id: v.optional(v.string()), reason: v.optional(v.string()), at: v.number() })),
  })
    .index("by_migration_kind", ["migrationId", "kind", "index"])
    .index("by_migration_kind_state", ["migrationId", "kind", "state", "index"])
    .index("by_file", ["fileId", "index"])
    .index("by_migration_state", ["migrationId", "state"]),

  /** One background import. It checkpoints after every batch, in the same write as the batch. */
  migrationRuns: defineTable({
    companyId: v.id("companies"),
    migrationId: v.id("migrations"),
    status: literals(["running", "done", "failed", "cancelled"] as const),
    /** Which record kind it is writing (customers, properties, recurring, bookings), and the last row index done in it. */
    phase: v.number(),
    cursor: v.number(),
    counts: v.object({ created: v.number(), updated: v.number(), linked: v.number(), skipped: v.number(), failed: v.number() }),
    /** Rows to write in total, for real progress. */
    total: v.number(),
    done: v.number(),
    attempts: v.number(),
    leaseUntil: v.number(),
    problem: v.optional(v.string()),
    startedBy: actorValidator,
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_migration", ["migrationId", "startedAt"])
    .index("by_status_lease", ["status", "leaseUntil"]),

  /** What a record in another system became in Selestial. Importing it again finds this instead of making a copy. */
  migrationLinks: defineTable({
    companyId: v.id("companies"),
    source: v.string(),
    kind: fileKindValidator,
    externalId: v.string(),
    table: v.string(),
    recordId: v.string(),
    migrationId: v.id("migrations"),
    rowId: v.id("migrationRows"),
    createdAt: v.number(),
  })
    .index("by_company_source_kind_external", ["companyId", "source", "kind", "externalId"])
    .index("by_migration", ["migrationId"]),
};

/** On a job or plan written by a migration: held until the owner releases it, so no agent acts on it first. */
export const migrationMarkValidator = v.object({ migrationId: v.id("migrations"), held: v.boolean() });
