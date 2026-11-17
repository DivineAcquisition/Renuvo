/**
 * The workforce record beyond the cleaner row itself (docs/cleaners/00-architecture.md).
 *
 * Six things are kept apart on purpose, so none is ever read off another:
 *  - relationship type: how the person works with the company (`cleaners.engagement`);
 *  - engagement status: whether the relationship is onboarding, active, paused or ended (`cleaners.status`);
 *  - onboarding progress: which of the company's requirements are met (computed, lib/workforce/readiness.ts);
 *  - job eligibility: whether Dispatch may offer them work at all (computed from the two above);
 *  - availability: when they said they can work, for a given time (availabilityWindows, timeOff);
 *  - payout readiness: whether they can be paid (Finance's, not built; shown as not tracked).
 *
 * A subcontractor company, its authorized contact and the individual people it supplies are three
 * records. Jobs are only ever assigned to a real person (a `cleaners` row); the affiliation history
 * keeps which company supplied them, and when.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { literals } from "../statuses";

export const SUBCONTRACTOR_STATUSES = ["active", "paused", "ended"] as const;
export type SubcontractorStatus = (typeof SUBCONTRACTOR_STATUSES)[number];
export const subcontractorStatusValidator = literals(SUBCONTRACTOR_STATUSES);

export const CREW_STATUSES = ["active", "archived"] as const;
export const crewStatusValidator = literals(CREW_STATUSES);

/** How a worker record came to exist. Kept so an import or a hire can be traced back. */
export const WORKER_SOURCES = ["manual", "import", "hiring"] as const;
export const workerSourceValidator = literals(WORKER_SOURCES);

export const workforceTables = {
  /**
   * A company that supplies its own cleaners. The organization, the person authorized to speak for it,
   * and the workers it supplies are separate: the workers are `cleaners` rows linked through
   * `workerAffiliations`, so a job is always assigned to a named person.
   */
  subcontractors: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    /** The person authorized to act for the subcontractor. Not a worker unless also added as one. */
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    status: subcontractorStatusValidator,
    /** Who changed the status last and why, for paused and ended. */
    statusNote: v.optional(v.string()),
    createdBy: v.id("members"),
    createdAt: v.number(),
    endedAt: v.optional(v.number()),
  }).index("by_company_status", ["companyId", "status"]),

  /**
   * Which subcontractor supplied a worker, and over what period. A change closes the open row and opens
   * a new one, so past jobs keep the affiliation they had. A direct worker has no open row.
   */
  workerAffiliations: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    subcontractorId: v.id("subcontractors"),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    by: v.id("members"),
  })
    .index("by_company_cleaner", ["companyId", "cleanerId", "startedAt"])
    .index("by_company_subcontractor", ["companyId", "subcontractorId", "startedAt"]),

  /**
   * A named team that usually works together, with a lead. Membership is history: a member who leaves
   * keeps their row with `leftAt`. Being in a crew says nothing about being free at a given time.
   */
  crews: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    notes: v.optional(v.string()),
    status: crewStatusValidator,
    createdBy: v.id("members"),
    createdAt: v.number(),
  }).index("by_company_status", ["companyId", "status"]),

  crewMembers: defineTable({
    companyId: v.id("companies"),
    crewId: v.id("crews"),
    cleanerId: v.id("cleaners"),
    role: v.union(v.literal("lead"), v.literal("member")),
    joinedAt: v.number(),
    leftAt: v.optional(v.number()),
    by: v.id("members"),
  })
    .index("by_company_crew", ["companyId", "crewId"])
    .index("by_company_cleaner", ["companyId", "cleanerId"]),

  /**
   * One import of a list of workers, named by the key the browser chose for it. The same import sent
   * twice (a double click, a retry after a dropped connection) finds this row and adds nobody again.
   */
  workerImports: defineTable({
    companyId: v.id("companies"),
    key: v.string(),
    created: v.array(v.id("cleaners")),
    skipped: v.number(),
    by: v.id("members"),
    at: v.number(),
  }).index("by_company_key", ["companyId", "key"]),
};
