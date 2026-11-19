/**
 * Each agent's first work during setup (lib/setup/work.ts holds the reviews).
 *
 * `start` records one run per agent as "preparing" and schedules it; the screen shows each run's real state
 * while it waits, and each result as soon as it is in. A run reads the company's records and contacts no
 * one, so it uses no credits and running it again is safe: a run already preparing is not started twice,
 * and a newer run simply becomes the one shown.
 *
 * An agent the plan doesn't include, or that the Owner paused, gets no review: its card says why instead.
 * Retention is not built; its review is a list for the owner, and nothing is drafted to be sent.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type QueryCtx } from "./_generated/server";
import { companyQuery, ownerMutation } from "./lib/builders";
import { agentReadiness } from "./lib/setup/readiness";
import { ACTIVITY, dispatchWork, recruiterWork, retentionWork, salesWork, type WorkAgent, type WorkOutcome } from "./lib/setup/work";

const AGENTS: WorkAgent[] = ["sales", "recruiter", "dispatch", "retention"];
const agentValidator = v.union(v.literal("sales"), v.literal("recruiter"), v.literal("dispatch"), v.literal("retention"));
/** A run still "preparing" after this long has stopped; another may start. */
const STALE = 5 * 60 * 1000;

async function latest(ctx: { db: QueryCtx["db"] }, companyId: Doc<"companies">["_id"], agent: WorkAgent) {
  return ctx.db
    .query("setupWork")
    .withIndex("by_company_agent", (q) => q.eq("companyId", companyId).eq("agent", agent))
    .order("desc")
    .first();
}

/** The newest run for each agent, with the agent's readiness beside it. */
export const status = companyQuery({
  args: {},
  handler: async (ctx) => {
    const readiness = await agentReadiness(ctx, ctx.company);
    const now = Date.now();
    return Promise.all(
      AGENTS.map(async (agent) => {
        const row = await latest(ctx, ctx.companyId, agent);
        const ready = readiness.find((r) => r.agent === agent)!;
        const stalled = row?.status === "preparing" && row.startedAt < now - STALE;
        return {
          agent,
          name: ready.name,
          readiness: { state: ready.state, words: ready.words },
          work: row
            ? {
                id: row._id,
                status: stalled ? ("failed" as const) : row.status,
                activity: row.activity,
                result: row.result ?? null,
                problem: stalled ? "This stopped before it finished. Prepare it again." : (row.problem ?? null),
                startedAt: row.startedAt,
                finishedAt: row.finishedAt ?? null,
              }
            : null,
        };
      }),
    );
  },
});

/** Prepares first work for every agent, or for one. A run already preparing is left to finish. */
export const start = ownerMutation({
  args: { agent: v.optional(agentValidator) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const started: WorkAgent[] = [];
    for (const agent of args.agent ? [args.agent] : AGENTS) {
      const row = await latest(ctx, ctx.companyId, agent);
      if (row?.status === "preparing" && row.startedAt > now - STALE) continue;
      const workId = await ctx.db.insert("setupWork", { companyId: ctx.companyId, agent, status: "preparing", activity: ACTIVITY[agent], requestedBy: ctx.member._id, startedAt: now });
      await ctx.scheduler.runAfter(0, internal.setupWork.prepare, { workId });
      started.push(agent);
    }
    return { started };
  },
});

export const prepare = internalMutation({
  args: { workId: v.id("setupWork") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.workId);
    if (!row || row.status !== "preparing") return null;
    const company = await ctx.db.get(row.companyId);
    if (!company) return null;
    const now = Date.now();
    const readiness = (await agentReadiness(ctx, company)).find((r) => r.agent === row.agent);
    let outcome: WorkOutcome;
    try {
      // Not on the plan, or paused by the Owner: no review, and the card says why.
      if (readiness && (readiness.state === "plan_needed" || readiness.state === "paused")) {
        const gap = readiness.gaps[0];
        outcome = {
          status: "waiting",
          result: { title: readiness.state === "paused" ? "Paused" : "Not on your plan", summary: readiness.words, used: [], uncertain: [], items: [], next: gap ? { words: gap.next, href: gap.href } : { words: "See your plan", href: "/app/settings/billing" }, counts: {} },
        };
      } else if (row.agent === "sales") outcome = await salesWork(ctx, company, readiness, now);
      else if (row.agent === "recruiter") outcome = await recruiterWork(ctx, company, readiness);
      else if (row.agent === "dispatch") outcome = await dispatchWork(ctx, company, readiness, now);
      else outcome = await retentionWork(ctx, company, now);
    } catch (error) {
      console.error("setup work failed", row.agent, error instanceof Error ? error.message : "unknown");
      await ctx.db.patch(row._id, { status: "failed", problem: "This couldn't be prepared. Nothing was changed; try again.", finishedAt: now });
      return null;
    }
    await ctx.db.patch(row._id, { status: outcome.status, result: outcome.result, finishedAt: now });
    // The first prepared work counts as setup's first artifact.
    const setup = await ctx.db
      .query("companySetups")
      .withIndex("by_company", (q) => q.eq("companyId", company._id))
      .first();
    if (setup && outcome.status === "ready_for_review" && setup.milestones.firstArtifactAt === undefined) await ctx.db.patch(setup._id, { milestones: { ...setup.milestones, firstArtifactAt: now } });
    return null;
  },
});
