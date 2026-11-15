/**
 * Dispatch does not hire, change a customer's price, settle a complaint, judge quality or pay anyone.
 * When its work reaches one of those, it opens a task in that agent's queue and says so. Recruiter is an
 * agent the record already knows. Team Coordinator, Customer Care, Quality and Finance are not built, so
 * their queues are worked by a person: the task is held for a person from the start, never left for an
 * agent that does not exist.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { aboutValidator } from "../../schema";
import type { Actor } from "../events";
import type { HandoffQueue } from "../statuses";
import { liveTaskByKey, openTask, setTaskState } from "../taskState";

type About = typeof aboutValidator.type;

export const QUEUE_NAMES: Record<HandoffQueue, string> = {
  recruiter: "Recruiter",
  team_coordinator: "Team Coordinator",
  customer_care: "Customer Care",
  quality: "Quality",
  finance: "Finance",
};

export type Handoff = {
  companyId: Id<"companies">;
  to: HandoffQueue;
  /** Names this one handoff, so the same trouble does not open it twice. */
  key: string;
  title: string;
  /** What the receiving queue has to decide or do. */
  question: string;
  trigger: string;
  completionCondition: string;
  escalation: string;
  dueAt: number;
  about?: About;
  actor: Actor;
};

/** Opens the handoff once. Answers with the task that carries it. */
export async function handOff(ctx: MutationCtx, input: Handoff): Promise<Doc<"tasks">> {
  const existing = await liveTaskByKey(ctx, input.companyId, input.key);
  if (existing) return existing;
  const taskId = await openTask(ctx, {
    companyId: input.companyId,
    // Recruiter is a known agent. The other queues have no agent yet, so the task is filed under Dispatch,
    // which raised it, and held for a person.
    agent: input.to === "recruiter" ? "recruiter" : "dispatch",
    title: input.title.slice(0, 200),
    nextAction: input.question.slice(0, 500),
    dueAt: input.dueAt,
    completionCondition: input.completionCondition,
    about: input.about,
    key: input.key,
    actor: input.actor,
  });
  await ctx.db.patch(taskId, { handoffTo: input.to, trigger: input.trigger.slice(0, 500), escalation: input.escalation.slice(0, 500) });
  const task = (await ctx.db.get(taskId))!;
  if (input.to !== "recruiter") {
    await setTaskState(ctx, task, "needs_decision", { openQuestion: input.question.slice(0, 1000), dueAt: input.dueAt, withPersonSince: Date.now() }, input.actor);
  }
  return (await ctx.db.get(taskId))!;
}
