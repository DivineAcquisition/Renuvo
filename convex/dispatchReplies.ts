/**
 * A cleaner's plain text, read and acted on safely (docs/dispatch/02-screens.md, "Cleaner replies").
 *
 * 1. inbound.ts receives a text from a number that belongs to exactly one cleaner of the company, and
 *    opens a reading. Only that cleaner's own visits in that company are ever considered.
 * 2. `read` shows the reader (replyReader.ts) those visits under short labels and gets back which one
 *    the text is about and what it says. The reader can name only a visit it was shown.
 * 3. `decide` checks the answer against the record as it is now. A clear reading of "running late",
 *    "can't come" or "no to an offer" is carried out by Dispatch if the Owner allows it; everything else,
 *    an acceptance included, waits for a person on the reply task, with the reading spelled out.
 * 4. Carrying it out uses the same functions as the cleaner's own link, so every check they make (the
 *    offer still open, places left, no clash, not checked in) runs again at that moment.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { authorityFor } from "./lib/authority";
import { managerMutation } from "./lib/builders";
import { answerOffer } from "./lib/dispatch/assignmentState";
import { cannotAttend, reportDelay } from "./lib/dispatch/live";
import { replyModel, type ReplyOption } from "./lib/dispatch/replyReader";
import { arrivalWords } from "./lib/dispatch/sms";
import { DISPATCH } from "./lib/dispatch/workflow";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent, type Actor } from "./lib/events";
import { setTaskState } from "./lib/taskState";
import { clock } from "./lib/time";

const HOUR = 60 * 60 * 1000;
export const ACT_ON_REPLY = "dispatch.act_on_cleaner_reply";
/** What Dispatch may carry out on its own. Taking a job always needs a person: a text is weaker proof than the cleaner's link. */
const DISPATCH_MAY = new Set(["running_late", "decline_offer", "cannot_attend"]);

type Option = ReplyOption & { assignmentId: Id<"assignments"> };

/** The visits this cleaner could mean: open offers, and accepted visits that have not ended. */
async function optionsFor(ctx: QueryCtx | MutationCtx, company: Doc<"companies">, cleanerId: Id<"cleaners">): Promise<Option[]> {
  const now = Date.now();
  const out: Option[] = [];
  for (const status of ["offered", "accepted"] as const) {
    const rows = await ctx.db
      .query("assignments")
      .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", company._id).eq("cleanerId", cleanerId).eq("status", status))
      .take(50);
    for (const row of rows) {
      const job = await ctx.db.get(row.jobId);
      if (!job || job.status === "cancelled" || job.status === "completed") continue;
      if (status === "offered" && row.respondBy < now) continue;
      if (status === "accepted" && job.endsAt < now - 2 * HOUR) continue;
      const property = await ctx.db.get(job.propertyId);
      out.push({
        assignmentId: row._id,
        ref: "",
        kind: status === "offered" ? "offer" : "job",
        when: arrivalWords(job, company.timezone),
        service: job.serviceType,
        area: property ? `${property.address.city} ${property.address.postalCode}` : "area not on file",
        state: status === "offered" ? `Offer open, answer due ${clock(row.respondBy, company.timezone)}.` : row.checkIn ? "Checked in." : row.late ? `Already said they are late, ETA ${clock(row.late.etaAt, company.timezone)}.` : "Not checked in yet.",
      });
    }
  }
  return out.sort((a, b) => a.when.localeCompare(b.when)).map((option, index) => ({ ...option, ref: `V${index + 1}` }));
}

export const context = internalQuery({
  args: { readingId: v.id("replyReadings") },
  handler: async (ctx, args) => {
    const reading = await ctx.db.get(args.readingId);
    if (!reading || reading.status !== "reading") return null;
    const company = await ctx.db.get(reading.companyId);
    if (!company) return null;
    return { text: reading.excerpt, options: (await optionsFor(ctx, company, reading.cleanerId)).map(({ ref, kind, when, service, area, state }) => ({ ref, kind, when, service, area, state })) };
  },
});

export const read = internalAction({
  args: { readingId: v.id("replyReadings") },
  handler: async (ctx, args) => {
    const input = await ctx.runQuery(internal.dispatchReplies.context, args);
    if (!input) return null;
    const answer = await replyModel().read(input);
    await ctx.runMutation(internal.dispatchReplies.decide, { readingId: args.readingId, answer, options: input.options.map((option) => option.ref) });
    return null;
  },
});

const answerValidator = v.object({
  intent: v.union(v.literal("accept_offer"), v.literal("decline_offer"), v.literal("running_late"), v.literal("cannot_attend"), v.literal("other")),
  ref: v.union(v.string(), v.null()),
  etaMinutes: v.union(v.number(), v.null()),
  clear: v.boolean(),
  reason: v.string(),
  reader: v.string(),
});

/** What a reading proposes, in words a person can check. */
function proposalWords(reading: Pick<Doc<"replyReadings">, "intent" | "etaMinutes">, visit: string): string {
  switch (reading.intent) {
    case "accept_offer":
      return `take the offer for ${visit}`;
    case "decline_offer":
      return `turn down the offer for ${visit}`;
    case "running_late":
      return `record that they are running about ${reading.etaMinutes} minutes late for ${visit}`;
    case "cannot_attend":
      return `take them off ${visit}, because they say they cannot come, and start cover`;
    default:
      return "nothing Dispatch can do";
  }
}

async function visitWords(ctx: MutationCtx, assignmentId: Id<"assignments">, timezone: string): Promise<string> {
  const assignment = await ctx.db.get(assignmentId);
  const job = assignment ? await ctx.db.get(assignment.jobId) : null;
  const customer = job ? await ctx.db.get(job.customerId) : null;
  return job ? `${customer?.name ?? "a customer"}'s visit ${arrivalWords(job, timezone)}` : "a visit";
}

/** Carries a reading out through the same functions the cleaner's link uses. Answers with what happened. */
async function carryOut(ctx: MutationCtx, reading: Doc<"replyReadings">, actor: Actor, timezone: string): Promise<{ ok: boolean; words: string }> {
  const assignment = reading.assignmentId ? await ctx.db.get(reading.assignmentId) : null;
  if (!assignment || assignment.companyId !== reading.companyId || assignment.cleanerId !== reading.cleanerId) return { ok: false, words: "The visit is no longer one this cleaner is on." };
  const data = { via: "text", readingId: reading._id };
  try {
    if (reading.intent === "accept_offer" || reading.intent === "decline_offer") {
      const result = await answerOffer(ctx, assignment, reading.intent === "accept_offer" ? "accepted" : "declined", actor, data);
      if (result.status === "refused") return { ok: false, words: result.message };
      if (result.status === "expired") return { ok: false, words: "The offer's deadline had passed, so it expired instead." };
      return { ok: true, words: result.status === "accepted" ? "Recorded as accepted. Their job link was texted to them." : "Recorded as declined. Dispatch looks for the next cleaner." };
    }
    if (reading.intent === "running_late") {
      if (!reading.etaMinutes) return { ok: false, words: "No time was given." };
      const result = await reportDelay(ctx, assignment._id, { etaMinutes: reading.etaMinutes, reason: `By text: "${reading.excerpt.slice(0, 200)}"` }, actor);
      return { ok: true, words: `Recorded as running late, expected about ${clock(result.etaAt, timezone)}.${result.pastWindow ? " That is past the arrival window, so telling the customer is now a task." : ""}` };
    }
    if (reading.intent === "cannot_attend") {
      await cannotAttend(ctx, assignment._id, `By text: "${reading.excerpt.slice(0, 200)}"`, actor);
      return { ok: true, words: "Taken off the visit. Their place is open and cover has started." };
    }
  } catch (error) {
    const message = (error as { data?: { message?: unknown } }).data?.message;
    return { ok: false, words: typeof message === "string" ? message : "It could not be recorded." };
  }
  return { ok: false, words: "There is nothing to carry out." };
}

async function settleTask(ctx: MutationCtx, reading: Doc<"replyReadings">, outcome: string, actor: Actor) {
  if (!reading.taskId) return;
  const task = await ctx.db.get(reading.taskId);
  if (task && task.status !== "done" && task.status !== "cancelled") await setTaskState(ctx, task, "done", { outcome: outcome.slice(0, 500), closedAt: Date.now(), withPersonSince: null }, actor);
}

/**
 * Checks the reader's answer against the record and either carries it out (only what the Owner allows,
 * only when clear) or spells it out on the reply task for a person.
 */
export const decide = internalMutation({
  args: { readingId: v.id("replyReadings"), answer: answerValidator, options: v.array(v.string()) },
  handler: async (ctx, args) => {
    const reading = await ctx.db.get(args.readingId);
    if (!reading || reading.status !== "reading") return null;
    const company = await ctx.db.get(reading.companyId);
    if (!company) return null;
    const cleaner = await ctx.db.get(reading.cleanerId);
    const name = cleaner?.name ?? "The cleaner";
    // The answer names a visit by its label. The label is matched to the visits as they are now.
    const options = await optionsFor(ctx, company, reading.cleanerId);
    const option = args.answer.ref ? options.find((row) => row.ref === args.answer.ref) : undefined;
    const fits = option && ((option.kind === "offer" && (args.answer.intent === "accept_offer" || args.answer.intent === "decline_offer")) || (option.kind === "job" && (args.answer.intent === "running_late" || args.answer.intent === "cannot_attend")));
    const sameList = options.length === args.options.length;
    const clear = args.answer.clear && Boolean(fits) && sameList && (args.answer.intent !== "running_late" || (args.answer.etaMinutes !== null && args.answer.etaMinutes >= 1 && args.answer.etaMinutes <= 480));
    const now = Date.now();
    const task = reading.taskId ? await ctx.db.get(reading.taskId) : null;

    if (!clear || !option) {
      await ctx.db.patch(reading._id, { status: "unclear", reader: args.answer.reader, intent: args.answer.intent, reason: args.answer.reason.slice(0, 300), decidedAt: now });
      if (task && task.status === "needs_decision") {
        const why = !sameList ? "Their visits changed while the text was being read." : args.answer.reason;
        await setTaskState(ctx, task, "needs_decision", { openQuestion: `${name} texted: "${reading.excerpt}". Dispatch could not tell for certain what to do (${why}). Nothing was changed. Reply to them, or record what they meant on the visit.`.slice(0, 1000), dueAt: task.dueAt }, DISPATCH, { sameStatus: true });
      }
      return null;
    }

    await ctx.db.patch(reading._id, { status: "proposed", reader: args.answer.reader, intent: args.answer.intent, assignmentId: option.assignmentId, etaMinutes: args.answer.etaMinutes ?? undefined, reason: args.answer.reason.slice(0, 300), decidedAt: now });
    const proposed = (await ctx.db.get(reading._id))!;
    const visit = await visitWords(ctx, option.assignmentId, company.timezone);
    const authority = await authorityFor(ctx, company._id, ACT_ON_REPLY);
    const may = DISPATCH_MAY.has(args.answer.intent) && authority.kind === "level" && (authority.level === "execute_and_report" || authority.level === "execute");
    if (may) {
      const done = await carryOut(ctx, proposed, DISPATCH, company.timezone);
      await ctx.db.patch(reading._id, { status: done.ok ? "applied" : "not_applied", outcome: done.words });
      await recordEvent(ctx, { companyId: company._id, type: done.ok ? "dispatch.reply_applied" : "dispatch.reply_not_applied", actor: DISPATCH, subject: { table: "assignments", id: option.assignmentId }, data: { intent: args.answer.intent, reader: args.answer.reader, readingId: reading._id } });
      if (done.ok) {
        await settleTask(ctx, proposed, `Dispatch read "${reading.excerpt}" as: ${proposalWords(proposed, visit)}. ${done.words}`, DISPATCH);
        return null;
      }
      if (task && task.status === "needs_decision") {
        await setTaskState(ctx, task, "needs_decision", { openQuestion: `${name} texted: "${reading.excerpt}". Dispatch read it as: ${proposalWords(proposed, visit)}, but it could not be recorded: ${done.words} Nothing was changed.`.slice(0, 1000), dueAt: task.dueAt }, DISPATCH, { sameStatus: true });
      }
      return null;
    }
    if (task && task.status === "needs_decision") {
      const who = args.answer.intent === "accept_offer" ? "Taking a job by text always needs a person." : "Your Playbook has Dispatch propose this.";
      await setTaskState(ctx, task, "needs_decision", { openQuestion: `${name} texted: "${reading.excerpt}". Dispatch reads it as: ${proposalWords(proposed, visit)} (${args.answer.reason}). ${who} Apply it, or dismiss it and reply to them.`.slice(0, 1000), dueAt: task.dueAt }, DISPATCH, { sameStatus: true });
    }
    return null;
  },
});

/** A person applies the reading Dispatch proposed. Every check runs again now. */
export const apply = managerMutation({
  args: { readingId: v.id("replyReadings") },
  handler: async (ctx, args) => {
    const reading = await ctx.db.get(args.readingId);
    if (!reading || reading.companyId !== ctx.companyId) notFound();
    if (reading.status !== "proposed") throw userError("This reading was already dealt with.");
    const done = await carryOut(ctx, reading, byMember(ctx), ctx.company.timezone);
    await ctx.db.patch(reading._id, { status: done.ok ? "applied" : "not_applied", outcome: done.words, decidedAt: Date.now() });
    if (!done.ok) throw userError(`It could not be recorded: ${done.words}`);
    await settleTask(ctx, reading, `Applied by a person: ${done.words}`, byMember(ctx));
    return { words: done.words };
  },
});

/** A person decides the reading is wrong. Nothing changes on the visit. */
export const dismiss = managerMutation({
  args: { readingId: v.id("replyReadings") },
  handler: async (ctx, args) => {
    const reading = await ctx.db.get(args.readingId);
    if (!reading || reading.companyId !== ctx.companyId) notFound();
    if (reading.status !== "proposed" && reading.status !== "unclear") throw userError("This reading was already dealt with.");
    await ctx.db.patch(reading._id, { status: "dismissed", decidedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "dispatch.reply_dismissed", actor: byMember(ctx), subject: { table: "cleaners", id: reading.cleanerId }, data: { intent: reading.intent ?? "other" } });
    return null;
  },
});

/** Opens a reading for a text from one known cleaner, tied to the reply task a person sees. */
export async function startReading(ctx: MutationCtx, input: { companyId: Id<"companies">; cleanerId: Id<"cleaners">; excerpt: string; receivedAt: number; taskId: Id<"tasks"> | null }) {
  const readingId = await ctx.db.insert("replyReadings", { companyId: input.companyId, cleanerId: input.cleanerId, excerpt: input.excerpt, receivedAt: input.receivedAt, status: "reading", taskId: input.taskId ?? undefined });
  await ctx.scheduler.runAfter(0, internal.dispatchReplies.read, { readingId });
  return readingId;
}

