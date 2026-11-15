/**
 * The one detail panel. A job, an approval and a task all answer the same questions in the same order:
 * the current situation, the relevant context, the next action, and the history.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyQuery, type MemberAccess } from "./lib/builders";
import { AGENT_PROFILES, departmentOf } from "./lib/departments";
import { notAllowed } from "./lib/errors";
import { describeEvents, type Described, type EventRef } from "./lib/eventWords";
import { coverRun, type RunStep } from "./lib/dispatch/run";
import { coverKey } from "./lib/dispatch/workflow";
import { isManager } from "./lib/roles";
import type { Agent } from "./lib/statuses";
import { liveTaskByKey } from "./lib/taskState";
import { when } from "./lib/time";

type Ctx = QueryCtx & MemberAccess;

export const refValidator = v.union(
  v.object({ kind: v.literal("job"), id: v.id("jobs") }),
  v.object({ kind: v.literal("approval"), id: v.id("approvals") }),
  v.object({ kind: v.literal("task"), id: v.id("tasks") }),
);

export type Fact = { label: string; value: string; ref: EventRef | null; missing?: boolean };

export type Detail = {
  ref: EventRef;
  title: string;
  subtitle: string;
  /** Who or what is responsible right now. */
  responsible: { label: string; agent: Agent | null };
  status: { label: string; tone: "good" | "pending" | "attention" | "neutral" };
  situation: string[];
  context: Fact[];
  /** What happens next, when, and what happens if it fails. */
  next: { action: string; when: number | null; ifFails: string | null };
  history: Described[];
  job: null | {
    status: Doc<"jobs">["status"];
    /** True while a person holds this visit's coverage and Dispatch leaves it alone. */
    withPerson: boolean;
    /** Dispatch's work on this visit, step by step, read from the record. */
    run: RunStep[];
    assignments: { id: Id<"assignments">; cleaner: string; status: Doc<"assignments">["status"]; respondBy: number; payCents: number; endReason: string | null }[];
  };
  approval: null | { status: Doc<"approvals">["status"]; canDecide: boolean; carriesOut: boolean; note: string | null; authorizes: string | null; ifWaiting: string | null; jobId: Id<"jobs"> | null };
  task: null | { status: Doc<"tasks">["status"]; agent: Agent };
};

async function history(ctx: Ctx, subjectIds: string[], asOf: number): Promise<Described[]> {
  const events: Doc<"events">[] = [];
  for (const subjectId of subjectIds) {
    events.push(
      ...(await ctx.db
        .query("events")
        .withIndex("by_company_subject_at", (q) => q.eq("companyId", ctx.companyId).eq("subjectId", subjectId))
        .take(200)),
    );
  }
  // Events written in one step share a time; the order they were written in breaks the tie.
  events.sort((a, b) => b.at - a.at || b._creationTime - a._creationTime);
  return describeEvents(ctx, ctx.company, events.slice(0, 100), asOf);
}

/** The Dispatch task that carries this visit's coverage, if one is open. */
async function taskFor(ctx: Ctx, jobId: Id<"jobs">): Promise<Doc<"tasks"> | null> {
  return liveTaskByKey(ctx, ctx.companyId, coverKey(jobId));
}

async function jobDetail(ctx: Ctx, jobId: Id<"jobs">, asOf: number): Promise<Detail> {
  const tz = ctx.company.timezone;
  const job = await owned(ctx, jobId);
  const [customer, property] = [await ctx.db.get(job.customerId), await ctx.db.get(job.propertyId)];
  const rows = await ctx.db
    .query("assignments")
    .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", job._id))
    .take(50);
  const assignments = [];
  for (const row of rows.sort((a, b) => b.offeredAt - a.offeredAt)) {
    assignments.push({ id: row._id, cleaner: (await ctx.db.get(row.cleanerId))?.name ?? "Unknown", status: row.status, respondBy: row.respondBy, payCents: row.payCents, endReason: row.endReason ?? null });
  }
  const accepted = assignments.find((row) => row.status === "accepted");
  const offered = assignments.filter((row) => row.status === "offered").sort((a, b) => a.respondBy - b.respondBy)[0];
  const task = await taskFor(ctx, job._id);

  let status: Detail["status"];
  let situation: string[];
  let next: Detail["next"];
  if (job.status === "cancelled") {
    status = { label: "Cancelled", tone: "neutral" };
    situation = [`This visit was cancelled${job.cancelReason ? `: ${job.cancelReason}` : "."}`];
    next = { action: "Nothing further.", when: null, ifFails: null };
  } else if (job.status === "completed") {
    status = { label: "Completed", tone: "good" };
    situation = [`The visit was marked complete${accepted ? ` by ${accepted.cleaner}'s crew` : ""}.`];
    next = { action: "Nothing further. Verifying the visit's evidence arrives with Dispatch's next step.", when: null, ifFails: null };
  } else if (job.status === "in_progress") {
    status = { label: "In progress", tone: "good" };
    situation = [`${accepted?.cleaner ?? "The crew"} is on this visit now.`];
    next = { action: "Mark the visit complete when the crew finishes.", when: job.endsAt, ifFails: "If it runs late, later visits for the same cleaner may be affected." };
  } else if (accepted) {
    status = { label: "Accepted", tone: "good" };
    situation = [`${accepted.cleaner} accepted this visit. Accepted means the cleaner agreed, not only that their name is on it.`];
    next = { action: "The visit takes place.", when: job.startsAt, ifFails: "If the cleaner drops out, the visit is uncovered again and cover starts." };
  } else if (offered) {
    status = { label: "Awaiting acceptance", tone: "pending" };
    situation = [`An offer is out to ${offered.cleaner}. Nobody has accepted this visit yet.`];
    next = { action: `Wait for ${offered.cleaner}'s answer.`, when: offered.respondBy, ifFails: "With no answer in time the offer expires and the visit is offered to the next eligible cleaner, or handed to you." };
  } else {
    status = { label: "Needs coverage", tone: "attention" };
    situation = ["No cleaner has been offered this visit, so nobody has agreed to do it."];
    next = task
      ? { action: task.status === "needs_decision" ? (task.openQuestion ?? "A person needs to decide.") : (task.nextAction ?? "Dispatch is finding a cleaner."), when: task.dueAt, ifFails: "The visit stays uncovered until a cleaner accepts." }
      : { action: "Offer the visit to an eligible cleaner.", when: job.startsAt, ifFails: "The visit stays uncovered until a cleaner accepts." };
  }
  if (task?.status === "needs_decision" && job.status === "scheduled") situation.push(`Dispatch handed this to a person: ${task.openQuestion ?? "a decision is needed."}`);

  const address = property ? `${property.address.line1}${property.address.line2 ? `, ${property.address.line2}` : ""}, ${property.address.city}, ${property.address.region} ${property.address.postalCode}` : "Unknown";
  const price = job.priceCents === undefined ? null : `$${(job.priceCents / 100).toFixed(2)}`;
  const context: Fact[] = [
    { label: "Customer", value: customer?.name ?? "Unknown", ref: null },
    { label: "Property", value: address, ref: null },
    { label: "Scope", value: job.scope, ref: null },
    ...(job.requiredSkills.length > 0 ? [{ label: "Skills needed", value: job.requiredSkills.join(", "), ref: null }] : []),
    { label: "Access instructions", value: property?.accessInstructions ?? "None recorded", ref: null, missing: !property?.accessInstructions },
    { label: "Price", value: price ?? "No price set", ref: null, missing: !price },
    { label: "Payment", value: "Payments are not connected yet", ref: null, missing: true },
    { label: "Conversation", value: "Conversations are not built yet", ref: null, missing: true },
  ];

  return {
    ref: { kind: "job", id: job._id },
    title: `${customer?.name ?? "Unknown customer"} · ${job.serviceType}`,
    subtitle: `${when(job.startsAt, asOf, tz)} to ${when(job.endsAt, asOf, tz).replace(/^.* at /, "")}`,
    responsible: task?.withPersonSince !== undefined ? { label: "You. Dispatch is leaving this visit alone until you hand it back.", agent: null } : task ? { label: "Dispatch", agent: "dispatch" } : accepted ? { label: accepted.cleaner, agent: null } : { label: "Your team. No agent is working on this yet.", agent: null },
    status,
    situation,
    context,
    next,
    history: await history(ctx, [job._id, ...rows.map((row) => row._id)], asOf),
    job: { status: job.status, withPerson: task?.withPersonSince !== undefined, run: await coverRun(ctx, ctx.company, job, asOf), assignments },
    approval: null,
    task: null,
  };
}

async function approvalDetail(ctx: Ctx, approvalId: Id<"approvals">, asOf: number): Promise<Detail> {
  if (!isManager(ctx.role)) notAllowed();
  const approval = await owned(ctx, approvalId);
  const context: Fact[] = [];
  let jobId: Id<"jobs"> | null = null;
  if (approval.about?.table === "jobs") jobId = approval.about.id;
  if (approval.proposal?.kind === "offer_assignment") jobId = approval.proposal.jobId;
  if (jobId) {
    const job = await ctx.db.get(jobId);
    if (job && job.companyId === ctx.companyId) {
      const customer = await ctx.db.get(job.customerId);
      context.push({ label: "Visit", value: `${when(job.startsAt, asOf, ctx.company.timezone)} · ${job.serviceType}`, ref: { kind: "job", id: job._id } });
      context.push({ label: "Customer", value: customer?.name ?? "Unknown", ref: null });
    }
  }
  if (approval.proposal?.kind === "offer_assignment") {
    const cleaner = await ctx.db.get(approval.proposal.cleanerId);
    context.push({ label: "Cleaner", value: cleaner?.name ?? "Unknown", ref: null });
    context.push({ label: "Cleaner's pay for this visit", value: `$${(approval.proposal.payCents / 100).toFixed(2)}`, ref: null });
    context.push({ label: "Time to answer", value: `${approval.proposal.respondWithinMinutes} minutes`, ref: null });
  }
  if (approval.taskId) context.push({ label: "Task", value: (await ctx.db.get(approval.taskId))?.title ?? "Task", ref: { kind: "task", id: approval.taskId } });
  const decider = approval.decidedBy ? await ctx.db.get(approval.decidedBy) : null;
  const pending = approval.status === "pending";
  const words = { pending: "Needs your decision", approved: "Approved", changed: "Changed", skipped: "Skipped", expired: "Expired" }[approval.status];

  return {
    ref: { kind: "approval", id: approval._id },
    title: approval.summary,
    subtitle: `${AGENT_PROFILES[approval.agent].name} · ${departmentOf(approval.agent).name}`,
    responsible: pending ? { label: "You. The agent is waiting for a decision.", agent: null } : { label: AGENT_PROFILES[approval.agent].name, agent: approval.agent },
    status: { label: words, tone: pending ? "attention" : approval.status === "approved" ? "good" : "neutral" },
    situation: [approval.reason, ...(pending ? [] : [`${decider?.name ?? "Nobody"} ${approval.status === "expired" ? "decided in time, so it expired" : `${approval.status} this`}${approval.note ? `: ${approval.note}` : "."}`])],
    context,
    next: pending
      ? { action: approval.authorizes ?? "Approve, change or skip the proposal.", when: approval.decideBy, ifFails: approval.ifWaiting ?? "If nobody decides in time the proposal expires. It is never treated as approved." }
      : { action: "Nothing further on this proposal.", when: null, ifFails: null },
    history: await history(ctx, [approval._id], asOf),
    job: null,
    approval: { status: approval.status, canDecide: pending, carriesOut: Boolean(approval.proposal), note: approval.note ?? null, authorizes: approval.authorizes ?? null, ifWaiting: approval.ifWaiting ?? null, jobId },
    task: null,
  };
}

async function taskDetail(ctx: Ctx, taskId: Id<"tasks">, asOf: number): Promise<Detail> {
  const task = await owned(ctx, taskId);
  const context: Fact[] = [{ label: "Done when", value: task.completionCondition, ref: null }];
  if (task.about?.table === "jobs") {
    const job = await ctx.db.get(task.about.id);
    if (job && job.companyId === ctx.companyId) context.push({ label: "Visit", value: `${when(job.startsAt, asOf, ctx.company.timezone)} · ${job.serviceType}`, ref: { kind: "job", id: job._id } });
  }
  const agent = AGENT_PROFILES[task.agent];
  const paused = ctx.company.pausedAgents.includes(task.agent);
  let status: Detail["status"];
  let situation: string[];
  let next: Detail["next"];
  if (task.status === "open") {
    status = { label: paused ? "Paused" : "In progress", tone: paused ? "attention" : "pending" };
    situation = [paused ? `${agent.name} is paused, so this is not moving.` : `${agent.name} is working on this.`];
    next = { action: task.nextAction ?? "No next action recorded.", when: task.dueAt, ifFails: "If the deadline passes it shows as late and is brought to you." };
  } else if (task.status === "waiting") {
    status = { label: "Waiting on a response", tone: "pending" };
    situation = [`Waiting on ${task.waitingOn === "other" ? "someone outside the company" : `the ${task.waitingOn}`}.`];
    next = { action: `Follow up if there is no answer.`, when: task.followUpAt ?? null, ifFails: "With no answer by then, the agent follows up or hands it to you." };
  } else if (task.status === "needs_decision") {
    status = { label: "Needs your decision", tone: "attention" };
    situation = [task.openQuestion ?? "This was handed to a person."];
    next = { action: "Decide, then set the next step or close the task.", when: task.dueAt, ifFails: "Nothing moves on this until a person decides." };
  } else {
    status = { label: task.status === "done" ? "Done" : "Cancelled", tone: task.status === "done" ? "good" : "neutral" };
    situation = [task.outcome ?? "Closed."];
    next = { action: "Nothing further.", when: null, ifFails: null };
  }
  return {
    ref: { kind: "task", id: task._id },
    title: task.title,
    subtitle: `${agent.name} · ${departmentOf(task.agent).name}`,
    responsible: task.status === "needs_decision" ? { label: "You. The agent handed this over.", agent: null } : { label: agent.name, agent: task.agent },
    status,
    situation,
    context,
    next,
    history: await history(ctx, [task._id], asOf),
    job: null,
    approval: null,
    task: { status: task.status, agent: task.agent },
  };
}

export const get = companyQuery({
  args: { ref: refValidator, asOf: v.number() },
  handler: async (ctx, args): Promise<Detail> => {
    if (args.ref.kind === "job") return jobDetail(ctx, args.ref.id, args.asOf);
    if (args.ref.kind === "approval") return approvalDetail(ctx, args.ref.id, args.asOf);
    return taskDetail(ctx, args.ref.id, args.asOf);
  },
});

/** What happened lately, newest first, in words: the live feed of the team's work. */
export const activity = companyQuery({
  args: { asOf: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Described[]> => {
    const events = await ctx.db
      .query("events")
      .withIndex("by_company_at", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(Math.min(Math.max(Math.trunc(args.limit ?? 25), 1), 100));
    return describeEvents(ctx, ctx.company, events, args.asOf);
  },
});
