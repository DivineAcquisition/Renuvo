/**
 * Admin Support Sessions (docs/operations/03-support-sessions.md).
 *
 *  - supportSessions   one staff member inside one company, for a stated reason, for a limited time
 *  - supportGrants     an owner's permission for Manage sessions, for a limited time
 *  - supportEvents     what happened in each session: start, mode changes, reveals, every change, end
 *  - staffAudit        changes to who is staff and what each staff member may do
 *
 * The session keeps both identities: the staff member doing the work (staffId) and the company being
 * worked in (companyId). Nothing here holds a password, token, key or message body.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { capabilityValidator } from "./catalog";

export const supportModeValidator = v.union(v.literal("view"), v.literal("manage"));
export const previewRoleValidator = v.union(v.literal("owner"), v.literal("manager"), v.literal("office"));

export const supportTables = {
  supportSessions: defineTable({
    staffId: v.id("staff"),
    companyId: v.id("companies"),
    mode: supportModeValidator,
    /** Why staff opened it, in their words. Shown to the owner in Support access history. */
    reason: v.string(),
    incidentId: v.optional(v.id("incidents")),
    /** A support ticket or conversation reference, when there is one. */
    ticket: v.optional(v.string()),
    /** "View as" a role: what that role would see. Never that person's identity or authority. */
    previewRole: previewRoleValidator,
    startedAt: v.number(),
    expiresAt: v.number(),
    /** Set when it switched to Manage: why, and what allowed it. */
    manage: v.optional(v.object({ at: v.number(), reason: v.string(), basis: v.union(v.literal("owner_grant"), v.literal("incident")), grantId: v.optional(v.id("supportGrants")), incidentId: v.optional(v.id("incidents")) })),
    /** Customer message content shown until this time, after a reason was given. */
    revealedUntil: v.optional(v.number()),
    /** How many changes were made, for the owner's summary. */
    changes: v.number(),
    endedAt: v.optional(v.number()),
    endReason: v.optional(v.union(v.literal("exited"), v.literal("expired"), v.literal("revoked"), v.literal("staff_removed"))),
    /** When the owner was sent the summary of a Manage session that changed something. */
    summarizedAt: v.optional(v.number()),
  })
    .index("by_company_started", ["companyId", "startedAt"])
    .index("by_staff_started", ["staffId", "startedAt"])
    .index("by_open_expires", ["endedAt", "expiresAt"]),

  supportGrants: defineTable({
    companyId: v.id("companies"),
    grantedBy: v.id("members"),
    grantedAt: v.number(),
    expiresAt: v.number(),
    note: v.optional(v.string()),
    revokedAt: v.optional(v.number()),
    revokedBy: v.optional(v.id("members")),
  }).index("by_company_granted", ["companyId", "grantedAt"]),

  supportEvents: defineTable({
    sessionId: v.id("supportSessions"),
    companyId: v.id("companies"),
    staffId: v.id("staff"),
    kind: v.union(v.literal("started"), v.literal("manage"), v.literal("extended"), v.literal("revealed"), v.literal("change"), v.literal("ended")),
    /** In words a company owner can read: "updated the business settings". */
    summary: v.string(),
    /** For a change: the fields it touched (names only) and the record, never values that could hold secrets. */
    fields: v.optional(v.array(v.string())),
    subject: v.optional(v.object({ table: v.string(), id: v.string() })),
    at: v.number(),
  })
    .index("by_session_at", ["sessionId", "at"])
    .index("by_company_at", ["companyId", "at"])
    .index("by_at", ["at"]),

  staffAudit: defineTable({
    /** Who did it: a staff id, or "console" for the command line. */
    by: v.union(v.id("staff"), v.literal("console")),
    staffId: v.id("staff"),
    kind: v.union(v.literal("added"), v.literal("removed"), v.literal("role"), v.literal("granted"), v.literal("revoked")),
    capability: v.optional(capabilityValidator),
    reason: v.optional(v.string()),
    at: v.number(),
  }).index("by_staff_at", ["staffId", "at"]),
};
