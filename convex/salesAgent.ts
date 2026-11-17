/**
 * One run of the Sales workflow, in separate steps so a crash between any two is recoverable and
 * nothing is done twice:
 *
 *   begin    (a mutation) takes a queued run, checks Sales is not paused and no person holds the
 *            conversation, and gathers what the reader needs. If an AI reader is connected, it opens
 *            the credit execution for this one reading.
 *   read     (the action) holds the credits, then has the reader read the customer's message. Without
 *            a verified hold, or if the reader fails, the company's rules read it and nothing is charged.
 *   apply    (a mutation) checks the reading against the message, then works the opportunity forward
 *            through the bounded tools (convex/lib/sales/agent.ts). Everything it writes is one
 *            transaction. With the rules reader it also routes what it prepared.
 *   word     (the action) lets the AI reader reword what was prepared.
 *   finish   (a mutation) keeps a rewording only if it adds nothing the draft did not say, routes each
 *            draft by the Owner's permission as it is at that moment, and settles the credits.
 *
 * Nothing leaves the building except through the outbox (convex/messaging.ts). A run never calls a
 * provider itself, so a provider timeout is never mistaken for a failed send.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { finishExecution, openExecution } from "./lib/billing/executions";
import { reserveExecution } from "./lib/billing/reserve";
import { recordEvent } from "./lib/events";
import { routeAction } from "./lib/sales/actions";
import { advance, wantsWork } from "./lib/sales/agent";
import { releaseHolds } from "./lib/sales/capacity";
import { kindOfService, requirementsFor, type Requirement } from "./lib/sales/facts";
import { stopFollowUps } from "./lib/sales/followUps";
import { checked, readByRule, type ReadInput } from "./lib/sales/interpret";
import { salesModel, type WordingInput } from "./lib/sales/model";
import { isOpen, setNext, SYSTEM } from "./lib/sales/opportunities";
import { expireDue } from "./lib/sales/quotes";
import { enqueueRun } from "./lib/sales/runs";
import { OPEN_STAGES, readingValidator, type RunStep } from "./lib/sales/schema";
import { salesSettings } from "./lib/sales/settings";
import { acceptWording } from "./lib/sales/words";
import { publishedCatalog } from "./lib/services/store";

const MINUTE = 60_000;
const MAX_ATTEMPTS = 3;
const STUCK_AFTER = 5 * MINUTE;

const note = (tool: string, outcome: RunStep["outcome"], summary: string): RunStep => ({ tool, outcome, summary: summary.slice(0, 400), at: Date.now() });

async function end(ctx: MutationCtx, run: Doc<"salesRuns">, status: "done" | "failed" | "skipped", result: string, steps: RunStep[] = []) {
  await ctx.db.patch(run._id, { status, result: result.slice(0, 500), steps: [...run.steps, ...steps].slice(-16), finishedAt: Date.now() });
}

/** Every question any service of this kind might ask, so a first message's details are not lost before the service is known. */
function requirementsAcross(catalog: Awaited<ReturnType<typeof publishedCatalog>>, opportunity: Doc<"salesOpportunities">): Requirement[] {
  const chosen = catalog.find((row) => row.service.key === opportunity.serviceKey);
  if (chosen) return requirementsFor(chosen.version.spec, opportunity.kind);
  const out = new Map<string, Requirement>();
  for (const row of catalog.filter((item) => kindOfService(item.version.spec) === opportunity.kind)) for (const requirement of requirementsFor(row.version.spec, opportunity.kind)) if (!out.has(requirement.key)) out.set(requirement.key, requirement);
  if (out.size === 0) for (const requirement of requirementsFor(null, opportunity.kind)) out.set(requirement.key, requirement);
  return [...out.values()];
}

export const begin = internalMutation({
  args: { runId: v.id("salesRuns"), messageId: v.optional(v.id("salesMessages")) },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "queued") return null;
    const opportunity = await ctx.db.get(run.opportunityId);
    const company = await ctx.db.get(run.companyId);
    if (!opportunity || !company) {
      await end(ctx, run, "skipped", "The opportunity no longer exists.");
      return null;
    }
    // Paused: nothing is read, written or sent. The work is picked up when Sales is resumed.
    if (company.pausedAgents.includes("sales")) {
      await end(ctx, run, "skipped", "Sales is paused, so it did nothing. This is picked up when Sales is resumed.");
      return null;
    }
    if (opportunity.takeover) {
      await end(ctx, run, "skipped", "A person is handling this conversation, so Sales did nothing.");
      return null;
    }
    if (!isOpen(opportunity.stage) && opportunity.stage !== "deferred") {
      await end(ctx, run, "skipped", "The opportunity is closed.");
      return null;
    }
    await ctx.db.patch(run._id, { status: "running", startedAt: Date.now(), attempt: run.attempt + 1 });
    const message = args.messageId ? await ctx.db.get(args.messageId) : null;
    const customer = await ctx.db.get(opportunity.customerId);
    const settings = salesSettings(company);
    let read: ReadInput | null = null;
    if (message && message.companyId === company._id && message.direction === "in" && message.author.kind === "customer") {
      const latest = opportunity.asked.reduce((max, row) => Math.max(max, row.at), 0);
      const open = opportunity.asked.filter((row) => row.at === latest && !row.key.startsWith("booking:"));
      read = { text: message.body, requirements: requirementsAcross(await publishedCatalog(ctx, company._id), opportunity), lastAsked: open.length === 1 ? open[0].key : null, quoteOut: opportunity.stage === "quote_sent" };
    }
    // An AI reading is one billable unit. It is opened here and held in the action; without a hold, the rules read.
    let executionId: Id<"aiExecutions"> | null = null;
    let billingNote: string | null = null;
    if (read && salesModel().name !== "rules") {
      const opened = await openExecution(ctx, { company, key: `sales-read:${run._id}`, agent: "sales", task: "sales_message_reading", units: 1, autonomous: true, origin: "automatic", source: { table: "salesOpportunities", id: opportunity._id }, link: { label: "Sales", path: `/app/agents/sales/pipeline?opp=${opportunity._id}` } });
      if (opened.ok && !opened.repeated) executionId = opened.executionId;
      else if (!opened.ok) billingNote = opened.message;
      if (executionId) await ctx.db.patch(run._id, { executionId });
    }
    return {
      read,
      executionId,
      billingNote,
      wording: { tone: settings.voice.tone, channel: opportunity.channel, companyName: company.name, approvedAnswers: settings.answers.map((row) => ({ question: row.question, answer: row.answer })), customerMessage: message?.direction === "in" ? message.body : null, customerName: customer?.name ?? "" },
    };
  },
});

export const apply = internalMutation({
  args: { runId: v.id("salesRuns"), reading: v.optional(readingValidator), messageId: v.optional(v.id("salesMessages")), followUpId: v.optional(v.id("salesFollowUps")), route: v.boolean(), notes: v.array(v.string()), reader: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running") return null;
    const company = await ctx.db.get(run.companyId);
    if (!company) return null;
    const message = args.messageId ? await ctx.db.get(args.messageId) : null;
    const output = await advance(ctx, company, run.opportunityId, { trigger: run.trigger, runId: run._id, reading: args.reading, messageRef: message?._id, messageText: message?.direction === "in" ? message.body : undefined, followUpId: args.followUpId, route: args.route });
    const steps = [...args.notes.map((text) => note("read_opportunity", "read", text)), ...output.steps];
    await ctx.db.patch(run._id, { reader: args.reader });
    const fresh = (await ctx.db.get(run._id))!;
    if (args.route || output.drafts.length === 0) {
      await end(ctx, fresh, "done", output.result, steps);
      return { drafts: [] };
    }
    await ctx.db.patch(run._id, { steps: [...fresh.steps, ...steps].slice(-16), result: output.result.slice(0, 500) });
    const drafts: { actionId: Id<"salesActions">; draft: string; channel: "sms" | "email" }[] = [];
    for (const actionId of output.drafts) {
      const action = await ctx.db.get(actionId);
      if (action?.body && action.channel) drafts.push({ actionId, draft: action.body, channel: action.channel });
    }
    return { drafts };
  },
});

export const finish = internalMutation({
  args: { runId: v.id("salesRuns"), wording: v.array(v.object({ actionId: v.id("salesActions"), text: v.union(v.string(), v.null()) })), reader: v.string(), read: v.boolean() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const company = await ctx.db.get(run.companyId);
    const steps: RunStep[] = [];
    if (run.status === "running" && company) {
      for (const row of args.wording) {
        const action = await ctx.db.get(row.actionId);
        if (!action || action.runId !== run._id || action.status !== "prepared" || !action.body || !action.channel) continue;
        const accepted = acceptWording(action.body, row.text, action.channel);
        if (accepted) await ctx.db.patch(action._id, { body: accepted, writtenBy: args.reader, updatedAt: Date.now() });
        else if (row.text) steps.push(note("send_message", "refused", "The AI's rewording added something the draft did not say, so the company's own wording was kept."));
        const opportunity = await ctx.db.get(action.opportunityId);
        if (opportunity) {
          const routed = await routeAction(ctx, company, opportunity, (await ctx.db.get(action._id))!);
          steps.push(note("send_message", routed === "sent" ? "done" : routed === "failed" || routed === "not_allowed" ? "refused" : "proposed", `${routed === "sent" ? "Sent" : routed === "awaiting_approval" ? "Waiting for your approval" : routed === "batched" ? "In your first review batch" : routed === "held" ? "Held: Sales is paused" : routed === "not_allowed" ? "Not sent: switched off for Sales" : "Could not be sent"}: ${action.summary}`));
        }
      }
      await end(ctx, (await ctx.db.get(run._id))!, "done", run.result ?? "Done.", steps);
    }
    // Charged only when the AI reader actually read the message. Anything else releases the hold.
    if (run.executionId) await finishExecution(ctx, run.executionId, args.read ? { completedUnits: 1 } : { ended: "failed" });
    return null;
  },
});

/** A run that could not finish. It is tried again a few times; after that the opportunity goes to a person, in plain words. */
export const failed = internalMutation({
  args: { runId: v.id("salesRuns"), messageId: v.optional(v.id("salesMessages")), followUpId: v.optional(v.id("salesFollowUps")) },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status === "done" || run.status === "skipped") return null;
    if (run.executionId) await finishExecution(ctx, run.executionId, { ended: "failed" });
    if (run.attempt < MAX_ATTEMPTS) {
      await ctx.db.patch(run._id, { status: "queued", executionId: undefined, steps: [...run.steps, note("read_opportunity", "refused", "This attempt did not finish. Sales is trying again.")].slice(-16) });
      await ctx.scheduler.runAfter(run.attempt * 30_000, internal.salesAgent.run, { runId: run._id, messageId: args.messageId, followUpId: args.followUpId });
      return null;
    }
    await end(ctx, run, "failed", "Sales could not finish working on this after three tries. Nothing was sent. You can have Sales try again, or handle it yourself.");
    const opportunity = await ctx.db.get(run.opportunityId);
    if (opportunity && isOpen(opportunity.stage)) await setNext(ctx, opportunity, { what: "Sales could not finish working on this. Have it try again, or handle it yourself.", by: "owner", dueAt: Date.now() + 60 * MINUTE });
    await recordEvent(ctx, { companyId: run.companyId, type: "opportunity.run_failed", actor: SYSTEM, subject: { table: "salesOpportunities", id: run.opportunityId } });
    return null;
  },
});

export const run = internalAction({
  args: { runId: v.id("salesRuns"), messageId: v.optional(v.id("salesMessages")), followUpId: v.optional(v.id("salesFollowUps")) },
  handler: async (ctx, args) => {
    try {
      const started = await ctx.runMutation(internal.salesAgent.begin, { runId: args.runId, messageId: args.messageId });
      if (!started) return null;
      const notes: string[] = [];
      let model = salesModel();
      // The AI reader is used only with credits verified as held for this reading.
      if (model.name !== "rules") {
        const held = started.executionId ? await reserveExecution(ctx, started.executionId) : null;
        if (!held?.ok) {
          const why = held && !held.ok ? held.message : (started.billingNote ?? null);
          if (started.read && why) notes.push(`Read by the company's rules instead of AI: ${why}`);
          model = salesModel("rules");
        }
      }
      let read = false;
      let reading = undefined;
      if (started.read) {
        try {
          reading = checked(await model.read(started.read), started.read);
          read = model.name !== "rules" && reading.reader !== "rules";
        } catch {
          reading = checked(readByRule(started.read), started.read);
          notes.push("The AI reader did not answer, so the company's rules read the message.");
        }
      }
      const useAi = model.name !== "rules" && read;
      const applied = await ctx.runMutation(internal.salesAgent.apply, { runId: args.runId, reading, messageId: args.messageId, followUpId: args.followUpId, route: !useAi, notes, reader: useAi ? model.name : "rules" });
      const wording: { actionId: Id<"salesActions">; text: string | null }[] = [];
      for (const draft of applied?.drafts ?? []) {
        let text: string | null = null;
        try {
          const input: WordingInput = { draft: draft.draft, customerMessage: started.wording.customerMessage, tone: started.wording.tone, channel: draft.channel, companyName: started.wording.companyName, approvedAnswers: started.wording.approvedAnswers };
          text = await model.word(input);
        } catch {
          text = null;
        }
        wording.push({ actionId: draft.actionId, text });
      }
      await ctx.runMutation(internal.salesAgent.finish, { runId: args.runId, wording, reader: model.name, read });
    } catch (error) {
      if (process.env.SALES_DEBUG) console.error("sales run failed", error);
      // The reason is never shown raw. The run is retried, and after that a person is told in plain words.
      await ctx.runMutation(internal.salesAgent.failed, { runId: args.runId, messageId: args.messageId, followUpId: args.followUpId });
    }
    return null;
  },
});

/**
 * Run on a schedule. It finds what a missed trigger would otherwise leave stuck: a run that started and
 * never finished, an opportunity whose next step is Sales's and overdue (after a pause, for example), a
 * quote past its last day, a hold that ran out, a reminder whose timer was lost.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let touched = 0;
    const stuck = await ctx.db
      .query("salesRuns")
      .withIndex("by_status_started", (q) => q.eq("status", "running").lt("startedAt", now - STUCK_AFTER))
      .take(50);
    for (const run of stuck) {
      await ctx.scheduler.runAfter(0, internal.salesAgent.failed, { runId: run._id });
      touched += 1;
    }
    for (const quote of await expireDue(ctx, now)) {
      const opportunity = await ctx.db.get(quote.opportunityId);
      if (!opportunity || opportunity.stage !== "quote_sent") continue;
      await stopFollowUps(ctx, opportunity, "The quote expired.", SYSTEM);
      await setNext(ctx, opportunity, { what: "The quote expired without an answer. Send a fresh quote, defer it, or close it.", by: "owner", dueAt: now + 24 * 60 * MINUTE });
      touched += 1;
    }
    const holds = await ctx.db
      .query("salesHolds")
      .withIndex("by_status_expires", (q) => q.eq("status", "held").lt("expiresAt", now))
      .take(100);
    for (const hold of holds) {
      await ctx.db.patch(hold._id, { status: "expired" });
      touched += 1;
    }
    const due = await ctx.db
      .query("salesFollowUps")
      .withIndex("by_status_due", (q) => q.eq("status", "scheduled").lt("dueAt", now - 2 * MINUTE))
      .take(100);
    for (const followUp of due) await ctx.scheduler.runAfter(0, internal.salesFollowUps.due, { followUpId: followUp._id });
    for (const stage of [...OPEN_STAGES, "deferred" as const]) {
      const rows = await ctx.db
        .query("salesOpportunities")
        .withIndex("by_stage_updated", (q) => q.eq("stage", stage))
        .order("desc")
        .take(200);
      for (const opportunity of rows) {
        if (stage === "deferred" || !wantsWork(opportunity, now)) continue;
        const company = await ctx.db.get(opportunity.companyId);
        if (!company || company.pausedAgents.includes("sales")) continue;
        // One pick-up per opportunity per revision per hour, so a sweep that finds nothing new starts nothing.
        const runId = await enqueueRun(ctx, opportunity, { trigger: "resume", key: `resume:${opportunity._id}:${opportunity.revision}:${Math.floor(now / (60 * MINUTE))}` });
        if (runId) touched += 1;
      }
    }
    return touched;
  },
});

/** Released when an opportunity closes without a booking, so the time is open to others again. */
export const releaseFor = internalMutation({
  args: { opportunityId: v.id("salesOpportunities") },
  handler: async (ctx, args) => {
    const opportunity = await ctx.db.get(args.opportunityId);
    if (opportunity) await releaseHolds(ctx, opportunity, "released");
    return null;
  },
});

