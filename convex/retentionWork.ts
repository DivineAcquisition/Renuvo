/**
 * Retention's background work: the things that happen because something else happened (a visit was
 * completed, a customer wrote), and the reconciliation that runs on a schedule.
 *
 * Every piece of work is a `retentionRuns` row named by a key, so an event delivered twice, a webhook
 * replayed or a job run again finds the first and does nothing more. A run that throws changes nothing
 * (its transaction rolls back) and stays queued; the sweep tries it again a few times and then puts it
 * in front of a person in plain words.
 *
 * While Retention is paused nothing here reads, prepares or sends. The work waits and is picked up when
 * Retention is resumed.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { finishExecution, openExecution } from "./lib/billing/executions";
import { reserveExecution } from "./lib/billing/reserve";
import { AGENT_PROFILES } from "./lib/departments";
import { actionsOf, syncHandoff } from "./lib/retention/actions";
import { addEntry, closeCase, DAY, RETENTION, SYSTEM } from "./lib/retention/cases";
import { onCustomerText } from "./lib/retention/continuity";
import { checkedReading, retentionModel } from "./lib/retention/diagnose";
import { assess, closeQuiet, correctionCompleted, followThrough, noteNextService, planRecovery } from "./lib/retention/recovery";
import { reconcile } from "./lib/retention/reconcile";
import { prepareRenewal } from "./lib/retention/relationships";
import { enqueueRun } from "./lib/retention/runs";
import { liveTaskByKey, openTask, setTaskState } from "./lib/taskState";

const MAX_ATTEMPTS = 3;
const MINUTE = 60_000;

async function finish(ctx: MutationCtx, run: Doc<"retentionRuns">, status: "done" | "skipped" | "failed", result: string) {
  await ctx.db.patch(run._id, { status, result: result.slice(0, 500), finishedAt: Date.now() });
}

/** A completed visit: the correction it was, the next service it is for an earlier case, or a customer's first. */
async function serviceCompleted(ctx: MutationCtx, company: Doc<"companies">, job: Doc<"jobs">): Promise<string> {
  const did: string[] = [];
  if (job.recovery) {
    await correctionCompleted(ctx, company, job);
    did.push("recorded the completed correction");
  } else {
    await noteNextService(ctx, company, job);
    const opened = await followThrough(ctx, company, job);
    if (opened) did.push("started first-service follow-through");
    // A former customer who was asked back and has now been served again.
    const cases = await ctx.db
      .query("retentionCases")
      .withIndex("by_company_customer", (q) => q.eq("companyId", company._id).eq("customerId", job.customerId))
      .order("desc")
      .take(30);
    for (const row of cases) {
      if (row.kind !== "reactivation" || row.status === "closed" || job.startsAt < row.createdAt) continue;
      await addEntry(ctx, row, { kind: "verification", basis: "fact", text: "A service was completed for this customer after the return offer.", source: { table: "jobs", id: job._id, label: "Completed service", at: job.startsAt }, actor: SYSTEM });
      await closeCase(ctx, row, "reactivated", SYSTEM);
      did.push("recorded a returned customer");
    }
  }
  // Any handoff that was waiting on this visit.
  const linked = job.recovery ? await ctx.db.get(job.recovery.caseId) : null;
  if (linked) for (const action of await actionsOf(ctx, linked)) await syncHandoff(ctx, action);
  return did.length ? did.join("; ") : "nothing to do";
}

/** Everything that keeps cases honest between events: handoffs coming back, questions nobody answered, renewals coming due. */
async function upkeep(ctx: MutationCtx, company: Doc<"companies">): Promise<string> {
  const now = Date.now();
  let returned = 0;
  const underway = await ctx.db
    .query("retentionActions")
    .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "underway"))
    .take(300);
  for (const action of underway) if (await syncHandoff(ctx, action)) returned += 1;
  const quiet = await closeQuiet(ctx, company, now);
  const result = await reconcile(ctx, company);
  // An end of term coming up gets its case and its service review prepared once.
  let renewals = 0;
  const open = await ctx.db
    .query("retentionSignals")
    .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "open"))
    .take(300);
  for (const signal of open) {
    if (signal.kind !== "renewal_approaching" || !signal.agreementId) continue;
    const agreement = await ctx.db.get(signal.agreementId);
    const row = agreement ? await prepareRenewal(ctx, company, agreement) : null;
    if (row) {
      await ctx.db.patch(signal._id, { status: "in_case", caseId: row._id });
      renewals += 1;
    }
  }
  return `${result.seen} signals on record, ${result.cleared} cleared, ${returned} handoffs returned, ${quiet} quiet cases closed, ${renewals} renewals prepared`;
}

export const run = internalMutation({
  args: { runId: v.id("retentionRuns") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.runId);
    if (!row || row.status !== "queued") return null;
    const company = await ctx.db.get(row.companyId);
    if (!company) return finish(ctx, row, "skipped", "The company no longer exists.");
    // Paused or suspended: the work waits, unread. The sweep picks it up when Retention is resumed.
    if (company.suspendedAt || company.pausedAgents.includes("retention")) return null;
    await ctx.db.patch(row._id, { startedAt: Date.now(), attempts: row.attempts + 1 });
    if (row.kind === "service_completed") {
      const job = row.jobId ? await ctx.db.get(row.jobId) : null;
      if (!job || job.status !== "completed") return finish(ctx, row, "skipped", "The visit is not completed.");
      return finish(ctx, row, "done", await serviceCompleted(ctx, company, job));
    }
    if (row.kind === "customer_text") {
      const customer = row.customerId ? await ctx.db.get(row.customerId) : null;
      if (!customer || !row.payload) return finish(ctx, row, "skipped", "There was nothing to read.");
      const result = await onCustomerText(ctx, company, customer, row.payload, row.queuedAt);
      // The text is not kept on the run after it is read: the conversation holds it.
      await ctx.db.patch(row._id, { payload: undefined });
      return finish(ctx, row, "done", result.did);
    }
    if (row.kind === "reconcile") return finish(ctx, row, "done", await upkeep(ctx, company));
    return finish(ctx, row, "skipped", "Not a run this worker carries out.");
  },
});

/**
 * Every ten minutes: each company's reconciliation is queued once for that window, and work that was
 * queued and never finished is tried again. After three tries it stops and a person is told.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!AGENT_PROFILES.retention.built) return { queued: 0, retried: 0 };
    const now = Date.now();
    const window = Math.floor(now / (10 * MINUTE));
    let queued = 0;
    const companies = await ctx.db.query("companies").take(500);
    for (const company of companies) {
      if (company.suspendedAt || company.pausedAgents.includes("retention")) continue;
      if (await enqueueRun(ctx, { companyId: company._id, kind: "reconcile", key: `reconcile:${window}` })) queued += 1;
    }
    let retried = 0;
    const stuck = await ctx.db
      .query("retentionRuns")
      .withIndex("by_status_queued", (q) => q.eq("status", "queued").lt("queuedAt", now - 2 * MINUTE))
      .take(100);
    for (const row of stuck) {
      const company = await ctx.db.get(row.companyId);
      if (!company || company.suspendedAt || company.pausedAgents.includes("retention")) continue;
      // A reconciliation for an old window is superseded by the current one.
      if (row.kind === "reconcile" && row.key !== `reconcile:${window}`) {
        await finish(ctx, row, "skipped", "Superseded by a later reconciliation.");
        continue;
      }
      if (row.attempts >= MAX_ATTEMPTS) {
        await finish(ctx, row, "failed", "It could not be finished after three tries.");
        const key = `retention.run_failed:${row._id}`;
        if (!(await liveTaskByKey(ctx, row.companyId, key))) {
          const taskId = await openTask(ctx, { companyId: row.companyId, agent: "retention", title: "Retention could not finish some follow-up work", nextAction: "Open Retention and check the customer or visit this was about.", dueAt: now + DAY, completionCondition: "A person checked what the work was about and followed it up.", key, about: row.customerId ? { table: "customers", id: row.customerId } : row.jobId ? { table: "jobs", id: row.jobId } : undefined, actor: SYSTEM });
          await setTaskState(ctx, (await ctx.db.get(taskId))!, "needs_decision", { openQuestion: `Retention tried three times to ${row.kind === "service_completed" ? "follow up a completed visit" : row.kind === "customer_text" ? "read a customer's text" : "reconcile its records"} and could not. Check it by hand.`, dueAt: now + DAY, withPersonSince: now }, SYSTEM);
        }
        continue;
      }
      // Counted here, outside the run's own transaction, so a run that keeps throwing still reaches its limit.
      await ctx.db.patch(row._id, { attempts: row.attempts + 1 });
      if (row.kind === "diagnose") await ctx.scheduler.runAfter(0, internal.retentionWork.diagnose, { runId: row._id });
      else await ctx.scheduler.runAfter(0, internal.retentionWork.run, { runId: row._id });
      retried += 1;
    }
    return { queued, retried };
  },
});

// ── The optional AI reading of a customer's words ────────────────────────────────────────────────

export const diagnoseBegin = internalMutation({
  args: { runId: v.id("retentionRuns") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.runId);
    if (!row || row.status !== "queued" || !row.caseId) return null;
    const company = await ctx.db.get(row.companyId);
    const subject = await ctx.db.get(row.caseId);
    if (!company || !subject || subject.status === "closed" || !subject.customerWords || subject.serious || subject.diagnosis?.reader === "person") {
      await finish(ctx, row, "skipped", "There was nothing for a reader to add.");
      return null;
    }
    if (company.suspendedAt || company.pausedAgents.includes("retention")) return null;
    // One reading is one billable unit, opened here and held in the action. Without a hold, the rules' reading stands.
    const opened = await openExecution(ctx, { company, key: `retention-read:${row._id}`, agent: "retention", task: "retention_assessment", units: 1, autonomous: true, origin: "automatic", source: { table: "retentionCases", id: subject._id }, link: { label: "Retention", path: `/app/agents/retention/recovery?case=${subject._id}` } });
    if (!opened.ok || opened.repeated) {
      await addEntry(ctx, subject, { kind: "agent", text: `Read by the company's rules, not by AI: ${opened.ok ? "this reading was already made." : opened.message}`, actor: SYSTEM });
      await finish(ctx, row, "skipped", opened.ok ? "Already read." : opened.message);
      return null;
    }
    await ctx.db.patch(row._id, { executionId: opened.executionId, startedAt: Date.now() });
    return { words: subject.customerWords, executionId: opened.executionId };
  },
});

export const diagnoseApply = internalMutation({
  args: { runId: v.id("retentionRuns"), reading: v.union(v.null(), v.object({ category: v.union(v.string(), v.null()), areas: v.array(v.string()) })), reader: v.string(), read: v.boolean(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.runId);
    if (!row || row.status !== "queued") return null;
    const subject = row.caseId ? await ctx.db.get(row.caseId) : null;
    const company = await ctx.db.get(row.companyId);
    // Charged only when the reader actually read the words. Anything else releases the hold.
    if (row.executionId) await finishExecution(ctx, row.executionId, args.read ? { completedUnits: 1 } : { ended: "failed" });
    if (!subject || !company || subject.status === "closed") return finish(ctx, row, "skipped", "The case closed first.");
    if (!args.read || !args.reading) {
      await addEntry(ctx, subject, { kind: "agent", text: `Read by the company's rules, not by AI${args.note ? `: ${args.note}` : "."}`, actor: SYSTEM });
      return finish(ctx, row, "skipped", args.note ?? "The rules' reading stands.");
    }
    // Only what the customer's own words support is kept, and never a verdict on who is right.
    const checked = checkedReading(subject.customerWords ?? "", { category: args.reading.category as never, areas: args.reading.areas });
    const added = checked.areas.filter((area) => !subject.areas.includes(area));
    if (!added.length && !checked.category) return finish(ctx, row, "done", "The reader added nothing to the rules' reading.");
    const before = subject.diagnosis?.category;
    const assessed = await assess(ctx, company, subject, { category: checked.category, areas: checked.areas, reader: args.reader });
    await addEntry(ctx, assessed, { kind: "agent", basis: "hypothesis", text: `An AI reader read the customer's words${added.length ? ` and found: ${added.join(", ")}` : ""}. Its reading is a hypothesis, checked against the words themselves.`, actor: RETENTION });
    // A first step is prepared only if none exists yet; an approved or running step is never replaced by a re-reading.
    const live = (await actionsOf(ctx, assessed)).some((a) => a.status !== "declined" && a.status !== "cancelled" && a.status !== "failed");
    if (!live && assessed.diagnosis?.category !== before) await planRecovery(ctx, company, assessed);
    return finish(ctx, row, "done", "The reading was added to the case.");
  },
});

export const diagnose = internalAction({
  args: { runId: v.id("retentionRuns") },
  handler: async (ctx, args) => {
    const started = await ctx.runMutation(internal.retentionWork.diagnoseBegin, { runId: args.runId });
    if (!started) return null;
    const model = retentionModel();
    const held = model ? await reserveExecution(ctx, started.executionId) : null;
    if (!model || !held?.ok) {
      await ctx.runMutation(internal.retentionWork.diagnoseApply, { runId: args.runId, reading: null, reader: "rules", read: false, note: !model ? "no AI reader is connected" : held && !held.ok ? held.message : undefined });
      return null;
    }
    let reading: { category: string | null; areas: string[] } | null = null;
    try {
      reading = await model.read(started.words);
    } catch {
      reading = null;
    }
    await ctx.runMutation(internal.retentionWork.diagnoseApply, { runId: args.runId, reading, reader: model.name, read: reading !== null, note: reading === null ? "the AI reader did not answer" : undefined });
    return null;
  },
});
