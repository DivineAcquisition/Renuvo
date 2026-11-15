import { v } from "convex/values";

import { companyQuery, ownerMutation, signedInMutation, signedInQuery } from "./lib/builders";
import { isTimezone } from "./lib/availability";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { roleOf } from "./lib/roles";
import { agentValidator } from "./lib/statuses";
import { text } from "./lib/text";

function timezone(value: string): string {
  const zone = value.trim();
  if (!isTimezone(zone)) throw userError("That is not a time zone. Enter the IANA name of your zone.");
  return zone;
}

/** Whoever creates a company is its Owner. This is the only way an Owner comes to exist. */
export const create = signedInMutation({
  args: { name: v.string(), timezone: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const companyId = await ctx.db.insert("companies", { name: text(args.name, "Company name", 160), timezone: timezone(args.timezone), pausedAgents: [], createdAt: now });
    const memberId = await ctx.db.insert("members", { companyId, userId: ctx.userId, email: ctx.email, name: ctx.name, role: "owner", status: "active", createdAt: now });
    await recordEvent(ctx, { companyId, type: "company.created", actor: { kind: "member", memberId }, subject: { table: "companies", id: companyId } });
    return companyId;
  },
});

/** The companies the signed-in person belongs to. */
export const mine = signedInQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
      .take(50);
    const out: { companyId: string; name: string; role: string }[] = [];
    for (const row of rows) {
      if (row.status !== "active") continue;
      const company = await ctx.db.get(row.companyId);
      if (company) out.push({ companyId: company._id, name: company.name, role: roleOf(row.role) });
    }
    return out;
  },
});

export const get = companyQuery({
  args: {},
  handler: async (ctx) => ({
    id: ctx.company._id,
    name: ctx.company.name,
    timezone: ctx.company.timezone,
    pausedAgents: ctx.company.pausedAgents,
    role: ctx.role,
  }),
});

export const update = ownerMutation({
  args: { name: v.optional(v.string()), timezone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(ctx.companyId, {
      ...(args.name !== undefined ? { name: text(args.name, "Company name", 160) } : {}),
      ...(args.timezone !== undefined ? { timezone: timezone(args.timezone) } : {}),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "company.updated", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId } });
    return null;
  },
});

/** The owner can pause one agent or all of them (brief, section 7). */
export const setPausedAgents = ownerMutation({
  args: { agents: v.array(agentValidator) },
  handler: async (ctx, args) => {
    const pausedAgents = [...new Set(args.agents)];
    await ctx.db.patch(ctx.companyId, { pausedAgents });
    await recordEvent(ctx, {
      companyId: ctx.companyId,
      type: "company.agents_paused_changed",
      actor: byMember(ctx),
      subject: { table: "companies", id: ctx.companyId },
      data: { paused: pausedAgents.join(",") },
    });
    return null;
  },
});
