/**
 * Selestial staff: the people who run Selestial itself, not the people inside a cleaning company. Staff
 * manage the public trust information (policies, providers, claims) and work the privacy and security
 * request queues. Being staff gives no access to any company's records: those still need membership.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const STAFF_ROLES = ["admin", "reviewer"] as const;
export const staffRoleValidator = v.union(v.literal("admin"), v.literal("reviewer"));

export const staffTables = {
  staff: defineTable({
    /** The sign-in subject. Set when the person first signs in as staff. */
    userId: v.optional(v.string()),
    /** Confirmed email, lower case. Staff are matched by it until they have signed in once. */
    email: v.string(),
    name: v.string(),
    /** admin manages staff and published trust information; reviewer works the request queues. */
    role: staffRoleValidator,
    status: v.union(v.literal("active"), v.literal("removed")),
    addedAt: v.number(),
    /** Who added them: a staff id, or "bootstrap" for the first admin named by STAFF_BOOTSTRAP_EMAIL. */
    addedBy: v.string(),
  })
    .index("by_email", ["email"])
    .index("by_user", ["userId"]),
};
