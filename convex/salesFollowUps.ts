/**
 * The Sales agent's reminders to customers, for the Sales workspace and for the timer that brings one
 * due. A reminder coming due does not send anything by itself: it starts a run, which checks the
 * conversation as it is then and either stops the reminder with the reason or writes the message and
 * routes it by the Owner's permission.
 */
import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { companyQuery, managerMutation } from "./lib/builders";
import { byMember, recordEvent } from "./lib/events";
import { ownedFollowUp, PURPOSE_WORDS, STOP_CONDITIONS } from "./lib/sales/agentFollowUps";
import { load, setNext } from "./lib/sales/agentOpportunity";
import { enqueueRun } from "./lib/sales/runs";

const DAY = 24 * 60 * 60_000;

/** A reminder's time arrived. Asked twice (the timer and the sweep), it starts one run. */
export const due = internalMutation({
  args: { followUpId: v.id("salesFollowUps") },
  handler: async (ctx, args) => {
    const followUp = await ctx.db.get(args.followUpId);
    if (!followUp || followUp.status !== "scheduled" || followUp.dueAt > Date.now() + 60_000) return null;
    const opportunity = await ctx.db.get(followUp.opportunityId);
    if (!opportunity) {
      await ctx.db.patch(followUp._id, { status: "cancelled", stopReason: "The opportunity no longer exists.", doneAt: Date.now() });
      return null;
    }
    return enqueueRun(ctx, opportunity, { trigger: "follow_up_due", key: `follow-up:${followUp._id}`, followUpId: followUp._id });
  },
});

/** What is planned, and what recently went or was stopped, with why each exists and what would stop it. */
export const list = companyQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args) => {
    const scheduled = await ctx.db
      .query("salesFollowUps")
      .withIndex("by_company_status_due", (q) => q.eq("companyId", ctx.companyId).eq("status", "scheduled"))
      .take(200);
    const recent = [];
    for (const status of ["sent", "stopped", "skipped", "cancelled", "failed"] as const) {
      const rows = await ctx.db
        .query("salesFollowUps")
        .withIndex("by_company_status_due", (q) => q.eq("companyId", ctx.companyId).eq("status", status).gt("dueAt", args.asOf - 14 * DAY))
        .order("desc")
        .take(40);
      recent.push(...rows);
    }
    const view = async (row: (typeof scheduled)[number]) => {
      const customer = await ctx.db.get(row.customerId);
      const opportunity = await ctx.db.get(row.opportunityId);
      return {
        followUpId: row._id,
        opportunityId: row.opportunityId,
        customer: customer?.name ?? "A prospect",
        purpose: row.purpose,
        purposeWords: PURPOSE_WORDS[row.purpose],
        attempt: row.attempt,
        maxAttempts: row.maxAttempts,
        dueAt: row.dueAt,
        status: row.status,
        reason: row.reason,
        preview: row.preview,
        stopReason: row.stopReason ?? null,
        stopsWhen: STOP_CONDITIONS[row.purpose],
        channel: opportunity?.channel ?? "sms",
        // Who sends it: the agent, unless a person is handling the conversation, in which case nothing is sent.
        by: opportunity?.followUps === "paused" ? ("held" as const) : ("sales" as const),
        doneAt: row.doneAt ?? null,
      };
    };
    return {
      scheduled: await Promise.all(scheduled.sort((a, b) => a.dueAt - b.dueAt).map(view)),
      recent: await Promise.all(recent.sort((a, b) => (b.doneAt ?? b.dueAt) - (a.doneAt ?? a.dueAt)).slice(0, 60).map(view)),
    };
  },
});

/** A person cancels one planned reminder. The opportunity then waits on them, not on the agent. */
export const cancel = managerMutation({
  args: { followUpId: v.id("salesFollowUps"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const followUp = await ownedFollowUp(ctx, ctx.companyId, args.followUpId);
    if (!followUp || followUp.status !== "scheduled") return null;
    const now = Date.now();
    await ctx.db.patch(followUp._id, { status: "cancelled", stopReason: args.note?.trim().slice(0, 300) || "Cancelled by a person.", doneAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "follow_up.cancelled", actor: byMember(ctx), subject: { table: "salesFollowUps", id: followUp._id }, data: { purpose: followUp.purpose, attempt: followUp.attempt } });
    const opportunity = await load(ctx, followUp.opportunityId).catch(() => null);
    if (opportunity) {
      await ctx.db.patch(opportunity._id, { humanTouches: opportunity.agent.humanTouches + 1 });
      await setNext(ctx, await load(ctx, opportunity._id), { what: "You cancelled the agent's reminder. Decide the next step, or have the agent pick it back up.", by: "owner", dueAt: now + DAY }, byMember(ctx));
    }
    return null;
  },
});
