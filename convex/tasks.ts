/**
 * Tasks carry the work (brief, section 10). Every task has a responsible agent, a completion condition
 * and a deadline. While open it has a next action. Waiting on someone is an explicit state with a
 * follow-up time. Handing it to a person records the open question. Nothing sits in "sent" and is forgotten.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyMutation, companyQuery, type MemberAccess } from "./lib/builders";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent, type Actor } from "./lib/events";
import { agentValidator, assertChange, TASK_CHANGES, taskStatusValidator, waitingOnValidator, type Agent, type TaskStatus } from "./lib/statuses";
import { instant, text } from "./lib/text";
import { aboutValidator } from "./schema";

type About = typeof aboutValidator.type;

/** What a task is about must be in the same company. Another company's record is "Not found.". */
export async function checkAbout(ctx: MutationCtx, companyId: Id<"companies">, about: About | undefined) {
  if (!about) return;
  const doc = await ctx.db.get(about.id);
  if (!doc || doc.companyId !== companyId) notFound();
}

/** Opens a task. Agents will call this from their workflows; people call it through `create`. */
export async function openTask(
  ctx: MutationCtx,
  input: { companyId: Id<"companies">; agent: Agent; title: string; nextAction: string; dueAt: number; completionCondition: string; about?: About; actor: Actor },
): Promise<Id<"tasks">> {
  await checkAbout(ctx, input.companyId, input.about);
  const taskId = await ctx.db.insert("tasks", {
    companyId: input.companyId,
    agent: input.agent,
    title: text(input.title, "The title", 200),
    about: input.about,
    completionCondition: text(input.completionCondition, "The completion condition", 500),
    status: "open",
    nextAction: text(input.nextAction, "The next action", 500),
    dueAt: instant(input.dueAt, "The deadline"),
    createdAt: Date.now(),
  });
  await recordEvent(ctx, { companyId: input.companyId, type: "task.opened", actor: input.actor, subject: { table: "tasks", id: taskId }, data: { agent: input.agent } });
  return taskId;
}

async function move(ctx: MutationCtx & MemberAccess, task: Doc<"tasks">, to: TaskStatus, fields: Partial<Doc<"tasks">>) {
  assertChange(TASK_CHANGES, task.status, to, "task");
  // Each state holds only its own fields, so a waiting task never keeps a stale next action.
  await ctx.db.patch(task._id, { nextAction: undefined, waitingOn: undefined, followUpAt: undefined, openQuestion: undefined, ...fields, status: to });
  await recordEvent(ctx, { companyId: ctx.companyId, type: `task.${to}`, actor: byMember(ctx), subject: { table: "tasks", id: task._id }, data: { from: task.status } });
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
