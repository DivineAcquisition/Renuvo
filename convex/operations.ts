/**
 * Selestial's operational monitoring (docs/operations/02-incidents.md): the checks that find incidents,
 * and what Selestial staff read and do about them. The staff Operations workspace reads these.
 *
 * Every count and state here comes from records: incidents and the source records they name. Nothing
 * is estimated, and no model is asked about infrastructure health.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { staffMutation, staffQuery } from "./lib/builders";
import { notFound, userError } from "./lib/errors";
import { AREAS, CLOSE_BY_HAND, KIND_LABELS, SEVERITIES, areaValidator, checkValidator, nextActor, severityRank, stateValidator, type Area, type Severity, type State } from "./lib/operations/catalog";
import { DETECTORS, detectorFor } from "./lib/operations/detectors";
import { reevaluate, resolveIncident, runDetector, stateWords, verifyIncident } from "./lib/operations/incidents";
import { text } from "./lib/text";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
/** Provider callback failures are kept this long for the checks to read. */
const SIGNAL_KEEP = 7 * DAY;
/** At most this many failures are recorded in five minutes, so a flood of bad callbacks cannot flood the table. */
const SIGNAL_CAP = 200;

// ── Running the checks ────────────────────────────────────────────────────────────────────────────

/** Every five minutes (convex/crons.ts): starts each check that is due, each in its own transaction. */
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let started = 0;
    for (const detector of DETECTORS) {
      const row = await ctx.db
        .query("monitorChecks")
        .withIndex("by_check", (q) => q.eq("check", detector.check))
        .first();
      // Thirty seconds of slack, so a check every five minutes is not skipped by a tick that ran a moment early.
      if (row && now - row.lastStartedAt < detector.everyMinutes * MINUTE - 30 * 1000) continue;
      if (row) await ctx.db.patch(row._id, { lastStartedAt: now });
      else await ctx.db.insert("monitorChecks", { check: detector.check, lastStartedAt: now });
      await ctx.scheduler.runAfter(0, internal.operations.runCheck, { check: detector.check });
      started += 1;
    }
    return started;
  },
});

/** One check. If it throws, nothing it did is kept and its last finish stays old, so it shows as failing. */
export const runCheck = internalMutation({
  args: { check: checkValidator },
  handler: async (ctx, args) => {
    const now = Date.now();
    const result = await runDetector(ctx, detectorFor(args.check), now);
    if (args.check === "inbound_processing") {
      const old = await ctx.db
        .query("opsSignals")
        .withIndex("by_kind_at", (q) => q.eq("kind", "webhook_failed").lt("at", now - SIGNAL_KEEP))
        .take(200);
      for (const row of old) await ctx.db.delete(row._id);
    }
    const row = await ctx.db
      .query("monitorChecks")
      .withIndex("by_check", (q) => q.eq("check", args.check))
      .first();
    if (row) await ctx.db.patch(row._id, { lastFinishedAt: now, found: result.found });
    else await ctx.db.insert("monitorChecks", { check: args.check, lastStartedAt: now, lastFinishedAt: now, found: result.found });
    return result;
  },
});

/** A provider callback that verified but could not be processed (convex/lib/builders.ts providerWebhook). */
export const webhookFailed = internalMutation({
  args: { source: v.string(), detail: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const recent = await ctx.db
      .query("opsSignals")
      .withIndex("by_kind_at", (q) => q.eq("kind", "webhook_failed").gt("at", now - 5 * MINUTE))
      .take(SIGNAL_CAP);
    if (recent.length >= SIGNAL_CAP) return null;
    await ctx.db.insert("opsSignals", { kind: "webhook_failed", source: args.source.slice(0, 100), detail: args.detail.split("\n")[0].slice(0, 300), at: now });
    return null;
  },
});

// ── What staff read ──────────────────────────────────────────────────────────────────────────────

type Freshness = "ok" | "stale" | "failing" | "never_run";

/** How each check is doing. A check that has not finished for three of its intervals is stale. */
function freshness(row: Doc<"monitorChecks"> | null, everyMinutes: number, now: number): Freshness {
  if (!row?.lastFinishedAt) return row && now - row.lastStartedAt > 10 * MINUTE ? "failing" : "never_run";
  if (row.lastStartedAt - row.lastFinishedAt > 10 * MINUTE) return "failing";
  if (now - row.lastFinishedAt > 3 * everyMinutes * MINUTE) return "stale";
  return "ok";
}

async function companyNames(ctx: { db: { get: (id: Id<"companies">) => Promise<Doc<"companies"> | null> } }, ids: Iterable<Id<"companies">>) {
  const names = new Map<string, string>();
  for (const id of ids) {
    if (names.has(id)) continue;
    const company = await ctx.db.get(id);
    names.set(id, company?.name ?? "Deleted company");
  }
  return names;
}

function incidentRow(incident: Doc<"incidents">, names: Map<string, string>) {
  return {
    id: incident._id,
    kind: incident.kind,
    label: KIND_LABELS[incident.kind],
    area: incident.area,
    company: incident.companyId ? { id: incident.companyId, name: names.get(incident.companyId) ?? "Deleted company" } : null,
    provider: incident.provider ?? null,
    severity: incident.severity,
    state: incident.state,
    stateWords: stateWords(incident.state),
    nextActor: nextActor(incident.state),
    title: incident.title,
    impact: incident.impact,
    nextAction: incident.nextAction,
    occurrences: incident.occurrences,
    recoveryAttempts: incident.recoveryAttempts,
    firstSeenAt: incident.firstSeenAt,
    lastSeenAt: incident.lastSeenAt,
    lastCheckedAt: incident.lastCheckedAt,
    assignedTo: incident.assignedTo ?? null,
    parentId: incident.parentId ?? null,
    resolvedAt: incident.resolvedAt || null,
    resolution: incident.resolution ?? null,
  };
}

const bySeverityThenRecent = (a: Doc<"incidents">, b: Doc<"incidents">) => severityRank(a.severity) - severityRank(b.severity) || b.lastSeenAt - a.lastSeenAt;

/** The Overview: what is broken, who is affected, what is blocked, whether recovery is running, who acts next. */
export const overview = staffQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const open = await ctx.db
      .query("incidents")
      .withIndex("by_resolved_seen", (q) => q.eq("resolvedAt", 0))
      .order("desc")
      .take(500);
    const recent = await ctx.db
      .query("incidents")
      .withIndex("by_resolved_seen", (q) => q.gt("resolvedAt", now - DAY))
      .take(200);
    const names = await companyNames(ctx, [...open, ...recent].flatMap((row) => (row.companyId ? [row.companyId] : [])));

    const byArea = Object.fromEntries(AREAS.map((area) => [area, 0])) as Record<Area, number>;
    const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>;
    const byState: Partial<Record<State, number>> = {};
    const affected = new Map<string, { id: Id<"companies">; name: string; open: number; worst: Severity }>();
    for (const incident of open) {
      byArea[incident.area] += 1;
      bySeverity[incident.severity] += 1;
      byState[incident.state] = (byState[incident.state] ?? 0) + 1;
      if (incident.companyId) {
        const entry = affected.get(incident.companyId) ?? { id: incident.companyId, name: names.get(incident.companyId) ?? "Deleted company", open: 0, worst: "low" as Severity };
        entry.open += 1;
        if (severityRank(incident.severity) < severityRank(entry.worst)) entry.worst = incident.severity;
        affected.set(incident.companyId, entry);
      }
    }
    const checks = await Promise.all(
      DETECTORS.map(async (detector) => {
        const found = await ctx.db
          .query("monitorChecks")
          .withIndex("by_check", (q) => q.eq("check", detector.check))
          .first();
        return { check: detector.check, everyMinutes: detector.everyMinutes, lastStartedAt: found?.lastStartedAt ?? null, lastFinishedAt: found?.lastFinishedAt ?? null, found: found?.found ?? null, freshness: freshness(found, detector.everyMinutes, now) };
      }),
    );
    const sorted = [...open].sort(bySeverityThenRecent);
    return {
      now,
      // Truncated at 500 open incidents: the counts say so rather than pretend.
      complete: open.length < 500,
      openCount: open.length,
      byArea,
      bySeverity,
      byState,
      platform: sorted.filter((row) => !row.companyId).map((row) => incidentRow(row, names)),
      needsStaff: sorted.filter((row) => row.state === "needs_staff").slice(0, 20).map((row) => incidentRow(row, names)),
      waitingOwner: sorted.filter((row) => row.state === "waiting_owner").slice(0, 20).map((row) => incidentRow(row, names)),
      recovering: sorted.filter((row) => row.state === "recovering" || row.state === "investigating").slice(0, 20).map((row) => incidentRow(row, names)),
      affectedCompanies: [...affected.values()].sort((a, b) => severityRank(a.worst) - severityRank(b.worst) || b.open - a.open).slice(0, 50),
      recentlyResolved: recent.sort((a, b) => b.resolvedAt - a.resolvedAt).slice(0, 20).map((row) => incidentRow(row, names)),
      checks,
      monitoringHealthy: checks.every((check) => check.freshness === "ok"),
    };
  },
});

/** Needs attention, Agent work, Communications, Connections, Billing: the open incidents of one area, or all. */
export const list = staffQuery({
  args: { area: v.optional(areaValidator), state: v.optional(stateValidator), companyId: v.optional(v.id("companies")), resolved: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    let rows: Doc<"incidents">[];
    if (args.companyId) {
      const companyId = args.companyId;
      rows = args.resolved
        ? await ctx.db.query("incidents").withIndex("by_company_resolved", (q) => q.eq("companyId", companyId).gt("resolvedAt", 0)).order("desc").take(200)
        : await ctx.db.query("incidents").withIndex("by_company_resolved", (q) => q.eq("companyId", companyId).eq("resolvedAt", 0)).order("desc").take(200);
    } else {
      rows = args.resolved
        ? await ctx.db.query("incidents").withIndex("by_resolved_seen", (q) => q.gt("resolvedAt", now - 30 * DAY)).order("desc").take(300)
        : await ctx.db.query("incidents").withIndex("by_resolved_seen", (q) => q.eq("resolvedAt", 0)).order("desc").take(500);
    }
    if (args.area) rows = rows.filter((row) => row.area === args.area);
    if (args.state) rows = rows.filter((row) => row.state === args.state);
    const names = await companyNames(ctx, rows.flatMap((row) => (row.companyId ? [row.companyId] : [])));
    return (args.resolved ? rows.sort((a, b) => b.resolvedAt - a.resolvedAt) : rows.sort(bySeverityThenRecent)).map((row) => incidentRow(row, names));
  },
});

/** One incident in the side panel: what it is, its records, its history, and the shared incident or its companies. */
export const incident = staffQuery({
  args: { id: v.id("incidents") },
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.id);
    if (!found) notFound();
    const updates = await ctx.db
      .query("incidentUpdates")
      .withIndex("by_incident_at", (q) => q.eq("incidentId", found._id))
      .order("desc")
      .take(100);
    const children = found.kind === "provider_outage" ? await ctx.db.query("incidents").withIndex("by_parent", (q) => q.eq("parentId", found._id)).take(100) : [];
    const parent = found.parentId ? await ctx.db.get(found.parentId) : null;
    const names = await companyNames(ctx, [found, ...children, ...(parent ? [parent] : [])].flatMap((row) => (row.companyId ? [row.companyId] : [])));
    const staffIds = new Set<Id<"staff">>();
    if (found.assignedTo) staffIds.add(found.assignedTo);
    for (const update of updates) if (update.by !== "system") staffIds.add(update.by);
    if (found.resolvedBy && found.resolvedBy !== "system") staffIds.add(found.resolvedBy);
    const staffNames = new Map<string, string>();
    for (const id of staffIds) staffNames.set(id, (await ctx.db.get(id))?.name ?? "Former staff");
    return {
      ...incidentRow(found, names),
      check: found.check,
      key: found.key,
      diagnostics: found.diagnostics ?? null,
      related: found.related,
      evidence: found.evidence ?? null,
      resolvedBy: found.resolvedBy ? (found.resolvedBy === "system" ? "Selestial (automatic check)" : staffNames.get(found.resolvedBy) ?? "Former staff") : null,
      assignedName: found.assignedTo ? staffNames.get(found.assignedTo) ?? "Former staff" : null,
      closeByHand: CLOSE_BY_HAND.has(found.kind),
      updates: updates.map((update) => ({ id: update._id, kind: update.kind, words: update.words, at: update.at, by: update.by === "system" ? "Selestial" : staffNames.get(update.by) ?? "Former staff" })),
      parent: parent ? incidentRow(parent, names) : null,
      children: children.sort(bySeverityThenRecent).map((child) => incidentRow(child, names)),
    };
  },
});

// ── What staff do ────────────────────────────────────────────────────────────────────────────────

async function openIncident(ctx: { db: { get: (id: Id<"incidents">) => Promise<Doc<"incidents"> | null> } }, id: Id<"incidents">) {
  const found = await ctx.db.get(id);
  if (!found) notFound();
  if (found.resolvedAt !== 0) throw userError("This incident is already resolved.");
  return found;
}

/** Takes an incident, hands it to another staff member, or lets it go. */
export const assign = staffMutation({
  args: { id: v.id("incidents"), staffId: v.union(v.id("staff"), v.null()) },
  handler: async (ctx, args) => {
    const found = await openIncident(ctx, args.id);
    let words = "Unassigned.";
    if (args.staffId) {
      const person = await ctx.db.get(args.staffId);
      if (!person || person.status !== "active") notFound();
      words = person._id === ctx.staff._id ? `${person.name} took it.` : `Assigned to ${person.name} by ${ctx.staff.name}.`;
    }
    await ctx.db.patch(found._id, { assignedTo: args.staffId ?? undefined, updatedAt: Date.now() });
    await ctx.db.insert("incidentUpdates", { incidentId: found._id, kind: "assigned", words, by: ctx.staff._id, at: Date.now() });
    return null;
  },
});

/** A note on what a staff member found or did. Never a secret or a customer's message. */
export const addNote = staffMutation({
  args: { id: v.id("incidents"), words: v.string() },
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.id);
    if (!found) notFound();
    await ctx.db.insert("incidentUpdates", { incidentId: found._id, kind: "note", words: text(args.words, "The note", 1000), by: ctx.staff._id, at: Date.now() });
    return null;
  },
});

/** Looks at the incident's records again now, after a fix, instead of waiting for the next check. */
export const recheck = staffMutation({
  args: { id: v.id("incidents") },
  handler: async (ctx, args) => {
    const found = await openIncident(ctx, args.id);
    const now = Date.now();
    if (found.kind === "provider_outage") {
      await ctx.scheduler.runAfter(0, internal.operations.runCheck, { check: found.check });
      return { resolved: false, words: "The check is running again now." };
    }
    const result = await verifyIncident(ctx, detectorFor(found.check), found, now);
    return result === "resolved" ? { resolved: true, words: "Checked again: the condition is gone, so it is resolved." } : { resolved: false, words: "Checked again: it is still happening." };
  },
});

/**
 * Resolves an incident by hand. Only for kinds whose record ends in a final state (a failed job stays
 * failed), with the reason it is handled; and only once its records no longer show anything worse. Every
 * other incident resolves when its check finds the condition gone, so clicking Retry never closes one.
 */
export const resolve = staffMutation({
  args: { id: v.id("incidents"), reason: v.string() },
  handler: async (ctx, args) => {
    const found = await openIncident(ctx, args.id);
    const reason = text(args.reason, "The reason", 1000);
    if (reason.length < 10) throw userError("Say what was done, so the next person can tell why it was closed.");
    const now = Date.now();
    if (found.kind === "provider_outage") {
      const child = await ctx.db.query("incidents").withIndex("by_parent", (q) => q.eq("parentId", found._id).eq("resolvedAt", 0)).first();
      if (child) throw userError("Companies under it still have open incidents. It resolves by itself once theirs do.");
    }
    const present = found.kind === "provider_outage" ? [] : await reevaluate(ctx, detectorFor(found.check), found, now);
    if (present.length > 0 && !CLOSE_BY_HAND.has(found.kind)) {
      throw userError("It is still happening: its check found the condition again just now. It resolves by itself once the condition is gone.");
    }
    await resolveIncident(ctx, found, { by: ctx.staff._id, resolution: `Resolved by ${ctx.staff.name}.`, evidence: reason }, now);
    return null;
  },
});

