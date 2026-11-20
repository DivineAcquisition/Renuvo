/**
 * Selestial staff: the people who run Selestial itself, not the people inside a cleaning company. Staff
 * manage the public trust information (policies, providers, claims), work the privacy and security
 * request queues, and run operations. Being staff opens no company by itself: a staff member with
 * `workspace.view` can open one only through an Admin Support Session, for a stated reason and a limited
 * time, recorded and shown to the company (convex/lib/support, docs/operations/03-support-sessions.md).
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { capabilityValidator } from "../support/catalog";

export const STAFF_ROLES = ["admin", "support", "reviewer"] as const;
export const staffRoleValidator = v.union(v.literal("admin"), v.literal("support"), v.literal("reviewer"));

export const staffTables = {
  staff: defineTable({
    /** The sign-in subject. Set when the person first signs in as staff. */
    userId: v.optional(v.string()),
    /** The sign-in service `userId` came from; see members.userIssuer. */
    userIssuer: v.optional(v.string()),
    /** Confirmed email, lower case. Staff are matched by it until they have signed in once. */
    email: v.string(),
    name: v.string(),
    /**
     * admin manages staff and published trust information; support helps companies in support sessions;
     * reviewer works the request queues. What each may do is convex/lib/support/catalog.ts.
     */
    role: staffRoleValidator,
    /** Capabilities granted to this person beyond their role, each recorded in staffAudit. */
    capabilities: v.optional(v.array(capabilityValidator)),
    status: v.union(v.literal("active"), v.literal("removed")),
    addedAt: v.number(),
    /** Who added them: a staff id, or "bootstrap" for the first admin named by STAFF_BOOTSTRAP_EMAIL. */
    addedBy: v.string(),
  })
    .index("by_email", ["email"])
    .index("by_user", ["userId"]),
};
