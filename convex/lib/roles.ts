/**
 * Roles inside a company (brief, section 16).
 * Owner: everything. Manager: operations and approvals, no billing or authority settings.
 * Office: works the queue and conversations.
 */
import { v } from "convex/values";

export const ROLES = ["owner", "manager", "office"] as const;
export type Role = (typeof ROLES)[number];

export const roleValidator = v.union(v.literal("owner"), v.literal("manager"), v.literal("office"));
/** The roles a person can be added with. A company has one way to get an Owner: creating it. */
export const grantableRoleValidator = v.union(v.literal("manager"), v.literal("office"));

export function roleOf(stored: string): Role {
  // An unknown word is treated as the least a person can be, never as more.
  return (ROLES as readonly string[]).includes(stored) ? (stored as Role) : "office";
}

export function isOwner(role: Role): boolean {
  return role === "owner";
}

export function isManager(role: Role): boolean {
  return role === "owner" || role === "manager";
}
