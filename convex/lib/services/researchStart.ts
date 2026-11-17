/**
 * Starting a research brief, from a mutation. The parts that need no AI are done here, at once and for
 * free: the sources a person supplied, and what the company's own completed visits show. Web research is
 * opened as a piece of billed AI work (10 credits under the 2026-11b card) and run by an action; if it
 * cannot run, the brief says why and keeps the free parts.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { openExecution } from "../billing/executions";
import type { Actor } from "../events";
import { providerConfigured } from "../ai/registry";
import { comparableRange, companyFindings, rangeStatement, type VisitFact } from "./research";
import type { Basis, Context } from "./schema";
import { CATEGORY_LABELS, type Category } from "./spec";

export type OwnerSource = { url?: string; title: string; publisher?: string; geography: string; excerpt: string; priceCents: number | null; priceKind: Extract<Basis, "advertised_starting" | "estimated" | "firm_published"> | null; unit: string; comparable: boolean; limitation: string };

const YEAR = 365 * 24 * 60 * 60 * 1000;

/** Completed visits from the last year: what they were booked at, and how long the crew was on site. */
export async function visitFacts(ctx: MutationCtx, companyId: Id<"companies">): Promise<VisitFact[]> {
  const since = Date.now() - YEAR;
  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_company_status_start", (q) => q.eq("companyId", companyId).eq("status", "completed").gte("startsAt", since))
    .order("desc")
    .take(200);
  const out: VisitFact[] = [];
  for (const job of jobs) {
    const rows = await ctx.db
      .query("assignments")
      .withIndex("by_company_job", (q) => q.eq("companyId", companyId).eq("jobId", job._id))
      .take(12);
    const timed = rows.filter((row) => row.checkIn && row.completion);
    out.push({ serviceType: job.serviceType, priceCents: job.priceCents ?? null, minutesOnSite: timed.length ? Math.max(...timed.map((row) => (row.completion!.submittedAt - row.checkIn!.at) / 60_000)) : null });
  }
  return out;
}

export async function insertOwnerSource(ctx: MutationCtx, companyId: Id<"companies">, briefId: Id<"researchBriefs">, source: OwnerSource) {
  const clip = (value: string | undefined, max: number) => (value ?? "").trim().slice(0, max);
  const url = clip(source.url, 500);
  if (url && !/^https?:\/\//i.test(url)) throw new Error("A source's address must start with http:// or https://.");
  const sourceId = await ctx.db.insert("researchSources", {
    companyId,
    briefId,
    origin: "owner",
    ...(url ? { url } : {}),
    title: clip(source.title, 200) || url || "A source you supplied",
    ...(source.publisher?.trim() ? { publisher: clip(source.publisher, 120) } : {}),
    retrievedAt: Date.now(),
    geography: clip(source.geography, 120),
    excerpt: clip(source.excerpt, 300),
    limitation: clip(source.limitation, 300) || "Supplied by your team; Selestial did not read the page itself.",
    priceKind: source.priceCents === null ? null : (source.priceKind ?? "estimated"),
    priceCents: source.priceCents === null ? null : Math.max(0, Math.round(source.priceCents)),
    unit: clip(source.unit, 40) || "per visit",
  });
  return sourceId;
}

/** Recomputes the brief's code-made parts: the range (if three comparable prices share a unit) and the summary. */
export async function refreshSourcesSummary(ctx: MutationCtx, brief: Doc<"researchBriefs">) {
  const sources = await ctx.db
    .query("researchSources")
    .withIndex("by_company_brief", (q) => q.eq("companyId", brief.companyId).eq("briefId", brief._id))
    .take(100);
  const kept = brief.findings.filter((f) => f.id !== "range" && !f.id.startsWith("owner:"));
  const owner = sources
    .filter((s) => s.origin === "owner" && s.priceCents !== null && s.priceKind !== null)
    .map((s) => ({ id: `owner:${s._id}`, statement: `${s.title}: ${s.priceKind === "advertised_starting" ? "from " : ""}$${((s.priceCents ?? 0) / 100).toFixed(2)} ${s.unit}.`, basis: s.priceKind as Basis, sourceIds: [s._id], geography: s.geography, scope: s.excerpt.slice(0, 300), limitation: s.limitation, priceCents: s.priceCents, unit: s.unit, comparable: true }));
  const findings = [...kept, ...owner];
  const range = comparableRange(findings);
  if (range) findings.push({ id: "range", statement: rangeStatement(range), basis: range.basis, sourceIds: [...new Set(findings.filter((f) => f.comparable && f.priceCents !== null).flatMap((f) => f.sourceIds))], geography: brief.geography, scope: "Comparable services only", limitation: "Computed by Selestial from the prices above. Advertised prices are not what customers pay.", priceCents: null, unit: range.unit, comparable: true });
  const ownerCount = sources.filter((s) => s.origin === "owner").length;
  const company = findings.filter((f) => f.basis === "company_data");
  const summary = brief.mode === "web" && brief.summary
    ? { ...brief.summary, uncertain: [...brief.summary.uncertain.filter((u) => !u.startsWith("Fewer than three")), ...(range ? [] : ["Fewer than three comparable prices share a unit, so no typical range is given."])] }
    : {
        found: [`${ownerCount} source${ownerCount === 1 ? "" : "s"} supplied by your team.`, ...(company.length ? [`${company.length} of your services have completed visits in the last year.`] : ["No completed visits in the last year to learn from yet."])],
        comparable: range ? [rangeStatement(range)] : [],
        uncertain: [...(brief.blocked ? [brief.blocked] : []), ...(range ? [] : ["Fewer than three comparable prices share a unit, so no typical range is given."]), "Selestial did not search the web for this brief."],
        options: [],
      };
  await ctx.db.patch(brief._id, { findings, summary });
}

/**
 * Creates a brief. Free parts are filled in now. When web research is asked for and can run, the billed
 * work is opened and the action is scheduled; when it cannot, the brief records why, in words.
 */
export async function startBrief(
  ctx: MutationCtx,
  input: { company: Doc<"companies">; member: Doc<"members"> | null; actor: Actor; question: string; geography: string; category?: Category; serviceId?: Id<"services">; origin: "setup" | "member" | "chat"; web: boolean; sources: OwnerSource[]; conversationId?: Id<"conversations"> },
): Promise<{ briefId: Id<"researchBriefs">; web: boolean; blocked: string | null }> {
  const now = Date.now();
  const question = input.question.trim().slice(0, 500);
  if (!question) throw new Error("Say what the research should answer.");
  if (input.sources.length > 20) throw new Error("Up to 20 sources at a time.");
  const briefId = await ctx.db.insert("researchBriefs", {
    companyId: input.company._id,
    question,
    geography: input.geography.trim().slice(0, 200),
    ...(input.category ? { category: input.category } : {}),
    ...(input.serviceId ? { serviceId: input.serviceId } : {}),
    origin: input.origin,
    mode: input.web ? "web" : "sources",
    state: input.web ? "queued" : "ready",
    findings: [],
    createdBy: input.actor,
    createdAt: now,
    ...(input.web ? {} : { finishedAt: now }),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
  });
  for (const source of input.sources) await insertOwnerSource(ctx, input.company._id, briefId, source);

  // The company's own completed visits, counted in code.
  const facts = companyFindings(await visitFacts(ctx, input.company._id));
  if (facts.length) {
    const sourceId = await ctx.db.insert("researchSources", { companyId: input.company._id, briefId, origin: "company", title: "Your completed visits, last 12 months", retrievedAt: now, geography: "Your service area", excerpt: "", limitation: "Only visits recorded in Selestial.", priceKind: "company_data", priceCents: null, unit: "per visit" });
    await ctx.db.patch(briefId, { findings: facts.map((f, i) => ({ id: `company:${i}`, statement: f.statement, basis: "company_data" as const, sourceIds: [sourceId], geography: "Your service area", scope: f.scope, limitation: f.limitation, priceCents: f.priceCents, unit: f.unit, comparable: false })) });
  }

  let blocked: string | null = null;
  if (input.web) {
    if (!providerConfigured("anthropic")) blocked = "Web research isn't available right now: no AI model is connected. This brief uses your sources and your own records only.";
    else {
      const opened = await openExecution(ctx, {
        company: input.company,
        key: `research:${briefId}`,
        agent: "services",
        task: "research_brief",
        units: 1,
        autonomous: input.origin === "setup",
        ...(input.member ? { memberId: input.member._id } : {}),
        source: { table: "researchBriefs", id: briefId },
        origin: input.origin === "setup" ? "automatic" : input.origin === "chat" ? "chat" : "member",
        link: { label: "Research & Insights", path: "/app/services/research" },
      });
      if (!opened.ok) blocked = `Web research did not run: ${opened.message} This brief uses your sources and your own records only.`;
      else {
        await ctx.db.patch(briefId, { executionId: opened.executionId });
        await ctx.scheduler.runAfter(0, internal.servicesResearch.run, { briefId });
      }
    }
    if (blocked) await ctx.db.patch(briefId, { mode: "sources", state: "ready", blocked, finishedAt: now });
  }
  const brief = (await ctx.db.get(briefId))!;
  if (brief.mode === "sources") await refreshSourcesSummary(ctx, brief);
  return { briefId, web: input.web && !blocked, blocked };
}

/** The research setup starts on its own (the owner's decision of November 16, 2026). */
export async function startSetupResearch(ctx: MutationCtx, company: Doc<"companies">, member: Doc<"members">, context: Context): Promise<{ briefId: Id<"researchBriefs"> }> {
  const categories = context.categories.length ? context.categories.map((c) => CATEGORY_LABELS[c].toLowerCase()).join(", ") : "residential cleaning";
  const started = await startBrief(ctx, {
    company,
    member,
    actor: { kind: "system" },
    question: `What do comparable cleaning businesses in ${context.serviceAreas.trim()} publish for ${categories}: what is included, how is it priced, and when do they require a walkthrough?`,
    geography: context.serviceAreas.trim(),
    ...(context.categories[0] ? { category: context.categories[0] } : {}),
    origin: "setup",
    web: true,
    sources: [],
  });
  return { briefId: started.briefId };
}
