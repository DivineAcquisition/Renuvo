/**
 * The bounded tools the Dispatch agent works through. A model chooses a tool and its inputs; it never
 * writes to the database. Each tool reads the record again, applies the hard rules in code, and checks
 * the Owner's permission at that moment, so a recommendation cannot get around a requirement: a cleaner
 * who fails a hard rule cannot be offered a job by naming them. Every use is recorded in `toolRuns`
 * with what allowed it, what went in, what came out and what it touched.
 *
 * No model is wired up yet. The tools are what a model will be given; today the deterministic workflow
 * (workflow.ts, live.ts) is the only caller of the same underlying functions.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { requestApproval } from "../approvalQueue";
import { authorityFor } from "../authority";
import type { Actor } from "../events";
import { assignmentMessages, queueMessage } from "../messaging/outbox";
import { openTask, liveTaskByKey, setTaskState } from "../taskState";
import { jobCoverageRequests, openCoverageRequest } from "./coverage";
import { staffing } from "./crew";
import { DISPATCH_RULES } from "./eligibility";
import { jobAssignments } from "./facts";
import { handOff } from "./handoffs";
import { issueLink, liveLink } from "./links";
import { offerProblem, placeOffer } from "./offers";
import { money } from "./pay";
import { dispatchPolicy } from "./policy";
import { dispatchSettings } from "./settings";
import { confirmedSms } from "./sms";
import { candidatesFor, coverJob, coverKey, currentCoverAction, ensureCoverTask, jobApprovals, RUN_BACKUP, whenWords } from "./workflow";

export const TOOL_NAMES = [
  "inspect_job",
  "find_eligible_cleaners",
  "prepare_dispatch_proposal",
  "request_dispatch_approval",
  "send_job_offers",
  "inspect_offer_responses",
  "open_coverage_request",
  "propose_reassignment",
  "prepare_customer_update",
  "issue_action_link",
  "escalate_dispatch_issue",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export type ToolInput = { jobId?: Id<"jobs">; assignmentId?: Id<"assignments">; cleanerId?: Id<"cleaners">; text?: string };
export type ToolResult = {
  outcome: "done" | "proposed" | "refused";
  /** The permission it ran under and its level then, or "read". */
  authorization: string;
  result: Record<string, unknown>;
  jobId?: Id<"jobs">;
  assignmentId?: Id<"assignments">;
};

const MINUTE = 60_000;
const DISPATCH: Actor = { kind: "agent", agent: "dispatch" };
const refused = (authorization: string, why: string, extra: Partial<ToolResult> = {}): ToolResult => ({ outcome: "refused", authorization, result: { why }, ...extra });

async function jobOf(ctx: MutationCtx, company: Doc<"companies">, input: ToolInput): Promise<Doc<"jobs"> | null> {
  const job = input.jobId ? await ctx.db.get(input.jobId) : null;
  return job && job.companyId === company._id ? job : null;
}

async function assignmentOf(ctx: MutationCtx, company: Doc<"companies">, input: ToolInput): Promise<Doc<"assignments"> | null> {
  const assignment = input.assignmentId ? await ctx.db.get(input.assignmentId) : null;
  return assignment && assignment.companyId === company._id ? assignment : null;
}

/** "dispatch.x at execute", or why not. A paused or switched-off action is never "allowed". */
async function allowed(ctx: MutationCtx, company: Doc<"companies">, action: string) {
  const authority = await authorityFor(ctx, company._id, action);
  if (authority.kind === "paused") return { ok: false as const, label: `${action}: Dispatch is paused`, level: null };
  if (authority.kind !== "level" || authority.level === "off") return { ok: false as const, label: `${action}: not allowed`, level: null };
  return { ok: true as const, label: `${action} at ${authority.level}`, level: authority.level };
}

async function ranked(ctx: MutationCtx, company: Doc<"companies">, job: Doc<"jobs">) {
  const found = await candidatesFor(ctx, company, job);
  return {
    found,
    candidates: found.candidates.map((row, index) => ({ cleanerId: row.cleanerId, name: row.name, rank: index + 1, reasons: row.reasons, pay: row.pay.ok ? money(row.pay.payCents) : null })),
    // Hard requirements. None of these can be set aside by a tool.
    excluded: found.excluded.map((row) => ({ cleanerId: row.cleanerId, name: row.name, rule: row.code, reason: row.reason })),
  };
}

export async function runTool(ctx: MutationCtx, company: Doc<"companies">, tool: ToolName, input: ToolInput): Promise<ToolResult> {
  switch (tool) {
    case "inspect_job": {
      const job = await jobOf(ctx, company, input);
      if (!job) return refused("read", "No such job in this company.");
      const assignments = await jobAssignments(ctx, job);
      const staff = staffing(job, assignments);
      const approvals = (await jobApprovals(ctx, job)).filter((row) => row.status === "pending");
      const requests = (await jobCoverageRequests(ctx, job)).filter((row) => row.status === "open" || row.status === "unresolved");
      const task = await liveTaskByKey(ctx, company._id, coverKey(job._id));
      return {
        outcome: "done",
        authorization: "read",
        jobId: job._id,
        result: {
          status: job.status,
          when: whenWords(job.startsAt, company.timezone),
          serviceType: job.serviceType,
          requiredSkills: job.requiredSkills,
          ...staff,
          pendingApprovals: approvals.length,
          coverageRequests: requests.map((row) => ({ cause: row.cause, status: row.status })),
          task: task ? { status: task.status, nextAction: task.nextAction ?? null, openQuestion: task.openQuestion ?? null, withPerson: task.withPersonSince !== undefined } : null,
          completionReported: job.completionReportedAt !== undefined,
        },
      };
    }
    case "find_eligible_cleaners": {
      const job = await jobOf(ctx, company, input);
      if (!job) return refused("read", "No such job in this company.");
      const { candidates, excluded } = await ranked(ctx, company, job);
      return { outcome: "done", authorization: "read", jobId: job._id, result: { candidates, excluded } };
    }
    case "prepare_dispatch_proposal": {
      const job = await jobOf(ctx, company, input);
      if (!job) return refused("read", "No such job in this company.");
      const { found, candidates } = await ranked(ctx, company, job);
      const action = await currentCoverAction(ctx, job, found.assignments);
      const staff = staffing(job, found.assignments);
      return { outcome: "done", authorization: "read", jobId: job._id, result: { action, openPlaces: staff.open, wouldAsk: candidates.slice(0, Math.max(0, staff.open - staff.offersOut)), nothingWritten: true } };
    }
    case "request_dispatch_approval":
    case "send_job_offers": {
      const job = await jobOf(ctx, company, input);
      if (!job) return refused("none", "No such job in this company.");
      const assignments = await jobAssignments(ctx, job);
      const action = await currentCoverAction(ctx, job, assignments);
      const may = await allowed(ctx, company, action);
      if (!may.ok) return refused(may.label, "The Owner's settings do not allow this right now.", { jobId: job._id });
      if (tool === "send_job_offers" && may.level === "propose") return refused(may.label, "This action is on Propose, so an offer needs a person's approval first. Use request_dispatch_approval.", { jobId: job._id });

      if (!input.cleanerId) {
        // No cleaner named: the workflow chooses by the ranking, exactly as it does on its own.
        const state = await coverJob(ctx, job._id);
        return { outcome: state === "proposed" || state === "awaiting_decision" ? "proposed" : state === "offered" || state === "offer_out" || state === "covered" ? "done" : "refused", authorization: may.label, jobId: job._id, result: { state } };
      }
      // A cleaner was named. They must already be among the cleaners the hard rules allow.
      const { found } = await ranked(ctx, company, job);
      const candidate = found.candidates.find((row) => row.cleanerId === input.cleanerId);
      const cleaner = found.cleaners.find((row) => row._id === input.cleanerId);
      if (!candidate || !cleaner || !candidate.pay.ok) {
        const why = found.excluded.find((row) => row.cleanerId === input.cleanerId);
        return refused(may.label, why ? `${why.name} ${why.reason}. A hard requirement cannot be set aside by Dispatch.` : "That cleaner is not eligible for this job.", { jobId: job._id });
      }
      const staff = staffing(job, assignments);
      const pending = (await jobApprovals(ctx, job)).filter((row) => row.status === "pending" && row.proposal?.kind === "offer_assignment");
      if (staff.offersOut + pending.length >= staff.open) return refused(may.label, "Every open place on this job already has an offer or a proposal.", { jobId: job._id });
      const backup = action === RUN_BACKUP;
      const windowMinutes = backup ? dispatchPolicy(company).backupOfferWindowMinutes : dispatchSettings(company).offerWindowMinutes;
      const now = Date.now();
      const respondBy = Math.min(now + windowMinutes * MINUTE, job.startsAt);
      const request = { company, job, cleaner, respondBy, payCents: candidate.pay.payCents, rules: DISPATCH_RULES };
      const problem = await offerProblem(ctx, request);
      if (problem) return refused(may.label, problem, { jobId: job._id });
      if (may.level === "propose") {
        const task = await ensureCoverTask(ctx, company, job);
        const summary = `Offer the visit on ${whenWords(job.startsAt, company.timezone)} to ${cleaner.name}`;
        const approvalId = await requestApproval(ctx, {
          companyId: company._id,
          action,
          summary,
          reason: `${cleaner.name} ${candidate.reasons.join(", ")}.`,
          authorizes: `Dispatch will offer this visit to ${cleaner.name}: ${job.scope}. Their pay is ${money(candidate.pay.payCents)} (${candidate.pay.basis}). They get ${windowMinutes} minutes to answer.`,
          ifWaiting: "The visit stays without a cleaner.",
          proposal: { kind: "offer_assignment", jobId: job._id, cleanerId: cleaner._id, payCents: candidate.pay.payCents, respondWithinMinutes: windowMinutes },
          decideBy: Math.min(job.startsAt, now + 24 * 60 * MINUTE),
          about: { table: "jobs", id: job._id },
          taskId: task._id,
        });
        await coverJob(ctx, job._id);
        return { outcome: "proposed", authorization: may.label, jobId: job._id, result: { approvalId, cleaner: cleaner.name } };
      }
      const coverRequest = (await jobCoverageRequests(ctx, job)).find((row) => row.status === "open" || row.status === "unresolved");
      const assignmentId = await placeOffer(ctx, request, DISPATCH, { action, via: "tool" }, { kind: backup ? "backup" : action === "dispatch.request_acceptance" ? "initial" : "replacement", coverageRequestId: backup ? coverRequest?._id : undefined });
      await coverJob(ctx, job._id);
      return { outcome: "done", authorization: may.label, jobId: job._id, assignmentId, result: { offeredTo: cleaner.name, respondBy } };
    }
    case "inspect_offer_responses": {
      const job = await jobOf(ctx, company, input);
      if (!job) return refused("read", "No such job in this company.");
      const rows = [];
      for (const row of await jobAssignments(ctx, job)) {
        const texts = await assignmentMessages(ctx, row);
        const offerText = texts.find((text) => text.purpose === "offer" || text.purpose === "backup_offer");
        rows.push({
          assignmentId: row._id,
          cleaner: (await ctx.db.get(row.cleanerId))?.name ?? null,
          status: row.status,
          cause: row.endCause ?? null,
          respondBy: row.respondBy,
          // What the provider reported. Delivered does not mean read; nothing records that.
          text: offerText ? { status: offerText.status, problem: offerText.problem ?? null } : null,
        });
      }
      return { outcome: "done", authorization: "read", jobId: job._id, result: { offers: rows } };
    }
    case "open_coverage_request": {
      const assignment = await assignmentOf(ctx, company, input);
      if (!assignment) return refused("none", "No such assignment in this company.");
      const job = await ctx.db.get(assignment.jobId);
      if (!job) return refused("none", "The job no longer exists.");
      // Dispatch may reopen a place that is already empty. Taking a confirmed cleaner off a job is a person's call.
      const lost = assignment.status === "cancelled" && (assignment.endCause === "dropped" || assignment.endCause === "no_show" || assignment.endCause === "released") && assignment.respondedAt !== undefined;
      if (!lost) return refused("none", "This cleaner is still on the job, or never was. Dispatch does not remove a confirmed cleaner: use propose_reassignment.", { jobId: job._id, assignmentId: assignment._id });
      const may = await allowed(ctx, company, RUN_BACKUP);
      if (!may.ok) return refused(may.label, "The Owner's settings do not allow backup coverage right now.", { jobId: job._id, assignmentId: assignment._id });
      const requestId = await openCoverageRequest(ctx, { job, from: assignment, cause: assignment.endCause === "no_show" ? "no_show" : assignment.endCause === "released" ? "released" : "drop", detail: input.text?.slice(0, 500), actor: DISPATCH });
      const state = await coverJob(ctx, job._id);
      return { outcome: "done", authorization: may.label, jobId: job._id, assignmentId: assignment._id, result: { coverageRequestId: requestId, state } };
    }
    case "propose_reassignment": {
      const assignment = await assignmentOf(ctx, company, input);
      const reason = input.text?.trim();
      if (!assignment || assignment.status !== "accepted") return refused("none", "Only an accepted assignment can be proposed for reassignment.");
      if (!reason || reason.length < 3) return refused("none", "A reason is required.");
      const may = await allowed(ctx, company, "dispatch.reassign_confirmed_visit");
      if (!may.ok) return refused(may.label, "The Owner's settings do not allow this right now.", { assignmentId: assignment._id });
      const job = await ctx.db.get(assignment.jobId);
      const cleaner = await ctx.db.get(assignment.cleanerId);
      if (!job || !cleaner) return refused(may.label, "The job or cleaner no longer exists.");
      // Always a proposal. Releasing the cleaner is done by a person, which records who did it and why.
      const key = `dispatch.reassign:${assignment._id}`;
      let task = await liveTaskByKey(ctx, company._id, key);
      if (!task) {
        const taskId = await openTask(ctx, { companyId: company._id, agent: "dispatch", title: `Reassign ${cleaner.name}'s visit on ${whenWords(job.startsAt, company.timezone)}?`, nextAction: "Decide whether to release this cleaner", dueAt: job.startsAt, completionCondition: "A person released the cleaner or decided to keep them", about: { table: "assignments", id: assignment._id }, key, actor: DISPATCH });
        await ctx.db.patch(taskId, { trigger: reason.slice(0, 500), escalation: "Nothing changes unless a person releases the cleaner." });
        task = (await ctx.db.get(taskId))!;
        await setTaskState(ctx, task, "needs_decision", { openQuestion: `Dispatch suggests taking ${cleaner.name} off this visit: ${reason.slice(0, 600)} Release them to start a replacement search, or keep them.`, dueAt: job.startsAt, withPersonSince: Date.now() }, DISPATCH);
      }
      return { outcome: "proposed", authorization: may.label, jobId: job._id, assignmentId: assignment._id, result: { taskId: task._id } };
    }
    case "prepare_customer_update": {
      const job = await jobOf(ctx, company, input);
      const draft = input.text?.trim();
      if (!job) return refused("none", "No such job in this company.");
      if (!draft || draft.length < 3) return refused("none", "The update's text is required.");
      const may = await allowed(ctx, company, "dispatch.notify_running_late");
      if (!may.ok) return refused(may.label, "The Owner's settings do not allow this right now.", { jobId: job._id });
      // Dispatch has no channel to customers here. The draft goes to Customer Care's queue for a person to send.
      const customer = await ctx.db.get(job.customerId);
      const task = await handOff(ctx, { companyId: company._id, to: "customer_care", key: `customer_care.update:${job._id}:${draft.length}:${draft.slice(0, 24)}`, title: `Update ${customer?.name ?? "the customer"} about their visit`, question: `Draft from Dispatch: "${draft.slice(0, 700)}". Send it, change it, or decide not to.`, trigger: "Dispatch prepared a customer update.", completionCondition: "The customer was told, or a person decided not to", escalation: "Nothing is sent to the customer until a person sends it.", dueAt: Math.max(Date.now() + 15 * MINUTE, Math.min(job.startsAt, Date.now() + 24 * 60 * MINUTE)), about: { table: "jobs", id: job._id }, actor: DISPATCH });
      return { outcome: "proposed", authorization: may.label, jobId: job._id, result: { taskId: task._id, sent: false } };
    }
    case "issue_action_link": {
      const assignment = await assignmentOf(ctx, company, input);
      if (!assignment || assignment.status !== "accepted") return refused("none", "A job link is issued only for an accepted assignment. An offer's link is issued with the offer.");
      const job = await ctx.db.get(assignment.jobId);
      const cleaner = await ctx.db.get(assignment.cleanerId);
      if (!job || !cleaner || job.status === "cancelled" || job.status === "completed") return refused("none", "The job is closed.");
      const may = await allowed(ctx, company, "dispatch.send_reminder");
      if (!may.ok || may.level === "propose") return refused(may.label, "Texting a cleaner needs the Owner's permission at Execute.", { assignmentId: assignment._id });
      const existing = await liveLink(ctx, assignment, "job");
      if (existing) return { outcome: "done", authorization: may.label, jobId: job._id, assignmentId: assignment._id, result: { linkId: existing._id, issued: false, note: "The cleaner already has a live link." } };
      const expiresAt = job.endsAt + dispatchPolicy(company).jobAccessGraceHours * 60 * MINUTE;
      if (expiresAt <= Date.now()) return refused(may.label, "The time a link would cover has passed.");
      const link = await issueLink(ctx, { assignment, purpose: "job", expiresAt, actor: DISPATCH });
      if (!link) return refused(may.label, "Action links are not set up on this deployment.");
      const message = await queueMessage(ctx, { companyId: company._id, purpose: "assignment_confirmed", cleaner, jobId: job._id, assignmentId: assignment._id, link, body: confirmedSms({ company, job }), dedupeKey: `reissue:${link._id}`, actor: DISPATCH });
      return { outcome: "done", authorization: may.label, jobId: job._id, assignmentId: assignment._id, result: { linkId: link._id, issued: true, text: message.status } };
    }
    case "escalate_dispatch_issue": {
      const job = await jobOf(ctx, company, input);
      const issue = input.text?.trim();
      if (!job) return refused("none", "No such job in this company.");
      if (!issue || issue.length < 3) return refused("none", "Say what the issue is.");
      // Escalating is always allowed, paused or not: telling the owner is never an autonomous action on the outside world.
      const key = `dispatch.issue:${job._id}`;
      let task = await liveTaskByKey(ctx, company._id, key);
      if (!task) {
        const taskId = await openTask(ctx, { companyId: company._id, agent: "dispatch", title: `Issue on the visit on ${whenWords(job.startsAt, company.timezone)}`, nextAction: "Decide what to do", dueAt: Math.max(job.startsAt, Date.now() + 60 * MINUTE), completionCondition: "A person decided what to do about the issue", about: { table: "jobs", id: job._id }, key, actor: DISPATCH });
        await ctx.db.patch(taskId, { trigger: "Dispatch could not resolve this within its tools.", escalation: "It stays open with the owner until decided." });
        task = (await ctx.db.get(taskId))!;
      }
      await setTaskState(ctx, task, "needs_decision", { openQuestion: issue.slice(0, 1000), dueAt: task.dueAt, withPersonSince: Date.now() }, DISPATCH, { sameStatus: true });
      return { outcome: "done", authorization: "escalation", jobId: job._id, result: { taskId: task._id } };
    }
  }
}
