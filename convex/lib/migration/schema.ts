/**
 * Records brought in from another system besides clients (lib/migration/records.ts). Each belongs to a
 * client already in Selestial. None is a visit, a plan or an invoice: an owner turns an appointment or a
 * schedule into one when they choose, and history is reference only.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { literals } from "../statuses";
import { scheduleValidator } from "../services/spec";
import { RECORD_KINDS } from "./records";

export const recordKindValidator = literals(RECORD_KINDS);
export const recordSourceValidator = v.union(v.literal("csv"), v.literal("jobber"), v.literal("housecall_pro"), v.literal("bookingkoala"));

export const migrationTables = {
  migrationRecords: defineTable({
    companyId: v.id("companies"),
    customerId: v.id("customers"),
    /** The client's property at the row's street, when one matched. */
    propertyId: v.optional(v.id("properties")),
    kind: recordKindValidator,
    source: recordSourceValidator,
    /** Identifies the row across imports (records.ts recordKey). */
    key: v.string(),
    /** YYYY-MM-DD. An appointment's day, a schedule's first day, or a history record's date. */
    day: v.optional(v.string()),
    /** HH:MM on the company's clock. */
    time: v.optional(v.string()),
    endDay: v.optional(v.string()),
    durationMinutes: v.optional(v.number()),
    /** The frequency as the other system wrote it, and Selestial's schedule when it says one plainly. */
    frequency: v.optional(v.string()),
    cadence: v.optional(v.union(scheduleValidator, v.null())),
    amountCents: v.optional(v.number()),
    reference: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(v.string()),
    assignedTo: v.optional(v.string()),
    /** review: waiting for the owner. set_up: they made a visit or plan from it. dismissed: they set it aside. History is always "reference". */
    review: v.union(v.literal("review"), v.literal("set_up"), v.literal("dismissed"), v.literal("reference")),
    runId: v.id("migrationImportRuns"),
    createdAt: v.number(),
  })
    .index("by_company_key", ["companyId", "key"])
    .index("by_company_kind", ["companyId", "kind", "review"])
    .index("by_company_customer", ["companyId", "customerId", "kind"]),

  migrationImportRuns: defineTable({
    companyId: v.id("companies"),
    importKey: v.string(),
    kind: recordKindValidator,
    source: recordSourceValidator,
    label: v.string(),
    results: v.array(v.object({ index: v.number(), name: v.string(), outcome: v.union(v.literal("created"), v.literal("skipped"), v.literal("failed")), reason: v.optional(v.string()) })),
    created: v.number(),
    skipped: v.number(),
    failed: v.number(),
    by: v.id("members"),
    createdAt: v.number(),
  }).index("by_company_key", ["companyId", "importKey"]),
};
