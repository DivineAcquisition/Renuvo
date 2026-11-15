/**
 * What the owner's Overview reads. Every sentence and number here is built by code from the shared
 * record, each statement points at the record behind it, and anything that is not connected yet says
 * "not set up" instead of showing a number.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { companyQuery, type MemberAccess } from "./lib/builders";
import { AGENT_PROFILES, departmentOf, DEPARTMENTS } from "./lib/departments";
import { coverRun, type RunStep } from "./lib/dispatch/run";
import { dispatchSettings } from "./lib/dispatch/settings";
import { coverKey, jobApprovals } from "./lib/dispatch/workflow";
import { liveTaskByKey } from "./lib/taskState";
import { isManager } from "./lib/roles";
import { AGENTS, type Agent } from "./lib/statuses";
import { addLocalDays, clock, startOfLocalDay, when } from "./lib/time";

type Ctx = QueryCtx & MemberAccess;

export type RecordRef = { kind: "job"; id: Id<"jobs"> } | { kind: "approval"; id: Id<"approvals"> } | { kind: "task"; id: Id<"tasks"> };
export type Link = RecordRef | { kind: "view"; view: "schedule_today" | "schedule_tomorrow" | "decisions" };

/** confirmed: the record says so. pending: waiting on someone's answer. attention: needs a person. */
export type Statement = {
  text: string;
  certainty: "confirmed" | "pending" | "attention";
  link: Link | null;
  /** The agent on it, and where its work stands, when an agent is carrying this. */
  handling?: { agent: Agent; text: string };
};

export type VisitState = "completed" | "in_progress" | "accepted" | "awaiting_acceptance" | "needs_coverage" | "cancelled";

export type Visit = {
  jobId: Id<"jobs">;
  startsAt: number;
  endsAt: number;
  customer: string;
  place: string;
  serviceType: string;
  state: VisitState;
  /** The cleaner who accepted, or the one an offer is out to. Null when nobody has been asked. */
  cleaner: string | null;
  /** When the open offer must be answered by. */
  respondBy: number | null;
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

async function visitsBetween(ctx: Ctx, from: number, to: number): Promise<Visit[]> {
  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_company_start", (q) => q.eq("companyId", ctx.companyId).gte("startsAt", from).lt("startsAt", to))
    .take(300);
  const names = new Map<string, string>();
  const nameOf = async (id: Id<"customers"> | Id<"cleaners">) => {
    if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.name ?? "Unknown");
    return names.get(id)!;
  };
  const visits: Visit[] = [];
  for (const job of jobs) {
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", job._id))
      .take(50);
    const accepted = assignments.find((row) => row.status === "accepted");
    const offered = assignments.filter((row) => row.status === "offered").sort((a, b) => a.respondBy - b.respondBy)[0];
    const property = await ctx.db.get(job.propertyId);
    let state: VisitState;
    if (job.status === "completed" || job.status === "in_progress" || job.status === "cancelled") state = job.status;
    else if (accepted) state = "accepted";
    else if (offered) state = "awaiting_acceptance";
    else state = "needs_coverage";
    const holder = accepted ?? (job.status === "scheduled" ? offered : undefined);
    visits.push({
      jobId: job._id,
      startsAt: job.startsAt,
      endsAt: job.endsAt,
      customer: await nameOf(job.customerId),
      place: property ? (property.label ?? `${property.address.line1}, ${property.address.city}`) : "Unknown property",
      serviceType: job.serviceType,
      state,
      cleaner: holder ? await nameOf(holder.cleanerId) : null,
      respondBy: !accepted && offered && job.status === "scheduled" ? offered.respondBy : null,
    });
  }
  return visits;
}

async function openDecisions(ctx: Ctx) {
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_company_status_due", (q) => q.eq("companyId", ctx.companyId).eq("status", "needs_decision"))
    .take(200);
  const pending = await ctx.db
    .query("approvals")
    .withIndex("by_company_status_decideBy", (q) => q.eq("companyId", ctx.companyId).eq("status", "pending"))
    .take(200);
  // A task that is only waiting on one of these approvals is the same decision, shown once: as the approval.
  const covered = new Set(pending.map((row) => row.taskId).filter(Boolean));
  // Approvals belong to Owners and Managers. Office sees the tasks handed to a person, not the approval queue.
  const approvals = isManager(ctx.role) ? pending : [];
  return { approvals, tasks: tasks.filter((task) => !covered.has(task._id)) };
}

/** Where Dispatch's work on an uncovered visit stands, in one clause. */
async function handlingOf(ctx: Ctx, jobId: Id<"jobs">): Promise<Statement["handling"]> {
  const job = await ctx.db.get(jobId);
  if (!job) return undefined;
  const task = await liveTaskByKey(ctx, ctx.companyId, coverKey(jobId));
  if (!task) return undefined;
  if (task.withPersonSince !== undefined) return { agent: "dispatch", text: "You are handling it; Dispatch is standing by." };
  if (ctx.company.pausedAgents.includes("dispatch")) return { agent: "dispatch", text: "Dispatch is paused." };
  if (task.status === "needs_decision") {
    const pending = (await jobApprovals(ctx, job)).some((row) => row.status === "pending");
    return { agent: "dispatch", text: pending ? "Dispatch proposed a cleaner and is waiting for your approval." : "Dispatch could not cover it and handed it to you." };
  }
  return { agent: "dispatch", text: "Dispatch is finding a cleaner." };
}

export const today = companyQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args) => {
    const tz = ctx.company.timezone;
    const dayStart = startOfLocalDay(args.asOf, tz);
    const tomorrowStart = addLocalDays(dayStart, 1, tz);
    const visits = await visitsBetween(ctx, dayStart, tomorrowStart);
    const tomorrow = await visitsBetween(ctx, tomorrowStart, addLocalDays(dayStart, 2, tz));
    const { approvals, tasks } = await openDecisions(ctx);

    const count = (state: VisitState) => visits.filter((visit) => visit.state === state).length;
    const live = visits.filter((visit) => visit.state !== "cancelled");
    const accepted = live.filter((visit) => visit.state !== "awaiting_acceptance" && visit.state !== "needs_coverage").length;
    const deadlines = [...approvals.map((row) => row.decideBy), ...tasks.map((row) => row.dueAt)];
    const decisions = approvals.length + tasks.length;

    const briefing: Statement[] = [];
    if (live.length === 0) {
      briefing.push({ text: "No visits are scheduled today.", certainty: "confirmed", link: { kind: "view", view: "schedule_today" } });
    } else if (accepted === live.length) {
      briefing.push({
        text: live.length === 1 ? "Today's one visit has a cleaner who accepted it." : `All ${live.length} of today's visits have a cleaner who accepted.`,
        certainty: "confirmed",
        link: { kind: "view", view: "schedule_today" },
      });
    } else {
      briefing.push({
        text: `${accepted} of today's ${plural(live.length, "visit")} ${accepted === 1 ? "has" : "have"} a cleaner who accepted.`,
        certainty: "confirmed",
        link: { kind: "view", view: "schedule_today" },
      });
    }
    for (const visit of visits.filter((row) => row.state === "needs_coverage").slice(0, 3)) {
      briefing.push({ text: `The ${clock(visit.startsAt, tz)} visit for ${visit.customer} has no cleaner.`, certainty: "attention", link: { kind: "job", id: visit.jobId }, handling: await handlingOf(ctx, visit.jobId) });
    }
    for (const visit of visits.filter((row) => row.state === "awaiting_acceptance").slice(0, 3)) {
      briefing.push({
        text: `The ${clock(visit.startsAt, tz)} visit for ${visit.customer} is waiting on ${visit.cleaner}'s answer${visit.respondBy ? `, due ${when(visit.respondBy, args.asOf, tz)}` : ""}.`,
        certainty: "pending",
        link: { kind: "job", id: visit.jobId },
        handling: { agent: "dispatch", text: "Dispatch follows up when the answer is due." },
      });
    }
    const tomorrowOpen = tomorrow.filter((row) => row.state === "needs_coverage" || row.state === "awaiting_acceptance").length;
    if (tomorrowOpen > 0) {
      briefing.push({
        text: `Tomorrow has ${plural(tomorrowOpen, "visit")} without an accepted cleaner.`,
        certainty: "attention",
        link: { kind: "view", view: "schedule_tomorrow" },
      });
    } else if (tomorrow.some((row) => row.state !== "cancelled")) {
      briefing.push({ text: "Every visit tomorrow has a cleaner who accepted.", certainty: "confirmed", link: { kind: "view", view: "schedule_tomorrow" } });
    }
    if (decisions > 0) {
      briefing.push({
        text: `${plural(decisions, "decision")} ${decisions === 1 ? "is" : "are"} waiting for you; the earliest is due ${when(Math.min(...deadlines), args.asOf, tz)}.`,
        certainty: "attention",
        link: { kind: "view", view: "decisions" },
      });
    } else {
      briefing.push({ text: "Nothing is waiting on your decision.", certainty: "confirmed", link: null });
    }

    const latest = await ctx.db
      .query("events")
      .withIndex("by_company_at", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .first();

    return {
      company: ctx.company.name,
      timezone: tz,
      /** When the record behind this briefing last changed. */
      lastChangeAt: latest?.at ?? null,
      briefing,
      indicators: {
        jobs: { total: live.length, completed: count("completed"), inProgress: count("in_progress"), upcoming: live.length - count("completed") - count("in_progress") },
        coverage: { needing: live.length, accepted, awaiting: count("awaiting_acceptance"), uncovered: count("needs_coverage") },
        decisions: { count: decisions, nextDeadline: deadlines.length > 0 ? Math.min(...deadlines) : null },
        // Payments are not built. The screen says so instead of showing an amount.
        payments: { state: "not_set_up" as const },
      },
    };
  },
});

export const schedule = companyQuery({
  args: { asOf: v.number(), view: v.union(v.literal("today"), v.literal("tomorrow"), v.literal("week")) },
  handler: async (ctx, args) => {
    const tz = ctx.company.timezone;
    const todayStart = startOfLocalDay(args.asOf, tz);
    const from = args.view === "tomorrow" ? addLocalDays(todayStart, 1, tz) : todayStart;
    const days = args.view === "week" ? 7 : 1;
    const dayStarts = Array.from({ length: days }, (_, index) => addLocalDays(from, index, tz));
    const to = addLocalDays(from, days, tz);
    return { timezone: tz, from, to, dayStarts, visits: await visitsBetween(ctx, from, to) };
  },
});

async function aboutContext(ctx: Ctx, about: Doc<"tasks">["about"], asOf: number): Promise<{ label: string; value: string; ref: RecordRef | null }[]> {
  if (!about) return [];
  const tz = ctx.company.timezone;
  const jobContext = async (jobId: Id<"jobs">) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.companyId !== ctx.companyId) return [];
    const customer = await ctx.db.get(job.customerId);
    return [
      { label: "Visit", value: `${when(job.startsAt, asOf, tz)} · ${job.serviceType}`, ref: { kind: "job" as const, id: job._id } },
      { label: "Customer", value: customer?.name ?? "Unknown", ref: null },
    ];
  };
  if (about.table === "jobs") return jobContext(about.id);
  if (about.table === "assignments") {
    const assignment = await ctx.db.get(about.id);
    if (!assignment || assignment.companyId !== ctx.companyId) return [];
    const cleaner = await ctx.db.get(assignment.cleanerId);
    return [...(await jobContext(assignment.jobId)), { label: "Cleaner", value: cleaner?.name ?? "Unknown", ref: null }];
  }
  const doc = await ctx.db.get(about.id);
  if (!doc || doc.companyId !== ctx.companyId) return [];
  if (about.table === "customers") return [{ label: "Customer", value: (doc as Doc<"customers">).name, ref: null }];
  if (about.table === "cleaners") return [{ label: "Cleaner", value: (doc as Doc<"cleaners">).name, ref: null }];
  const property = doc as Doc<"properties">;
  return [{ label: "Property", value: property.label ?? property.address.line1, ref: null }];
}

export type Decision = {
  ref: RecordRef;
  agent: Agent;
  agentName: string;
  department: string;
  title: string;
  /** The problem, in the agent's words. */
  situation: string;
  /** The specific proposed action. Null when the agent has no proposal and a person must choose. */
  recommended: string | null;
  authorizes: string | null;
  ifWaiting: string | null;
  deadline: number;
  context: { label: string; value: string; ref: RecordRef | null }[];
  /** True when this person may approve, change or skip it. */
  canDecide: boolean;
  /** True when approving carries the action out, not only records the decision. */
  carriesOut: boolean;
  /** The agent's work so far on the visit this is about, step by step. Empty when it is not about a visit. */
  run: RunStep[];
};

async function runFor(ctx: Ctx, agent: Agent, about: Doc<"tasks">["about"], asOf: number): Promise<RunStep[]> {
  if (agent !== "dispatch" || about?.table !== "jobs") return [];
  const job = await ctx.db.get(about.id);
  return job && job.companyId === ctx.companyId ? coverRun(ctx, ctx.company, job, asOf) : [];
}

export const decisions = companyQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args): Promise<Decision[]> => {
    const { approvals, tasks } = await openDecisions(ctx);
    const items: Decision[] = [];
    for (const approval of approvals) {
      const context = await aboutContext(ctx, approval.about, args.asOf);
      if (approval.proposal?.kind === "offer_assignment") {
        const cleaner = await ctx.db.get(approval.proposal.cleanerId);
        if (cleaner && !context.some((row) => row.label === "Cleaner")) context.push({ label: "Cleaner", value: cleaner.name, ref: null });
      }
      items.push({
        ref: { kind: "approval", id: approval._id },
        agent: approval.agent,
        agentName: AGENT_PROFILES[approval.agent].name,
        department: departmentOf(approval.agent).name,
        title: approval.summary,
        situation: approval.reason,
        recommended: approval.summary,
        authorizes: approval.authorizes ?? null,
        ifWaiting: approval.ifWaiting ?? null,
        deadline: approval.decideBy,
        context,
        canDecide: true,
        carriesOut: Boolean(approval.proposal),
        run: await runFor(ctx, approval.agent, approval.about, args.asOf),
      });
    }
    for (const task of tasks) {
      items.push({
        ref: { kind: "task", id: task._id },
        agent: task.agent,
        agentName: AGENT_PROFILES[task.agent].name,
        department: departmentOf(task.agent).name,
        title: task.title,
        situation: task.openQuestion ?? "This task was handed to a person.",
        recommended: null,
        authorizes: null,
        ifWaiting: null,
        deadline: task.dueAt,
        context: await aboutContext(ctx, task.about, args.asOf),
        canDecide: true,
        carriesOut: false,
        run: await runFor(ctx, task.agent, task.about, args.asOf),
      });
    }
    return items.sort((a, b) => a.deadline - b.deadline);
  },
});

/** The count behind the badge that follows the owner to every page. */
export const decisionCount = companyQuery({
  args: {},
  handler: async (ctx) => {
    const { approvals, tasks } = await openDecisions(ctx);
    return approvals.length + tasks.length;
  },
});

const DAY = 24 * 60 * 60 * 1000;

/**
 * The facts behind the sidebar's badges: things a person can act on, counted from the record. A badge
 * is never a count of messages sent or of activity.
 */
export const sidebar = companyQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args) => {
    const { approvals, tasks } = await openDecisions(ctx);
    const ahead = await visitsBetween(ctx, args.asOf, args.asOf + dispatchSettings(ctx.company).lookAheadDays * DAY);
    const unfilled = ahead.filter((visit) => visit.state === "needs_coverage");
    const work = await agentWork(ctx, "dispatch");
    return {
      /** Approvals and handed-over tasks waiting on this person. */
      decisions: approvals.length + tasks.length,
      dispatch: {
        paused: ctx.company.pausedAgents.includes("dispatch"),
        withYou: work.counts.needsDecision,
        inProgress: work.counts.open,
        waiting: work.counts.waiting,
        /** Visits Dispatch is looking at that nobody has been asked to take. */
        unfilled: unfilled.length,
        /** Of those, the ones that start within a day. */
        unfilledWithinDay: unfilled.filter((visit) => visit.startsAt < args.asOf + DAY).length,
        /** Visits with an offer out and no answer yet. */
        awaitingAnswer: ahead.filter((visit) => visit.state === "awaiting_acceptance").length,
      },
    };
  },
});

export type AgentState = "not_built" | "paused" | "needs_you" | "waiting" | "working" | "clear";
export type WorkLine = {
  taskId: Id<"tasks">;
  title: string;
  status: "open" | "waiting" | "needs_decision";
  nextAction: string | null;
  dueAt: number;
  waitingOn: string | null;
  followUpAt: number | null;
};

async function agentWork(ctx: Ctx, agent: Agent) {
  const read = (status: "open" | "waiting" | "needs_decision") =>
    ctx.db
      .query("tasks")
      .withIndex("by_company_agent_status", (q) => q.eq("companyId", ctx.companyId).eq("agent", agent).eq("status", status))
      .take(200);
  const [open, waiting, needsDecision] = [await read("open"), await read("waiting"), await read("needs_decision")];
  const profile = AGENT_PROFILES[agent];
  let state: AgentState;
  if (!profile.built) state = "not_built";
  else if (ctx.company.pausedAgents.includes(agent)) state = "paused";
  else if (needsDecision.length > 0) state = "needs_you";
  else if (open.length > 0) state = "working";
  else if (waiting.length > 0) state = "waiting";
  else state = "clear";
  const line = (task: Doc<"tasks">): WorkLine => ({
    taskId: task._id,
    title: task.title,
    status: task.status as WorkLine["status"],
    nextAction: task.nextAction ?? null,
    dueAt: task.dueAt,
    waitingOn: task.waitingOn ?? null,
    followUpAt: task.followUpAt ?? null,
  });
  const lines = [
    ...needsDecision.sort((a, b) => a.dueAt - b.dueAt),
    ...open.sort((a, b) => a.dueAt - b.dueAt),
    ...waiting.sort((a, b) => (a.followUpAt ?? 0) - (b.followUpAt ?? 0)),
  ].map(line);
  return {
    agent,
    name: profile.name,
    responsibility: profile.responsibility,
    state,
    counts: { open: open.length, waiting: waiting.length, needsDecision: needsDecision.length },
    lines,
  };
}

function summarize(agents: Awaited<ReturnType<typeof agentWork>>[]): string {
  const built = agents.filter((agent) => agent.state !== "not_built");
  if (built.length === 0) return "No agent is working here yet.";
  const total = (key: "open" | "waiting" | "needsDecision") => built.reduce((sum, agent) => sum + agent.counts[key], 0);
  const parts: string[] = [];
  if (total("needsDecision") > 0) parts.push(`${plural(total("needsDecision"), "item")} ${total("needsDecision") === 1 ? "needs" : "need"} your decision`);
  if (total("open") > 0) parts.push(`${total("open")} in progress`);
  if (total("waiting") > 0) parts.push(`${total("waiting")} waiting on a response`);
  const paused = built.filter((agent) => agent.state === "paused").map((agent) => agent.name);
  if (paused.length > 0) parts.push(`${paused.join(" and ")} paused`);
  if (parts.length === 0) return "Nothing open right now.";
  const sentence = parts.join("; ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/** Departments with the agents inside them and the actual state of their work. */
export const team = companyQuery({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const department of DEPARTMENTS) {
      const agents = [];
      for (const agent of department.agents) agents.push(await agentWork(ctx, agent));
      out.push({ id: department.id, name: department.name, purpose: department.purpose, summary: summarize(agents), agents });
    }
    return { timezone: ctx.company.timezone, departments: out };
  },
});

export type Measure = {
  key: string;
  label: string;
  why: string;
  /** not_set_up: the part of the product that would know this is not built or not connected. */
  state: "measured" | "not_set_up";
  kind: "count" | "cents";
  value: number | null;
  previous: number | null;
  /** What the number leaves out, in words. */
  limitation: string | null;
};

/** The compact weekly view: the last seven days against the seven before. */
export const week = companyQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args) => {
    const tz = ctx.company.timezone;
    const tomorrowStart = addLocalDays(startOfLocalDay(args.asOf, tz), 1, tz);
    const thisFrom = addLocalDays(tomorrowStart, -7, tz);
    const lastFrom = addLocalDays(tomorrowStart, -14, tz);
    const completedBetween = async (from: number, to: number) =>
      ctx.db
        .query("jobs")
        .withIndex("by_company_status_start", (q) => q.eq("companyId", ctx.companyId).eq("status", "completed").gte("startsAt", from).lt("startsAt", to))
        .take(1000);
    const [thisWeek, lastWeek] = [await completedBetween(thisFrom, tomorrowStart), await completedBetween(lastFrom, thisFrom)];
    const revenue = (jobs: Doc<"jobs">[]) => jobs.reduce((sum, job) => sum + (job.priceCents ?? 0), 0);
    const unpriced = thisWeek.filter((job) => job.priceCents === undefined).length;
    const upcoming = await visitsBetween(ctx, args.asOf, addLocalDays(tomorrowStart, 7, tz));
    const gaps = upcoming.filter((visit) => visit.state === "needs_coverage" || visit.state === "awaiting_acceptance").length;
    const notSetUp = (key: string, label: string, why: string, limitation: string, kind: "count" | "cents" = "count"): Measure => ({ key, label, why, state: "not_set_up", kind, value: null, previous: null, limitation });

    const measures: Measure[] = [
      { key: "completed_visits", label: "Completed visits", why: "Work actually delivered.", state: "measured", kind: "count", value: thisWeek.length, previous: lastWeek.length, limitation: null },
      {
        key: "completed_revenue",
        label: "Completed service revenue",
        why: "Value of work actually delivered. This is not cash collected.",
        state: "measured",
        kind: "cents",
        value: revenue(thisWeek),
        previous: revenue(lastWeek),
        limitation: unpriced > 0 ? `${plural(unpriced, "completed visit")} ${unpriced === 1 ? "has" : "have"} no price, so ${unpriced === 1 ? "it is" : "they are"} left out.` : null,
      },
      { key: "coverage_gaps", label: "Coverage gaps", why: "Visits in the next seven days without an accepted cleaner.", state: "measured", kind: "count", value: gaps, previous: null, limitation: null },
      notSetUp("conversion", "Inquiry-to-booking conversion", "Whether sales opportunities become confirmed work.", "Arrives with the Sales agent."),
      notSetUp("cash", "Cash collected", "Money actually received.", "Payments are not connected.", "cents"),
      notSetUp("recurring", "Recurring customers", "Size and direction of the repeat customer base.", "Recurring plans arrive with Retention."),
      notSetUp("issues", "Customer issues unresolved", "Service problems that could damage retention.", "Service issues arrive with Retention."),
    ];
    return { from: thisFrom, to: tomorrowStart, previousFrom: lastFrom, measures };
  },
});

/** Every agent, for the AI Team page: what it is responsible for, where it sits, and what it is doing. */
export const agents = companyQuery({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const agent of AGENTS) {
      const work = await agentWork(ctx, agent);
      const done = await ctx.db
        .query("tasks")
        .withIndex("by_company_agent_status", (q) => q.eq("companyId", ctx.companyId).eq("agent", agent).eq("status", "done"))
        .order("desc")
        .take(5);
      const department = departmentOf(agent);
      out.push({
        ...work,
        completion: AGENT_PROFILES[agent].completion,
        department: { id: department.id, name: department.name },
        recentOutcomes: done.map((task) => ({ taskId: task._id, title: task.title, outcome: task.outcome ?? "", closedAt: task.closedAt ?? null })),
      });
    }
    return { timezone: ctx.company.timezone, canPause: ctx.role === "owner", agents: out };
  },
});
