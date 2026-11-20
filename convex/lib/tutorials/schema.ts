/**
 * What staff change about a migration tutorial without a release, what owners report, and what they did
 * with it. The tutorials themselves are in catalog.ts.
 *
 * Analytics hold the tutorial, where it was offered and what happened. Never a file, a row, a client or a
 * typed value: a tutorial event cannot say what the owner imported.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { literals } from "../statuses";
import { PLACEMENTS, STATES } from "./catalog";

export const stateValidator = literals(STATES);
export const placementValidator = literals(PLACEMENTS);

export const TUTORIAL_EVENTS = ["opened", "play_started", "play_completed", "steps_expanded", "action_selected", "play_failed", "reported_outdated", "suggestion_dismissed"] as const;
export const tutorialEventValidator = literals(TUTORIAL_EVENTS);

export const mediaValidator = v.object({
  version: v.number(),
  video: v.string(),
  poster: v.string(),
  captions: v.string(),
  durationSeconds: v.number(),
});

export const tutorialTables = {
  /** One row per tutorial staff have changed. A tutorial with no row is in its catalog default state. */
  tutorialSettings: defineTable({
    tutorialId: v.string(),
    state: stateValidator,
    /** Replaces the catalog's media, so a new version reaches every screen without a release. */
    media: v.optional(mediaValidator),
    /** Staff's own note: what was checked, or what changed in the other system. */
    note: v.optional(v.string()),
    /** When an owner last reported the steps as changed. Cleared when staff review it. */
    reportedAt: v.optional(v.number()),
    updatedBy: v.string(),
    updatedAt: v.number(),
  }).index("by_tutorial", ["tutorialId"]),

  /** An owner saying a tutorial no longer matches the other system. */
  tutorialReports: defineTable({
    tutorialId: v.string(),
    companyId: v.id("companies"),
    /** What looked different, in the owner's words. */
    note: v.optional(v.string()),
    contentVersion: v.number(),
    mediaVersion: v.optional(v.number()),
    status: v.union(v.literal("open"), v.literal("reviewed")),
    createdAt: v.number(),
  })
    .index("by_status", ["status", "createdAt"])
    .index("by_company", ["companyId", "createdAt"])
    .index("by_tutorial", ["tutorialId", "createdAt"]),

  tutorialEvents: defineTable({
    companyId: v.id("companies"),
    tutorialId: v.string(),
    kind: tutorialEventValidator,
    placement: placementValidator,
    at: v.number(),
  })
    .index("by_at", ["at"])
    .index("by_company_tutorial", ["companyId", "tutorialId", "kind"]),
};
