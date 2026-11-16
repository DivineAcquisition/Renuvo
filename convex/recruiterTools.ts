/**
 * The one door the Recruiter agent's tools are called through. Internal only: no browser, no link and no
 * email can reach it. A call whose idempotency key was already carried out returns the first answer and
 * does nothing again, so a retried step never sends a second invitation.
 */
import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { owned } from "./lib/access";
import { managerQuery } from "./lib/builders";
import { runTool, TOOL_NAMES, type ToolName } from "./lib/recruiter/tools";
import { literals } from "./lib/statuses";

const inputValidator = v.object({
  applicationId: v.optional(v.id("applications")),
  sourceMessageId: v.optional(v.id("sourceMessages")),
  slotId: v.optional(v.id("interviewSlots")),
  text: v.optional(v.string()),
  startConditions: v.optional(v.string()),
  expectations: v.optional(v.string()),
});

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
      actor: { kind: "agent", agent: "recruiter" },
      authorization: answer.authorization,
      input: JSON.stringify(args.input).slice(0, 4000),
      outcome: answer.outcome,
      result: JSON.stringify(answer.result).slice(0, 8000),
      applicationId: answer.applicationId,
      at: Date.now(),
    });
    return { outcome: answer.outcome, authorization: answer.authorization, result: answer.result, repeated: false };
  },
});

/** The agent's actions on one application: what it was allowed, what it was given and what came of it. */
export const forApplication = managerQuery({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const application = await owned(ctx, args.applicationId);
    const rows = await ctx.db
      .query("toolRuns")
      .withIndex("by_company_application", (q) => q.eq("companyId", ctx.companyId).eq("applicationId", application._id))
      .order("desc")
      .take(100);
    return rows.map((row) => ({ toolRunId: row._id, tool: row.tool, authorization: row.authorization, outcome: row.outcome, input: row.input, result: row.result, at: row.at }));
  },
});
