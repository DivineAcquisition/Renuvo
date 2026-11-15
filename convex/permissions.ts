/**
 * Authority settings (brief, section 7). Only the Owner changes them. A level can never go past the
 * action's ceiling, and the things that always need a person are not settings at all.
 */
import { v } from "convex/values";

import { companyQuery, ownerMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { actionDef, ACTIONS, initialLevel, levelValidator, PERSON_ONLY, rank } from "./lib/permissionCatalog";
import { cents } from "./lib/text";

export const list = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("permissions")
      .withIndex("by_company_action", (q) => q.eq("companyId", ctx.companyId))
      .take(200);
    const byAction = new Map(rows.map((row) => [row.action, row]));
    return {
      pausedAgents: ctx.company.pausedAgents,
      actions: ACTIONS.map((def) => {
        const row = byAction.get(def.key);
        return {
          key: def.key,
          agent: def.agent,
          label: def.label,
          level: row?.level ?? initialLevel(def),
          changed: Boolean(row),
          standard: def.standard,
          ceiling: def.ceiling,
          money: def.money,
          perActionCents: row?.perActionCents ?? null,
          perDayCents: row?.perDayCents ?? null,
        };
      }),
      personOnly: PERSON_ONLY,
    };
  },
});

export const set = ownerMutation({
  args: {
    action: v.string(),
    level: levelValidator,
    perActionCents: v.optional(v.number()),
    perDayCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (PERSON_ONLY.some((entry) => entry.key === args.action)) throw userError("This always needs a person. It cannot be handed to an agent.");
    const def = actionDef(args.action);
    if (!def) throw userError("That is not an action an agent can take.");
    if (rank(args.level) > rank(def.ceiling)) throw userError("This action needs a person's approval every time, so it cannot be set higher than Propose.");
    const hasLimits = args.perActionCents !== undefined || args.perDayCents !== undefined;
    if (hasLimits && !def.money) throw userError("Limits apply only to actions that move money.");
    const perActionCents = args.perActionCents === undefined ? undefined : cents(args.perActionCents, "The limit per action");
    const perDayCents = args.perDayCents === undefined ? undefined : cents(args.perDayCents, "The limit per day");
    if (perActionCents !== undefined && perDayCents !== undefined && perActionCents > perDayCents) throw userError("The limit per action cannot be more than the limit per day.");
    // Money never runs without review until the Owner has said how much.
    if (def.money && rank(args.level) > rank("propose") && (perActionCents === undefined || perDayCents === undefined)) {
      throw userError("Set a limit per action and per day before letting an agent do this without approval.");
    }

    const fields = { level: args.level, perActionCents, perDayCents, updatedBy: ctx.member._id, updatedAt: Date.now() };
    const existing = await ctx.db
      .query("permissions")
      .withIndex("by_company_action", (q) => q.eq("companyId", ctx.companyId).eq("action", def.key))
      .unique();
    const from = existing?.level ?? initialLevel(def);
    const id = existing ? existing._id : await ctx.db.insert("permissions", { companyId: ctx.companyId, action: def.key, ...fields });
    if (existing) await ctx.db.patch(existing._id, fields);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "permission.changed", actor: byMember(ctx), subject: { table: "permissions", id }, data: { action: def.key, from, to: args.level } });
    return null;
  },
});
