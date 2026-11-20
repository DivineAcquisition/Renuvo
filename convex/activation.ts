/**
 * Activation: the Owner starts their agents' first work, and it runs in the background until it is done
 * (docs/onboarding/01-activation.md). The plan is code (lib/activation/plan.ts); each task's work goes
 * through the workspace's own builders and the agents' own workflows (lib/activation/work.ts).
 *
 * How it stays durable, with the same pieces the rest of Selestial uses:
 *  - Start is one transaction that writes the plan and schedules the first tick. Nothing external runs in it.
 *  - tick leases up to CONCURRENCY queued tasks and schedules execute (an action) for each.
 *  - execute runs one step as one mutation; if it throws, the step's writes roll back and stepFailed
 *    records the problem and retries with backoff, at most MAX_ATTEMPTS times.
 *  - A task waiting on an agent's own workflow is checked again by a scheduled step, never by a browser.
 *  - recover (scheduled at each lease's end) and sweep (cron) find a step whose worker never reported back.
 *  - Before every step: the batch is still running, the Owner who started it still is one, the agent isn't
 *    paused, the plan includes it, and the records still need the work.
 *
 * Public:  preview, start, current, task, cancel, retry, routines
 * Internal: tick, execute, step, stepFailed, recover, sweep, reevaluate, planFirstResult
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { authorityFor } from "./lib/authority";
import { billingState } from "./lib/billing/access";
import { companyQuery, ownerMutation } from "./lib/builders";
import { notFound, userError } from "./lib/errors";
import { recordEvent, type Actor } from "./lib/events";
import { kindFor, noticeInApp } from "./lib/activation/notices";
import { FOCUS, NOT_BUILT, planFor, regate, STATE_WORDS, type TemplateId } from "./lib/activation/plan";
import { BLOCKED_STATES, FINAL_STATES, type Output, type TaskState } from "./lib/activation/schema";
import { contextOf, snapshotOf } from "./lib/activation/snapshot";
import { accessFor, runStep, type Result } from "./lib/activation/work";
import { AGENT_PROFILES } from "./lib/departments";
import { notifyMembers } from "./lib/notify/route";
import { isOwner, roleOf } from "./lib/roles";
import { priorityValidator, type Priority } from "./lib/setup/schema";
import { AGENTS, type Agent } from "./lib/statuses";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
/** Tasks of one batch worked at once. The agents keep their own provider limits on top of this. */
export const CONCURRENCY = 3;
export const MAX_ATTEMPTS = 3;
/** How long a step may hold a task before it counts as abandoned. */
export const LEASE_MS = 2 * MINUTE;
/** The first-result email waits this long, so results finishing close together go in one email. */
const FIRST_RESULT_DELAY_MS = 2 * MINUTE;
const SYSTEM: Actor = { kind: "system" };

type Ctx = QueryCtx | MutationCtx;

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────────

async function latest(ctx: Ctx, companyId: Id<"companies">): Promise<Doc<"activations"> | null> {
  return ctx.db
    .query("activations")
    .withIndex("by_company_started", (q) => q.eq("companyId", companyId))
    .order("desc")
    .first();
}

async function tasksOf(ctx: Ctx, activationId: Id<"activations">): Promise<Doc<"activationTasks">[]> {
  return ctx.db
    .query("activationTasks")
    .withIndex("by_activation", (q) => q.eq("activationId", activationId))
    .take(20);
}

async function focusOf(ctx: Ctx, companyId: Id<"companies">, args: { focus?: Priority; secondary?: Priority[] }) {
  const setup = await ctx.db
    .query("companySetups")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .first();
  const focus = args.focus ?? setup?.priority ?? null;
  const secondary = (args.secondary ?? setup?.secondary ?? []).filter((value) => value !== focus).slice(0, 5);
  return { focus, secondary, setup };
}

/** What Start would do, for the review screen: the tasks, why each runs or waits, and what it may cost. */
export const preview = companyQuery({
  args: { focus: v.optional(priorityValidator), secondary: v.optional(v.array(priorityValidator)) },
  handler: async (ctx, args) => {
    const { focus, secondary } = await focusOf(ctx, ctx.companyId, args);
    const running = await latest(ctx, ctx.companyId);
    const current = running && running.status === "running" ? { id: running._id, focus: running.focus, startedAt: running.startedAt } : null;
    if (!focus) return { focus: null, secondary, tasks: [], budget: null, notBuilt: NOT_BUILT, current, canStart: isOwner(ctx.role) };
    const snapshot = await snapshotOf(ctx, ctx.company, Date.now());
    const tasks = planFor(focus, secondary, snapshot);
    const credits = tasks.reduce((sum, t) => sum + t.estimate.credits, 0);
    const billing = billingState();
    return {
      focus: { id: focus, words: FOCUS[focus].words, lead: FOCUS[focus].lead, agent: FOCUS[focus].agent },
      secondary,
      tasks: tasks.map((t) => ({ ...t, stateWords: STATE_WORDS[t.state], agentName: AGENT_PROFILES[t.agent].name })),
      budget: { credits, words: budgetWords(credits, billing.connected) },
      notBuilt: NOT_BUILT,
      current,
      canStart: isOwner(ctx.role),
    };
  },
});

function budgetWords(credits: number, connected: boolean): { estimate: string; allowance: string } {
  return {
    estimate: credits === 0 ? "This plan uses no AI credits. Its drafts come from templates and your confirmed answers; any message an agent is allowed to send counts as a normal business message." : `Up to ${credits} Selestial Credits, and never more: each task stops before it would go over.`,
    // There is no setup allowance in the billing catalog. Saying so is the honest answer until one is decided.
    allowance: connected ? "No separate setup allowance applies: any AI work is charged to your plan's credits at the current rate card." : "Billing isn't connected yet, so any AI work waits; the preparation work still runs.",
  };
}

// ── Starting ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The Owner starts the displayed plan. Pressing it twice, from two tabs, or coming back to setup later
 * finds the same batch: a batch still running is never started again, and the same context is one batch.
 * From setup, it also opens the workspace (and records that once, like setup.enter).
 */
export const start = ownerMutation({
  args: { source: v.union(v.literal("setup"), v.literal("workspace")), focus: v.optional(priorityValidator), secondary: v.optional(v.array(priorityValidator)) },
  handler: async (ctx, args) => {
    const { focus, secondary, setup } = await focusOf(ctx, ctx.companyId, args);
    if (!focus) throw userError("Choose what Selestial should focus on first.");
    const now = Date.now();
    if (args.source === "setup" && setup && setup.status === "in_progress") {
      await ctx.db.patch(setup._id, { status: "entered", milestones: { ...setup.milestones, enteredAt: now }, revision: setup.revision + 1, updatedAt: now });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "setup.workspace_entered", actor: { kind: "member", memberId: ctx.member._id }, subject: { table: "companies", id: ctx.companyId }, data: { priority: setup.priority ?? "none", contextConfirmed: setup.milestones.contextConfirmedAt !== undefined, startedAgents: true } });
    }
    const running = await latest(ctx, ctx.companyId);
    if (running && running.status === "running") return { activationId: running._id, already: true };

    const snapshot = await snapshotOf(ctx, ctx.company, now);
    const { version, context } = await contextOf(ctx, ctx.company, focus, secondary, snapshot);
    const same = await ctx.db
      .query("activations")
      .withIndex("by_company_version", (q) => q.eq("companyId", ctx.companyId).eq("contextVersion", version))
      .first();
    if (same && same.status !== "canceled") return { activationId: same._id, already: true };

    const planned = planFor(focus, secondary, snapshot);
    if (!planned.length) throw userError("There's nothing for your agents to start with this focus yet.");
    const credits = planned.reduce((sum, t) => sum + t.estimate.credits, 0);
    const words = budgetWords(credits, billingState().connected);
    const activationId = await ctx.db.insert("activations", {
      companyId: ctx.companyId,
      focus,
      secondary,
      source: args.source,
      contextVersion: version,
      context: context.slice(0, 60),
      status: "running",
      startedBy: ctx.member._id,
      startedAt: now,
      budget: { estimatedCredits: credits, ceilingCredits: credits, allowance: words.allowance },
      noticed: {},
      updatedAt: now,
    });
    for (const t of planned) {
      await ctx.db.insert("activationTasks", {
        companyId: ctx.companyId,
        activationId,
        template: t.template,
        agent: t.agent,
        title: t.title,
        objective: t.objective,
        sources: t.sources,
        expectedOutput: t.expectedOutput,
        prerequisites: t.prerequisites,
        authority: t.authority,
        estimate: t.estimate,
        priority: t.priority,
        dependsOn: t.dependsOn,
        completion: t.completion,
        state: t.state,
        statusLine: t.statusLine,
        steps: [{ at: now, words: t.state === "queued" ? "Planned from your focus and confirmed details." : "Planned, and waiting for what is named below.", kind: t.state === "queued" ? "info" : "waiting" }],
        outputs: [],
        ...(t.blocker ? { blocker: t.blocker } : {}),
        attempts: 0,
        nextRunAt: now,
        charges: [],
        approvals: [],
        createdAt: now,
        updatedAt: now,
        ...(t.state === "unavailable" ? { finishedAt: now } : {}),
      });
    }
    // Work that can't start yet is told once, with the one thing that unblocks it.
    for (const row of await tasksOf(ctx, activationId)) if (row.state === "waiting_info" || row.state === "waiting_connection") await noticeTask(ctx, (await ctx.db.get(activationId))!, row);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "activation.started", actor: { kind: "member", memberId: ctx.member._id }, subject: { table: "companies", id: ctx.companyId }, data: { focus, tasks: planned.length, source: args.source, version } });
    await ctx.scheduler.runAfter(0, internal.activation.tick, { activationId });
    return { activationId, already: false };
  },
});

// ── Running ─────────────────────────────────────────────────────────────────────────────────────────

/** Leases the next tasks whose turn it is and starts them. Safe to run any number of times. */
export const tick = internalMutation({
  args: { activationId: v.id("activations") },
  handler: async (ctx, args) => {
    const activation = await ctx.db.get(args.activationId);
    if (!activation || activation.status !== "running") return null;
    const tasks = await tasksOf(ctx, activation._id);
    const now = Date.now();
    const settledIds = new Set(tasks.filter((t) => FINAL_STATES.includes(t.state) || BLOCKED_STATES.includes(t.state)).map((t) => t.template));
    let working = tasks.filter((t) => t.state === "working").length;
    let soonest: number | null = null;
    const ready = tasks.filter((t) => t.state === "queued").sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
    for (const task of ready) {
      if (!task.dependsOn.every((dep) => settledIds.has(dep) || !tasks.some((t) => t.template === dep))) continue;
      if (task.nextRunAt > now) {
        soonest = Math.min(soonest ?? task.nextRunAt, task.nextRunAt);
        continue;
      }
      if (working >= CONCURRENCY) break;
      working += 1;
      const attempt = task.attempts + 1;
      await ctx.db.patch(task._id, { state: "working", attempts: attempt, leaseUntil: now + LEASE_MS, statusLine: workingLine(task.template as TemplateId), updatedAt: now });
      await ctx.scheduler.runAfter(0, internal.activation.execute, { taskId: task._id, attempt, phase: "start" });
      await ctx.scheduler.runAfter(LEASE_MS + 5 * SECOND, internal.activation.recover, { taskId: task._id, attempt });
    }
    if (soonest !== null) await ctx.scheduler.runAt(soonest, internal.activation.tick, { activationId: activation._id });
    await settle(ctx, activation);
    return null;
  },
});

/** What a task is doing while it works, precisely. */
function workingLine(template: TemplateId): string {
  const lines: Record<TemplateId, string> = {
    "sales.service_draft": "Preparing your service draft.",
    "sales.booking_page": "Preparing your booking page.",
    "sales.agreement_draft": "Preparing your agreement draft.",
    "sales.faq_answers": "Writing proposed answers from your confirmed details.",
    "sales.inquiry_follow_through": "Reviewing imported inquiries.",
    "recruiter.role_draft": "Creating your application form.",
    "recruiter.applicant_review": "Reading your hiring inbox.",
    "dispatch.coverage_review": "Checking coverage for upcoming appointments.",
    "dispatch.readiness": "Checking what Dispatch needs to offer work.",
    "retention.review": "Reviewing completed services and recurring plans.",
    "retention.care_setup": "Preparing your feedback and recovery steps.",
  };
  return lines[template] ?? "Working on it.";
}

/** Runs one step in its own transaction, and records a failure in another, so a failure can't leave half a step. */
export const execute = internalAction({
  args: { taskId: v.id("activationTasks"), attempt: v.number(), phase: v.union(v.literal("start"), v.literal("check")) },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(internal.activation.step, args);
    } catch (error) {
      const data = (error as { data?: { message?: unknown } }).data;
      const problem = data && typeof data.message === "string" ? data.message : "An unexpected problem stopped this step.";
      await ctx.runMutation(internal.activation.stepFailed, { taskId: args.taskId, attempt: args.attempt, problem: problem.slice(0, 300) });
    }
    return null;
  },
});

export const step = internalMutation({
  args: { taskId: v.id("activationTasks"), attempt: v.number(), phase: v.union(v.literal("start"), v.literal("check")) },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    // A step from an older attempt, or for a task that moved on, does nothing.
    if (!task || task.state !== "working" || task.attempts !== args.attempt) return null;
    const activation = await ctx.db.get(task.activationId);
    const company = await ctx.db.get(task.companyId);
    const now = Date.now();
    if (!activation || !company) return null;
    if (activation.status !== "running") {
      await finishTask(ctx, task, { state: "canceled", statusLine: "Canceled before this step ran.", steps: [] });
      return null;
    }
    // Checked again now: authority can be revoked while work is underway.
    const starter = await ctx.db.get(activation.startedBy);
    if (!starter || starter.companyId !== company._id || starter.status !== "active" || roleOf(starter.role) !== "owner") {
      await stopActivation(ctx, activation, "The Owner who started this no longer has Owner access, so the remaining work stopped. Everything already made is kept.");
      return null;
    }
    if (company.suspendedAt !== undefined) {
      await finishTask(ctx, task, { state: "paused", statusLine: "Paused while the company is suspended.", steps: [{ at: now, words: "Stopped: the company is suspended, so nothing runs.", kind: "waiting" }], blocker: { kind: "paused", words: "Your company is suspended, so nothing runs.", action: { label: "Contact support", href: "/app/settings" } } });
      return null;
    }
    const snapshot = await snapshotOf(ctx, company, now);
    if (args.phase === "start") {
      const gate = regate(task.template as TemplateId, snapshot);
      if (gate) {
        await finishTask(ctx, task, { state: gate.state, statusLine: gate.statusLine, blocker: gate.blocker, steps: [{ at: now, words: gate.blocker.words, kind: "waiting" }] });
        await ctx.scheduler.runAfter(0, internal.activation.tick, { activationId: activation._id });
        return null;
      }
      // A task that would use credits stops cleanly when it would pass the batch's ceiling.
      if (task.estimate.credits > 0) {
        const spent = (await tasksOf(ctx, activation._id)).reduce((sum, t) => sum + t.charges.reduce((s, c) => s + c.credits, 0), 0);
        if (spent + task.estimate.credits > activation.budget.ceilingCredits) {
          await finishTask(ctx, task, { state: "waiting_info", statusLine: "Stopped at your spending limit.", blocker: { kind: "credits", words: "This would go over what you approved for this work. Nothing more was spent.", action: { label: "Review credits", href: "/app/settings/billing" } }, steps: [{ at: now, words: "Stopped before passing the approved credit limit.", kind: "waiting" }] });
          return null;
        }
      }
    }
    const access = accessFor(ctx, company, starter);
    const result = await runStep({ ctx, access, company, activation, task, snapshot, now }, args.phase);
    await applyResult(ctx, activation, task, result);
    return null;
  },
});

async function applyResult(ctx: MutationCtx, activation: Doc<"activations">, task: Doc<"activationTasks">, result: Result) {
  const now = Date.now();
  if (result.kind === "watch") {
    await ctx.db.patch(task._id, { statusLine: result.statusLine, steps: [...task.steps, ...result.steps].slice(-40), outputs: result.outputs, watching: result.watching, leaseUntil: now + result.checkAfterMs + LEASE_MS, updatedAt: now });
    await ctx.scheduler.runAfter(result.checkAfterMs, internal.activation.execute, { taskId: task._id, attempt: task.attempts, phase: "check" });
    await ctx.scheduler.runAfter(result.checkAfterMs + LEASE_MS + 5 * SECOND, internal.activation.recover, { taskId: task._id, attempt: task.attempts });
    return;
  }
  await finishTask(ctx, task, { state: result.state, statusLine: result.statusLine, steps: result.steps, outputs: result.outputs, ...(result.kind === "blocked" ? { blocker: result.blocker } : {}) });
  await ctx.scheduler.runAfter(0, internal.activation.tick, { activationId: activation._id });
}

/** Moves a task to a resting state, with what it made, and tells the right people once. */
async function finishTask(ctx: MutationCtx, task: Doc<"activationTasks">, change: { state: TaskState; statusLine: string; steps: Doc<"activationTasks">["steps"]; outputs?: Output[]; blocker?: Doc<"activationTasks">["blocker"]; lastError?: string }) {
  const now = Date.now();
  const final = FINAL_STATES.includes(change.state);
  const outputs = change.outputs ?? task.outputs;
  await ctx.db.patch(task._id, {
    state: change.state,
    statusLine: change.statusLine,
    steps: [...task.steps, ...change.steps].slice(-40),
    outputs,
    blocker: change.blocker,
    leaseUntil: undefined,
    watching: undefined,
    ...(change.lastError ? { lastError: change.lastError } : {}),
    ...(final ? { finishedAt: now } : {}),
    updatedAt: now,
  });
  const activation = await ctx.db.get(task.activationId);
  if (!activation) return;
  if (change.state !== task.state || (change.outputs?.length ?? 0) > 0) await noticeTask(ctx, activation, { ...task, state: change.state, statusLine: change.statusLine, outputs, blocker: change.blocker });
  if (final) await recordEvent(ctx, { companyId: task.companyId, type: `activation.task_${change.state}`, actor: { kind: "agent", agent: task.agent }, subject: { table: "companies", id: task.companyId }, data: { template: task.template, outputs: outputs.length } });
}

async function noticeTask(ctx: MutationCtx, activation: Doc<"activations">, task: Doc<"activationTasks">) {
  if (task.state === "canceled" || task.state === "unavailable" || task.state === "paused") return;
  const firstResult = activation.noticed.firstResultAt === undefined && task.outputs.length > 0 && (task.state === "completed" || task.state === "ready_for_review");
  const kind = kindFor(task.state, task.outputs, firstResult);
  if (!kind) return;
  const target = task.outputs[0]?.ref ?? (task.blocker ? { table: "activationTasks", id: task._id, label: task.blocker.action.label, href: task.blocker.action.href } : undefined);
  await noticeInApp(ctx, {
    companyId: task.companyId,
    kind,
    agent: task.agent,
    headline: task.state === "failed" ? `${AGENT_PROFILES[task.agent].name} couldn't finish: ${task.title.toLowerCase()}` : task.statusLine,
    summary: task.blocker?.words ?? summaryOf(task),
    activationId: activation._id,
    taskId: task._id,
    target,
    key: `activation:${task._id}:${kind}`,
  });
  if (firstResult) {
    await ctx.db.patch(activation._id, { noticed: { ...activation.noticed, firstResultAt: Date.now() }, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(FIRST_RESULT_DELAY_MS, internal.activation.planFirstResult, { activationId: activation._id });
  }
}

function summaryOf(task: Doc<"activationTasks">): string {
  const made = task.outputs.map((o) => `${o.ref.label} (${o.state})`).join("; ");
  return made ? `${AGENT_PROFILES[task.agent].name}: ${made}.` : task.steps[task.steps.length - 1]?.words ?? task.statusLine;
}

/** The first-result email, planned after a short wait so close results share one email. Never changes a task. */
export const planFirstResult = internalMutation({
  args: { activationId: v.id("activations") },
  handler: async (ctx, args) => {
    const activation = await ctx.db.get(args.activationId);
    if (!activation || activation.status === "canceled") return null;
    await notifyMembers(ctx, { companyId: activation.companyId, event: "activation_result", ref: activation._id, key: "first", also: [activation.startedBy] });
    return null;
  },
});

/** A step threw: its writes were rolled back. Retry with backoff, or fail the task with the reason. */
export const stepFailed = internalMutation({
  args: { taskId: v.id("activationTasks"), attempt: v.number(), problem: v.string() },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.state !== "working" || task.attempts !== args.attempt) return null;
    await retryOrFail(ctx, task, args.problem);
    return null;
  },
});

async function retryOrFail(ctx: MutationCtx, task: Doc<"activationTasks">, problem: string) {
  const now = Date.now();
  if (task.attempts < MAX_ATTEMPTS) {
    const wait = 30 * SECOND * 2 ** (task.attempts - 1);
    await ctx.db.patch(task._id, { state: "queued", leaseUntil: undefined, watching: undefined, nextRunAt: now + wait, lastError: problem, statusLine: `Trying again shortly after a problem: ${problem}`, steps: [...task.steps, { at: now, words: `A step didn't finish (${problem}). Nothing from it was kept; trying again.`, kind: "failed" as const }].slice(-40), updatedAt: now });
    await ctx.scheduler.runAfter(wait, internal.activation.tick, { activationId: task.activationId });
    return;
  }
  await finishTask(ctx, task, { state: "failed", statusLine: `Couldn't finish after ${MAX_ATTEMPTS} tries.`, steps: [{ at: now, words: `Stopped after ${MAX_ATTEMPTS} tries: ${problem}`, kind: "failed" }], lastError: problem, blocker: { kind: "information", words: `${problem} You can try it again from Home.`, action: { label: "Try again", href: "/app" } } });
  await ctx.scheduler.runAfter(0, internal.activation.tick, { activationId: task.activationId });
}

/** A step's lease ran out and it never reported back (its worker stopped). Same as a failed step. */
export const recover = internalMutation({
  args: { taskId: v.id("activationTasks"), attempt: v.number() },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.state !== "working" || task.attempts !== args.attempt) return null;
    if ((task.leaseUntil ?? 0) > Date.now()) return null;
    await retryOrFail(ctx, task, "The step stopped without reporting back.");
    return null;
  },
});

/** Every few minutes: abandoned steps, batches that need a tick, and blocked work that may be able to go. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query("activationTasks")
      .withIndex("by_state_lease", (q) => q.eq("state", "working").lt("leaseUntil", now - 30 * SECOND))
      .take(50);
    for (const task of stale) await retryOrFail(ctx, task, "The step stopped without reporting back.");
    const running = await ctx.db
      .query("activations")
      .withIndex("by_status_updated", (q) => q.eq("status", "running"))
      .take(100);
    for (const activation of running) {
      await ctx.scheduler.runAfter(0, internal.activation.tick, { activationId: activation._id });
      await ctx.scheduler.runAfter(0, internal.activation.reevaluate, { companyId: activation.companyId });
    }
    return { recovered: stale.length, batches: running.length };
  },
});

/**
 * Something changed (an inbox connected, inquiries imported, an agent resumed): blocked tasks of the
 * latest batch are checked again from fresh records. One that can go now is queued, if the Owner who
 * started it still is one. A finished task is never restarted.
 */
export const reevaluate = internalMutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const activation = await latest(ctx, args.companyId);
    const company = await ctx.db.get(args.companyId);
    if (!activation || !company || activation.status === "canceled") return null;
    const blocked = (await tasksOf(ctx, activation._id)).filter((t) => BLOCKED_STATES.includes(t.state));
    if (!blocked.length) return null;
    const starter = await ctx.db.get(activation.startedBy);
    if (!starter || starter.status !== "active" || roleOf(starter.role) !== "owner") return null;
    const snapshot = await snapshotOf(ctx, company, Date.now());
    let woke = 0;
    for (const task of blocked) {
      const gate = regate(task.template as TemplateId, snapshot);
      if (gate && gate.state === task.state) continue;
      const now = Date.now();
      if (gate) {
        await ctx.db.patch(task._id, { state: gate.state, statusLine: gate.statusLine, blocker: gate.blocker, updatedAt: now });
        continue;
      }
      await ctx.db.patch(task._id, { state: "queued", blocker: undefined, nextRunAt: now, statusLine: "Ready to go again: what it was waiting for is in place.", steps: [...task.steps, { at: now, words: "What it was waiting for is in place, so it's going again.", kind: "info" as const }].slice(-40), updatedAt: now });
      woke += 1;
    }
    if (woke) {
      if (activation.status !== "running") await ctx.db.patch(activation._id, { status: "running", finishedAt: undefined, updatedAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.activation.tick, { activationId: activation._id });
    }
    return { woke };
  },
});

/** When nothing is queued or working, the batch has settled: completed, or partial with what's left. Told once. */
async function settle(ctx: MutationCtx, activation: Doc<"activations">) {
  const tasks = await tasksOf(ctx, activation._id);
  if (tasks.some((t) => t.state === "queued" || t.state === "working")) return;
  const now = Date.now();
  const clean = tasks.every((t) => t.state === "completed" || t.state === "ready_for_review" || t.state === "unavailable");
  const status = clean ? "completed" : "partial";
  await ctx.db.patch(activation._id, { status, finishedAt: now, updatedAt: now, ...(activation.noticed.summaryAt === undefined ? { noticed: { ...activation.noticed, summaryAt: now } } : {}) });
  if (activation.noticed.summaryAt !== undefined) return;
  const made = tasks.reduce((sum, t) => sum + t.outputs.length, 0);
  const waiting = tasks.filter((t) => BLOCKED_STATES.includes(t.state)).length;
  await noticeInApp(ctx, {
    companyId: activation.companyId,
    kind: "batch_finished",
    headline: clean ? "Your agents finished their first work" : "Your agents' first work is partly done",
    summary: `${made} ${made === 1 ? "result" : "results"} ready${waiting ? `, ${waiting} waiting on something from you` : ""}.`,
    activationId: activation._id,
    target: { table: "activations", id: activation._id, label: "Your agents' work", href: `/app?activation=${activation._id}` },
    key: `activation:${activation._id}:settled`,
  });
  await notifyMembers(ctx, { companyId: activation.companyId, event: "activation_summary", ref: activation._id, key: "summary", also: [activation.startedBy] });
  await recordEvent(ctx, { companyId: activation.companyId, type: `activation.${status}`, actor: SYSTEM, subject: { table: "companies", id: activation.companyId }, data: { results: made, waiting } });
}

async function stopActivation(ctx: MutationCtx, activation: Doc<"activations">, words: string, by?: Id<"members">) {
  const now = Date.now();
  await ctx.db.patch(activation._id, { status: "canceled", finishedAt: now, updatedAt: now, ...(by ? { canceledBy: by } : {}) });
  for (const task of await tasksOf(ctx, activation._id)) {
    if (FINAL_STATES.includes(task.state)) continue;
    await ctx.db.patch(task._id, { state: "canceled", statusLine: "Canceled.", leaseUntil: undefined, watching: undefined, finishedAt: now, steps: [...task.steps, { at: now, words, kind: "info" as const }].slice(-40), updatedAt: now });
  }
}

// ── The Owner's controls ────────────────────────────────────────────────────────────────────────────

/** Stops future work. What was already made stays, and the tasks say exactly what happened. */
export const cancel = ownerMutation({
  args: { activationId: v.id("activations") },
  handler: async (ctx, args) => {
    const activation = await ctx.db.get(args.activationId);
    if (!activation || activation.companyId !== ctx.companyId) notFound();
    if (activation.status === "canceled") return null;
    await stopActivation(ctx, activation, "You canceled the rest of this work. Everything listed here as made was kept.", ctx.member._id);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "activation.canceled", actor: { kind: "member", memberId: ctx.member._id }, subject: { table: "companies", id: ctx.companyId } });
    return null;
  },
});

/** Tries a failed or blocked task again. A task that already finished is not run twice. */
export const retry = ownerMutation({
  args: { taskId: v.id("activationTasks") },
  support: { capability: "agents.recover", summary: "tried failed first agent work again" },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.companyId !== ctx.companyId) notFound();
    const activation = await ctx.db.get(task.activationId);
    if (!activation || activation.status === "canceled") throw userError("This work was canceled. Start your agents again from Home.");
    if (task.state !== "failed" && !BLOCKED_STATES.includes(task.state)) throw userError(task.state === "working" || task.state === "queued" ? "It's already going." : "This task already finished. Its results are kept.");
    const now = Date.now();
    await ctx.db.patch(task._id, { state: "queued", attempts: 0, blocker: undefined, nextRunAt: now, finishedAt: undefined, statusLine: ctx.support ? "Queued again by Selestial Support." : "Queued again at your request.", steps: [...task.steps, { at: now, words: ctx.support ? "Selestial Support tried it again." : "You asked to try it again.", kind: "info" as const }].slice(-40), updatedAt: now });
    if (activation.status !== "running") await ctx.db.patch(activation._id, { status: "running", finishedAt: undefined, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.activation.tick, { activationId: activation._id });
    return null;
  },
});

// ── Home ────────────────────────────────────────────────────────────────────────────────────────────

/** The latest batch, as Home shows it: by agent, with real steps, real outputs and what waits on the owner. */
export const current = companyQuery({
  args: { activationId: v.optional(v.id("activations")) },
  handler: async (ctx, args) => {
    const pick = args.activationId ? await ctx.db.get(args.activationId) : await latest(ctx, ctx.companyId);
    const activation = pick && pick.companyId === ctx.companyId ? pick : null;
    const setup = await ctx.db
      .query("companySetups")
      .withIndex("by_company", (q) => q.eq("companyId", ctx.companyId))
      .first();
    if (!activation) return { activation: null, canStart: isOwner(ctx.role), focus: setup?.priority ?? null };
    const tasks = (await tasksOf(ctx, activation._id)).sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
    const approvals = [];
    for (const id of [...new Set(tasks.flatMap((t) => t.approvals))].slice(0, 20)) {
      const row = await ctx.db.get(id);
      if (row && row.companyId === ctx.companyId && row.status === "pending") approvals.push({ id: row._id, summary: row.summary, agent: row.agent });
    }
    return {
      activation: {
        id: activation._id,
        focus: { id: activation.focus, words: FOCUS[activation.focus].words, agent: FOCUS[activation.focus].agent },
        status: activation.status,
        startedAt: activation.startedAt,
        finishedAt: activation.finishedAt ?? null,
        budget: activation.budget,
        counts: {
          working: tasks.filter((t) => t.state === "working" || t.state === "queued").length,
          ready: tasks.filter((t) => t.state === "ready_for_review").length,
          blocked: tasks.filter((t) => BLOCKED_STATES.includes(t.state)).length,
          done: tasks.filter((t) => t.state === "completed").length,
          failed: tasks.filter((t) => t.state === "failed").length,
          outputs: tasks.reduce((sum, t) => sum + t.outputs.length, 0),
        },
        tasks: tasks.map((t) => ({
          id: t._id,
          agent: t.agent,
          agentName: AGENT_PROFILES[t.agent].name,
          title: t.title,
          state: t.state,
          stateWords: STATE_WORDS[t.state],
          statusLine: t.statusLine,
          priority: t.priority,
          steps: t.steps.filter((s) => s.kind !== "info" || t.steps.length < 6).slice(-4),
          outputs: t.outputs,
          blocker: t.blocker ?? null,
          updatedAt: t.updatedAt,
        })),
        approvals,
      },
      canStart: isOwner(ctx.role),
      focus: activation.focus,
    };
  },
});

/** One task in full: what it read, what it did, what it made, what it cost, and what happens next. */
export const task = companyQuery({
  args: { taskId: v.id("activationTasks") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.taskId);
    if (!row || row.companyId !== ctx.companyId) notFound();
    const activation = await ctx.db.get(row.activationId);
    if (!activation) notFound();
    // Charges are read back from the agents' own executions, never estimated after the fact.
    const charges: { label: string; credits: number; state: string }[] = [];
    for (const charge of row.charges) {
      const execution = await ctx.db.get(charge.executionId);
      if (execution) charges.push({ label: execution.task, credits: execution.credits, state: execution.state });
    }
    const approvals = [];
    for (const id of row.approvals.slice(0, 20)) {
      const approval = await ctx.db.get(id);
      if (approval && approval.companyId === ctx.companyId) approvals.push({ id: approval._id, summary: approval.summary, status: approval.status });
    }
    const authority = row.authority.action ? await authorityFor(ctx, ctx.companyId, row.authority.action) : null;
    return {
      id: row._id,
      agent: row.agent,
      agentName: AGENT_PROFILES[row.agent].name,
      title: row.title,
      objective: row.objective,
      state: row.state,
      stateWords: STATE_WORDS[row.state],
      statusLine: row.statusLine,
      inputs: { sources: row.sources, prerequisites: row.prerequisites, context: activation.context, contextVersion: activation.contextVersion },
      expectedOutput: row.expectedOutput,
      completion: row.completion,
      authority: { ...row.authority, now: authority?.kind === "level" ? authority.level : (authority?.kind ?? null) },
      steps: row.steps,
      outputs: row.outputs,
      estimate: row.estimate,
      charges,
      approvals,
      blocker: row.blocker ?? null,
      attempts: row.attempts,
      lastError: row.lastError ?? null,
      canRetry: isOwner(ctx.role) && (row.state === "failed" || BLOCKED_STATES.includes(row.state)) && activation.status !== "canceled",
      next: row.blocker ? row.blocker.words : row.state === "ready_for_review" ? "Review what it made. Nothing is published or sent until you decide." : row.state === "completed" ? "Nothing: this is done. The agent's routine keeps working from here." : row.statusLine,
      startedAt: row.createdAt,
      finishedAt: row.finishedAt ?? null,
    };
  },
});

/**
 * The ongoing routines each agent runs after activation, from the record: what triggers it, the
 * permission that governs what it sends, and whether it's running. They are the agents' own event
 * triggers and reconciliation schedules (convex/crons.ts); pausing an agent stops all of them.
 */
export const routines = companyQuery({
  args: {},
  handler: async (ctx) => {
    const ROUTINES: Record<Agent, { trigger: string; schedule: string; action: string }> = {
      sales: { trigger: "A new inquiry or reply → Sales qualifies it and prepares the next step.", schedule: "Checks for overdue next steps every 5 minutes.", action: "sales.reply_and_quote" },
      recruiter: { trigger: "A new application in your hiring inbox → Recruiter files it and routes it to an open role.", schedule: "Reads connected hiring inboxes every 10 minutes.", action: "recruiter.send_invitation" },
      dispatch: { trigger: "A new or changed visit → Dispatch checks its coverage.", schedule: "Looks for uncovered visits every 15 minutes.", action: "dispatch.request_acceptance" },
      retention: { trigger: "A completed visit or a customer concern → Retention follows through.", schedule: "Reconciles plans, visits, billing and agreements every 10 minutes.", action: "retention.request_feedback" },
    };
    const out = [];
    for (const agent of AGENTS) {
      const found = await authorityFor(ctx, ctx.companyId, ROUTINES[agent].action);
      const level = found.kind === "level" ? found.level : found.kind;
      out.push({ agent, name: AGENT_PROFILES[agent].name, ...ROUTINES[agent], level, paused: ctx.company.pausedAgents.includes(agent), built: AGENT_PROFILES[agent].built });
    }
    return out;
  },
});
