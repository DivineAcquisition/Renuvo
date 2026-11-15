/**
 * Tasks carry the work (brief, section 10). Every task has a responsible agent, a completion condition
 * and a deadline. While open it has a next action. Waiting on someone is an explicit state with a
 * follow-up time. Handing it to a person records the open question. Nothing sits in "sent" and is forgotten.
 */
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyMutation, companyQuery, type MemberAccess } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { agentValidator, taskStatusValidator, waitingOnValidator, type TaskStatus } from "./lib/statuses";
import { openTask, setTaskState, type TaskStateFields } from "./lib/taskState";
import { instant, text } from "./lib/text";
import { aboutValidator } from "./schema";

export { checkAbout, openTask } from "./lib/taskState";

async function move(ctx: MutationCtx & MemberAccess, task: Doc<"tasks">, to: TaskStatus, fields: TaskStateFields) {
  await setTaskState(ctx, task, to, fields, byMember(ctx));
}

export const list = companyQuery({
  args: { status: taskStatusValidator, agent: v.optional(agentValidator) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("tasks")
      .withIndex("by_company_status_due", (q) => q.eq("companyId", ctx.companyId).eq("status", args.status))
      .take(200);
    return args.agent ? rows.filter((row) => row.agent === args.agent) : rows;
  },
});

/** What is late as of a moment the caller names: open work past its deadline, and waits past their follow-up. */
export const overdue = companyQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args) => {
    const late: Doc<"tasks">[] = [];
    for (const status of ["open", "needs_decision"] as const) {
      late.push(
        ...(await ctx.db
          .query("tasks")
          .withIndex("by_company_status_due", (q) => q.eq("companyId", ctx.companyId).eq("status", status).lt("dueAt", args.asOf))
          .take(100)),
      );
    }
    const waiting = await ctx.db
      .query("tasks")
      .withIndex("by_company_status_due", (q) => q.eq("companyId", ctx.companyId).eq("status", "waiting"))
      .take(200);
    late.push(...waiting.filter((row) => (row.followUpAt ?? 0) < args.asOf));
    return late;
  },
});

export const get = companyQuery({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => owned(ctx, args.taskId),
});

export const create = companyMutation({
  args: {
    agent: agentValidator,
    title: v.string(),
    nextAction: v.string(),
    dueAt: v.number(),
    completionCondition: v.string(),
    about: v.optional(aboutValidator),
  },
  handler: async (ctx, args) => openTask(ctx, { ...args, companyId: ctx.companyId, actor: byMember(ctx) }),
});

/** Back to work, or a new next step: the next action and its deadline are both required. */
export const setNextAction = companyMutation({
  args: { taskId: v.id("tasks"), nextAction: v.string(), dueAt: v.number() },
  handler: async (ctx, args) => {
    const task = await owned(ctx, args.taskId);
    const fields = { nextAction: text(args.nextAction, "The next action", 500), dueAt: instant(args.dueAt, "The deadline") };
    if (task.status === "open") {
      await ctx.db.patch(task._id, fields);
      await recordEvent(ctx, { companyId: ctx.companyId, type: "task.next_action_set", actor: byMember(ctx), subject: { table: "tasks", id: task._id } });
    } else {
      await move(ctx, task, "open", fields);
    }
    return null;
  },
});

export const wait = companyMutation({
  args: { taskId: v.id("tasks"), waitingOn: waitingOnValidator, followUpAt: v.number() },
  handler: async (ctx, args) => {
    const task = await owned(ctx, args.taskId);
    const followUpAt = instant(args.followUpAt, "The follow-up time");
    if (followUpAt <= Date.now()) throw userError("The follow-up time must be in the future.");
    await move(ctx, task, "waiting", { waitingOn: args.waitingOn, followUpAt });
    return null;
  },
});

/** Hands the task to a person with the open question and the time a decision is needed by. */
export const escalate = companyMutation({
  args: { taskId: v.id("tasks"), openQuestion: v.string(), decideBy: v.number() },
  handler: async (ctx, args) => {
    const task = await owned(ctx, args.taskId);
    await move(ctx, task, "needs_decision", { openQuestion: text(args.openQuestion, "The open question", 1000), dueAt: instant(args.decideBy, "The decision deadline") });
    return null;
  },
});

export const complete = companyMutation({
  args: { taskId: v.id("tasks"), outcome: v.string() },
  handler: async (ctx, args) => {
    const task = await owned(ctx, args.taskId);
    await move(ctx, task, "done", { outcome: text(args.outcome, "The outcome", 1000), closedAt: Date.now() });
    return null;
  },
});

export const cancel = companyMutation({
  args: { taskId: v.id("tasks"), reason: v.string() },
  handler: async (ctx, args) => {
    const task = await owned(ctx, args.taskId);
    await move(ctx, task, "cancelled", { outcome: text(args.reason, "The reason", 1000), closedAt: Date.now() });
    return null;
  },
});
