/**
 * The one door the Dispatch agent's tools are called through. Internal only: no browser and no link can
 * reach it. A call with an idempotency key that was already carried out returns the first answer and
 * does nothing again, so a retried step never sends a second offer.
 */
import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { managerQuery } from "./lib/builders";
import { runTool, TOOL_NAMES, type ToolName } from "./lib/dispatch/tools";
import { literals } from "./lib/statuses";

const inputValidator = v.object({ jobId: v.optional(v.id("jobs")), assignmentId: v.optional(v.id("assignments")), cleanerId: v.optional(v.id("cleaners")), text: v.optional(v.string()) });

export const run = internalMutation({
  args: { companyId: v.id("companies"), tool: literals(TOOL_NAMES), input: inputValidator, idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId);
    if (!company) throw new Error("Unknown company");
    const earlier = await ctx.db
      .query("toolRuns")
      .withIndex("by_company_key", (q) => q.eq("companyId", args.companyId).eq("idempotencyKey", args.idempotencyKey))
      .first();
    if (earlier) return { outcome: earlier.outcome, authorization: earlier.authorization, result: JSON.parse(earlier.result) as Record<string, unknown>, repeated: true };
    const answer = await runTool(ctx, company, args.tool as ToolName, args.input);
    await ctx.db.insert("toolRuns", {
      companyId: args.companyId,
      tool: args.tool,
      idempotencyKey: args.idempotencyKey,
      actor: { kind: "agent", agent: "dispatch" },
      authorization: answer.authorization,
      input: JSON.stringify(args.input),
      outcome: answer.outcome,
      result: JSON.stringify(answer.result).slice(0, 8000),
      jobId: answer.jobId,
      assignmentId: answer.assignmentId,
      at: Date.now(),
    });
    return { outcome: answer.outcome, authorization: answer.authorization, result: answer.result, repeated: false };
  },
});

/** The agent's actions on one job: what it was allowed, what it was given and what came of it. */
export const forJob = managerQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("toolRuns")
      .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", args.jobId))
      .order("desc")
      .take(100);
    return rows.map((row) => ({ toolRunId: row._id, tool: row.tool, authorization: row.authorization, outcome: row.outcome, input: row.input, result: row.result, assignmentId: row.assignmentId ?? null, at: row.at }));
  },
});
