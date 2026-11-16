/**
 * Texts and opt-outs coming in, from Telnyx's webhook (convex/http.ts, /webhooks/telnyx). Only what is needed to honour the person's choice is kept: never the whole
 * text, at most its first 200 characters with any link taken out, and no IP or device data.
 *
 * Keywords are the whole message, trimmed, in any letter case:
 * STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT: stop every text from this business.
 * HELP, INFO: one answer with who is texting and how to reach them.
 * START, UNSTOP, YES: undo a STOP, and only what the STOP withdrew.
 * A plain-words request to stop ("stop texting me") stops texts too, and a person checks it.
 * Anything else from someone on record becomes a task for a person to read. Nothing acts on its words.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { startReading } from "./dispatchReplies";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { readProfile } from "./lib/compliance/profile";
import { activeSuppressions, addSuppression, currentPermission, excerpt, liftSuppression, setPermission, withdrawChannel } from "./lib/compliance/permissions";
import { normalAddress, recipientsAt, type RecipientRecord } from "./lib/compliance/recipients";
import { CATEGORIES, categoryValidator, type Recipient } from "./lib/compliance/schema";
import type { Actor } from "./lib/events";
import { queueReply } from "./lib/messaging/outbox";
import { allow } from "./lib/rateLimit";
import type { Agent } from "./lib/statuses";
import { liveTaskByKey, openTask, setTaskState } from "./lib/taskState";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SYSTEM: Actor = { kind: "system" };
/** At most this many automatic answers to one number in an hour, whatever it sends. */
const REPLIES_PER_HOUR = 5;

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);
const START_WORDS = new Set(["START", "UNSTOP", "YES"]);
const PLAIN_STOP = /\b(stop (texting|messaging|contacting|sending)|(don'?t|do not) (text|message|contact)|remove me|unsubscribe me|no more (texts|messages))\b/i;

export type InboundKind = "stop" | "help" | "start" | "plain_stop" | "ignored";

export function classify(body: string): InboundKind {
  const word = body.trim().replace(/[.!]+$/, "").toUpperCase();
  if (STOP_WORDS.has(word)) return "stop";
  if (HELP_WORDS.has(word)) return "help";
  if (START_WORDS.has(word)) return "start";
  if (PLAIN_STOP.test(body)) return "plain_stop";
  return "ignored";
}

async function companyForNumber(ctx: MutationCtx, to: string): Promise<Id<"companies"> | null> {
  const rows = await ctx.db
    .query("complianceProfiles")
    .withIndex("by_sms_number", (q) => q.eq("messaging.smsNumber", to))
    .take(2);
  // A number set on two companies cannot say which one the person meant, so it answers for neither.
  return rows.length === 1 ? rows[0].companyId : null;
}

function asRecipient(row: RecipientRecord): Recipient {
  return { kind: row.kind, id: row.id };
}

async function reply(ctx: MutationCtx, companyId: Id<"companies">, to: string, body: string, kind: "stop" | "help" | "start", dedupeKey: string): Promise<Doc<"messages"> | null> {
  if (!(await allow(ctx, `inbound-reply:${companyId}:${to}`, REPLIES_PER_HOUR, HOUR))) return null;
  return queueReply(ctx, { companyId, to, body, reply: kind, dedupeKey });
}

type InboundResult = { kind: InboundKind | "unknown_number" | "bad_number" | "duplicate"; replied: boolean };

export const sms = internalMutation({
  args: { to: v.string(), from: v.string(), body: v.string(), receivedAt: v.number() },
  handler: async (ctx, args): Promise<InboundResult> => handleSms(ctx, args),
});

/**
 * A text from Telnyx's webhook. The same event delivered twice is recognised by its id and handled once,
 * so a STOP is not confirmed twice and a reply does not open two tasks.
 */
export const telnyx = internalMutation({
  args: { eventId: v.string(), to: v.string(), from: v.string(), body: v.string(), receivedAt: v.number() },
  handler: async (ctx, args): Promise<InboundResult> => {
    const seen = await ctx.db
      .query("providerReceipts")
      .withIndex("by_provider_event", (q) => q.eq("provider", "telnyx").eq("eventId", args.eventId))
      .first();
    if (seen) return { kind: "duplicate", replied: false };
    await ctx.db.insert("providerReceipts", { provider: "telnyx", eventId: args.eventId, receivedAt: Date.now() });
    return handleSms(ctx, args);
  },
});

async function handleSms(ctx: MutationCtx, args: { to: string; from: string; body: string; receivedAt: number }): Promise<InboundResult> {
  {
    const to = normalAddress("sms", args.to);
    const companyId = to ? await companyForNumber(ctx, to) : null;
    if (!companyId) return { kind: "unknown_number", replied: false };
    const from = normalAddress("sms", args.from);
    if (!from) return { kind: "bad_number", replied: false };
    const kind = classify(args.body);
    // Not a keyword. Someone on record who texts the company's number is answered by a person, and a
    // cleaner's text is also read against their own visits (dispatchReplies.ts).
    const ordinary = async (): Promise<InboundResult> => {
      const known = await recipientsAt(ctx, companyId, "sms", from);
      if (known.length > 0) await replyTask(ctx, companyId, from, known, args.body, args.receivedAt);
      return { kind: "ignored", replied: false };
    };
    if (kind === "ignored") return ordinary();

    const profile = await readProfile(ctx, companyId);
    const sender = profile.messaging.senderName ?? (await ctx.db.get(companyId))?.name ?? "this business";
    const people = await recipientsAt(ctx, companyId, "sms", from);
    const at = args.receivedAt;
    const byRecipient = { kind: "recipient" as const };

    if (kind === "stop") {
      const { suppression, created } = await addSuppression(ctx, { companyId, channel: "sms", address: from, scope: "all", reason: "stop_keyword", sourceMessage: excerpt(args.body), at, actor: SYSTEM });
      for (const person of people) {
        await withdrawChannel(ctx, { companyId, recipient: asRecipient(person), channel: "sms", source: "text_reply", recordedBy: byRecipient, stopKeyword: true, evidence: "Replied STOP.", actor: SYSTEM, at });
      }
      // One confirmation per STOP that started a suppression. A second STOP while it stands gets no new answer.
      let replied = false;
      if (created) {
        const message = await reply(ctx, companyId, from, `You will no longer receive texts from ${sender}. Reply START to resubscribe.`, "stop", `reply:stop:${suppression._id}`);
        replied = message !== null && message.status !== "not_sent";
      }
      return { kind, replied };
    }

    if (kind === "help") {
      const reach = [profile.identity.supportPhone ? `call ${profile.identity.supportPhone}` : null, profile.identity.supportEmail ? `email ${profile.identity.supportEmail}` : null].filter(Boolean).join(" or ");
      const body = `${sender}: ${reach ? `for help, ${reach}.` : "for help, contact the business directly."} Reply STOP to stop texts.`;
      const message = await reply(ctx, companyId, from, body, "help", `reply:help:${from}:${at}`);
      return { kind, replied: message !== null && message.status !== "not_sent" };
    }

    if (kind === "start") {
      const stops = (await activeSuppressions(ctx, companyId, "sms", from)).filter((row) => row.reason === "stop_keyword");
      // START means something only after a STOP. Otherwise it is an ordinary reply, such as "Yes" to an offer.
      if (stops.length === 0) return ordinary();
      for (const row of stops) await liftSuppression(ctx, row, { liftedBy: byRecipient, note: "Replied START.", actor: SYSTEM });
      for (const person of people) {
        for (const category of CATEGORIES) {
          const row = await currentPermission(ctx, companyId, asRecipient(person), "sms", category);
          // Only what a STOP withdrew comes back. A START is never a new marketing permission.
          if (!row || row.status !== "withdrawn" || !row.stopKeyword) continue;
          await setPermission(ctx, { companyId, recipient: asRecipient(person), channel: "sms", category, status: "granted", source: "text_reply", evidence: "Replied START.", recordedBy: byRecipient, at, actor: SYSTEM });
        }
      }
      const message = await reply(ctx, companyId, from, `You will receive texts from ${sender} again. Reply STOP to stop.`, "start", `reply:start:${stops[0]._id}`);
      return { kind, replied: message !== null && message.status !== "not_sent" };
    }

    // A plain-words request to stop. Texts stop now; a person reads it and confirms what the person wants.
    const { suppression } = await addSuppression(ctx, { companyId, channel: "sms", address: from, scope: "all", reason: "natural_language", sourceMessage: excerpt(args.body), at, actor: SYSTEM });
    for (const person of people) {
      await withdrawChannel(ctx, { companyId, recipient: asRecipient(person), channel: "sms", source: "text_reply", recordedBy: byRecipient, evidence: "Asked in their own words to stop texts.", actor: SYSTEM, at });
    }
    await reviewTask(ctx, companyId, from, people, suppression);
    return { kind, replied: false };
  }
}

/**
 * One open task per number for texts a person needs to read. A later text from the same number updates
 * the task with the newest words. Only an excerpt is kept, with any link taken out.
 */
async function replyTask(ctx: MutationCtx, companyId: Id<"companies">, address: string, people: RecipientRecord[], body: string, at: number) {
  const key = `inbound.reply:${address}`;
  const person = people.length === 1 ? people[0] : null;
  const who = person ? person.name : `${people.length} people who share ${address}`;
  const question = `${who} texted the company's number: "${excerpt(body) ?? ""}". Read it and act on it yourself: a text is not recorded as an answer to an offer, an ETA or a check-in. Reply by phone or from your own texting tool.`.slice(0, 1000);
  const existing = await liveTaskByKey(ctx, companyId, key);
  // A text from exactly one cleaner is also read against that cleaner's own visits (dispatchReplies.ts).
  const read = async (taskId: Id<"tasks">) => {
    // Each reading may call a model, so one number gets at most ten an hour; the task still shows every text.
    if (person?.kind === "cleaner" && (await allow(ctx, `reply-read:${companyId}:${address}`, 10, HOUR))) await startReading(ctx, { companyId, cleanerId: person.id as Id<"cleaners">, excerpt: excerpt(body) ?? "", receivedAt: at, taskId });
  };
  if (existing) {
    await setTaskState(ctx, existing, "needs_decision", { openQuestion: question, dueAt: at + HOUR, withPersonSince: existing.withPersonSince ?? Date.now() }, SYSTEM, { sameStatus: true });
    await read(existing._id);
    return;
  }
  // Rate-limited per number, so a stream of texts cannot open a stream of tasks.
  if (!(await allow(ctx, `inbound-task:${companyId}:${address}`, 5, HOUR))) return;
  const agent: Agent = person?.kind === "customer" ? "retention" : person?.kind === "applicant" ? "recruiter" : "dispatch";
  const taskId = await openTask(ctx, {
    companyId,
    agent,
    title: `Text from ${who}`,
    nextAction: "Read the text and answer it",
    dueAt: at + HOUR,
    completionCondition: "A person read the text and dealt with it",
    about: person ? (person.kind === "cleaner" ? { table: "cleaners", id: person.id as Id<"cleaners"> } : { table: "customers", id: person.id as Id<"customers"> }) : undefined,
    key,
    actor: SYSTEM,
  });
  await setTaskState(ctx, (await ctx.db.get(taskId))!, "needs_decision", { openQuestion: question, dueAt: at + HOUR, withPersonSince: Date.now() }, SYSTEM);
  await read(taskId);
}

/** A task for a person to read a plain-words opt-out and confirm it. Opened once per number while it is open. */
async function reviewTask(ctx: MutationCtx, companyId: Id<"companies">, address: string, people: RecipientRecord[], suppression: Doc<"suppressions">) {
  const key = `consent.review:${address}`;
  if (await liveTaskByKey(ctx, companyId, key)) return;
  const person = people.length === 1 ? people[0] : null;
  // Filed under the agent that would text this person. Dispatch texts cleaners today; the others are queues a person works.
  const agent: Agent = person?.kind === "customer" ? "retention" : person?.kind === "applicant" ? "recruiter" : "dispatch";
  const who = person ? person.name : people.length > 1 ? `${people.length} people who share ${address}` : address;
  const taskId = await openTask(ctx, {
    companyId,
    agent,
    title: `Check a request to stop texts from ${who}`,
    nextAction: "Read the reply and confirm the person asked to stop texts. Texts to this number are stopped until a person decides.",
    dueAt: Date.now() + DAY,
    completionCondition: "A person confirmed the opt-out, or recorded what the person actually wants",
    about: person ? (person.kind === "cleaner" ? { table: "cleaners", id: person.id as Id<"cleaners"> } : { table: "customers", id: person.id as Id<"customers"> }) : undefined,
    key,
    actor: SYSTEM,
  });
  await setTaskState(
    ctx,
    (await ctx.db.get(taskId))!,
    "needs_decision",
    { openQuestion: `${who} wrote: "${suppression.sourceMessage ?? ""}". Texts are stopped. Is this a request to stop all texts? If not, the Owner can lift the stop with a note.`.slice(0, 1000), withPersonSince: Date.now() },
    SYSTEM,
  );
}

/** An email unsubscribe link was used. The address gets no more email of that kind from this company. */
export const emailUnsubscribe = internalMutation({
  args: { companyId: v.id("companies"), address: v.string(), category: categoryValidator },
  handler: async (ctx, args) => {
    const address = normalAddress("email", args.address);
    if (!address || !(await ctx.db.get(args.companyId))) return { suppressed: false };
    const at = Date.now();
    await addSuppression(ctx, { companyId: args.companyId, channel: "email", address, scope: args.category, reason: "unsubscribe", at, actor: SYSTEM });
    for (const person of await recipientsAt(ctx, args.companyId, "email", address)) {
      await withdrawChannel(ctx, { companyId: args.companyId, recipient: asRecipient(person), channel: "email", categories: [args.category], source: "email_reply", recordedBy: { kind: "recipient" }, evidence: "Used the unsubscribe link.", actor: SYSTEM, at });
    }
    return { suppressed: true };
  },
});
