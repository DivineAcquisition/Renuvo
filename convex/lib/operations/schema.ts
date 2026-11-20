/**
 * Selestial's operational records (docs/operations/02-incidents.md). These are Selestial's own records
 * about the service, read in the staff Operations workspace:
 *
 *  - incidents         one tracked problem, found again by its key, closed only once its check finds it gone
 *  - incidentUpdates   what happened to an incident, in order: opened, state changes, recovery seen, notes
 *  - monitorChecks     when each check last started and last finished, so a check that stopped shows as stale
 *  - opsSignals        failures that leave no record of their own (a provider callback that could not be
 *                      processed), kept a week for the checks to read
 *
 * Nothing here holds a secret, a token or a message body. Recipients and addresses are masked.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { areaValidator, checkValidator, kindValidator, severityValidator, stateValidator } from "./catalog";

export const relatedValidator = v.object({ table: v.string(), id: v.string() });

export const operationsTables = {
  incidents: defineTable({
    /** The condition this is, so the same problem found again updates this row (for example mailbox_reconnect:<connection id>). */
    key: v.string(),
    check: checkValidator,
    kind: kindValidator,
    area: areaValidator,
    /** Absent: a platform incident, about Selestial or a provider rather than one company. */
    companyId: v.optional(v.id("companies")),
    /** A company's incident that is part of a shared one (one provider failing for several companies). */
    parentId: v.optional(v.id("incidents")),
    /** The provider involved, when there is one: google, telnyx, resend, autumn, gmail, microsoft... */
    provider: v.optional(v.string()),
    severity: severityValidator,
    state: stateValidator,
    /** For staff: what is wrong, in one line. */
    title: v.string(),
    /** What business activity it blocks, in plain words. */
    impact: v.string(),
    /** The next thing that should happen, and by whom. */
    nextAction: v.string(),
    /** Provider states and codes for staff. Never a secret or a message body. */
    diagnostics: v.optional(v.string()),
    /** The records it is about, most recent first, at most MAX_RELATED. */
    related: v.array(relatedValidator),
    /** How many records showed the condition the last time the check looked. */
    occurrences: v.number(),
    /** Automatic recovery attempts seen on those records (retries, settlement attempts, read failures). */
    recoveryAttempts: v.number(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    /** When its check last confirmed the condition was still there. */
    lastCheckedAt: v.number(),
    assignedTo: v.optional(v.id("staff")),
    /** 0 while open; when it was resolved. */
    resolvedAt: v.number(),
    resolvedBy: v.optional(v.union(v.literal("system"), v.id("staff"))),
    resolution: v.optional(v.string()),
    /** What showed it was resolved: the check that found the condition gone, or the staff member's reason. */
    evidence: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_key_resolved", ["key", "resolvedAt"])
    .index("by_check_resolved", ["check", "resolvedAt"])
    .index("by_resolved_seen", ["resolvedAt", "lastSeenAt"])
    .index("by_company_resolved", ["companyId", "resolvedAt", "lastSeenAt"])
    .index("by_parent", ["parentId", "resolvedAt"])
    .index("by_kind_resolved", ["kind", "resolvedAt", "lastSeenAt"]),

  incidentUpdates: defineTable({
    incidentId: v.id("incidents"),
    kind: v.union(
      v.literal("opened"),
      v.literal("reopened"),
      v.literal("state"),
      v.literal("severity"),
      v.literal("recovery"),
      v.literal("grouped"),
      v.literal("assigned"),
      v.literal("note"),
      v.literal("resolved"),
    ),
    words: v.string(),
    by: v.union(v.literal("system"), v.id("staff")),
    at: v.number(),
  }).index("by_incident_at", ["incidentId", "at"]),

  monitorChecks: defineTable({
    check: checkValidator,
    /** When the scheduler last asked for it. */
    lastStartedAt: v.number(),
    /** When it last finished. A start much later than the last finish means it is failing. */
    lastFinishedAt: v.optional(v.number()),
    /** Conditions it found the last time it finished. */
    found: v.optional(v.number()),
  }).index("by_check", ["check"]),

  opsSignals: defineTable({
    kind: v.literal("webhook_failed"),
    /** Where it happened, for example the webhook path /webhooks/telnyx. */
    source: v.string(),
    /** The error's first line, without request contents. */
    detail: v.string(),
    at: v.number(),
  }).index("by_kind_at", ["kind", "at"]),
};
