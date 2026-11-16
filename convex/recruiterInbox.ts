/**
 * Reading the hiring inbox. One run for one connection: list headers after the saved cursor, decide
 * from sender and subject which messages are hiring mail, open only those, file each one, then save the
 * cursor. The cursor is saved after the page is filed, never before, so a crash replays the page and
 * filing ignores what it already has. Nothing here sends, deletes or marks a message.
 *
 * Internal only. A browser cannot start a run or hand it a message.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { recordEvent } from "./lib/events";
import { checked, headerEvidence } from "./lib/recruiter/interpret";
import { ingestMessage, type IngestInput, type Verdict } from "./lib/recruiter/intake";
import { addressOf, classifyHeader, plainText, worthReading, type MessageBody, type MessageHeader } from "./lib/recruiter/mail";
import { accessToken, gmailConnector, googleApp } from "./lib/recruiter/gmail";
import { connectorFor, MailboxAuthError } from "./lib/recruiter/mailbox";
import { unseal } from "./lib/recruiter/secrets";
import { hiringModel, rulesModel, type HiringModel } from "./lib/recruiter/model";
import { finishExecution, openExecution } from "./lib/billing/executions";
import { reserveExecution } from "./lib/billing/reserve";
import { classificationValidator, contactEvidenceValidator, sourceValidator } from "./lib/recruiter/schema";
import { HOUR } from "./lib/recruiter/settings";
import { liveTaskByKey, openTask, setTaskState } from "./lib/taskState";

const PAGE = 25;
const MAX_PAGES = 8;
const EXCERPT = 6000;

const headerValidator = v.object({ id: v.string(), threadId: v.optional(v.string()), from: v.string(), replyTo: v.optional(v.string()), subject: v.string(), receivedAt: v.number() });
const evidenceValidator = v.object({ address: contactEvidenceValidator.fields.address, kind: contactEvidenceValidator.fields.kind, where: contactEvidenceValidator.fields.where });
const readValidator = v.object({
  classification: classificationValidator,
  source: sourceValidator,
  reason: v.string(),
  name: v.optional(v.string()),
  role: v.optional(v.string()),
  sourceApplicationId: v.optional(v.string()),
  phone: v.optional(v.string()),
  location: v.optional(v.string()),
  experience: v.optional(v.string()),
  availability: v.optional(v.string()),
  resume: v.optional(v.string()),
  addresses: v.array(evidenceValidator),
  replyIntent: v.optional(v.union(v.literal("withdraw"), v.literal("no_contact"), v.literal("question"))),
  forwarded: v.boolean(),
});

/** What a run needs to start. Null when the connection is not one to read. */
export const begin = internalQuery({
  args: { connectionId: v.id("mailboxConnections") },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status === "disconnected" || connection.status === "expired") return null;
    const company = await ctx.db.get(connection.companyId);
    if (!company || company.pausedAgents.includes("recruiter")) return null;
    const members = await ctx.db
      .query("members")
      .withIndex("by_company", (q) => q.eq("companyId", connection.companyId))
      .take(200);
    return {
      provider: connection.provider,
      scope: { address: connection.address, folder: connection.folder, after: connection.processFrom },
      cursor: connection.cursor ?? null,
      sources: connection.sources,
      // Our own addresses are never an applicant's.
      ours: [connection.address, ...members.map((member) => member.email)].map((value) => value.toLowerCase()),
    };
  },
});

/** Which of these messages are new, and which come from an address an applicant is known by. Reads no message. */
export const triage = internalQuery({
  args: { connectionId: v.id("mailboxConnections"), messages: v.array(v.object({ id: v.string(), from: v.optional(v.string()) })) },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return [];
    const out: { id: string; seen: boolean; knownApplicant: boolean }[] = [];
    for (const message of args.messages) {
      const seen = await ctx.db
        .query("sourceMessages")
        .withIndex("by_connection_message", (q) => q.eq("connectionId", connection._id).eq("providerMessageId", message.id))
        .first();
      const known = message.from
        ? await ctx.db
            .query("applicants")
            .withIndex("by_company_email", (q) => q.eq("companyId", connection.companyId).eq("email", message.from))
            .first()
        : null;
      out.push({ id: message.id, seen: seen !== null, knownApplicant: known !== null && !known.redactedAt });
    }
    return out;
  },
});

export const ingest = internalMutation({
  args: {
    connectionId: v.id("mailboxConnections"),
    header: headerValidator,
    verdict: v.object({ classification: classificationValidator, classifiedBy: v.union(v.literal("rule"), v.literal("model")), reason: v.string(), source: v.optional(sourceValidator) }),
    read: v.optional(readValidator),
    excerpt: v.optional(v.string()),
    attachments: v.optional(v.array(v.object({ name: v.string(), contentType: v.string(), size: v.number(), read: v.boolean() }))),
    headerEvidence: v.optional(v.array(evidenceValidator)),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return "gone";
    const input: IngestInput = { header: args.header, verdict: args.verdict, read: args.read, excerpt: args.excerpt, attachments: args.attachments, headerEvidence: args.headerEvidence };
    return ingestMessage(ctx, connection, input);
  },
});

/** A page was filed. Saves where it ended and clears any earlier trouble. */
export const commit = internalMutation({
  args: { connectionId: v.id("mailboxConnections"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return null;
    await ctx.db.patch(connection._id, { cursor: args.cursor ?? connection.cursor, lastSyncAt: Date.now(), failures: 0, status: "connected", problem: undefined });
    const task = await liveTaskByKey(ctx, connection.companyId, `recruiter.mailbox:${connection._id}`);
    if (task) await setTaskState(ctx, task, "done", { outcome: "The hiring inbox is being read again.", closedAt: Date.now() }, { kind: "system" });
    return null;
  },
});

/** A run failed. The cursor is untouched, so the next run starts where this one did. */
export const failed = internalMutation({
  args: { connectionId: v.id("mailboxConnections"), kind: v.union(v.literal("auth"), v.literal("provider"), v.literal("not_built")) },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return null;
    const failures = connection.failures + 1;
    const auth = args.kind === "auth";
    const problem = auth
      ? "The mailbox's authorization has ended. Reconnect the hiring inbox."
      : args.kind === "not_built"
        ? "This mailbox provider is not connected yet."
        : "The mailbox provider did not answer. Recruiter will try again.";
    const status = auth ? "expired" : args.kind === "not_built" || failures >= 3 ? "error" : connection.status;
    await ctx.db.patch(connection._id, { failures, status, problem });
    await recordEvent(ctx, { companyId: connection.companyId, type: "mailbox.sync_failed", actor: { kind: "system" }, subject: { table: "mailboxConnections", id: connection._id }, data: { kind: args.kind, failures } });
    if (status === connection.status && status === "connected") return null;
    // New applications are not being seen. That is a person's problem to know about, once.
    const key = `recruiter.mailbox:${connection._id}`;
    if (await liveTaskByKey(ctx, connection.companyId, key)) return null;
    const dueAt = Date.now() + 4 * HOUR;
    const taskId = await openTask(ctx, { companyId: connection.companyId, agent: "recruiter", title: `The hiring inbox ${connection.address} is not being read`, nextAction: problem, dueAt, completionCondition: "The hiring inbox is connected and read again", about: { table: "mailboxConnections", id: connection._id }, key, actor: { kind: "system" } });
    await setTaskState(ctx, (await ctx.db.get(taskId))!, "needs_decision", { openQuestion: `${problem} Until then, new applications are not seen.`, dueAt, withPersonSince: Date.now() }, { kind: "system" });
    return null;
  },
});

export const sync = internalAction({
  args: { connectionId: v.id("mailboxConnections") },
  handler: async (ctx, args): Promise<{ filed: number; opened: number } | null> => {
    const start = await ctx.runQuery(internal.recruiterInbox.begin, { connectionId: args.connectionId });
    if (!start) return null;
    let connector = connectorFor(start.provider);
    if (start.provider === "gmail") {
      // The stored authorization, opened only here and only for this run.
      const app = googleApp();
      const credential = await ctx.runQuery(internal.recruiterMailbox.credentialFor, { connectionId: args.connectionId });
      const refreshToken = credential ? await unseal(credential.sealedRefreshToken, args.connectionId) : null;
      if (!app || !refreshToken) {
        await ctx.runMutation(internal.recruiterInbox.failed, { connectionId: args.connectionId, kind: app ? "auth" : "not_built" });
        return null;
      }
      try {
        connector = gmailConnector({ token: await accessToken(app, refreshToken) });
      } catch (error) {
        await ctx.runMutation(internal.recruiterInbox.failed, { connectionId: args.connectionId, kind: error instanceof MailboxAuthError ? "auth" : "provider" });
        return null;
      }
    }
    if (!connector) {
      await ctx.runMutation(internal.recruiterInbox.failed, { connectionId: args.connectionId, kind: "not_built" });
      return null;
    }
    const aiModel = hiringModel();
    let cursor = start.cursor;
    let filed = 0;
    let opened = 0;
    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const listed = await connector.list(start.scope, cursor, PAGE);
        const marks = await ctx.runQuery(internal.recruiterInbox.triage, { connectionId: args.connectionId, messages: listed.headers.map((header) => ({ id: header.id, from: addressOf(header.from) ?? undefined })) });
        for (const header of listed.headers) {
          const mark = marks.find((row) => row.id === header.id);
          if (mark?.seen) continue;
          const input = await decide(header, Boolean(mark?.knownApplicant));
          await ctx.runMutation(internal.recruiterInbox.ingest, { connectionId: args.connectionId, ...input });
          filed += 1;
        }
        cursor = listed.cursor;
        await ctx.runMutation(internal.recruiterInbox.commit, { connectionId: args.connectionId, cursor });
        if (!listed.more) break;
      }
    } catch (error) {
      await ctx.runMutation(internal.recruiterInbox.failed, { connectionId: args.connectionId, kind: error instanceof MailboxAuthError ? "auth" : "provider" });
      return null;
    }
    return { filed, opened };

    /**
     * The AI reader, for one message, once Selestial Credits are held for it. Without a verified hold
     * (no plan, no credits, billing unreachable, the monthly budget for automatic work spent) that
     * message is read by the rules instead, so no application is dropped and nothing is charged.
     */
    async function readerFor(messageId: string): Promise<{ model: HiringModel; executionId: Id<"aiExecutions"> | null }> {
      if (aiModel.name === "rules") return { model: rulesModel, executionId: null };
      const opened = await ctx.runMutation(internal.recruiterInbox.openReading, { connectionId: args.connectionId, messageId });
      if (!opened) return { model: rulesModel, executionId: null };
      const held = await reserveExecution(ctx, opened);
      return held.ok ? { model: aiModel, executionId: opened } : { model: rulesModel, executionId: null };
    }

    /** Sender and subject first. The body is fetched only for mail that those say is hiring mail. */
    async function decide(header: MessageHeader, knownApplicant: boolean): Promise<IngestInput> {
      const held: { reader: { model: HiringModel; executionId: Id<"aiExecutions"> | null } | null } = { reader: null };
      const pick = async () => (held.reader ??= await readerFor(header.id)).model;
      const model = {
        looksLikeHiring: async (input: { from: string; subject: string }) => (await pick()).looksLikeHiring(input),
        interpret: async (message: MessageBody, known: Parameters<HiringModel["interpret"]>[1]) => (await pick()).interpret(message, known),
      };
      try {
        const decided = await decideWith(header, knownApplicant, model);
        if (held.reader?.executionId) await ctx.runMutation(internal.recruiterInbox.finishReading, { executionId: held.reader.executionId, read: true });
        return decided;
      } catch (error) {
        if (held.reader?.executionId) await ctx.runMutation(internal.recruiterInbox.finishReading, { executionId: held.reader.executionId, read: false });
        throw error;
      }
    }

    async function decideWith(header: MessageHeader, knownApplicant: boolean, model: Pick<HiringModel, "looksLikeHiring" | "interpret">): Promise<IngestInput> {
      const byHeader = classifyHeader(header);
      let verdict: Verdict;
      if (byHeader.kind === "board") {
        const wanted = start!.sources.length === 0 || start!.sources.includes(byHeader.source);
        verdict = wanted ? { classification: byHeader.classification, classifiedBy: "rule", reason: byHeader.reason, source: byHeader.source } : { classification: "promotion", classifiedBy: "rule", reason: "From a job board this connection is not set to read.", source: byHeader.source };
      } else if (knownApplicant) {
        verdict = { classification: "applicant_reply", classifiedBy: "rule", reason: "From an address an applicant is known by." };
      } else {
        const guess = await model.looksLikeHiring({ from: header.from.slice(0, 200), subject: header.subject.slice(0, 200) });
        verdict = guess.hiring ? { classification: "new_application", classifiedBy: "model", reason: guess.reason.slice(0, 200) } : { classification: "unrelated", classifiedBy: "model", reason: "" };
      }
      if (!worthReading(verdict.classification)) return { header, verdict };

      const message = await connector!.fetch(start!.scope, header.id);
      if (!message) return { header, verdict: { ...verdict, classification: "unrelated", reason: "" } };
      opened += 1;
      const known = byHeader.kind === "board" ? { source: byHeader.source, classification: verdict.classification } : knownApplicant ? { source: "direct" as const, classification: "applicant_reply" as const } : null;
      // Whoever read it, the reading is checked against the message before it is used.
      const read = checked(await model.interpret(message, known), message);
      if (known) read.classification = known.classification;
      if (read.classification === "unrelated") return { header, verdict: { classification: "unrelated", classifiedBy: verdict.classifiedBy, reason: "" } };
      return {
        header,
        verdict: { ...verdict, classification: read.classification, source: read.source },
        read,
        excerpt: plainText(message.text, EXCERPT),
        attachments: message.attachments.slice(0, 10).map((file) => ({ name: file.name.slice(0, 160), contentType: file.contentType.slice(0, 100), size: file.size, read: Boolean(file.text) })),
        headerEvidence: headerEvidence(message, start!.ours),
      };
    }
  },
});

/** Opens the execution for one message's AI reading. Null when it cannot be charged, so the rules read it. */
export const openReading = internalMutation({
  args: { connectionId: v.id("mailboxConnections"), messageId: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    const company = connection ? await ctx.db.get(connection.companyId) : null;
    if (!connection || !company) return null;
    const opened = await openExecution(ctx, { company, key: `hiring-read:${connection._id}:${args.messageId.slice(0, 200)}`, agent: "recruiter", task: "hiring_message_reading", units: 1, autonomous: true, source: { table: "mailboxConnections", id: connection._id } });
    return opened.ok && !opened.repeated ? opened.executionId : null;
  },
});

export const finishReading = internalMutation({
  args: { executionId: v.id("aiExecutions"), read: v.boolean() },
  handler: async (ctx, args) => {
    await finishExecution(ctx, args.executionId, args.read ? { completedUnits: 1 } : { ended: "failed" });
  },
});

/** Run on a schedule: starts a run for every connection that can be read. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    let started = 0;
    for await (const connection of ctx.db.query("mailboxConnections")) {
      if (connection.status === "disconnected" || connection.status === "expired") continue;
      await ctx.scheduler.runAfter(0, internal.recruiterInbox.sync, { connectionId: connection._id });
      started += 1;
    }
    return started;
  },
});
