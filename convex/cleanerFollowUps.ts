/**
 * Routine follow-ups, as the office sees and steers them: what Selestial has prepared or sent for each
 * cleaner, what became of it, and the means to send one now or stop one. The work itself is in
 * convex/lib/cleaners/followUps.ts and runs on a schedule.
 */
import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { owned } from "./lib/access";
import { companyQuery, managerMutation } from "./lib/builders";
import { ensureFollowUp, needFor, runFollowUp, sweep as sweepAll } from "./lib/cleaners/followUps";
import { followUpTopicValidator } from "./lib/cleaners/schema";
import { MESSAGE_STATE_WORDS } from "./lib/cleaners/words";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { text } from "./lib/text";

const STATE_WORDS = {
  scheduled: "Scheduled",
  awaiting_approval: "Waiting for your approval",
  sent: "Sent",
  answered: "Answered",
  resolved: "Done",
  stopped: "Stopped",
  not_sent: "Could not be sent",
} as const;

export const forCleaner = companyQuery({
  args: { cleanerId: v.id("cleaners") },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const rows = await ctx.db
      .query("followUps")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .order("desc")
      .take(20);
    const out = [];
    for (const row of rows) {
      const message = row.messageId ? await ctx.db.get(row.messageId) : null;
      const link = row.linkId ? await ctx.db.get(row.linkId) : null;
      out.push({
        followUpId: row._id,
        topic: row.topic,
        agent: row.agent === "recruiter" ? "Recruiter" : "Dispatch",
        status: row.status,
        statusWords: STATE_WORDS[row.status],
        summary: row.summary,
        attempt: row.attempt,
        dueAt: row.dueAt,
        lastSentAt: row.lastSentAt ?? null,
        stopReason: row.stopReason ?? null,
        approvalId: row.approvalId ?? null,
        taskId: row.taskId ?? null,
        /** Four separate facts: prepared (the follow-up), sent and delivered (the message), acted on (the link). */
        message: message ? { status: message.status, words: MESSAGE_STATE_WORDS[message.status], channel: message.channel === "email" ? "email" : "text", problem: message.status === "not_sent" || message.status === "failed" ? (message.problem ?? null) : null } : null,
        actedAt: link?.lastActionAt && row.lastSentAt && link.lastActionAt > row.lastSentAt ? link.lastActionAt : null,
      });
    }
    return out;
  },
});

/**
 * A person sends the reminder now, instead of waiting for its time. Every check still runs: whether it is
 * still needed, whether another message just went to them, and the sending policy.
 */
export const sendNow = managerMutation({
  args: { cleanerId: v.id("cleaners"), topic: followUpTopicValidator },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    if (!(await needFor(ctx, ctx.company, cleaner, args.topic, Date.now()))) throw userError("There is nothing to remind them about right now.");
    const row = await ensureFollowUp(ctx, ctx.company, cleaner, args.topic, Date.now());
    if (!row) throw userError("There is nothing to remind them about right now.");
    // Due now, by a person's choice: the agent's own permission level does not apply to a person's send.
    await ctx.db.patch(row._id, { dueAt: Date.now() });
    const result = await runFollowUp(ctx, row._id, { approved: true });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.follow_up", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { words: `asked for a reminder now: ${result.detail}`, topic: args.topic } });
    return result;
  },
});

export const stop = managerMutation({
  args: { followUpId: v.id("followUps"), reason: v.string() },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.followUpId);
    if (row.status !== "scheduled" && row.status !== "awaiting_approval" && row.status !== "sent") throw userError("This follow-up is already closed.");
    const reason = text(args.reason, "The reason", 300);
    await ctx.db.patch(row._id, { status: "stopped", stopReason: `Stopped by a person: ${reason}`, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.follow_up", actor: byMember(ctx), subject: { table: "cleaners", id: row.cleanerId }, data: { words: `stopped routine reminders: ${reason}`, topic: row.topic } });
    return null;
  },
});

/** Runs every 30 minutes: opens follow-ups that are needed, and runs the ones that are due. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => sweepAll(ctx, Date.now()),
});
