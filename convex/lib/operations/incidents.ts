/**
 * Turning what the checks find into incidents (docs/operations/02-incidents.md).
 *
 *  - One incident per key. The same condition found again updates it; found again within a day of being
 *    resolved, it is reopened rather than opened twice.
 *  - Its updates record only what changed: opened, state, severity, recovery seen, grouped, resolved.
 *  - It is resolved only when every record it names is looked at again and none still shows the condition.
 *    Retrying something does not resolve it; the next check does, once the retry worked.
 *  - Several companies showing the same provider failure at once are grouped under one shared incident,
 *    and each company keeps its own.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { KIND_LABELS, MAX_RELATED, OUTAGE_COMPANIES, OUTAGE_STARTED_WITHIN_MS, OUTAGE_WINDOW_MS, REOPEN_WITHIN_MS, severityRank, type Check, type Kind, type OpenState, type Severity } from "./catalog";
import type { Detector, Finding, Related } from "./detectors";

/** The more a state needs a person, the higher it ranks; a group of records takes its worst. */
const STATE_RANK: Record<OpenState, number> = { needs_staff: 4, waiting_owner: 3, waiting_provider: 2, recovering: 1, investigating: 0 };
const STATE_WORDS: Record<OpenState, string> = {
  investigating: "Investigating",
  recovering: "Recovering automatically",
  waiting_owner: "Waiting for the owner",
  waiting_provider: "Waiting for the provider",
  needs_staff: "Needs staff action",
};

export function stateWords(state: OpenState | "resolved"): string {
  return state === "resolved" ? "Resolved" : STATE_WORDS[state];
}

type Summary = Pick<Doc<"incidents">, "kind" | "area" | "companyId" | "provider" | "severity" | "state" | "title" | "impact" | "nextAction" | "diagnostics" | "related" | "occurrences" | "recoveryAttempts" | "firstSeenAt">;

/** What a group of findings that share one key adds up to. */
export function summarize(findings: Finding[]): Summary {
  const sorted = [...findings].sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state] || severityRank(a.severity) - severityRank(b.severity) || b.since - a.since);
  const lead = sorted[0];
  const severity = findings.reduce<Severity>((worst, row) => (severityRank(row.severity) < severityRank(worst) ? row.severity : worst), lead.severity);
  const words = findings.length > 1 && lead.plural ? lead.plural(findings.length) : { title: lead.title, impact: lead.impact };
  const seen = new Set<string>();
  const related: Related[] = [];
  for (const row of [...findings].sort((a, b) => b.since - a.since)) {
    const id = `${row.source.table}:${row.source.id}`;
    if (seen.has(id) || related.length >= MAX_RELATED) continue;
    seen.add(id);
    related.push(row.source);
  }
  return {
    kind: lead.kind,
    area: lead.area,
    companyId: lead.companyId,
    provider: lead.provider,
    severity,
    state: lead.state,
    title: words.title,
    impact: words.impact,
    nextAction: lead.nextAction,
    diagnostics: lead.diagnostics,
    related,
    occurrences: findings.length,
    recoveryAttempts: findings.reduce((sum, row) => sum + row.attempts, 0),
    firstSeenAt: Math.min(...findings.map((row) => row.since)),
  };
}

async function note(ctx: MutationCtx, incidentId: Id<"incidents">, kind: Doc<"incidentUpdates">["kind"], words: string, by: Doc<"incidentUpdates">["by"] = "system") {
  await ctx.db.insert("incidentUpdates", { incidentId, kind, words: words.slice(0, 1000), by, at: Date.now() });
}

export async function openByKey(ctx: QueryCtx, key: string): Promise<Doc<"incidents"> | null> {
  return ctx.db
    .query("incidents")
    .withIndex("by_key_resolved", (q) => q.eq("key", key).eq("resolvedAt", 0))
    .first();
}

/** Records the findings for one key: updates the open incident, reopens a recent one, or opens a new one. */
export async function upsertIncident(ctx: MutationCtx, check: Check, key: string, findings: Finding[], now: number): Promise<Id<"incidents">> {
  const next = summarize(findings);
  const open = await openByKey(ctx, key);
  if (open) {
    if (open.state !== next.state) await note(ctx, open._id, "state", `${stateWords(open.state as OpenState)} → ${stateWords(next.state as OpenState)}. ${next.nextAction}`);
    if (open.severity !== next.severity) await note(ctx, open._id, "severity", `Severity ${open.severity} → ${next.severity}.`);
    if (next.recoveryAttempts > open.recoveryAttempts) await note(ctx, open._id, "recovery", `Automatic recovery tried again: ${next.recoveryAttempts} ${next.recoveryAttempts === 1 ? "attempt" : "attempts"} so far.`);
    await ctx.db.patch(open._id, { ...next, firstSeenAt: Math.min(open.firstSeenAt, next.firstSeenAt), lastSeenAt: now, lastCheckedAt: now, updatedAt: now });
    return open._id;
  }
  const recent = await ctx.db
    .query("incidents")
    .withIndex("by_key_resolved", (q) => q.eq("key", key).gt("resolvedAt", now - REOPEN_WITHIN_MS))
    .order("desc")
    .first();
  if (recent) {
    await ctx.db.patch(recent._id, { ...next, firstSeenAt: Math.min(recent.firstSeenAt, next.firstSeenAt), lastSeenAt: now, lastCheckedAt: now, resolvedAt: 0, resolvedBy: undefined, resolution: undefined, evidence: undefined, updatedAt: now });
    await note(ctx, recent._id, "reopened", `Found again after it was resolved. ${next.impact}`);
    return recent._id;
  }
  const id = await ctx.db.insert("incidents", { key, check, ...next, lastSeenAt: now, lastCheckedAt: now, resolvedAt: 0, updatedAt: now });
  await note(ctx, id, "opened", `${KIND_LABELS[next.kind]}. ${next.impact}`);
  return id;
}

export async function resolveIncident(ctx: MutationCtx, incident: Doc<"incidents">, how: { by: "system" | Id<"staff">; resolution: string; evidence: string }, now: number) {
  await ctx.db.patch(incident._id, { state: "resolved", resolvedAt: now, resolvedBy: how.by, resolution: how.resolution, evidence: how.evidence, updatedAt: now });
  await note(ctx, incident._id, "resolved", `${how.resolution} ${how.evidence}`, how.by);
}

/** Looks at every record an incident names again. The findings still there, or none. */
export async function reevaluate(ctx: QueryCtx, detector: Detector, incident: Doc<"incidents">, now: number): Promise<Finding[]> {
  const present: Finding[] = [];
  for (const source of incident.related) {
    const finding = await detector.evaluate(ctx, source, now);
    if (finding && finding.key === incident.key) present.push(finding);
  }
  return present;
}

/** Re-checks an open incident its check did not find this time, and resolves it if its condition is gone. */
export async function verifyIncident(ctx: MutationCtx, detector: Detector, incident: Doc<"incidents">, now: number): Promise<"resolved" | "present"> {
  const present = await reevaluate(ctx, detector, incident, now);
  if (present.length > 0) {
    await upsertIncident(ctx, detector.check, incident.key, present, now);
    return "present";
  }
  const n = incident.related.length;
  await resolveIncident(ctx, incident, { by: "system", resolution: "The condition is gone.", evidence: `Checked ${n} ${n === 1 ? "record" : "records"} again at ${new Date(now).toISOString()}; none still shows it.` }, now);
  return "resolved";
}

/** One run of a check: what it finds is recorded, and what it no longer finds is verified and resolved. */
export async function runDetector(ctx: MutationCtx, detector: Detector, now: number): Promise<{ found: number; resolved: number }> {
  const sources = await detector.scan(ctx, now);
  const seen = new Set<string>();
  const groups = new Map<string, Finding[]>();
  for (const source of sources) {
    const id = `${source.table}:${source.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const finding = await detector.evaluate(ctx, source, now);
    if (!finding) continue;
    groups.set(finding.key, [...(groups.get(finding.key) ?? []), finding]);
  }
  const touched = new Set<string>();
  for (const [key, findings] of groups) touched.add(await upsertIncident(ctx, detector.check, key, findings, now));

  let resolved = 0;
  const open = await ctx.db
    .query("incidents")
    .withIndex("by_check_resolved", (q) => q.eq("check", detector.check).eq("resolvedAt", 0))
    .take(300);
  for (const incident of open) {
    if (touched.has(incident._id) || incident.kind === "provider_outage") continue;
    if ((await verifyIncident(ctx, detector, incident, now)) === "resolved") resolved += 1;
  }
  resolved += await groupOutages(ctx, detector.check, now);
  let found = 0;
  for (const findings of groups.values()) found += findings.length;
  return { found, resolved };
}

/**
 * The same provider failure in several companies at once is one shared incident. Each company keeps its
 * own incident (its own impact and next action) and points at the shared one. The shared one resolves
 * when none of its companies' incidents is still open.
 */
export async function groupOutages(ctx: MutationCtx, check: Check, now: number): Promise<number> {
  let resolved = 0;
  const open = await ctx.db
    .query("incidents")
    .withIndex("by_check_resolved", (q) => q.eq("check", check).eq("resolvedAt", 0))
    .take(300);
  const byProvider = new Map<string, Doc<"incidents">[]>();
  for (const incident of open) {
    if (incident.kind === "provider_outage" || !incident.companyId || !incident.provider) continue;
    // Waiting for an owner to reconnect is each company's own matter, not a provider failure.
    if (incident.state === "waiting_owner") continue;
    // Only what is happening now (seen in the last half hour) and was opened recently: long-standing problems in
    // three companies are three problems, not an outage. Once grouped, an incident stays in its group.
    if (incident.lastSeenAt < now - OUTAGE_WINDOW_MS) continue;
    if (!incident.parentId && incident._creationTime < now - OUTAGE_STARTED_WITHIN_MS) continue;
    const group = `${incident.provider}:${incident.kind}`;
    byProvider.set(group, [...(byProvider.get(group) ?? []), incident]);
  }
  for (const [group, members] of byProvider) {
    const companies = new Set(members.map((row) => row.companyId));
    if (companies.size < OUTAGE_COMPANIES) continue;
    const [provider, kind] = group.split(":") as [string, Kind];
    const key = `provider_outage:${group}`;
    const lead = members[0];
    const findings: Finding[] = members.map((row) => ({
      key,
      kind: "provider_outage",
      area: lead.area,
      provider,
      severity: severityRank(row.severity) <= severityRank("high") ? "critical" : "high",
      state: "needs_staff",
      title: `${KIND_LABELS[kind]} at ${provider} for ${companies.size} companies`,
      impact: `${companies.size} companies show the same ${provider} problem at once, which points to the provider rather than any one company.`,
      nextAction: `Check ${provider}'s status and Selestial's credentials for it. Each company's own incident shows its impact.`,
      source: { table: "incidents", id: row._id },
      since: row.firstSeenAt,
      attempts: row.recoveryAttempts,
    }));
    const parentId = await upsertIncident(ctx, check, key, findings, now);
    for (const row of members) {
      if (row.parentId === parentId) continue;
      await ctx.db.patch(row._id, { parentId });
      await note(ctx, row._id, "grouped", `Grouped with ${companies.size - 1} other companies showing the same ${provider} problem.`);
    }
  }
  // A shared incident with no open company incident left is over.
  for (const parent of open.filter((row) => row.kind === "provider_outage")) {
    const child = await ctx.db
      .query("incidents")
      .withIndex("by_parent", (q) => q.eq("parentId", parent._id).eq("resolvedAt", 0))
      .first();
    if (child) continue;
    await resolveIncident(ctx, parent, { by: "system", resolution: "Every company's incident under it is resolved.", evidence: `No open company incident pointed at it at ${new Date(now).toISOString()}.` }, now);
    resolved += 1;
  }
  return resolved;
}
