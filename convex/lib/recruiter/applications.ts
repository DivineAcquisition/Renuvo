/**
 * The application's own state: its stage, who has the next action, and how it ends. Every change is an
 * event. An application that is still being worked always has a next action and someone responsible.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import { assertChange } from "../statuses";
import { liveTaskByKey, openTask, setTaskState } from "../taskState";
import { revokeApplicationLinks } from "./links";
import { ACTIVE_STAGES, STAGE_CHANGES, type ClosureReason, type Stage } from "./schema";
import { DAY, recruiterSettings } from "./settings";

export const RECRUITER: Actor = { kind: "agent", agent: "recruiter" };
export const SYSTEM: Actor = { kind: "system" };

export type NextAction = NonNullable<Doc<"applications">["nextAction"]>;

export function isActive(application: Pick<Doc<"applications">, "stage">): boolean {
  return ACTIVE_STAGES.includes(application.stage);
}

export function firstName(name: string | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first && /^[\p{L}'-]{2,30}$/u.test(first) ? first : null;
}

/** Moves the application to a stage, with the next action that stage needs. Refuses a change the list does not allow. */
export async function setStage(ctx: MutationCtx, application: Doc<"applications">, to: Stage, actor: Actor, fields: Partial<Doc<"applications">> & { nextAction: NextAction | undefined }): Promise<Doc<"applications">> {
  if (application.stage !== to) assertChange(STAGE_CHANGES, application.stage, to, "application");
  await ctx.db.patch(application._id, { ...fields, stage: to });
  if (application.stage !== to) {
    await recordEvent(ctx, { companyId: application.companyId, type: `application.${to}`, actor, subject: { table: "applications", id: application._id }, data: { from: application.stage } });
  }
  return (await ctx.db.get(application._id))!;
}

export async function setNextAction(ctx: MutationCtx, application: Doc<"applications">, nextAction: NextAction): Promise<void> {
  await ctx.db.patch(application._id, { nextAction });
}

const taskKey = (what: string, id: string) => `recruiter.${what}:${id}`;

/**
 * Puts a question about an application in front of a person, once. The task is Recruiter's and is held
 * for a person from the start, with the question and a deadline.
 */
export async function askPerson(
  ctx: MutationCtx,
  application: Pick<Doc<"applications">, "_id" | "companyId">,
  input: { what: string; title: string; question: string; dueAt: number; completionCondition: string; actor?: Actor },
): Promise<Id<"tasks">> {
  const key = taskKey(input.what, application._id);
  const existing = await liveTaskByKey(ctx, application.companyId, key);
  if (existing) return existing._id;
  const actor = input.actor ?? RECRUITER;
  const taskId = await openTask(ctx, {
    companyId: application.companyId,
    agent: "recruiter",
    title: input.title.slice(0, 200),
    nextAction: input.question.slice(0, 500),
    dueAt: input.dueAt,
    completionCondition: input.completionCondition,
    about: { table: "applications", id: application._id },
    key,
    actor,
  });
  const task = (await ctx.db.get(taskId))!;
  await setTaskState(ctx, task, "needs_decision", { openQuestion: input.question.slice(0, 1000), dueAt: input.dueAt, withPersonSince: Date.now() }, actor);
  return taskId;
}

/** Closes the task of this kind for the application, if one is open. */
export async function settleTask(ctx: MutationCtx, application: Pick<Doc<"applications">, "_id" | "companyId">, what: string, outcome: string, actor: Actor = SYSTEM): Promise<void> {
  const task = await liveTaskByKey(ctx, application.companyId, taskKey(what, application._id));
  if (task) await setTaskState(ctx, task, "done", { outcome: outcome.slice(0, 1000), closedAt: Date.now() }, actor);
}

const TASK_KINDS = ["contact", "role", "invitation", "reply", "review", "interview", "decision", "delivery", "duplicate"] as const;

async function endWork(ctx: MutationCtx, application: Doc<"applications">, outcome: string, actor: Actor) {
  for (const what of TASK_KINDS) await settleTask(ctx, application, what, outcome, actor);
  await revokeApplicationLinks(ctx, application, outcome, actor);
  const pending = await ctx.db
    .query("approvals")
    .withIndex("by_company_status_decideBy", (q) => q.eq("companyId", application.companyId).eq("status", "pending"))
    .take(500);
  for (const approval of pending) {
    if (approval.about?.table === "applications" && approval.about.id === application._id) {
      await ctx.db.patch(approval._id, { status: "expired", note: outcome });
      await recordEvent(ctx, { companyId: application.companyId, type: "approval.expired", actor: SYSTEM, subject: { table: "approvals", id: approval._id }, data: { action: approval.action } });
    }
  }
  for (const interview of await ctx.db
    .query("interviews")
    .withIndex("by_company_application", (q) => q.eq("companyId", application.companyId).eq("applicationId", application._id))
    .take(20)) {
    if (interview.status === "completed" || interview.status === "cancelled" || interview.status === "no_show") continue;
    if (interview.slotId) await ctx.db.patch(interview.slotId, { status: "open", interviewId: undefined });
    await ctx.db.patch(interview._id, { status: "cancelled", cancelReason: outcome, slotId: undefined });
    await recordEvent(ctx, { companyId: application.companyId, type: "interview.cancelled", actor, subject: { table: "interviews", id: interview._id }, data: { applicationId: application._id } });
  }
}

async function retainUntil(ctx: MutationCtx | QueryCtx, companyId: Id<"companies">): Promise<number> {
  const company = await ctx.db.get(companyId);
  return Date.now() + (company ? recruiterSettings(company).retentionDays : 365) * DAY;
}

/** Ends an application for a stated reason. Only a person's decision, or an allowed fixed-requirement decline, reaches here. */
export async function closeApplication(ctx: MutationCtx, application: Doc<"applications">, reason: ClosureReason, actor: Actor, options: { note?: string; by?: Id<"members"> } = {}): Promise<void> {
  if (!isActive(application)) throw userError("This application has already ended.");
  await endWork(ctx, application, `The application was closed: ${reason.replace(/_/g, " ")}.`, actor);
  await setStage(ctx, application, "closed", actor, {
    nextAction: undefined,
    questionSince: undefined,
    closure: { reason, note: options.note, by: options.by, at: Date.now() },
    retainUntil: reason === "hired" ? undefined : await retainUntil(ctx, application.companyId),
  });
}

/** The applicant took themselves out. Nothing more is sent. */
export async function withdrawApplication(ctx: MutationCtx, application: Doc<"applications">, actor: Actor, how: string): Promise<void> {
  if (!isActive(application)) return;
  await endWork(ctx, application, `The applicant withdrew (${how}).`, actor);
  await setStage(ctx, application, "withdrawn", actor, { nextAction: undefined, questionSince: undefined, retainUntil: await retainUntil(ctx, application.companyId) });
}

export async function activeApplicationsOf(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, applicantId: Id<"applicants">): Promise<Doc<"applications">[]> {
  const rows = await ctx.db
    .query("applications")
    .withIndex("by_company_applicant", (q) => q.eq("companyId", companyId).eq("applicantId", applicantId))
    .take(50);
  return rows.filter(isActive);
}
