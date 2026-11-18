/**
 * What a client's records say needs attention, and what Selestial is doing about it, read from the
 * records themselves: tasks, approvals, visits and their crews. Nothing here is a score: each signal names
 * its record, its date and the action it suggests, and a count is shown only when records back it.
 *
 * Booked, staffed, done and paid are separate facts and are never folded into one word.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { AGENT_PROFILES } from "../departments";
import { coverKey } from "../dispatch/workflow";
import { staffing } from "../dispatch/crew";
import { liveTaskByKey } from "../taskState";

const DAY = 24 * 60 * 60 * 1000;
const OPEN_TASK = new Set(["open", "waiting", "needs_decision"]);

export type ClientIds = { customerId: Id<"customers">; propertyIds: Id<"properties">[] };

/** A visit as the client's pages show it: when, where, what, and the crew, without the crew's private details. */
export async function visitSummary(ctx: QueryCtx, company: Doc<"companies">, job: Doc<"jobs">, propertyName: (id: Id<"properties">) => string) {
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_company_job", (q) => q.eq("companyId", job.companyId).eq("jobId", job._id))
    .take(30);
  const crew = staffing(job, assignments);
  const cover = job.status === "scheduled" ? await liveTaskByKey(ctx, job.companyId, coverKey(job._id)) : null;
  const staffingWords =
    job.status === "cancelled"
      ? null
      : crew.state === "full"
        ? `Crew confirmed (${crew.accepted} of ${crew.required})`
        : crew.accepted > 0
          ? `${crew.accepted} of ${crew.required} cleaners accepted`
          : crew.offersOut > 0
            ? `Offered to ${crew.offersOut} cleaner${crew.offersOut === 1 ? "" : "s"}, none accepted yet`
            : "No cleaner yet";
  const handling = cover ? (cover.withPersonSince !== undefined ? "A person is handling the staffing." : company.pausedAgents.includes("dispatch") ? "Dispatch is paused." : cover.status === "needs_decision" ? "Dispatch needs a decision about the crew." : "Dispatch is finding a cleaner.") : null;
  const outcome =
    job.status === "cancelled"
      ? job.skipped
        ? "Skipped"
        : "Cancelled"
      : job.status === "completed"
        ? job.completionReview
          ? job.completionReview.decision === "closed"
            ? "Completed and reviewed"
            : "Completed, closed without review"
          : "Completed, review open"
        : job.status === "in_progress"
          ? job.completionReportedAt
            ? "Crew reported it done"
            : "In progress"
          : "Booked";
  return {
    id: job._id,
    startsAt: job.startsAt,
    endsAt: job.endsAt,
    arrivalWindowMinutes: job.arrivalWindowMinutes ?? 0,
    service: job.serviceType,
    scope: job.scope.split("\n")[0].slice(0, 160),
    propertyId: job.propertyId,
    property: propertyName(job.propertyId),
    status: job.status,
    outcome,
    skipped: job.skipped === true,
    cancelReason: job.cancelReason ?? null,
    planId: job.planId ?? null,
    staffing: job.status === "scheduled" || job.status === "in_progress" ? { state: crew.state, words: staffingWords, handling } : null,
    priceCents: job.priceCents ?? null,
  };
}

export type VisitSummary = Awaited<ReturnType<typeof visitSummary>>;

/** Open tasks about the client, its properties, or its visits in the coming month. */
export async function clientTasks(ctx: QueryCtx, companyId: Id<"companies">, ids: ClientIds, jobIds: Id<"jobs">[]) {
  const subjects = [ids.customerId, ...ids.propertyIds, ...jobIds];
  const out: Doc<"tasks">[] = [];
  for (const id of subjects) {
    const rows = await ctx.db
      .query("tasks")
      .withIndex("by_company_about", (q) => q.eq("companyId", companyId).eq("about.id", id))
      .take(30);
    for (const row of rows) if (OPEN_TASK.has(row.status) && !out.some((t) => t._id === row._id)) out.push(row);
  }
  return out.sort((a, b) => a.dueAt - b.dueAt);
}

const WAITING_WORDS: Record<string, string> = { customer: "Waiting on the client", cleaner: "Waiting on a cleaner", applicant: "Waiting on an applicant", owner: "Waiting on the Owner", other: "Waiting" };

/** A task as a "Selestial is handling" card: who has it, what happened, what is next, and what blocks it. */
export function taskCard(task: Doc<"tasks">, company: Doc<"companies">, pendingApproval: Doc<"approvals"> | null) {
  const profile = AGENT_PROFILES[task.agent];
  const paused = company.pausedAgents.includes(task.agent);
  const withPerson = task.withPersonSince !== undefined || !profile.built || task.handoffTo !== undefined;
  const owner = task.handoffTo
    ? `${task.handoffTo.replace(/_/g, " ").replace(/^./, (c: string) => c.toUpperCase())} queue, worked by a person`
    : task.withPersonSince !== undefined
      ? "A person"
      : !profile.built
        ? `A person (${profile.name} is not built yet)`
        : paused
          ? `${profile.name}, paused`
          : profile.name;
  const state = pendingApproval
    ? "Needs approval"
    : task.status === "needs_decision"
      ? "Needs a decision"
      : task.status === "waiting"
        ? (WAITING_WORDS[task.waitingOn ?? "other"] ?? "Waiting")
        : withPerson
          ? "With a person"
          : paused
            ? "Paused"
            : "In progress";
  return {
    id: task._id,
    agent: task.agent,
    agentName: profile.name,
    /** True only when an agent that exists and is not paused holds it. Screens show motion only then. */
    agentWorking: profile.built && !paused && !withPerson && task.status === "open",
    title: task.title,
    owner,
    state,
    next: pendingApproval ? pendingApproval.summary : (task.openQuestion ?? task.nextAction ?? null),
    blocker: pendingApproval ? `Waiting for approval: ${pendingApproval.reason}` : task.status === "waiting" ? (WAITING_WORDS[task.waitingOn ?? "other"] ?? null) : paused ? `${profile.name} is paused` : null,
    trigger: task.trigger ?? null,
    dueAt: task.dueAt,
    createdAt: task.createdAt,
    about: task.about ?? null,
    approvalId: pendingApproval?._id ?? null,
  };
}

export type TaskCard = ReturnType<typeof taskCard>;

export async function pendingApprovalFor(ctx: QueryCtx, companyId: Id<"companies">, taskId: Id<"tasks">) {
  const rows = await ctx.db
    .query("approvals")
    .withIndex("by_company_task", (q) => q.eq("companyId", companyId).eq("taskId", taskId))
    .take(10);
  return rows.find((row) => row.status === "pending") ?? null;
}

export type AttentionKind = "followup" | "setup" | "schedule" | "issues";
export const ATTENTION_WORDS: Record<AttentionKind, { label: string; detail: string }> = {
  followup: { label: "Needs follow-up", detail: "An open Sales or Retention task about the client or one of its properties, or a deal in the Sales pipeline whose next action is overdue." },
  setup: { label: "Awaiting service setup", detail: "An active client with no property, a plan still being set up, or no plan and no visit yet." },
  schedule: { label: "Schedule exceptions", detail: "A visit in the next 14 days that does not have its full crew." },
  issues: { label: "Open service issues", detail: "An open quality review or customer-care task about a visit or the client." },
};

const isIssue = (task: Doc<"tasks">) => task.key?.startsWith("quality.review:") || task.key?.startsWith("customer_care.") || task.handoffTo === "customer_care" || task.handoffTo === "quality";

/** The company's attention sets: which clients are in each. Read from tasks, visits and the directory, capped. */
export async function companyAttention(ctx: QueryCtx, companyId: Id<"companies">): Promise<Record<AttentionKind, Set<Id<"customers">>>> {
  const out: Record<AttentionKind, Set<Id<"customers">>> = { followup: new Set(), setup: new Set(), schedule: new Set(), issues: new Set() };
  const customerOf = new Map<string, Id<"customers"> | null>();
  const resolve = async (about: Doc<"tasks">["about"]): Promise<Id<"customers"> | null> => {
    if (!about) return null;
    if (customerOf.has(about.id)) return customerOf.get(about.id)!;
    let id: Id<"customers"> | null = null;
    if (about.table === "customers") id = about.id;
    else if (about.table === "salesOpportunities") {
      // A Sales opportunity is about the person who asked: its task is that client's follow-up.
      const row = await ctx.db.get(about.id);
      id = row && row.companyId === companyId ? (row.customerId ?? null) : null;
    } else if (about.table === "properties" || about.table === "jobs") {
      const row = await ctx.db.get(about.id);
      id = row && row.companyId === companyId ? row.customerId : null;
    }
    customerOf.set(about.id, id);
    return id;
  };
  for (const status of ["open", "waiting", "needs_decision"] as const) {
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_company_status_due", (q) => q.eq("companyId", companyId).eq("status", status))
      .take(500);
    for (const task of tasks) {
      if (isIssue(task)) {
        const id = await resolve(task.about);
        if (id) out.issues.add(id);
      } else if ((task.agent === "sales" || task.agent === "retention") && (task.about?.table === "customers" || task.about?.table === "properties" || task.about?.table === "salesOpportunities")) {
        const id = await resolve(task.about);
        if (id) out.followup.add(id);
      }
    }
  }
  // A deal in the Sales pipeline whose next action is past due.
  for (const stage of ["new", "qualifying", "quoting"] as const) {
    const deals = await ctx.db
      .query("salesOpportunities")
      .withIndex("by_company_stage", (q) => q.eq("companyId", companyId).eq("stage", stage))
      .take(500);
    for (const deal of deals) if (deal.customerId && deal.nextActionAt !== undefined && deal.nextActionAt < Date.now()) out.followup.add(deal.customerId);
  }
  const setup = await ctx.db
    .query("clientViews")
    .withIndex("by_company_view_name", (q) => q.eq("companyId", companyId).eq("view", "all"))
    .filter((q) => q.eq(q.field("needsSetup"), true))
    .take(1000);
  for (const row of setup) out.setup.add(row.customerId);
  const now = Date.now();
  const upcoming = await ctx.db
    .query("jobs")
    .withIndex("by_company_status_start", (q) => q.eq("companyId", companyId).eq("status", "scheduled").gte("startsAt", now).lt("startsAt", now + 14 * DAY))
    .take(500);
  for (const job of upcoming) {
    if (out.schedule.has(job.customerId)) continue;
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_company_job", (q) => q.eq("companyId", companyId).eq("jobId", job._id))
      .take(30);
    if (staffing(job, assignments).open > 0) out.schedule.add(job.customerId);
  }
  return out;
}
