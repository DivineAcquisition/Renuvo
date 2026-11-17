/**
 * Research & Insights for Services & Pricing. Research proposes; it never changes a price. A finding can
 * be attached to a service's draft as evidence, which travels with the draft into its review.
 *
 * Owners and Managers start research and add sources. Web research costs one research brief (10 credits
 * under the 2026-11b rate card); everything else here is free.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { finishExecution } from "./lib/billing/executions";
import { postToConversation } from "./lib/chat/state";
import { reserveExecution } from "./lib/billing/reserve";
import { companyQuery, managerMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { isManager } from "./lib/roles";
import { priceSummary } from "./lib/services/engine";
import { BASIS_LABELS, comparableRange, extractJson, rangeStatement, screen } from "./lib/services/research";
import { insertOwnerSource, refreshSourcesSummary, startBrief, type OwnerSource } from "./lib/services/researchStart";
import { categoryValidator } from "./lib/services/spec";
import { draftOf, ownedService, publishedSpec } from "./lib/services/store";
import { ResearchError, searchAndWrite } from "./lib/services/webResearch";

const ownerSourceValidator = v.object({
  url: v.optional(v.string()),
  title: v.string(),
  publisher: v.optional(v.string()),
  geography: v.string(),
  excerpt: v.string(),
  priceCents: v.union(v.number(), v.null()),
  priceKind: v.union(v.literal("advertised_starting"), v.literal("estimated"), v.literal("firm_published"), v.null()),
  unit: v.string(),
  comparable: v.boolean(),
  limitation: v.string(),
});

async function ownedBrief(ctx: { db: { get: (id: Id<"researchBriefs">) => Promise<Doc<"researchBriefs"> | null> }; companyId: Id<"companies"> }, briefId: Id<"researchBriefs">) {
  const brief = await ctx.db.get(briefId);
  if (!brief || brief.companyId !== ctx.companyId) throw userError("Not found.", "not_found");
  return brief;
}

/** Every brief, newest first. */
export const briefs = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("researchBriefs")
      .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(50);
    return {
      canStart: isManager(ctx.role),
      briefs: rows.map((row) => ({ id: row._id, question: row.question, geography: row.geography, origin: row.origin, mode: row.mode, state: row.state, blocked: row.blocked ?? null, findings: row.findings.length, createdAt: row.createdAt, finishedAt: row.finishedAt ?? null })),
    };
  },
});

/** One brief with its sources, findings and summary, each finding labeled by what kind of evidence it is. */
export const brief = companyQuery({
  args: { briefId: v.id("researchBriefs") },
  handler: async (ctx, args) => {
    const row = await ownedBrief(ctx, args.briefId);
    const sources = await ctx.db
      .query("researchSources")
      .withIndex("by_company_brief", (q) => q.eq("companyId", ctx.companyId).eq("briefId", row._id))
      .take(100);
    return {
      id: row._id,
      question: row.question,
      geography: row.geography,
      category: row.category ?? null,
      serviceId: row.serviceId ?? null,
      origin: row.origin,
      mode: row.mode,
      state: row.state,
      blocked: row.blocked ?? null,
      summary: row.summary ?? null,
      findings: row.findings.map((f) => ({ ...f, basisLabel: BASIS_LABELS[f.basis].label, basisMeaning: BASIS_LABELS[f.basis].meaning, sources: f.sourceIds.map((id) => sources.findIndex((s) => s._id === id) + 1).filter((n) => n > 0) })),
      sources: sources.map((s, i) => ({ number: i + 1, id: s._id, origin: s.origin, url: s.url ?? null, title: s.title, publisher: s.publisher ?? null, retrievedAt: s.retrievedAt, geography: s.geography, excerpt: s.excerpt, limitation: s.limitation, priceKind: s.priceKind, priceCents: s.priceCents, unit: s.unit })),
      createdAt: row.createdAt,
      finishedAt: row.finishedAt ?? null,
      canEdit: isManager(ctx.role),
      /** The conversation that started it, when it is this member's own (conversations are private). */
      conversationId: row.conversationId && (await ctx.db.get(row.conversationId))?.createdBy === ctx.member._id ? row.conversationId : null,
    };
  },
});

/** Starts a brief. With `web`, Selestial searches public pages (a research brief's credits); without, it uses only the sources given and the company's own records. */
export const start = managerMutation({
  args: { question: v.string(), geography: v.string(), category: v.optional(categoryValidator), serviceId: v.optional(v.id("services")), web: v.boolean(), sources: v.array(ownerSourceValidator) },
  handler: async (ctx, args) => {
    if (args.serviceId) await ownedService(ctx, ctx.companyId, args.serviceId);
    try {
      const started = await startBrief(ctx, { company: ctx.company, member: ctx.member, actor: byMember(ctx), question: args.question, geography: args.geography, category: args.category, serviceId: args.serviceId, origin: "member", web: args.web, sources: args.sources as OwnerSource[] });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "service.research_started", actor: byMember(ctx), subject: { table: "researchBriefs", id: started.briefId }, data: { web: started.web } });
      return started;
    } catch (error) {
      if (error instanceof Error && !(error as { data?: unknown }).data) throw userError(error.message);
      throw error;
    }
  },
});

/** Adds a source a person found (an advertised price, a page, a flyer). Its price is labeled as the person says it is. */
export const addSource = managerMutation({
  args: { briefId: v.id("researchBriefs"), source: ownerSourceValidator },
  handler: async (ctx, args) => {
    const brief = await ownedBrief(ctx, args.briefId);
    try {
      await insertOwnerSource(ctx, ctx.companyId, brief._id, args.source as OwnerSource);
    } catch (error) {
      throw userError(error instanceof Error ? error.message : "That source could not be added.");
    }
    await refreshSourcesSummary(ctx, (await ctx.db.get(brief._id))!);
    return null;
  },
});

/**
 * Attaches a finding (or the whole brief) to a service's draft as evidence. It proposes; it changes no
 * price. If the service is live with no draft, a draft is opened from the live version.
 */
export const attachToDraft = managerMutation({
  args: { briefId: v.id("researchBriefs"), findingId: v.optional(v.string()), serviceId: v.id("services") },
  handler: async (ctx, args) => {
    const brief = await ownedBrief(ctx, args.briefId);
    const service = await ownedService(ctx, ctx.companyId, args.serviceId);
    const finding = args.findingId ? brief.findings.find((f) => f.id === args.findingId) : null;
    if (args.findingId && !finding) throw userError("That finding is not in this brief.");
    let draft = await draftOf(ctx, ctx.companyId, service._id);
    if (!draft) {
      const live = await publishedSpec(ctx, service);
      if (!live) throw userError("This service has no draft or live version.");
      const now = Date.now();
      const id = await ctx.db.insert("serviceDrafts", { companyId: ctx.companyId, serviceId: service._id, spec: live.spec, revision: 1, baseVersion: live.version, step: "pricing", updatedBy: byMember(ctx), updatedAt: now, createdAt: now, via: "workspace" });
      draft = (await ctx.db.get(id))!;
    }
    const item = finding
      ? { kind: "research" as const, label: BASIS_LABELS[finding.basis].label, detail: `${finding.statement} (${finding.limitation})`.slice(0, 600), ref: brief._id }
      : { kind: "research" as const, label: "Research brief", detail: `${brief.question} — ${brief.summary?.comparable[0] ?? "see the brief for what was found and what is uncertain"}`.slice(0, 600), ref: brief._id };
    const evidence = [...(draft.evidence ?? []).filter((e) => !(e.ref === item.ref && e.detail === item.detail)), item].slice(-20);
    await ctx.db.patch(draft._id, { evidence });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "service.research_attached", actor: byMember(ctx), subject: { table: "services", id: service._id }, data: { brief: brief._id } });
    return { serviceId: service._id };
  },
});

// ── The billed web research, run by an action ───────────────────────────────────────────────────────

export const workContext = internalQuery({
  args: { briefId: v.id("researchBriefs") },
  handler: async (ctx, args) => {
    const brief = await ctx.db.get(args.briefId);
    if (!brief) return null;
    let service: string | null = null;
    if (brief.serviceId) {
      const row = await ctx.db.get(brief.serviceId);
      const live = row ? await publishedSpec(ctx, row) : null;
      const draft = row ? await draftOf(ctx, brief.companyId, row._id) : null;
      const spec = draft?.spec ?? live?.spec ?? null;
      if (spec) service = `${spec.name}: ${spec.summary}\nIncludes: ${spec.included.map((i) => i.label).join("; ") || "not listed"}\nExcludes: ${spec.excluded.join("; ") || "not listed"}\nPrice now: ${priceSummary(spec)}`;
    }
    return { state: brief.state, executionId: brief.executionId ?? null, question: brief.question, geography: brief.geography, service };
  },
});

export const markRunning = internalMutation({
  args: { briefId: v.id("researchBriefs") },
  handler: async (ctx, args) => {
    const brief = await ctx.db.get(args.briefId);
    if (!brief || brief.state !== "queued") return false;
    await ctx.db.patch(brief._id, { state: "running" });
    return true;
  },
});

/** Ends a brief that could not search: the free parts stay, the hold is released, and the reason is shown. */
/** The conversation that started a brief hears how it ended, so the person can carry on there. */
async function tellConversation(ctx: MutationCtx, briefId: Id<"researchBriefs">) {
  const brief = await ctx.db.get(briefId);
  if (!brief?.conversationId) return;
  const open = `[open the brief](/app/services/research/${brief._id})`;
  if (brief.state === "ready" && brief.mode === "web") {
    const range = brief.findings.find((f) => f.id === "range");
    const text = `**Research ready:** ${brief.question}\n\n${brief.findings.length} finding${brief.findings.length === 1 ? "" : "s"}${range ? `. ${range.statement}` : "."}\n\nAsk me what it means for your prices, or ${open}.`;
    await postToConversation(ctx, brief.conversationId, [{ kind: "text", text }]);
  } else {
    const why = brief.blocked ?? "The research did not finish.";
    await postToConversation(ctx, brief.conversationId, [{ kind: "notice", tone: "warning", text: `Research on "${brief.question.slice(0, 120)}" did not search the web: ${why}` }]);
    await postToConversation(ctx, brief.conversationId, [{ kind: "text", text: `What it has from your own records is in the brief: ${open}.` }]);
  }
}

export const endWithout = internalMutation({
  args: { briefId: v.id("researchBriefs"), reason: v.string(), failed: v.boolean() },
  handler: async (ctx, args) => {
    const brief = await ctx.db.get(args.briefId);
    if (!brief) return null;
    if (brief.executionId) await finishExecution(ctx, brief.executionId, { ended: "failed" });
    await ctx.db.patch(brief._id, { state: args.failed ? "failed" : "ready", mode: "sources", blocked: `${args.reason} This brief uses your sources and your own records only.`, finishedAt: Date.now() });
    await refreshSourcesSummary(ctx, (await ctx.db.get(brief._id))!);
    await recordEvent(ctx, { companyId: brief.companyId, type: "service.research_failed", actor: { kind: "system" }, subject: { table: "researchBriefs", id: brief._id } });
    await tellConversation(ctx, brief._id);
    return null;
  },
});

/** Stores what the search found, after code has screened it, and charges the one brief. */
export const complete = internalMutation({
  args: { briefId: v.id("researchBriefs"), text: v.string(), pages: v.array(v.object({ url: v.string(), title: v.union(v.string(), v.null()), pageAge: v.union(v.string(), v.null()) })) },
  handler: async (ctx, args) => {
    const brief = await ctx.db.get(args.briefId);
    if (!brief || brief.state !== "running") return null;
    const screened = screen(extractJson(args.text), args.pages);
    if (!screened) {
      if (brief.executionId) await finishExecution(ctx, brief.executionId, { ended: "failed" });
      await ctx.db.patch(brief._id, { state: "failed", mode: "sources", blocked: "The research answer could not be read, so nothing from it was kept. Nothing was charged.", finishedAt: Date.now() });
      await refreshSourcesSummary(ctx, (await ctx.db.get(brief._id))!);
      await tellConversation(ctx, brief._id);
      return null;
    }
    const now = Date.now();
    const ids = new Map<string, Id<"researchSources">>();
    for (const source of screened.sources) {
      const id = await ctx.db.insert("researchSources", { companyId: brief.companyId, briefId: brief._id, origin: "web", url: source.url, title: source.title, ...(source.publisher ? { publisher: source.publisher } : {}), retrievedAt: now, geography: source.geography, excerpt: source.excerpt, limitation: source.limitation, priceKind: null, priceCents: null, unit: "" });
      ids.set(source.url, id);
    }
    const web = screened.findings.map((f, i) => ({ id: `web:${i}`, statement: f.statement, basis: f.basis, sourceIds: f.sourceUrls.map((u) => ids.get(u)).filter((id): id is Id<"researchSources"> => id !== undefined), geography: f.geography || brief.geography, scope: f.scope, limitation: f.limitation, priceCents: f.priceCents, unit: f.unit, comparable: f.comparable }));
    const findings = [...brief.findings, ...web];
    const range = comparableRange(findings);
    if (range) findings.push({ id: "range", statement: rangeStatement(range), basis: range.basis, sourceIds: [...new Set(web.filter((f) => f.comparable && f.priceCents !== null).flatMap((f) => f.sourceIds))], geography: brief.geography, scope: "Comparable services only", limitation: "Computed by Selestial from the prices above. Advertised prices are not what customers pay.", priceCents: null, unit: range.unit, comparable: true });
    const uncertain = [...screened.summary.uncertain, ...(range ? [] : ["Fewer than three comparable prices share a unit, so no typical range is given."]), ...(screened.dropped ? [`${screened.dropped} statement${screened.dropped === 1 ? " was" : "s were"} dropped because no retrieved page supported ${screened.dropped === 1 ? "it" : "them"}.`] : [])];
    await ctx.db.patch(brief._id, { state: "ready", findings, summary: { ...screened.summary, comparable: range ? [rangeStatement(range), ...screened.summary.comparable] : screened.summary.comparable, uncertain }, finishedAt: now });
    if (brief.executionId) await finishExecution(ctx, brief.executionId, { completedUnits: 1 });
    await recordEvent(ctx, { companyId: brief.companyId, type: "service.research_ready", actor: { kind: "system" }, subject: { table: "researchBriefs", id: brief._id }, data: { sources: screened.sources.length, findings: web.length } });
    await tellConversation(ctx, brief._id);
    return null;
  },
});

export const run = internalAction({
  args: { briefId: v.id("researchBriefs") },
  handler: async (ctx, args) => {
    const work = await ctx.runQuery(internal.servicesResearch.workContext, { briefId: args.briefId });
    if (!work || work.state !== "queued" || !work.executionId) return;
    if (!(await ctx.runMutation(internal.servicesResearch.markRunning, { briefId: args.briefId }))) return;
    const reserved = await reserveExecution(ctx, work.executionId);
    if (!reserved.ok) {
      await ctx.runMutation(internal.servicesResearch.endWithout, { briefId: args.briefId, reason: `Web research did not run: ${reserved.message}`, failed: false });
      return;
    }
    try {
      const result = await searchAndWrite({ question: work.question, geography: work.geography, service: work.service });
      await ctx.runMutation(internal.servicesResearch.complete, { briefId: args.briefId, text: result.text.slice(0, 200_000), pages: result.pages.slice(0, 100).map((p) => ({ url: p.url.slice(0, 1000), title: p.title?.slice(0, 300) ?? null, pageAge: p.pageAge?.slice(0, 60) ?? null })) });
    } catch (error) {
      await ctx.runMutation(internal.servicesResearch.endWithout, { briefId: args.briefId, reason: error instanceof ResearchError ? error.message : "The research could not be finished. Nothing was charged.", failed: true });
    }
  },
});

