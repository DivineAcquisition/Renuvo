/**
 * The run engine behind Company Chat. Internal only: no browser can call these.
 *
 * A run answers one message. The person's message is saved before the run is scheduled, and every word
 * the model writes is saved as it arrives, so a refresh, a dropped connection or a closed tab loses
 * nothing: the page reads the record. Each tool call is a separate transaction (lib/chat/steps.ts) with
 * its own receipt, carried out at most once.
 *
 * Stop is checked before every step and every few words. Stopping ends future work; it never claims to
 * undo what was already done, and the reply says exactly what was.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { chatModel, ModelError, type ModelMessage, type ToolSpec } from "./lib/chat/model";
import { systemPrompt, userTurn } from "./lib/chat/prompt";
import { runStatusValidator, type RunStatus } from "./lib/chat/schema";
import { addPart, currentMember, monthOf, setState, stateAfter, usageRow } from "./lib/chat/state";
import { stepFromModel } from "./lib/chat/steps";
import { describeRecord, toolSpecs, type RecordTable } from "./lib/chat/tools";

const TEXT_LIMIT = 120_000;
/** A run whose worker has said nothing for this long is treated as interrupted. */
export const STALE_MS = 3 * 60 * 1000;
const HISTORY_MESSAGES = 40;
const ATTACHMENT_CHARS = 60_000;

async function liveRun(ctx: MutationCtx, runId: Id<"chatRuns">) {
  const run = await ctx.db.get(runId);
  return run && (run.status === "running" || run.status === "queued") ? run : null;
}

/** Claims a queued run. A run already claimed, or ended, is left alone, so a duplicate schedule does nothing. */
export const begin = internalMutation({
  args: { runId: v.id("chatRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "queued") return null;
    await ctx.db.patch(run._id, { status: "running", heartbeatAt: Date.now() });
    return { startedAt: run.startedAt, limits: run.limits };
  },
});

/** Between steps: still allowed to go on? The member must still be in the company, and nobody pressed Stop. */
export const checkpoint = internalMutation({
  args: { runId: v.id("chatRuns") },
  handler: async (ctx, args) => {
    const run = await liveRun(ctx, args.runId);
    if (!run) return { go: false, why: "stopped" as const };
    if (run.stopRequestedAt) return { go: false, why: "stopped" as const };
    const conversation = await ctx.db.get(run.conversationId);
    if (!conversation || conversation.shelf === "deleted") return { go: false, why: "gone" as const };
    if (!(await currentMember(ctx, run.initiatedBy, run.companyId))) return { go: false, why: "membership" as const };
    await ctx.db.patch(run._id, { heartbeatAt: Date.now() });
    return { go: true, why: null };
  },
});

type HistoryEntry = {
  role: "user" | "assistant";
  text: string;
  page: string | undefined;
  records: { label: string; data: unknown }[];
  attachments: { storageId: Id<"_storage">; name: string; state: "pending" | "read" | "unreadable"; note: string | undefined; contentType: string }[];
  messageId: Id<"chatMessages">;
};
type Loaded = { system: string; tools: ToolSpec[]; history: HistoryEntry[]; currentMessageId: Id<"chatMessages"> };

/** Everything the model is given for this run, read fresh, for the member as they are now. */
export const load = internalQuery({
  args: { runId: v.id("chatRuns") },
  handler: async (ctx, args): Promise<Loaded | null> => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const company = await ctx.db.get(run.companyId);
    const now = await currentMember(ctx, run.initiatedBy, run.companyId);
    const userMessage = await ctx.db.get(run.userMessageId);
    if (!company || !now || !userMessage) return null;
    const knowledge = await ctx.db
      .query("companyKnowledge")
      .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "confirmed"))
      .order("desc")
      .take(60);
    const window = (
      await ctx.db
        .query("chatMessages")
        .withIndex("by_company_conversation_seq", (q) => q.eq("companyId", company._id).eq("conversationId", run.conversationId).lte("seq", userMessage.seq))
        .order("desc")
        .take(HISTORY_MESSAGES)
    ).reverse();
    while (window.length && window[0].role !== "user") window.shift();

    const access = { ...ctx, company, role: now.role };
    const history: HistoryEntry[] = [];
    for (const message of window) {
      if (message.role === "user") {
        // Attached records are described for the latest message only; earlier ones are named, not re-read.
        const latest = message._id === userMessage._id;
        const records = [];
        for (const ref of message.contextRefs ?? []) {
          if (ref.table === "chatArtifacts") continue;
          const described = latest ? await describeRecord(access, ref.table as RecordTable, ref.id) : null;
          records.push(described ? { label: described.label, data: described.data } : { label: ref.label, data: latest ? "No longer available." : "Attached earlier." });
        }
        history.push({ role: "user" as const, text: message.text ?? "", page: latest ? message.page : undefined, records, attachments: (message.attachments ?? []).map((file) => ({ storageId: file.storageId, name: file.name, state: file.state, note: file.note, contentType: file.contentType })), messageId: message._id });
      } else {
        const lines: string[] = [];
        for (const part of message.parts ?? []) {
          if (part.kind === "text") lines.push(part.text);
          else if (part.kind === "step") {
            const step = await ctx.db.get(part.stepId);
            if (step) lines.push(`[Action ${step.tool}: ${step.status}${step.summary ? `. ${step.summary}` : ""}]`);
          } else if (part.kind === "artifact") lines.push(`[Draft ${part.artifactId}, version ${part.version}]`);
          else if (part.kind === "choices") lines.push(`${part.question} (choices: ${part.options.join(" / ")})`);
          else lines.push(`[${part.text}]`);
        }
        const text = lines.join("\n").trim();
        if (text) history.push({ role: "assistant" as const, text, page: undefined, records: [], attachments: [], messageId: message._id });
      }
    }
    return {
      system: systemPrompt({ company, member: now.member, role: now.role, knowledge: knowledge.map((row) => row.text), now: Date.now() }),
      tools: toolSpecs(now.role),
      history,
      currentMessageId: userMessage._id,
    };
  },
});

/** Saves words as they arrive. Answers whether to stop. */
export const appendText = internalMutation({
  args: { runId: v.id("chatRuns"), text: v.string() },
  handler: async (ctx, args) => {
    const run = await liveRun(ctx, args.runId);
    if (!run) return { stop: true };
    const message = await ctx.db.get(run.assistantMessageId);
    if (message) {
      const parts = [...(message.parts ?? [])];
      const last = parts.at(-1);
      const written = parts.reduce((sum, part) => sum + (part.kind === "text" ? part.text.length : 0), 0);
      const room = Math.max(0, TEXT_LIMIT - written);
      const text = args.text.slice(0, room);
      if (text) {
        if (last?.kind === "text") parts[parts.length - 1] = { kind: "text", text: last.text + text };
        else parts.push({ kind: "text", text });
        await ctx.db.patch(message._id, { parts });
      }
    }
    await ctx.db.patch(run._id, { heartbeatAt: Date.now() });
    return { stop: Boolean(run.stopRequestedAt) };
  },
});

export const markAttachments = internalMutation({
  args: { messageId: v.id("chatMessages"), results: v.array(v.object({ storageId: v.id("_storage"), state: v.union(v.literal("read"), v.literal("unreadable")), note: v.optional(v.string()) })) },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message?.attachments) return null;
    await ctx.db.patch(message._id, {
      attachments: message.attachments.map((file) => {
        const result = args.results.find((row) => row.storageId === file.storageId);
        return result ? { ...file, state: result.state, note: result.note } : file;
      }),
    });
    return null;
  },
});

/** One tool call. Checked, recorded and carried out in its own transaction. */
export const runStep = internalMutation({
  args: { runId: v.id("chatRuns"), toolUseId: v.string(), name: v.string(), input: v.string() },
  handler: async (ctx, args) => {
    const run = await liveRun(ctx, args.runId);
    if (!run || run.stopRequestedAt) return { halt: true, content: "Not run: the person stopped this response.", isError: true, waiting: false };
    const company = await ctx.db.get(run.companyId);
    const now = await currentMember(ctx, run.initiatedBy, run.companyId);
    if (!company || !now) return { halt: true, content: "Not run: the person is no longer a member of this company.", isError: true, waiting: false };
    const conversation = await ctx.db.get(run.conversationId);
    if (!conversation || conversation.shelf === "deleted") return { halt: true, content: "Not run: the chat was deleted.", isError: true, waiting: false };
    await ctx.db.patch(run._id, { steps: run.steps + 1, heartbeatAt: Date.now() });
    let input: unknown = null;
    try {
      input = JSON.parse(args.input);
    } catch {
      return { halt: false, content: JSON.stringify({ status: "invalid_input", why: "The input was not readable JSON." }), isError: true, waiting: false };
    }
    const answer = await stepFromModel(ctx, { run, company, member: now.member, role: now.role, name: args.name, rawInput: input, toolUseId: args.toolUseId });
    return { halt: false, ...answer };
  },
});

export const addChoices = internalMutation({
  args: { runId: v.id("chatRuns"), question: v.string(), options: v.array(v.string()) },
  handler: async (ctx, args) => {
    const run = await liveRun(ctx, args.runId);
    if (!run) return null;
    const options = [...new Set(args.options.map((option) => option.trim().slice(0, 80)).filter(Boolean))].slice(0, 5);
    if (options.length < 2) return null;
    await addPart(ctx, run.assistantMessageId, { kind: "choices", question: args.question.trim().slice(0, 300), options });
    return null;
  },
});

export const addUsage = internalMutation({
  args: { runId: v.id("chatRuns"), inputTokens: v.number(), outputTokens: v.number(), model: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    await ctx.db.patch(run._id, { model: args.model, usage: { inputTokens: run.usage.inputTokens + args.inputTokens, outputTokens: run.usage.outputTokens + args.outputTokens }, heartbeatAt: Date.now() });
    const month = monthOf(run.startedAt);
    const row = await usageRow(ctx, run.companyId, month);
    if (row) await ctx.db.patch(row._id, { inputTokens: row.inputTokens + args.inputTokens, outputTokens: row.outputTokens + args.outputTokens });
    return null;
  },
});

/** What this run already did, in words, for a reply that was stopped or failed part-way. */
async function effectsSoFar(ctx: MutationCtx, run: Doc<"chatRuns">): Promise<string[]> {
  const steps = await ctx.db
    .query("chatActionSteps")
    .withIndex("by_company_run", (q) => q.eq("companyId", run.companyId).eq("runId", run._id))
    .take(100);
  return steps.filter((step) => step.status === "done" || step.status === "proposed").filter((step) => !["calculate", "price_service", "read_draft"].includes(step.tool) && !step.tool.startsWith("list_") && !step.tool.startsWith("inspect_") && !["company_profile", "attention_summary", "find_records", "get_record"].includes(step.tool)).map((step) => step.summary ?? step.tool);
}

async function close(ctx: MutationCtx, run: Doc<"chatRuns">, status: RunStatus, error?: string, notice?: string) {
  const now = Date.now();
  await ctx.db.patch(run._id, { status, error, endedAt: now, heartbeatAt: now });
  const message = await ctx.db.get(run.assistantMessageId);
  if (message) {
    if (notice) await addPart(ctx, message._id, { kind: "notice", tone: "info", text: notice });
    if (status === "stopped" || status === "failed") {
      const done = await effectsSoFar(ctx, run);
      const lead = status === "stopped" ? "Stopped." : (error ?? "This response failed.");
      const tail = done.length ? ` Already carried out before that, and not undone: ${done.join("; ")}.` : status === "stopped" ? " Nothing was carried out." : " Nothing was carried out.";
      await addPart(ctx, message._id, { kind: "notice", tone: status === "failed" ? "error" : "warning", text: `${lead}${tail}` });
    }
    await ctx.db.patch(message._id, { status: status === "failed" ? "failed" : status === "stopped" ? "stopped" : "complete" });
  }
  const waiting = await ctx.db
    .query("chatActionSteps")
    .withIndex("by_company_conversation_created", (q) => q.eq("companyId", run.companyId).eq("conversationId", run.conversationId))
    .order("desc")
    .take(200);
  const conversation = await ctx.db.get(run.conversationId);
  if (conversation && conversation.shelf !== "deleted") await setState(ctx, conversation._id, stateAfter(status, waiting.some((step) => step.status === "awaiting_approval")));
}

export const finish = internalMutation({
  args: { runId: v.id("chatRuns"), status: runStatusValidator, error: v.optional(v.string()), notice: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const run = await liveRun(ctx, args.runId);
    // Already closed, for example by the sweep: the first ending stands.
    if (!run) return null;
    await close(ctx, run, args.status, args.error, args.notice);
    return null;
  },
});

/** Runs whose worker stopped reporting are closed honestly, so nothing waits forever on a dead run. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_MS;
    for (const status of ["running", "queued"] as const) {
      const stale = await ctx.db
        .query("chatRuns")
        .withIndex("by_status_heartbeat", (q) => q.eq("status", status).lt("heartbeatAt", cutoff))
        .take(50);
      for (const run of stale) await close(ctx, run, "failed", "This response was interrupted before it finished. Retry to continue; actions already carried out will not be repeated.");
    }
    return null;
  },
});

/** Removes a deleted chat's messages and its files, a batch at a time. Its action receipts stay. */
export const purgeMessages = internalMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.shelf !== "deleted") return null;
    const batch = await ctx.db
      .query("chatMessages")
      .withIndex("by_company_conversation_seq", (q) => q.eq("companyId", conversation.companyId).eq("conversationId", conversation._id))
      .take(200);
    for (const message of batch) {
      for (const file of message.attachments ?? []) {
        const upload = await ctx.db
          .query("chatUploads")
          .withIndex("by_storage", (q) => q.eq("storageId", file.storageId))
          .unique();
        if (upload) await ctx.db.delete(upload._id);
        try {
          await ctx.storage.delete(file.storageId);
        } catch {
          // Already gone.
        }
      }
      await ctx.db.delete(message._id);
    }
    if (batch.length === 200) await ctx.scheduler.runAfter(0, internal.chatRuns.purgeMessages, { conversationId: conversation._id });
    return null;
  },
});

async function readAttachment(ctx: { storage: { get: (id: Id<"_storage">) => Promise<Blob | null> } }, storageId: Id<"_storage">): Promise<{ text: string | null; note?: string }> {
  const blob = await ctx.storage.get(storageId);
  if (!blob) return { text: null, note: "The file is no longer stored." };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await blob.arrayBuffer());
    if (!text.trim()) return { text: null, note: "The file is empty." };
    return text.length > ATTACHMENT_CHARS ? { text: `${text.slice(0, ATTACHMENT_CHARS)}\n[The rest of the file was not read: it is longer than ${ATTACHMENT_CHARS} characters.]`, note: "Only the first part was read." } : { text };
  } catch {
    return { text: null, note: "The file is not readable text." };
  }
}

export const execute = internalAction({
  args: { runId: v.id("chatRuns") },
  handler: async (ctx, args): Promise<null> => {
    const started: { startedAt: number; limits: Doc<"chatRuns">["limits"] } | null = await ctx.runMutation(internal.chatRuns.begin, { runId: args.runId });
    if (!started) return null;
    const finish = async (status: RunStatus, error?: string, notice?: string): Promise<null> => {
      await ctx.runMutation(internal.chatRuns.finish, { runId: args.runId, status, error, notice });
      return null;
    };

    const choice = chatModel();
    if (!choice.model) return finish("failed", choice.why);
    const model = choice.model;
    const loaded: Loaded | null = await ctx.runQuery(internal.chatRuns.load, { runId: args.runId });
    if (!loaded) return finish("failed", "This chat or your membership is no longer available, so nothing was answered.");

    // Attached files are read here, as data. A file that cannot be read is said so, visibly.
    const files = new Map<string, { text: string | null; note?: string }>();
    for (const message of loaded.history) {
      for (const file of message.attachments) {
        if (file.state === "unreadable") files.set(file.storageId, { text: null, note: file.note });
        else files.set(file.storageId, await readAttachment(ctx, file.storageId));
      }
    }
    const current = loaded.history.find((message) => message.messageId === loaded.currentMessageId);
    if (current?.attachments.some((file) => file.state === "pending")) {
      await ctx.runMutation(internal.chatRuns.markAttachments, {
        messageId: loaded.currentMessageId,
        results: current.attachments.filter((file) => file.state === "pending").map((file) => {
          const read = files.get(file.storageId)!;
          return { storageId: file.storageId, state: read.text === null ? ("unreadable" as const) : ("read" as const), note: read.note };
        }),
      });
    }

    const messages: ModelMessage[] = loaded.history.map((message) =>
      message.role === "user"
        ? { role: "user", content: userTurn({ text: message.text, page: message.page, records: message.records, attachments: message.attachments.map((file) => ({ name: file.name, text: files.get(file.storageId)?.text ?? null, note: files.get(file.storageId)?.note })) }) }
        : { role: "assistant", content: message.text },
    );
    const deadline = started.startedAt + started.limits.maxMs;
    let status: RunStatus = "completed";
    let error: string | undefined;
    let notice: string | undefined;

    try {
      for (let step = 0; ; step += 1) {
        const gate = await ctx.runMutation(internal.chatRuns.checkpoint, { runId: args.runId });
        if (!gate.go) {
          status = gate.why === "stopped" ? "stopped" : "failed";
          error = gate.why === "membership" ? "Your membership in this company changed, so the response stopped." : gate.why === "gone" ? "The chat was deleted." : undefined;
          break;
        }
        if (step >= started.limits.maxSteps) {
          notice = `I stopped after ${started.limits.maxSteps} steps so this answer does not run on. Ask me to continue if you want more.`;
          break;
        }
        if (Date.now() > deadline) {
          notice = "I stopped because this answer took too long. Ask me to continue if you want more.";
          break;
        }

        const controller = new AbortController();
        let buffer = "";
        let flushedAt = Date.now();
        let stopped = false;
        let chain: Promise<void> = Promise.resolve();
        const flush = async () => {
          if (!buffer) return;
          const text = buffer;
          buffer = "";
          const answer = await ctx.runMutation(internal.chatRuns.appendText, { runId: args.runId, text });
          if (answer.stop && !stopped) {
            stopped = true;
            controller.abort();
          }
        };
        const onText = (delta: string) => {
          buffer += delta;
          if (Date.now() - flushedAt >= 300) {
            flushedAt = Date.now();
            chain = chain.then(flush);
          }
        };

        let reply;
        try {
          reply = await model.respond({ system: loaded.system, messages, tools: loaded.tools, maxTokens: started.limits.maxOutputTokens, signal: controller.signal, onText });
        } catch (failure) {
          await chain;
          await flush();
          if (stopped) {
            status = "stopped";
            break;
          }
          throw failure;
        }
        await chain;
        await flush();
        await ctx.runMutation(internal.chatRuns.addUsage, { runId: args.runId, inputTokens: reply.usage.inputTokens, outputTokens: reply.usage.outputTokens, model: `${model.name}:${reply.model}` });
        if (stopped) {
          status = "stopped";
          break;
        }
        if (reply.stop === "refusal") {
          notice = "The model declined to answer this. Try rephrasing what you need.";
          break;
        }
        if (reply.stop === "max_tokens" && reply.toolCalls.length > 0) {
          status = "failed";
          error = "The answer was cut off before its next action could be read, so that action was not carried out.";
          break;
        }
        if (reply.toolCalls.length === 0) {
          if (reply.stop === "max_tokens") notice = "This answer reached its length limit and was cut off. Ask me to continue.";
          break;
        }

        messages.push({ role: "assistant", content: reply.content });
        const results: { id: string; content: string; isError: boolean }[] = [];
        let waiting = false;
        let followUp = false;
        let halted = false;
        for (const call of reply.toolCalls) {
          if (halted) {
            results.push({ id: call.id, content: "Not run: the response was stopped.", isError: true });
            continue;
          }
          if (call.name === "ask_followup") {
            const input = (call.input ?? {}) as { question?: unknown; options?: unknown };
            const options = Array.isArray(input.options) ? input.options.filter((option): option is string => typeof option === "string") : [];
            if (typeof input.question === "string" && options.length >= 2) {
              await ctx.runMutation(internal.chatRuns.addChoices, { runId: args.runId, question: input.question, options });
              followUp = true;
              results.push({ id: call.id, content: "Shown to the person. Stop and wait for their answer.", isError: false });
            } else results.push({ id: call.id, content: "A question and at least two options are needed.", isError: true });
            continue;
          }
          const answer = await ctx.runMutation(internal.chatRuns.runStep, { runId: args.runId, toolUseId: call.id, name: call.name, input: JSON.stringify(call.input ?? null) });
          if (answer.halt) halted = true;
          waiting ||= answer.waiting;
          results.push({ id: call.id, content: answer.content, isError: answer.isError });
        }
        messages.push(model.toolResults(results));
        if (halted) {
          status = "stopped";
          break;
        }
        if (followUp) {
          status = "needs_input";
          break;
        }
        if (waiting) {
          status = "awaiting_approval";
          break;
        }
      }
    } catch (failure) {
      status = "failed";
      error = failure instanceof ModelError ? failure.message : "Something went wrong while answering. Try again.";
    }
    await finish(status, error, notice);
    return null;
  },
});
