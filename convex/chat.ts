/**
 * Company Chat (docs/chat/00-architecture.md). Every function here is for a signed-in, active member of
 * the company, and every chat belongs to the member who started it: nobody else can list, read, search,
 * change or delete it. A chat in another company, or someone else's, is "Not found.".
 */
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { companyMutation, companyQuery, ownerMutation, type MemberAccess } from "./lib/builders";
import { mayRead } from "./lib/agreements/access";
import { verifiedPlan } from "./lib/billing/access";
import { openExecution } from "./lib/billing/executions";
import { DOC_TYPE_BY_KEY } from "./lib/agreements/catalog";
import { CHAT_MODELS, chatModelOption, MAKER_NAMES, chatModelState, DEFAULT_CHAT_MODEL, type ChatModelOption } from "./lib/ai/chatModels";
import { settingFor } from "./lib/ai/media";
import { readableArtifact } from "./lib/chat/artifacts";
import type { ContextRef } from "./lib/chat/schema";
import { isLive, lastSeq, latestRun, monthlyRunAllowance, monthOf, ownConversation, usageRow } from "./lib/chat/state";
import { decideStep as decide } from "./lib/chat/steps";
import { searchTextFor, titleFrom } from "./lib/chat/titles";
import { describeRecord, type RecordTable } from "./lib/chat/tools";
import { notFound, userError } from "./lib/errors";
import { recordEvent } from "./lib/events";
import { allow } from "./lib/rateLimit";
import { isOwner } from "./lib/roles";
import { text as requiredText } from "./lib/text";

type Ctx = (QueryCtx | MutationCtx) & MemberAccess;

const LIMITS = { maxSteps: 8, maxMs: 4 * 60 * 1000, maxOutputTokens: 16_000 };
const MESSAGE_MAX = 20_000;
const SENDS_PER_WINDOW = 20;
const SEND_WINDOW_MS = 10 * 60 * 1000;
const UPLOAD_MAX_BYTES = 512 * 1024;
const PDF_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { "image/png": "image/png", "image/jpeg": "image/jpeg", "image/jpg": "image/jpeg", "image/webp": "image/webp", "image/gif": "image/gif" };
const IMAGE_EXTENSIONS: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const TEXT_TYPES = ["text/plain", "text/markdown", "text/csv", "application/json", "text/x-markdown"];
const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|json)$/i;
const THREAD_MESSAGES = 300;

const contextInput = v.object({ table: v.string(), id: v.string() });
const shelfValidator = v.union(v.literal("active"), v.literal("archived"));

// ── Context ──────────────────────────────────────────────────────────────────────────────────────

const CONTEXT_TABLES: readonly ContextRef["table"][] = ["customers", "properties", "cleaners", "jobs", "tasks", "applications", "hiringNeeds", "chatArtifacts", "invoices"];

/** Records a person attached, checked against the company and their role. Labels come from the record, never the browser. */
async function checkedContext(ctx: Ctx, refs: { table: string; id: string }[]): Promise<ContextRef[]> {
  if (refs.length > 10) throw userError("Attach at most ten records to one message.");
  const out: ContextRef[] = [];
  for (const ref of refs) {
    if (!(CONTEXT_TABLES as readonly string[]).includes(ref.table)) notFound();
    if (ref.table === "chatArtifacts") {
      const artifact = await readableArtifact(ctx, ctx.companyId, ctx.member._id, ref.id);
      out.push({ table: "chatArtifacts", id: artifact._id, label: artifact.title });
      continue;
    }
    const described = await describeRecord({ ...ctx, company: ctx.company }, ref.table as RecordTable, ref.id);
    if (!described) notFound();
    out.push({ table: ref.table as ContextRef["table"], id: ref.id, label: described.label.charAt(0).toUpperCase() + described.label.slice(1) });
  }
  return out;
}

/** The labels for records a page offers as context, so the chips show what the record says. */
export const resolveContext = companyQuery({
  args: { refs: v.array(contextInput) },
  handler: async (ctx, args) => {
    const out: ContextRef[] = [];
    for (const ref of args.refs.slice(0, 10)) {
      try {
        out.push(...(await checkedContext(ctx, [ref])));
      } catch {
        // A record that is gone or not theirs is simply not offered.
      }
    }
    return out;
  },
});

// ── Sending ──────────────────────────────────────────────────────────────────────────────────────

async function checkAllowance(ctx: MutationCtx & MemberAccess) {
  const month = monthOf(Date.now());
  const row = await usageRow(ctx, ctx.companyId, month);
  const cap = monthlyRunAllowance();
  if (cap !== null && row && row.runs >= cap) throw userError(`Company Chat is limited to ${cap} answers a month for now. The limit resets at the start of next month.`, "limit");
  if (!(await allow(ctx, `chat.send:${ctx.member._id}`, SENDS_PER_WINDOW, SEND_WINDOW_MS))) throw userError("That is a lot of messages in a few minutes. Wait a moment and send again.", "limit");
  if (row) await ctx.db.patch(row._id, { runs: row.runs + 1 });
  else await ctx.db.insert("chatUsage", { companyId: ctx.companyId, month, runs: 1, inputTokens: 0, outputTokens: 0 });
}

async function staffOffModels(ctx: QueryCtx | MutationCtx): Promise<Set<string>> {
  return new Set((await ctx.db.query("chatModelSettings").take(100)).filter((row) => !row.enabled).map((row) => row.key));
}

/** The model a person chose, checked: only keys from the catalog, and only while it may be used here. */
async function checkedModel(ctx: Ctx, key: string): Promise<ChatModelOption> {
  const option = chatModelOption(key);
  if (!option) throw userError("That model is not offered in Selestial.");
  if (option.key === DEFAULT_CHAT_MODEL) return option;
  const state = chatModelState(option, ctx.company, await staffOffModels(ctx), await settingFor(ctx, "chat"));
  if (!state.available) throw userError(state.why);
  return option;
}

async function startRun(ctx: MutationCtx & MemberAccess, conversation: Doc<"conversations">, userMessageId: Id<"chatMessages">, retryOf?: Id<"chatRuns">) {
  const now = Date.now();
  // One answer is one billable unit, priced by the model's cost class. Refused here, nothing is saved.
  const option = chatModelOption(conversation.modelKey ?? DEFAULT_CHAT_MODEL) ?? chatModelOption(DEFAULT_CHAT_MODEL)!;
  const opened = await openExecution(ctx, {
    company: ctx.company,
    key: `chat:${userMessageId}:${retryOf ?? "first"}`,
    agent: "chat",
    task: option.cost === "Higher cost" ? "chat_response_advanced" : "chat_response_standard",
    units: 1,
    autonomous: false,
    memberId: ctx.member._id,
    source: { table: "chatMessages", id: userMessageId },
    origin: "chat",
    link: { label: "Chat conversation", path: `/app/chat/${conversation._id}` },
  });
  if (!opened.ok) throw userError(opened.message, "limit");
  const seq = (await lastSeq(ctx, conversation)) + 1;
  const assistantMessageId = await ctx.db.insert("chatMessages", { companyId: ctx.companyId, conversationId: conversation._id, seq, role: "assistant", status: "streaming", parts: [], createdAt: now });
  const runId = await ctx.db.insert("chatRuns", {
    companyId: ctx.companyId,
    conversationId: conversation._id,
    initiatedBy: ctx.member._id,
    userMessageId,
    assistantMessageId,
    status: "queued",
    modelKey: conversation.modelKey,
    steps: 0,
    limits: LIMITS,
    usage: { inputTokens: 0, outputTokens: 0 },
    heartbeatAt: now,
    retryOf,
    executionId: opened.executionId,
    startedAt: now,
  });
  await ctx.db.patch(assistantMessageId, { runId });
  await ctx.db.patch(conversation._id, { state: "working", updatedAt: now, messageCount: conversation.messageCount + 1 });
  await ctx.scheduler.runAfter(0, internal.chatRuns.execute, { runId });
  return runId;
}

async function checkedAttachments(ctx: MutationCtx & MemberAccess, files: { storageId: Id<"_storage">; name: string }[]) {
  if (files.length > 5) throw userError("Attach at most five files to one message.");
  const out = [];
  for (const file of files) {
    const upload = await ctx.db
      .query("chatUploads")
      .withIndex("by_storage", (q) => q.eq("storageId", file.storageId))
      .unique();
    if (!upload || upload.companyId !== ctx.companyId || upload.memberId !== ctx.member._id) notFound();
    const meta = await ctx.db.system.get(file.storageId);
    if (!meta) notFound();
    const name = requiredText(file.name, "The file name", 200);
    const type = (meta.contentType ?? "").split(";")[0].trim().toLowerCase();
    const pdf = type === "application/pdf" || /\.pdf$/i.test(name);
    const image = IMAGE_TYPES[type] ?? IMAGE_EXTENSIONS[name.split(".").pop()?.toLowerCase() ?? ""];
    if (!pdf && !image && !TEXT_TYPES.includes(type) && !TEXT_EXTENSIONS.test(name)) throw userError(`"${name}" cannot be read yet. Chat reads PDFs, images and text files (.pdf, .png, .jpg, .webp, .gif, .txt, .md, .csv, .json); paste the text of other documents instead.`);
    const limit = pdf ? PDF_MAX_BYTES : image ? IMAGE_MAX_BYTES : UPLOAD_MAX_BYTES;
    if (meta.size > limit) throw userError(`"${name}" is larger than ${pdf ? "10 MB" : image ? "5 MB" : "512 KB"}.`);
    out.push({ storageId: file.storageId, name, contentType: pdf ? "application/pdf" : image ? image : type || "text/plain", size: meta.size, state: "pending" as const });
  }
  return out;
}

/**
 * Saves the person's message, then schedules the answer. Sent twice with the same key (a double click,
 * a retry after a dropped connection), it is kept once and answered once.
 */
export const send = companyMutation({
  args: {
    conversationId: v.optional(v.string()),
    text: v.string(),
    clientKey: v.string(),
    page: v.optional(v.string()),
    context: v.optional(v.array(contextInput)),
    attachments: v.optional(v.array(v.object({ storageId: v.id("_storage"), name: v.string() }))),
    /** A key from lib/ai/chatModels.ts. Unset: keep this chat's model. */
    model: v.optional(v.string()),
    /** Where a new conversation started (Research & Insights). Kept for every reply; ignored for an existing one. */
    origin: v.optional(v.object({ kind: v.literal("research") })),
  },
  handler: async (ctx, args) => {
    const words = requiredText(args.text, "Your message", MESSAGE_MAX);
    const clientKey = requiredText(args.clientKey, "The message key", 100);
    let conversation = args.conversationId ? await ownConversation(ctx, ctx.companyId, ctx.member._id, args.conversationId) : null;

    // The same send arriving again finds the first.
    const candidates = conversation
      ? [conversation]
      : await ctx.db
          .query("conversations")
          .withIndex("by_company_creator_shelf_updated", (q) => q.eq("companyId", ctx.companyId).eq("createdBy", ctx.member._id).eq("shelf", "active"))
          .order("desc")
          .take(5);
    for (const candidate of candidates) {
      const earlier = await ctx.db
        .query("chatMessages")
        .withIndex("by_company_conversation_clientKey", (q) => q.eq("companyId", ctx.companyId).eq("conversationId", candidate._id).eq("clientKey", clientKey))
        .first();
      if (earlier) return { conversationId: candidate._id, repeated: true };
    }

    if (conversation && isLive(await latestRun(ctx, conversation))) throw userError("A response is still being written in this chat. Stop it or wait for it to finish.");
    const context = await checkedContext(ctx, args.context ?? []);
    const attachments = await checkedAttachments(ctx, args.attachments ?? []);
    const model = await checkedModel(ctx, args.model ?? conversation?.modelKey ?? DEFAULT_CHAT_MODEL);
    await checkAllowance(ctx);
    const modelKey = model.key === DEFAULT_CHAT_MODEL ? undefined : model.key;

    const now = Date.now();
    if (!conversation) {
      const title = titleFrom(words);
      const origin = args.origin?.kind === "research" ? { kind: "research" as const, question: words.slice(0, 500) } : undefined;
      const id = await ctx.db.insert("conversations", { companyId: ctx.companyId, createdBy: ctx.member._id, title, titleSource: "generated", visibility: "private", state: "idle", searchText: searchTextFor(title, [words]), shelf: "active", messageCount: 0, modelKey, ...(origin ? { origin } : {}), createdAt: now, updatedAt: now });
      conversation = (await ctx.db.get(id))!;
    } else {
      const asked = conversation.searchText.length < 3500 ? `${conversation.searchText} \n${words}`.slice(0, 4000) : conversation.searchText;
      await ctx.db.patch(conversation._id, { searchText: asked, shelf: "active", archivedAt: undefined, modelKey });
      conversation = (await ctx.db.get(conversation._id))!;
    }

    const page = args.page?.startsWith("/app") ? args.page.slice(0, 200) : undefined;
    const userMessageId = await ctx.db.insert("chatMessages", {
      companyId: ctx.companyId,
      conversationId: conversation._id,
      seq: (await lastSeq(ctx, conversation)) + 1,
      role: "user",
      status: "complete",
      text: words,
      contextRefs: context.length ? context : undefined,
      page,
      attachments: attachments.length ? attachments : undefined,
      clientKey,
      createdAt: now,
    });
    await ctx.db.patch(conversation._id, { messageCount: conversation.messageCount + 1 });
    await startRun(ctx, (await ctx.db.get(conversation._id))!, userMessageId);
    return { conversationId: conversation._id, repeated: false };
  },
});

/** Stop the response being written. What was already carried out stays done, and the reply says what. */
export const stop = companyMutation({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const conversation = await ownConversation(ctx, ctx.companyId, ctx.member._id, args.conversationId);
    const run = await latestRun(ctx, conversation);
    if (!run || !isLive(run)) return { stopped: false };
    if (!run.stopRequestedAt) await ctx.db.patch(run._id, { stopRequestedAt: Date.now() });
    return { stopped: true };
  },
});

/** Answer the last message again after a failure or a stop. Actions the earlier attempt carried out are not repeated. */
export const retry = companyMutation({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const conversation = await ownConversation(ctx, ctx.companyId, ctx.member._id, args.conversationId);
    const run = await latestRun(ctx, conversation);
    if (!run) throw userError("There is nothing to retry yet.");
    if (isLive(run)) throw userError("A response is still being written.");
    if (run.status !== "failed" && run.status !== "stopped") throw userError("The last response finished. Send a new message instead.");
    await checkedModel(ctx, conversation.modelKey ?? DEFAULT_CHAT_MODEL);
    await checkAllowance(ctx);
    await startRun(ctx, conversation, run.userMessageId, run._id);
    return null;
  },
});

/** The person approves or declines a step that waits on them. */
export const decideStep = companyMutation({
  args: { stepId: v.string(), approve: v.boolean() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("chatActionSteps", args.stepId);
    const step = id ? await ctx.db.get(id) : null;
    if (!step || step.companyId !== ctx.companyId || step.initiatedBy !== ctx.member._id) notFound();
    await ownConversation(ctx, ctx.companyId, ctx.member._id, step.conversationId);
    if (step.status !== "awaiting_approval") throw userError(step.status === "done" || step.status === "proposed" ? "This was already approved and carried out." : "This is no longer waiting for a decision.");
    const result = await decide(ctx, { step, company: ctx.company, member: ctx.member, role: ctx.role, approve: args.approve });
    return { status: result.status, summary: result.summary ?? null };
  },
});

// ── Sessions ─────────────────────────────────────────────────────────────────────────────────────

function sessionRow(conversation: Doc<"conversations">) {
  return { conversationId: conversation._id, title: conversation.title, state: conversation.state, pinned: conversation.pinnedAt !== undefined, shelf: conversation.shelf, updatedAt: conversation.updatedAt, createdAt: conversation.createdAt };
}

/** The member's own conversations that started in Services & Pricing › Research & Insights, newest first. */
export const researchChats = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_company_creator_shelf_updated", (q) => q.eq("companyId", ctx.companyId).eq("createdBy", ctx.member._id).eq("shelf", "active"))
      .order("desc")
      .take(100);
    return rows
      .filter((row) => row.origin?.kind === "research")
      .slice(0, 8)
      .map((row) => ({ id: row._id, title: row.title, updatedAt: row.updatedAt, state: row.state }));
  },
});

export const sessions = companyQuery({
  args: { shelf: shelfValidator, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("conversations")
      .withIndex("by_company_creator_shelf_updated", (q) => q.eq("companyId", ctx.companyId).eq("createdBy", ctx.member._id).eq("shelf", args.shelf))
      .order("desc")
      .paginate(args.paginationOpts);
    return { ...page, page: page.page.map(sessionRow) };
  },
});

export const recent = companyQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 8), 1), 20);
    const pinned = (
      await ctx.db
        .query("conversations")
        .withIndex("by_company_creator_pinned", (q) => q.eq("companyId", ctx.companyId).eq("createdBy", ctx.member._id).gt("pinnedAt", 0))
        .order("desc")
        .take(20)
    ).filter((row) => row.shelf === "active");
    const latest = await ctx.db
      .query("conversations")
      .withIndex("by_company_creator_shelf_updated", (q) => q.eq("companyId", ctx.companyId).eq("createdBy", ctx.member._id).eq("shelf", "active"))
      .order("desc")
      .take(limit + pinned.length);
    const pinnedIds = new Set(pinned.map((row) => row._id));
    return { pinned: pinned.map(sessionRow), recent: latest.filter((row) => !pinnedIds.has(row._id)).slice(0, limit).map(sessionRow) };
  },
});

export const search = companyQuery({
  args: { query: v.string(), shelf: shelfValidator, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const query = args.query.trim().slice(0, 200);
    if (!query) return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db
      .query("conversations")
      .withSearchIndex("search_text", (q) => q.search("searchText", query).eq("companyId", ctx.companyId).eq("createdBy", ctx.member._id).eq("shelf", args.shelf))
      .paginate(args.paginationOpts);
    return { ...page, page: page.page.map(sessionRow) };
  },
});

/** One chat with everything its page shows. Steps and drafts are read live, so a card says what is true now. */
export const thread = companyQuery({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const conversation = await ownConversation(ctx, ctx.companyId, ctx.member._id, args.conversationId);
    const messages = (
      await ctx.db
        .query("chatMessages")
        .withIndex("by_company_conversation_seq", (q) => q.eq("companyId", ctx.companyId).eq("conversationId", conversation._id))
        .order("desc")
        .take(THREAD_MESSAGES)
    ).reverse();
    const stepIds = new Set<Id<"chatActionSteps">>();
    const artifactIds = new Set<Id<"chatArtifacts">>();
    const agreementIds = new Set<Id<"agreements">>();
    for (const message of messages) for (const part of message.parts ?? []) {
      if (part.kind === "step") stepIds.add(part.stepId);
      if (part.kind === "artifact") artifactIds.add(part.artifactId);
      if (part.kind === "agreement") agreementIds.add(part.agreementId);
    }
    const steps: Record<string, unknown> = {};
    for (const stepId of stepIds) {
      const step = await ctx.db.get(stepId);
      if (step) steps[stepId] = { stepId, tool: step.tool, agent: step.agent ?? null, status: step.status, summary: step.summary ?? null, preview: step.preview ?? null, link: step.link ?? null, record: step.record ?? null, result: step.tool === "price_service" || step.tool === "calculate" ? (step.result ?? null) : null, mine: step.initiatedBy === ctx.member._id };
    }
    const artifacts: Record<string, unknown> = {};
    for (const artifactId of artifactIds) {
      const artifact = await ctx.db.get(artifactId);
      if (artifact && artifact.createdBy === ctx.member._id) artifacts[artifactId] = { artifactId, title: artifact.title, kind: artifact.kind, state: artifact.state, currentVersion: artifact.currentVersion };
    }
    // An agreement card is shown only to someone who may read that document today; to anyone else it is not there.
    const agreements: Record<string, unknown> = {};
    for (const agreementId of agreementIds) {
      const agreement = await ctx.db.get(agreementId);
      if (agreement && agreement.companyId === ctx.companyId && mayRead(ctx.role, agreement.access)) agreements[agreementId] = { agreementId, title: agreement.title, workflow: agreement.workflow, currentVersion: agreement.currentVersion, typeLabel: DOC_TYPE_BY_KEY.get(agreement.docType)?.label ?? agreement.docType };
    }
    const run = await latestRun(ctx, conversation);
    const answeredBy: Record<string, string> = {};
    for (const message of messages) {
      if (message.role !== "assistant" || !message.runId) continue;
      const answered = await ctx.db.get(message.runId);
      if (answered) answeredBy[message._id] = (chatModelOption(answered.modelKey) ?? chatModelOption(DEFAULT_CHAT_MODEL)!).label;
    }
    return {
      conversation: sessionRow(conversation),
      modelKey: conversation.modelKey ?? DEFAULT_CHAT_MODEL,
      run: run ? { status: run.status, stopping: Boolean(run.stopRequestedAt) && isLive(run), error: run.error ?? null, canRetry: run.status === "failed" || run.status === "stopped" } : null,
      messages: messages.map((message) => ({ messageId: message._id, role: message.role, status: message.status, answeredBy: answeredBy[message._id] ?? null, text: message.text ?? null, parts: message.parts ?? [], contextRefs: message.contextRefs ?? [], attachments: (message.attachments ?? []).map((file) => ({ name: file.name, size: file.size, state: file.state, note: file.note ?? null })), createdAt: message.createdAt })),
      steps,
      artifacts,
      agreements,
    };
  },
});

export const rename = companyMutation({
  args: { conversationId: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    const conversation = await ownConversation(ctx, ctx.companyId, ctx.member._id, args.conversationId);
    const title = requiredText(args.title, "The title", 120);
    const asked = conversation.searchText.split(" \n").slice(1);
    await ctx.db.patch(conversation._id, { title, titleSource: "person", searchText: searchTextFor(title, asked) });
    return null;
  },
});

export const setPinned = companyMutation({
  args: { conversationId: v.string(), pinned: v.boolean() },
  handler: async (ctx, args) => {
    const conversation = await ownConversation(ctx, ctx.companyId, ctx.member._id, args.conversationId);
    await ctx.db.patch(conversation._id, { pinnedAt: args.pinned ? Date.now() : undefined });
    return null;
  },
});

/** Archiving sets a chat aside. Work it is doing keeps going; Stop is separate. */
export const setArchived = companyMutation({
  args: { conversationId: v.string(), archived: v.boolean() },
  handler: async (ctx, args) => {
    const conversation = await ownConversation(ctx, ctx.companyId, ctx.member._id, args.conversationId);
    await ctx.db.patch(conversation._id, args.archived ? { shelf: "archived", archivedAt: Date.now(), pinnedAt: undefined } : { shelf: "active", archivedAt: undefined });
    return { stillWorking: isLive(await latestRun(ctx, conversation)) };
  },
});

/**
 * Deletes a chat's words for good. The receipts of what it did to the business stay (chatActionSteps),
 * and drafts it made stay with their own history. A chat still answering must be stopped first: deleting
 * never cancels work behind the person's back.
 */
export const remove = companyMutation({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const conversation = await ownConversation(ctx, ctx.companyId, ctx.member._id, args.conversationId);
    if (isLive(await latestRun(ctx, conversation))) throw userError("A response is still running in this chat. Stop it first; deleting does not cancel work on its own.");
    const waiting = await ctx.db
      .query("chatActionSteps")
      .withIndex("by_company_conversation_created", (q) => q.eq("companyId", ctx.companyId).eq("conversationId", conversation._id))
      .take(500);
    for (const step of waiting.filter((row) => row.status === "awaiting_approval")) await ctx.db.patch(step._id, { status: "cancelled", summary: "The chat was deleted before this was approved. Nothing was done.", completedAt: Date.now() });
    await ctx.db.patch(conversation._id, { shelf: "deleted", deletedAt: Date.now(), title: "Deleted chat", titleSource: "generated", searchText: "", pinnedAt: undefined, state: "idle" });
    await ctx.scheduler.runAfter(0, internal.chatRuns.purgeMessages, { conversationId: conversation._id });
    return null;
  },
});

// ── Files ────────────────────────────────────────────────────────────────────────────────────────

export const uploadUrl = companyMutation({
  args: {},
  handler: async (ctx) => {
    if (!(await allow(ctx, `chat.upload:${ctx.member._id}`, 30, SEND_WINDOW_MS))) throw userError("Too many uploads in a few minutes. Wait a moment.", "limit");
    return ctx.storage.generateUploadUrl();
  },
});

/** Claims an uploaded file for this member in this company. Only they can attach it. */
export const registerUpload = companyMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chatUploads")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (existing) {
      if (existing.memberId !== ctx.member._id || existing.companyId !== ctx.companyId) notFound();
      return null;
    }
    const meta = await ctx.db.system.get(args.storageId);
    if (!meta) notFound();
    if (meta.size > PDF_MAX_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw userError("The file is larger than 10 MB.");
    }
    await ctx.db.insert("chatUploads", { companyId: ctx.companyId, memberId: ctx.member._id, storageId: args.storageId, createdAt: Date.now() });
    return null;
  },
});

// ── Usage ────────────────────────────────────────────────────────────────────────────────────────

// ── Models ───────────────────────────────────────────────────────────────────────────────────────

/** The models this person may choose, and why any is not available. Never a key, a provider's raw ID or a price. */
export const models = companyQuery({
  args: {},
  handler: async (ctx) => {
    const off = await staffOffModels(ctx);
    const chat = await settingFor(ctx, "chat");
    return {
      defaultKey: DEFAULT_CHAT_MODEL,
      options: CHAT_MODELS.map((option) => {
        const state = chatModelState(option, ctx.company, off, chat);
        return { key: option.key, label: option.label, maker: option.maker, makerName: MAKER_NAMES[option.maker], cost: option.cost, bestFor: option.bestFor, available: state.available, why: state.available ? null : state.why };
      }),
    };
  },
});

/** Change the model for the rest of this chat. The next answer uses it; earlier answers are unchanged. */
export const setModel = companyMutation({
  args: { conversationId: v.string(), model: v.string() },
  handler: async (ctx, args) => {
    const conversation = await ownConversation(ctx, ctx.companyId, ctx.member._id, args.conversationId);
    const model = await checkedModel(ctx, args.model);
    await ctx.db.patch(conversation._id, { modelKey: model.key === DEFAULT_CHAT_MODEL ? undefined : model.key });
    return null;
  },
});

export const usage = companyQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const row = await usageRow(ctx, ctx.companyId, monthOf(now));
    const date = new Date(now);
    return { month: monthOf(now), plan: verifiedPlan(ctx.company), answers: row?.runs ?? 0, cap: monthlyRunAllowance(), tokens: row ? row.inputTokens + row.outputTokens : 0, resetsAt: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) };
  },
});

// ── Company knowledge ────────────────────────────────────────────────────────────────────────────

export const knowledge = companyQuery({
  args: {},
  handler: async (ctx) => {
    const confirmed = await ctx.db
      .query("companyKnowledge")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "confirmed"))
      .order("desc")
      .take(100);
    const proposed = (
      await ctx.db
        .query("companyKnowledge")
        .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "proposed"))
        .order("desc")
        .take(100)
    ).filter((row) => isOwner(ctx.role) || row.proposedBy === ctx.member._id);
    const row = (entry: Doc<"companyKnowledge">) => ({ knowledgeId: entry._id, text: entry.text, status: entry.status, mine: entry.proposedBy === ctx.member._id, createdAt: entry.createdAt });
    return { canDecide: isOwner(ctx.role), confirmed: confirmed.map(row), proposed: proposed.map(row) };
  },
});

/** Only the Owner turns a proposal into company knowledge, or takes knowledge back. */
export const decideKnowledge = ownerMutation({
  args: { knowledgeId: v.id("companyKnowledge"), status: v.union(v.literal("confirmed"), v.literal("rejected")), text: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.knowledgeId);
    if (!entry || entry.companyId !== ctx.companyId) notFound();
    await ctx.db.patch(entry._id, { status: args.status, text: args.text === undefined ? entry.text : requiredText(args.text, "The knowledge", 500), decidedBy: ctx.member._id, decidedAt: Date.now() });
    // The search index follows: confirmed knowledge becomes findable, anything else stops being.
    if (args.status === "confirmed") await ctx.scheduler.runAfter(0, internal.knowledge.index, { kind: "knowledge", id: entry._id });
    else await ctx.scheduler.runAfter(0, internal.knowledge.remove, { companyId: ctx.companyId, sourceKey: `knowledge:${entry._id}` });
    await recordEvent(ctx, { companyId: ctx.companyId, type: `company_knowledge.${args.status}`, actor: { kind: "member", memberId: ctx.member._id }, subject: { table: "companyKnowledge", id: entry._id } });
    return null;
  },
});
