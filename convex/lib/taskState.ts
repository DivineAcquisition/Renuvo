/**
 * Opening a task and moving it between states, for people and for agents alike. A task in a state holds
 * only that state's fields, and every change is an event.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { aboutValidator } from "../schema";
import { notFound } from "./errors";
import { recordEvent, type Actor } from "./events";
import { assertChange, TASK_CHANGES, type Agent, type TaskStatus } from "./statuses";
import { instant, text } from "./text";

type About = typeof aboutValidator.type;

/** What a task is about must be in the same company. Another company's record is "Not found.". */
export async function checkAbout(ctx: MutationCtx, companyId: Id<"companies">, about: About | undefined) {
  if (!about) return;
  const doc = await ctx.db.get(about.id);
  if (!doc || doc.companyId !== companyId) notFound();
}

/** Opens a task. Agents call this from their workflows; people call it through `tasks.create`. */
export async function openTask(
  ctx: MutationCtx,
  input: {
    companyId: Id<"companies">;
    agent: Agent;
    title: string;
    nextAction: string;
    dueAt: number;
    completionCondition: string;
    about?: About;
    /** Names the one piece of work this task is, so a workflow that runs twice does not open it twice. */
    key?: string;
    actor: Actor;
  },
): Promise<Id<"tasks">> {
  await checkAbout(ctx, input.companyId, input.about);
  const taskId = await ctx.db.insert("tasks", {
    companyId: input.companyId,
    agent: input.agent,
    title: text(input.title, "The title", 200),
    about: input.about,
    key: input.key,
    completionCondition: text(input.completionCondition, "The completion condition", 500),
    status: "open",
    nextAction: text(input.nextAction, "The next action", 500),
    dueAt: instant(input.dueAt, "The deadline"),
    createdAt: Date.now(),
  });
  await recordEvent(ctx, { companyId: input.companyId, type: "task.opened", actor: input.actor, subject: { table: "tasks", id: taskId }, data: { agent: input.agent } });
  return taskId;
}

/** The task with this key that is still being worked, if there is one. */
export async function liveTaskByKey(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, key: string): Promise<Doc<"tasks"> | null> {
  const rows = await ctx.db
    .query("tasks")
    .withIndex("by_company_key", (q) => q.eq("companyId", companyId).eq("key", key))
    .order("desc")
    .take(20);
  return rows.find((row) => row.status !== "done" && row.status !== "cancelled") ?? null;
}

export type TaskStateFields = {
  nextAction?: string;
  dueAt?: number;
  waitingOn?: Doc<"tasks">["waitingOn"];
  followUpAt?: number;
  openQuestion?: string;
  outcome?: string;
  closedAt?: number;
  /** Pass null to give the task back to its agent. Leave out to keep it as it is. */
  withPersonSince?: number | null;
};

/**
 * Puts a task in a state with that state's fields and nothing left over from the last one. With
 * `sameStatus`, a workflow may refresh the fields of the state the task is already in; when nothing
 * would change, nothing is written and no event is recorded, so running a workflow twice is quiet.
 */
export async function setTaskState(
  ctx: MutationCtx,
  task: Doc<"tasks">,
  to: TaskStatus,
  fields: TaskStateFields,
  actor: Actor,
  options: { sameStatus?: boolean } = {},
): Promise<void> {
  const withPersonSince = fields.withPersonSince === undefined ? task.withPersonSince : (fields.withPersonSince ?? undefined);
  const next = {
    nextAction: fields.nextAction,
    waitingOn: fields.waitingOn,
    followUpAt: fields.followUpAt,
    openQuestion: fields.openQuestion,
    dueAt: fields.dueAt ?? task.dueAt,
    outcome: fields.outcome ?? task.outcome,
    closedAt: fields.closedAt ?? task.closedAt,
    withPersonSince,
  };
  if (task.status === to && options.sameStatus) {
    const same = (Object.keys(next) as (keyof typeof next)[]).every((key) => task[key] === next[key]);
    if (same) return;
    await ctx.db.patch(task._id, next);
    await recordEvent(ctx, { companyId: task.companyId, type: "task.updated", actor, subject: { table: "tasks", id: task._id }, data: { status: to } });
    return;
  }
  assertChange(TASK_CHANGES, task.status, to, "task");
  await ctx.db.patch(task._id, { ...next, status: to });
  await recordEvent(ctx, { companyId: task.companyId, type: `task.${to}`, actor, subject: { table: "tasks", id: task._id }, data: { from: task.status } });
}
