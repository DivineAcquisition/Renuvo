/**
 * Notifications to the people who run a company (convex/lib/notify/catalog.ts). The notices themselves
 * are rows in the shared outbox (`messages`, purpose "member_notice"), so they are planned, sent, retried
 * and tracked exactly like every other message. Only what is particular to them lives here.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { noticeCategoryValidator } from "./catalog";

export const notifyTables = {
  /**
   * One person's choices, per company. A category with no entry follows its default. A locked category
   * (security, and account for the Owner) is sent whatever is stored.
   */
  notificationPreferences: defineTable({
    companyId: v.id("companies"),
    memberId: v.id("members"),
    email: v.array(v.object({ category: noticeCategoryValidator, on: v.boolean(), at: v.number(), via: v.union(v.literal("settings"), v.literal("unsubscribe_link"), v.literal("one_click")) })),
    updatedAt: v.number(),
  }).index("by_company_member", ["companyId", "memberId"]),

  /**
   * Addresses Selestial's own notices must not go to: the mail provider said they bounce, the person
   * marked a notice as spam, or the provider itself suppressed them. Kept per address, across companies,
   * because it's the same inbox whichever company the notice is about. A person can clear it by
   * confirming the address works (a later delivery does not clear it by itself).
   */
  noticeSuppressions: defineTable({
    address: v.string(),
    reason: v.union(v.literal("bounce"), v.literal("complaint"), v.literal("provider")),
    at: v.number(),
    /** The notice that led to it. */
    messageId: v.optional(v.id("messages")),
    clearedAt: v.optional(v.number()),
  }).index("by_address", ["address"]),
};
