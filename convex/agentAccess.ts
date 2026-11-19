/**
 * Early access to agents that are not released yet (Marketing, Quality, Customer Care, Team Coordinator).
 *
 * Anyone in the company can ask, once per agent, and say what they would use it for. Asking records the
 * company's interest for Selestial's team; it does not turn anything on, change a plan or buy anything.
 * Selestial staff read the requests and mark the companies they invite to try an agent first.
 */
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { PLANNED_AGENT_IDS, type PlannedAgentId } from "./lib/agentAccess/schema";
import { companyMutation, companyQuery, staffMutation, staffQuery } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { allow } from "./lib/rateLimit";

const HOUR = 60 * 60 * 1000;

function plannedAgent(agent: string): PlannedAgentId {
  if (!(PLANNED_AGENT_IDS as readonly string[]).includes(agent)) throw userError("That agent is already available, or doesn't exist.");
  return agent as PlannedAgentId;
}

/** This company's request for one agent, as the coming-soon page shows it. */
export const mine = companyQuery({
  args: { agent: v.string() },
  handler: async (ctx, args) => {
    const agent = plannedAgent(args.agent);
    const row = await ctx.db
      .query("agentAccessRequests")
      .withIndex("by_company_agent", (q) => q.eq("companyId", ctx.companyId).eq("agent", agent))
      .first();
    if (!row) return { requested: false as const, mine: false, people: 0, firstAt: null, status: null };
    const names: string[] = [];
    for (const requester of row.requesters.slice(0, 5)) {
      const member = await ctx.db.get(requester.memberId);
      if (member) names.push(member.name);
    }
    return {
      requested: true as const,
      mine: row.requesters.some((r) => r.memberId === ctx.member._id),
      people: row.requesters.length,
      names,
      firstAt: row.firstAt,
      status: row.status,
    };
  },
});

/** Ask for early access, or add your name and what you'd use it for to the company's request. */
export const request = companyMutation({
  args: { agent: v.string(), uses: v.array(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const agent = plannedAgent(args.agent);
    if (!(await allow(ctx, `agent-access:${ctx.member._id}`, 10, HOUR))) throw userError("That's a lot of requests in an hour. Try again a little later.");
    const uses = [...new Set(args.uses.map((use) => use.trim()).filter(Boolean))].slice(0, 8).map((use) => use.slice(0, 80));
    const note = args.note?.trim() ? args.note.trim().slice(0, 500) : undefined;
    const now = Date.now();
    const entry = { memberId: ctx.member._id, at: now, uses, ...(note ? { note } : {}) };
    const row = await ctx.db
      .query("agentAccessRequests")
      .withIndex("by_company_agent", (q) => q.eq("companyId", ctx.companyId).eq("agent", agent))
      .first();
    let id: Doc<"agentAccessRequests">["_id"];
    if (row) {
      // Asking again updates your own line; it never adds you twice.
      const requesters = [...row.requesters.filter((r) => r.memberId !== ctx.member._id), entry].slice(-50);
      await ctx.db.patch(row._id, { requesters, lastAt: now });
      id = row._id;
    } else {
      id = await ctx.db.insert("agentAccessRequests", { companyId: ctx.companyId, agent, requesters: [entry], firstAt: now, lastAt: now, status: "requested" });
    }
    await recordEvent(ctx, { companyId: ctx.companyId, type: "agent_access.requested", actor: byMember(ctx), subject: { table: "agentAccessRequests", id }, data: { agent, uses: uses.length } });
    return null;
  },
});

/** Take your name off the company's request. The request goes when nobody is left on it. */
export const withdraw = companyMutation({
  args: { agent: v.string() },
  handler: async (ctx, args) => {
    const agent = plannedAgent(args.agent);
    const row = await ctx.db
      .query("agentAccessRequests")
      .withIndex("by_company_agent", (q) => q.eq("companyId", ctx.companyId).eq("agent", agent))
      .first();
    if (!row) return null;
    const requesters = row.requesters.filter((r) => r.memberId !== ctx.member._id);
    if (requesters.length === row.requesters.length) return null;
    if (requesters.length === 0) await ctx.db.delete(row._id);
    else await ctx.db.patch(row._id, { requesters });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "agent_access.withdrawn", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { agent } });
    return null;
  },
});

// ── Selestial staff ──────────────────────────────────────────────────────────────────────────────

/** Every company's requests, newest first, with what they'd use the agent for. */
export const requests = staffQuery({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const agent of PLANNED_AGENT_IDS) {
      const rows = await ctx.db
        .query("agentAccessRequests")
        .withIndex("by_agent_last", (q) => q.eq("agent", agent))
        .order("desc")
        .take(200);
      for (const row of rows) {
        const company = await ctx.db.get(row.companyId);
        out.push({
          id: row._id,
          agent,
          company: company?.name ?? "A company",
          plan: company?.plan ?? null,
          people: row.requesters.length,
          uses: [...new Set(row.requesters.flatMap((r) => r.uses))],
          notes: row.requesters.flatMap((r) => (r.note ? [r.note] : [])),
          firstAt: row.firstAt,
          lastAt: row.lastAt,
          status: row.status,
          staffNote: row.staffNote ?? null,
        });
      }
    }
    return out.sort((a, b) => b.lastAt - a.lastAt);
  },
});

/** Staff record their answer: invited to try it early, or not this time. */
export const answer = staffMutation({
  args: { id: v.id("agentAccessRequests"), status: v.union(v.literal("invited"), v.literal("declined"), v.literal("requested")), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw userError("Not found.", "not_found");
    await ctx.db.patch(row._id, { status: args.status, ...(args.note?.trim() ? { staffNote: args.note.trim().slice(0, 300) } : {}) });
    await recordEvent(ctx, { companyId: row.companyId, type: `agent_access.${args.status}`, actor: { kind: "system" }, subject: { table: "agentAccessRequests", id: row._id }, data: { agent: row.agent, staff: ctx.staff._id } });
    return null;
  },
});
