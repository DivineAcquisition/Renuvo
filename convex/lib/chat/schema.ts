/**
 * Company Chat's record (docs/chat/00-architecture.md). Three layers stay separate:
 *  1. the conversation itself (conversations, chatMessages, chatRuns);
 *  2. confirmed company knowledge (companyKnowledge), which a chat can only propose;
 *  3. the live operational records, which chat reads and changes only through its tools.
 *
 * Every table carries `companyId` and is read through an index that starts with it. A conversation
 * belongs to the member who started it: there is no sharing yet, so nobody else can read it.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { literals } from "../statuses";

// ── Lists ────────────────────────────────────────────────────────────────────────────────────────

/** What a person sees beside a chat. "idle" is a chat with nothing asked yet. */
export const CONVERSATION_STATES = ["idle", "working", "needs_input", "awaiting_approval", "completed", "failed", "stopped"] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];
export const conversationStateValidator = literals(CONVERSATION_STATES);

export const RUN_STATUSES = ["queued", "running", "awaiting_approval", "needs_input", "completed", "failed", "stopped"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const runStatusValidator = literals(RUN_STATUSES);
/** A run in one of these is still doing something, or may still be resumed by a person. */
export const LIVE_RUN: readonly RunStatus[] = ["queued", "running"];

export const MESSAGE_STATUSES = ["streaming", "complete", "failed", "stopped"] as const;
export const messageStatusValidator = literals(MESSAGE_STATUSES);

/**
 * One use of one tool from chat. "awaiting_approval" waits for the person's click on the exact preview;
 * "expired" means what it would change has changed since, so the approval no longer applies.
 */
export const STEP_STATUSES = ["running", "done", "proposed", "refused", "unavailable", "awaiting_approval", "rejected", "expired", "failed", "cancelled"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
export const stepStatusValidator = literals(STEP_STATUSES);

export const ARTIFACT_KINDS = ["agreement", "proposal", "pricing", "sop", "checklist", "onboarding", "role", "message", "campaign", "plan", "report", "other"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export const artifactKindValidator = literals(ARTIFACT_KINDS);

/**
 * A draft is only a draft. Approving its terms, sending it and recording a signature are separate,
 * each recorded by a person, and none of them is implied by the document existing.
 */
export const ARTIFACT_STATES = ["draft", "terms_approved", "sent", "signed"] as const;
export type ArtifactState = (typeof ARTIFACT_STATES)[number];
export const artifactStateValidator = literals(ARTIFACT_STATES);

export const KNOWLEDGE_STATUSES = ["proposed", "confirmed", "rejected"] as const;
export const knowledgeStatusValidator = literals(KNOWLEDGE_STATUSES);

// ── Shapes ───────────────────────────────────────────────────────────────────────────────────────

/** A business record a person attached to a message. Checked against the company and their role when sent. */
export const contextRefValidator = v.object({
  table: v.union(v.literal("customers"), v.literal("properties"), v.literal("cleaners"), v.literal("jobs"), v.literal("tasks"), v.literal("applications"), v.literal("hiringNeeds"), v.literal("chatArtifacts"), v.literal("invoices")),
  id: v.string(),
  label: v.string(),
});
export type ContextRef = typeof contextRefValidator.type;

export const attachmentValidator = v.object({
  storageId: v.id("_storage"),
  name: v.string(),
  contentType: v.string(),
  size: v.number(),
  /** "read": its text reached the model, as data. "unreadable": it did not, and the person was told why. */
  state: v.union(v.literal("pending"), v.literal("read"), v.literal("unreadable")),
  note: v.optional(v.string()),
});
export type Attachment = typeof attachmentValidator.type;

/** The parts of an assistant reply, in the order they happened. Text is the model's; everything else is the record's. */
export const partValidator = v.union(
  v.object({ kind: v.literal("text"), text: v.string() }),
  v.object({ kind: v.literal("step"), stepId: v.id("chatActionSteps") }),
  v.object({ kind: v.literal("artifact"), artifactId: v.id("chatArtifacts"), version: v.number() }),
  /** An agreement in the Agreements workspace. Chat and Agreements show the same record. */
  v.object({ kind: v.literal("agreement"), agreementId: v.id("agreements"), version: v.number() }),
  v.object({ kind: v.literal("choices"), question: v.string(), options: v.array(v.string()) }),
  v.object({ kind: v.literal("notice"), tone: v.union(v.literal("info"), v.literal("warning"), v.literal("error")), text: v.string() }),
);
export type Part = typeof partValidator.type;

/** Where a result lives in the app, so a person can open the actual record. */
export const linkValidator = v.object({ href: v.string(), label: v.string() });
export type Link = typeof linkValidator.type;

/** A record the app's detail panel opens (convex/details.ts). */
export const recordRefValidator = v.union(v.object({ kind: v.literal("job"), id: v.id("jobs") }), v.object({ kind: v.literal("approval"), id: v.id("approvals") }), v.object({ kind: v.literal("task"), id: v.id("tasks") }));
export type RecordRef = typeof recordRefValidator.type;

// ── Tables ───────────────────────────────────────────────────────────────────────────────────────

export const chatTables = {
  conversations: defineTable({
    companyId: v.id("companies"),
    /** The member who started it. Only they can read it until sharing exists. */
    createdBy: v.id("members"),
    title: v.string(),
    /** "generated" titles are replaced by a person's own; a person's title is never overwritten. */
    titleSource: v.union(v.literal("generated"), v.literal("person")),
    visibility: v.literal("private"),
    state: conversationStateValidator,
    /** Set while pinned, so pinned chats sort by when they were pinned. */
    pinnedAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
    /** Deleted chats keep this row, with the title cleared, so the action audit still has something to point at. */
    deletedAt: v.optional(v.number()),
    /** Title plus the start of what the person asked, for search. Never the model's words. */
    searchText: v.string(),
    /** "active", "archived" or "deleted", so search and lists filter by one field. */
    shelf: v.union(v.literal("active"), v.literal("archived"), v.literal("deleted")),
    messageCount: v.number(),
    /** The model the person chose for this chat (lib/ai/chatModels.ts). Unset: the default. */
    /** Where the conversation started, kept for every reply so it is never lost (lib/chat/business.ts). */
    origin: v.optional(v.union(v.object({ kind: v.literal("research"), question: v.string() }), v.object({ kind: v.literal("sales_draft"), draftId: v.id("salesDrafts") }))),
    modelKey: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_creator_shelf_updated", ["companyId", "createdBy", "shelf", "updatedAt"])
    .index("by_company_creator_pinned", ["companyId", "createdBy", "pinnedAt"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["companyId", "createdBy", "shelf"] }),

  chatMessages: defineTable({
    companyId: v.id("companies"),
    conversationId: v.id("conversations"),
    /** Order within the conversation. */
    seq: v.number(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    status: messageStatusValidator,
    /** A person's words, or the assistant's reply as parts. */
    text: v.optional(v.string()),
    parts: v.optional(v.array(partValidator)),
    contextRefs: v.optional(v.array(contextRefValidator)),
    /** The page the person was on, as a path. Shown to the model as a hint, never as an instruction. */
    page: v.optional(v.string()),
    attachments: v.optional(v.array(attachmentValidator)),
    /** Chosen by the browser for one send, so a send that is sent twice is kept once. */
    clientKey: v.optional(v.string()),
    runId: v.optional(v.id("chatRuns")),
    createdAt: v.number(),
  })
    .index("by_company_conversation_seq", ["companyId", "conversationId", "seq"])
    .index("by_company_conversation_clientKey", ["companyId", "conversationId", "clientKey"]),

  chatRuns: defineTable({
    companyId: v.id("companies"),
    conversationId: v.id("conversations"),
    initiatedBy: v.id("members"),
    userMessageId: v.id("chatMessages"),
    assistantMessageId: v.id("chatMessages"),
    status: runStatusValidator,
    /** The adapter and model that answered, for example "claude:claude-opus-5-5". */
    model: v.optional(v.string()),
    /** The chat model the person had chosen when this run started. */
    modelKey: v.optional(v.string()),
    steps: v.number(),
    limits: v.object({ maxSteps: v.number(), maxMs: v.number(), maxOutputTokens: v.number() }),
    usage: v.object({ inputTokens: v.number(), outputTokens: v.number() }),
    /** Set by Stop. The run stops before its next step; what already happened is reported, not undone. */
    stopRequestedAt: v.optional(v.number()),
    /** Updated as the run works, so a run whose worker died is found and closed honestly. */
    heartbeatAt: v.number(),
    /** Words for a person. Never a provider's raw response. */
    error: v.optional(v.string()),
    /** The run this one retries. Tool calls it already carried out are not carried out again. */
    retryOf: v.optional(v.id("chatRuns")),
    /** The credits held for this answer (convex/lib/billing). */
    executionId: v.optional(v.id("aiExecutions")),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index("by_company_conversation_started", ["companyId", "conversationId", "startedAt"])
    .index("by_status_heartbeat", ["status", "heartbeatAt"])
    .index("by_company_started", ["companyId", "startedAt"]),

  /** Kept when a chat is deleted: this is the audit of what chat did to the business. */
  chatActionSteps: defineTable({
    companyId: v.id("companies"),
    conversationId: v.id("conversations"),
    runId: v.id("chatRuns"),
    initiatedBy: v.id("members"),
    tool: v.string(),
    /** The specialist whose workflow ran, when one did. */
    agent: v.optional(v.string()),
    /** The validated arguments, as JSON. */
    args: v.string(),
    status: stepStatusValidator,
    /** Names this one action, so a retried run or a reconnect never carries it out twice. */
    idempotencyKey: v.string(),
    /** What a person approves: the exact effect in words, and a hash of what it is bound to. */
    preview: v.optional(v.object({ summary: v.string(), lines: v.array(v.string()), bindsTo: v.string() })),
    decidedAt: v.optional(v.number()),
    /** What came out, as JSON for the model and words for the person. */
    result: v.optional(v.string()),
    summary: v.optional(v.string()),
    link: v.optional(linkValidator),
    /** A record the detail panel can open. */
    record: v.optional(recordRefValidator),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_company_key", ["companyId", "idempotencyKey"])
    .index("by_company_conversation_created", ["companyId", "conversationId", "createdAt"])
    .index("by_company_run", ["companyId", "runId"]),

  chatArtifacts: defineTable({
    companyId: v.id("companies"),
    createdBy: v.id("members"),
    /** The chat it came from. It stays after the chat is deleted; the link then says so. */
    conversationId: v.optional(v.id("conversations")),
    title: v.string(),
    kind: artifactKindValidator,
    currentVersion: v.number(),
    state: artifactStateValidator,
    /** The version whose terms a person approved. A later version is a draft again. */
    approvedVersion: v.optional(v.number()),
    /** Manual records of what happened outside Selestial: no signing service is connected. */
    stateNote: v.optional(v.string()),
    stateBy: v.optional(v.id("members")),
    stateAt: v.optional(v.number()),
    linked: v.optional(v.array(contextRefValidator)),
    updatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_company_creator_updated", ["companyId", "createdBy", "updatedAt"])
    .index("by_company_conversation", ["companyId", "conversationId"]),

  chatArtifactVersions: defineTable({
    companyId: v.id("companies"),
    artifactId: v.id("chatArtifacts"),
    version: v.number(),
    /** Markdown. */
    content: v.string(),
    author: v.union(v.object({ kind: v.literal("assistant"), runId: v.id("chatRuns") }), v.object({ kind: v.literal("member"), memberId: v.id("members") })),
    note: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_company_artifact_version", ["companyId", "artifactId", "version"]),

  /**
   * What the company has confirmed about itself. A chat may propose an entry; only the Owner confirms
   * one. A confirmed entry is knowledge for answers, not an operating rule: rules change through their
   * own functions.
   */
  companyKnowledge: defineTable({
    companyId: v.id("companies"),
    text: v.string(),
    status: knowledgeStatusValidator,
    proposedBy: v.id("members"),
    fromConversationId: v.optional(v.id("conversations")),
    decidedBy: v.optional(v.id("members")),
    decidedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_company_status", ["companyId", "status", "createdAt"]),

  /** A file a member uploaded for chat. Only the member who registered it can attach it, and only in this company. */
  chatUploads: defineTable({
    companyId: v.id("companies"),
    memberId: v.id("members"),
    storageId: v.id("_storage"),
    createdAt: v.number(),
  })
    .index("by_storage", ["storageId"])
    .index("by_company_member", ["companyId", "memberId", "createdAt"]),

  /** Model use per company per calendar month (UTC), counted as runs and tokens. */
  chatUsage: defineTable({
    companyId: v.id("companies"),
    month: v.string(),
    runs: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
  }).index("by_company_month", ["companyId", "month"]),
};
