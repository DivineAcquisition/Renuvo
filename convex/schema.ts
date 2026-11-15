/**
 * The shared record (brief, section 9). Every company table carries `companyId` and is read through an
 * index that starts with it. Times are milliseconds since 1970. Money is whole cents.
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { actorValidator, eventDataValidator, subjectValidator } from "./lib/events";
import { levelValidator } from "./lib/permissionCatalog";
import { roleValidator } from "./lib/roles";
import {
  agentValidator,
  approvalStatusValidator,
  assignmentStatusValidator,
  cleanerStatusValidator,
  jobStatusValidator,
  memberStatusValidator,
  recordStatusValidator,
  taskStatusValidator,
  waitingOnValidator,
  workKindValidator,
} from "./lib/statuses";

export const addressValidator = v.object({
  line1: v.string(),
  line2: v.optional(v.string()),
  city: v.string(),
  region: v.string(),
  postalCode: v.string(),
});

/** How a cleaner is paid. Contractors get a share of the job (basis points); employees an hourly rate. */
export const payValidator = v.union(
  v.object({ kind: v.literal("share"), shareBps: v.number() }),
  v.object({ kind: v.literal("hourly"), hourlyCents: v.number() }),
);

/** What a task or approval is about. */
export const aboutValidator = v.union(
  v.object({ table: v.literal("customers"), id: v.id("customers") }),
  v.object({ table: v.literal("properties"), id: v.id("properties") }),
  v.object({ table: v.literal("cleaners"), id: v.id("cleaners") }),
  v.object({ table: v.literal("jobs"), id: v.id("jobs") }),
  v.object({ table: v.literal("assignments"), id: v.id("assignments") }),
);

export default defineSchema({
  // ── Public site ────────────────────────────────────────────────────────────────────────────────
  earlyAccessRequests: defineTable({
    name: v.string(),
    email: v.string(),
    company: v.string(),
    focus: v.union(v.literal("Sales"), v.literal("Recruiting"), v.literal("Dispatch"), v.literal("Retention")),
    source: v.string(),
    /** How many times this email has asked. A repeat updates the row instead of adding one. */
    requests: v.number(),
    createdAt: v.number(),
    lastRequestedAt: v.number(),
  }).index("by_email", ["email"]),

  rateLimits: defineTable({ key: v.string(), windowStart: v.number(), count: v.number() }).index("by_key", ["key"]),

  // ── Companies and the people in them ───────────────────────────────────────────────────────────
  companies: defineTable({
    name: v.string(),
    /** IANA name, for example America/Chicago. Availability windows are on this clock. */
    timezone: v.string(),
    /** Agents the owner has paused. Pausing all four pauses everything. */
    pausedAgents: v.array(agentValidator),
    createdAt: v.number(),
  }),

  members: defineTable({
    companyId: v.id("companies"),
    /** The sign-in subject. Empty until an invited person signs in and joins. */
    userId: v.optional(v.string()),
    email: v.string(),
    name: v.string(),
    role: roleValidator,
    status: memberStatusValidator,
    createdAt: v.number(),
  })
    .index("by_company_user", ["companyId", "userId"])
    .index("by_company_email", ["companyId", "email"])
    .index("by_company", ["companyId"])
    .index("by_user", ["userId"])
    .index("by_email_status", ["email", "status"]),

  // ── Customers and properties ───────────────────────────────────────────────────────────────────
  customers: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    kind: workKindValidator,
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    preferences: v.optional(v.string()),
    status: recordStatusValidator,
    createdAt: v.number(),
  }).index("by_company_status", ["companyId", "status"]),

  properties: defineTable({
    companyId: v.id("companies"),
    customerId: v.id("customers"),
    label: v.optional(v.string()),
    address: addressValidator,
    kind: workKindValidator,
    accessInstructions: v.optional(v.string()),
    status: recordStatusValidator,
    createdAt: v.number(),
  })
    .index("by_company_customer", ["companyId", "customerId"])
    .index("by_company_postal", ["companyId", "address.postalCode"]),

  // ── Cleaners and when they can work ────────────────────────────────────────────────────────────
  cleaners: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    engagement: v.union(v.literal("contractor"), v.literal("employee")),
    status: cleanerStatusValidator,
    skills: v.array(v.string()),
    /** Postal codes the cleaner works in. Empty means not set yet, which matches nothing. */
    serviceAreas: v.array(v.string()),
    /** Set by the Owner only. No agent reads this to change it. */
    pay: v.optional(payValidator),
    createdAt: v.number(),
  }).index("by_company_status", ["companyId", "status"]),

  /** A weekly window the cleaner said they can work, on the company's clock. Minutes from midnight. */
  availabilityWindows: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    weekday: v.number(),
    startMinute: v.number(),
    endMinute: v.number(),
  }).index("by_company_cleaner", ["companyId", "cleanerId"]),

  timeOff: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    startsAt: v.number(),
    endsAt: v.number(),
    note: v.optional(v.string()),
  }).index("by_company_cleaner_end", ["companyId", "cleanerId", "endsAt"]),

  // ── Jobs and assignments. Payments are not here and are never inferred from these. ─────────────
  jobs: defineTable({
    companyId: v.id("companies"),
    customerId: v.id("customers"),
    propertyId: v.id("properties"),
    serviceType: v.string(),
    scope: v.string(),
    requiredSkills: v.array(v.string()),
    startsAt: v.number(),
    endsAt: v.number(),
    status: jobStatusValidator,
    cancelReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_company_start", ["companyId", "startsAt"])
    .index("by_company_status_start", ["companyId", "status", "startsAt"])
    .index("by_company_customer", ["companyId", "customerId"]),

  assignments: defineTable({
    companyId: v.id("companies"),
    jobId: v.id("jobs"),
    cleanerId: v.id("cleaners"),
    status: assignmentStatusValidator,
    /** What the cleaner was told: the scope and their own pay, kept as offered. */
    scope: v.string(),
    payCents: v.number(),
    offeredAt: v.number(),
    respondBy: v.number(),
    respondedAt: v.optional(v.number()),
    endReason: v.optional(v.string()),
  })
    .index("by_company_job", ["companyId", "jobId"])
    .index("by_company_cleaner_status", ["companyId", "cleanerId", "status"])
    .index("by_status_respondBy", ["status", "respondBy"]),

  // ── Tasks carry the work (brief, section 10) ───────────────────────────────────────────────────
  tasks: defineTable({
    companyId: v.id("companies"),
    /** The responsible agent. */
    agent: agentValidator,
    title: v.string(),
    about: v.optional(aboutValidator),
    completionCondition: v.string(),
    status: taskStatusValidator,
    /** Set while open. */
    nextAction: v.optional(v.string()),
    /** The deadline for the next action, or for the decision while a person holds it. */
    dueAt: v.number(),
    /** Set while waiting. */
    waitingOn: v.optional(waitingOnValidator),
    followUpAt: v.optional(v.number()),
    /** Set while a person must decide. */
    openQuestion: v.optional(v.string()),
    /** Set when done or cancelled. */
    outcome: v.optional(v.string()),
    createdAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index("by_company_status_due", ["companyId", "status", "dueAt"])
    .index("by_company_agent_status", ["companyId", "agent", "status"]),

  // ── Authority (brief, section 7) ───────────────────────────────────────────────────────────────
  /** One row per action the owner has changed. An action with no row is at its starting level. */
  permissions: defineTable({
    companyId: v.id("companies"),
    action: v.string(),
    level: levelValidator,
    /** Money actions only. */
    perActionCents: v.optional(v.number()),
    perDayCents: v.optional(v.number()),
    updatedBy: v.id("members"),
    updatedAt: v.number(),
  }).index("by_company_action", ["companyId", "action"]),

  approvals: defineTable({
    companyId: v.id("companies"),
    agent: agentValidator,
    action: v.string(),
    /** What the agent wants to do, and why, in words a person can check. */
    summary: v.string(),
    reason: v.string(),
    about: v.optional(aboutValidator),
    taskId: v.optional(v.id("tasks")),
    status: approvalStatusValidator,
    decideBy: v.number(),
    decidedBy: v.optional(v.id("members")),
    decidedAt: v.optional(v.number()),
    /** What the person changed, or why they skipped it. */
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_company_status_decideBy", ["companyId", "status", "decideBy"])
    .index("by_status_decideBy", ["status", "decideBy"]),

  // ── Events: append-only ────────────────────────────────────────────────────────────────────────
  events: defineTable({
    companyId: v.id("companies"),
    /** thing.what_happened, for example assignment.accepted. */
    type: v.string(),
    actor: actorValidator,
    subject: subjectValidator,
    /** The subject's id again, so one record's history can be read through an index. */
    subjectId: v.string(),
    data: v.optional(eventDataValidator),
    at: v.number(),
  })
    .index("by_company_at", ["companyId", "at"])
    .index("by_company_subject_at", ["companyId", "subjectId", "at"]),
});
