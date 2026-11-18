/**
 * The Sales agent's record, beside the workspace's (schema.ts). The agent works the same opportunities,
 * drafts, quotes and bookings people do; what it adds is kept apart on purpose:
 *  - the conversation: what was said, by whom, on which channel (salesMessages). An outbound entry points
 *    at its row in `messages`, the one outbox, where delivery is recorded;
 *  - the work the agent prepared or did (salesActions), each with its evidence, its permission and its result;
 *  - one row per run of the agent (salesRuns), as the steps it actually took;
 *  - customer reminders (salesFollowUps), each with a reason and the conditions that stop it;
 *  - the first review batch (salesBatches): nothing the agent prepares goes out before the Owner has seen it.
 *
 * The agent's own view of a deal's progress (`Stage` here) is worked out from the pipeline's stage and
 * milestone (agentOpportunity.ts), never stored twice. A message sent is not a conversation, a quote sent
 * is not a sale, and an accepted quote is not a confirmed booking.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { channelValidator } from "../compliance/schema";
import { actorValidator } from "../events";
import { literals } from "../statuses";

// ── The agent's view of an opportunity ─────────────────────────────────────────────────────────────

/** The lifecycle as the agent reasons about it. Derived from stage + milestone; never stored. */
export const AGENT_STAGES = ["new", "qualifying", "quote_ready", "quote_sent", "booking_pending", "won", "deferred", "closed_lost"] as const;
export type Stage = (typeof AGENT_STAGES)[number];
/** Still being worked. Deferred is parked with a date; won and closed lost are outcomes. */
export const OPEN_STAGES: readonly Stage[] = ["new", "qualifying", "quote_ready", "quote_sent", "booking_pending"];
export const agentStageValidator = literals(AGENT_STAGES);

export const SOURCES = ["form", "sms", "email", "manual", "import", "google_lead", "booking_page"] as const;
export type Source = (typeof SOURCES)[number];
export const sourceKindValidator = literals(SOURCES);

/** Which questions apply. It follows the service once one is chosen. */
export const SERVICE_KINDS = ["residential", "commercial", "short_term_rental"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];
export const serviceKindValidator = literals(SERVICE_KINDS);

export const LOST_REASONS = ["price", "timing", "no_response", "out_of_area", "unsupported_service", "chose_another", "duplicate", "spam", "opted_out", "other"] as const;
export type LostReason = (typeof LOST_REASONS)[number];
export const lostReasonValidator = literals(LOST_REASONS);

/**
 * One thing known about the request, with where it came from. confirmed: a person at the company, or the
 * customer on a form, stated it outright. stated: read from the customer's own words in a message.
 * unverified: carried over from an import or an older record, and not to be relied on for a price.
 */
export const FACT_STATUSES = ["confirmed", "stated", "unverified"] as const;
export const factStatusValidator = literals(FACT_STATUSES);
export const factSourceValidator = v.object({
  kind: literals(["customer", "form", "member", "record", "import"] as const),
  /** The message, submission or member it came from. */
  ref: v.optional(v.string()),
  /** The customer's own words, at most 200 characters, so the owner can check the reading. */
  excerpt: v.optional(v.string()),
});
export const factValidator = v.object({ key: v.string(), value: v.union(v.string(), v.number(), v.boolean()), source: factSourceValidator, status: factStatusValidator, at: v.number() });
export type Fact = typeof factValidator.type;

/** Who owes the next step: the agent, a person at the company, or the customer. */
export const NEXT_BY = ["sales", "owner", "customer"] as const;
export type NextBy = (typeof NEXT_BY)[number];
export type NextAction = { what: string; by: NextBy; dueAt: number };

export const slotValidator = v.object({ startsAt: v.number(), endsAt: v.number() });

/** The agent's fields on a pipeline opportunity. All optional: a deal a person started has none of them. */
export const agentOpportunityFields = {
  /** Where the inquiry came from, structured. `source` (free text) stays the words people read. */
  intake: v.optional(
    v.object({
      kind: sourceKindValidator,
      externalId: v.optional(v.string()),
      campaign: v.optional(v.string()),
      medium: v.optional(v.string()),
      referrer: v.optional(v.string()),
    }),
  ),
  /** What the person first wrote, as it arrived. */
  inquiry: v.optional(v.string()),
  receivedAt: v.optional(v.number()),
  kind: v.optional(serviceKindValidator),
  propertyId: v.optional(v.id("properties")),
  /** The service asked for, by its key in Services & Pricing. */
  serviceKey: v.optional(v.string()),
  /** When the customer wants the service, in their words, and as a time once one is chosen. */
  timing: v.optional(v.object({ text: v.optional(v.string()), slot: v.optional(slotValidator) })),
  facts: v.optional(v.array(factValidator)),
  /** Questions already put to the customer, so none is asked twice in a row. */
  asked: v.optional(v.array(v.object({ key: v.string(), at: v.number(), times: v.number() }))),
  /** How the customer record was found. needs_review: someone similar exists and a person must say whether they are the same. */
  match: v.optional(v.object({ state: literals(["created", "matched", "needs_review"] as const), candidates: v.optional(v.array(v.id("customers"))) })),
  /** The channel replies go out on: the one the person used or chose. */
  channel: v.optional(channelValidator),
  /** Who owes `nextAction`. Absent on a deal a person runs by hand. */
  nextBy: v.optional(literals(NEXT_BY)),
  /** The draft the agent prices and books through, the same workspace a person opens. */
  draftId: v.optional(v.id("salesDrafts")),
  quoteId: v.optional(v.id("salesQuotes")),
  bookingId: v.optional(v.id("bookings")),
  lostReason: v.optional(lostReasonValidator),
  deferredUntil: v.optional(v.number()),
  taskId: v.optional(v.id("tasks")),
  // Measured moments. Each is written once, when it first happens.
  firstResponseAt: v.optional(v.number()),
  qualifiedAt: v.optional(v.number()),
  quotedAt: v.optional(v.number()),
  acceptedAt: v.optional(v.number()),
  wonAt: v.optional(v.number()),
  closedAt: v.optional(v.number()),
  lastInboundAt: v.optional(v.number()),
  lastOutboundAt: v.optional(v.number()),
  /** How many times a person stepped in: an edit, a takeover, a manual send, a decision. */
  humanTouches: v.optional(v.number()),
  /** Names this one inquiry, so an intake that runs twice files it once. */
  dedupeKey: v.optional(v.string()),
  /** Names this conversation in its email reply address. Random, given when the agent first emails, never shown. */
  replyKey: v.optional(v.string()),
  /** Counts material changes. Work prepared against an older revision is checked again before it goes. */
  revision: v.optional(v.number()),
};

// ── Conversations and the work the agent does ──────────────────────────────────────────────────────

export const ACTION_KINDS = ["reply", "question", "send_quote", "follow_up", "booking_steps", "booking_request", "escalation"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export const actionKindValidator = literals(ACTION_KINDS);

/**
 * prepared: written, not yet routed (or held in the first review batch). awaiting_approval: in the
 * approvals queue, or with a person. sent: handed to the outbox (or the booking was requested). done:
 * finished with nothing to send. stale: the conversation moved on, so it was not sent.
 */
export const ACTION_STATUSES = ["prepared", "awaiting_approval", "sent", "done", "failed", "discarded", "stale"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export const actionStatusValidator = literals(ACTION_STATUSES);

export const RUN_STATUSES = ["queued", "running", "done", "failed", "skipped"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const TRIGGERS = ["inquiry", "reply", "quote_approved", "quote_accepted", "quote_declined", "follow_up_due", "booking_change", "resume", "manual"] as const;
export type Trigger = (typeof TRIGGERS)[number];
export const triggerValidator = literals(TRIGGERS);

export const runStepValidator = v.object({
  tool: v.string(),
  /** read: looked something up. done: changed the record. proposed: prepared for a person. refused: a rule stopped it. */
  outcome: literals(["read", "done", "proposed", "refused"] as const),
  /** What happened, in words for the owner. Never a prompt, an id or a model's reasoning. */
  summary: v.string(),
  at: v.number(),
});
export type RunStep = typeof runStepValidator.type;

/** What the reader took from the customer's latest message. Data, checked in code before anything uses it. */
export const readingValidator = v.object({
  intent: literals(["provide_info", "question", "accept", "decline", "defer", "opt_out", "complaint", "other"] as const),
  facts: v.array(v.object({ key: v.string(), value: v.union(v.string(), v.number(), v.boolean()), excerpt: v.string() })),
  /** What the customer asked, in their words. */
  questions: v.array(v.string()),
  /** A date the customer asked to be contacted or served on, YYYY-MM-DD, when they gave one. */
  date: v.optional(v.string()),
  reader: v.string(),
});
export type Reading = typeof readingValidator.type;

// ── Follow-ups ──────────────────────────────────────────────────────────────────────────────────────

export const FOLLOW_UP_PURPOSES = ["missing_info", "quote", "requested_date", "agreement", "deposit", "deferred"] as const;
export type FollowUpPurpose = (typeof FOLLOW_UP_PURPOSES)[number];
export const followUpPurposeValidator = literals(FOLLOW_UP_PURPOSES);
/** stopped: a stop condition was met (a reply, a decline, an opt-out, a booking, a person took over). */
export const FOLLOW_UP_STATUSES = ["scheduled", "sent", "proposed", "skipped", "cancelled", "stopped", "failed"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];
export const followUpStatusValidator = literals(FOLLOW_UP_STATUSES);

// ── The Playbook: how the agent works for this company (the Owner's, with defaults in settings.ts) ───

export const TONES = ["warm", "direct", "formal"] as const;
export const depositRuleValidator = v.union(v.object({ kind: v.literal("none") }), v.object({ kind: v.literal("percent"), percent: v.number() }), v.object({ kind: v.literal("fixed"), cents: v.number() }));
export type DepositRule = typeof depositRuleValidator.type;

export const salesSettingsValidator = v.object({
  voice: v.optional(v.object({ tone: literals(TONES), signature: v.optional(v.string()) })),
  /** What the agent handles. A request outside it goes to a person. */
  eligibility: v.optional(v.object({ kinds: v.array(serviceKindValidator), textInquiries: v.boolean(), commercialNeedsWalkthrough: v.boolean() })),
  /** Answers the Owner approved for common questions and objections. The agent answers only from these and the service catalog. */
  answers: v.optional(v.array(v.object({ id: v.string(), topic: v.string(), question: v.string(), answer: v.string() }))),
  /** Hours after the last message before each reminder. The list's length is the most reminders sent. */
  followUp: v.optional(v.object({ missingInfoHours: v.array(v.number()), quoteHours: v.array(v.number()), bookingHours: v.array(v.number()) })),
  /** The most the agent may take off a quote without asking, as a percent of the cleaning amount. 0: never. */
  discounts: v.optional(v.object({ maxPercent: v.number(), reasons: v.array(v.string()) })),
  booking: v.optional(v.object({ agreementRequired: v.boolean(), deposit: depositRuleValidator, holdMinutes: v.number(), minimumNoticeHours: v.number() })),
  quotes: v.optional(v.object({ validDays: v.number(), paymentTerms: v.string(), cancellationTerms: v.string(), reviewAboveCents: v.union(v.number(), v.null()) })),
  /** Words that always send a conversation to a person. Damage, disputes and legal matters always do, whatever is listed. */
  escalation: v.optional(v.object({ keywords: v.array(v.string()) })),
  /** Set when the Owner decided the first review batch. Until then nothing the agent prepares is sent. */
  firstBatchDecidedAt: v.optional(v.number()),
  revision: v.optional(v.number()),
});
export type SalesSettingsInput = typeof salesSettingsValidator.type;

// ── Tables ──────────────────────────────────────────────────────────────────────────────────────────

export const agentTables = {
  /**
   * The conversation, both ways, oldest first. An inbound message keeps the person's words (they are the
   * request itself); an outbound one keeps what was written and points at the outbox row that says
   * whether it went. Notes are a person's own, never sent.
   */
  salesMessages: defineTable({
    companyId: v.id("companies"),
    opportunityId: v.id("salesOpportunities"),
    customerId: v.id("customers"),
    direction: literals(["in", "out", "note"] as const),
    channel: literals(["sms", "email", "form", "internal"] as const),
    author: v.union(v.object({ kind: v.literal("customer") }), v.object({ kind: v.literal("agent") }), v.object({ kind: v.literal("member"), memberId: v.id("members") }), v.object({ kind: v.literal("system") })),
    subject: v.optional(v.string()),
    body: v.string(),
    messageId: v.optional(v.id("messages")),
    actionId: v.optional(v.id("salesActions")),
    /** The provider's id for an inbound message, so the same delivery is kept once. */
    providerId: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_company_opportunity", ["companyId", "opportunityId", "at"])
    .index("by_company_provider", ["companyId", "providerId"])
    .index("by_company_message", ["companyId", "messageId"]),

  /** One thing the agent prepared or did for one opportunity: what, why, on what evidence, under which permission, and what came of it. */
  salesActions: defineTable({
    companyId: v.id("companies"),
    opportunityId: v.id("salesOpportunities"),
    customerId: v.id("customers"),
    kind: actionKindValidator,
    status: actionStatusValidator,
    channel: v.optional(channelValidator),
    subject: v.optional(v.string()),
    /** The message, with "{link}" where the quote link goes. */
    body: v.optional(v.string()),
    quoteId: v.optional(v.id("salesQuotes")),
    followUpId: v.optional(v.id("salesFollowUps")),
    /** What the agent wants to do, in a sentence. */
    summary: v.string(),
    /** Why, in words a person can check. */
    reason: v.string(),
    /** The facts it rests on. */
    evidence: v.array(v.object({ label: v.string(), detail: v.string() })),
    nextStep: v.optional(v.string()),
    /** The permission it goes out under, and the level when it was prepared. Both are read again before it is sent. */
    permission: v.string(),
    level: v.string(),
    /** What it was prepared against. A reply, a new quote or a stage change since then makes it stale. */
    basis: v.object({ revision: v.number(), lastInboundAt: v.optional(v.number()), quoteId: v.optional(v.id("salesQuotes")) }),
    approvalId: v.optional(v.id("approvals")),
    batchId: v.optional(v.id("salesBatches")),
    messageId: v.optional(v.id("messages")),
    bookingId: v.optional(v.id("bookings")),
    runId: v.optional(v.id("salesRuns")),
    /** Who wrote the words: "rules" for the company's templates, or the AI reader's name. */
    writtenBy: v.string(),
    editedBy: v.optional(v.id("members")),
    decidedBy: v.optional(v.id("members")),
    decidedAt: v.optional(v.number()),
    /** What happened, or why it did not, in plain words. */
    result: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_status", ["companyId", "status", "createdAt"])
    .index("by_company_opportunity", ["companyId", "opportunityId", "createdAt"])
    .index("by_company_batch", ["companyId", "batchId"])
    .index("by_company_created", ["companyId", "createdAt"]),

  /** One run of the agent for one opportunity, as the steps it actually took. */
  salesRuns: defineTable({
    companyId: v.id("companies"),
    opportunityId: v.id("salesOpportunities"),
    trigger: triggerValidator,
    /** Names this one piece of work, so the same event never starts it twice. */
    key: v.string(),
    status: literals(RUN_STATUSES),
    /** "rules", or the AI reader that was used. */
    reader: v.optional(v.string()),
    executionId: v.optional(v.id("aiExecutions")),
    steps: v.array(runStepValidator),
    /** How it ended, in words for the owner. */
    result: v.optional(v.string()),
    attempt: v.number(),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  })
    .index("by_company_key", ["companyId", "key"])
    .index("by_company_opportunity", ["companyId", "opportunityId", "createdAt"])
    .index("by_company_status", ["companyId", "status", "createdAt"])
    .index("by_status_started", ["status", "startedAt"]),

  /** One planned reminder to a customer, with why it exists and what stops it. Checked against the conversation again when it is due. */
  salesFollowUps: defineTable({
    companyId: v.id("companies"),
    opportunityId: v.id("salesOpportunities"),
    customerId: v.id("customers"),
    purpose: followUpPurposeValidator,
    attempt: v.number(),
    maxAttempts: v.number(),
    dueAt: v.number(),
    status: followUpStatusValidator,
    /** Why this reminder exists, in a sentence. */
    reason: v.string(),
    /** What it will say, as it stands now. Written again when it is due. */
    preview: v.string(),
    stopReason: v.optional(v.string()),
    actionId: v.optional(v.id("salesActions")),
    /** Names this one reminder, so scheduling twice plans it once. */
    key: v.string(),
    /** What it was planned against. Any reply since then stops it. */
    basis: v.object({ lastInboundAt: v.optional(v.number()), quoteId: v.optional(v.id("salesQuotes")) }),
    createdBy: actorValidator,
    createdAt: v.number(),
    doneAt: v.optional(v.number()),
  })
    .index("by_company_status_due", ["companyId", "status", "dueAt"])
    .index("by_status_due", ["status", "dueAt"])
    .index("by_company_opportunity", ["companyId", "opportunityId", "dueAt"])
    .index("by_company_key", ["companyId", "key"]),

  /** The first review batch: everything the agent prepared before the Owner had seen any of its work. Deciding it grants nothing afterwards. */
  salesBatches: defineTable({
    companyId: v.id("companies"),
    status: literals(["open", "decided"] as const),
    /** The task that tells the Owner the batch is waiting. Nothing is sent from the approvals queue: the batch is decided item by item. */
    taskId: v.optional(v.id("tasks")),
    createdAt: v.number(),
    decidedBy: v.optional(v.id("members")),
    decidedAt: v.optional(v.number()),
    sent: v.optional(v.number()),
    skipped: v.optional(v.number()),
  }).index("by_company_status", ["companyId", "status", "createdAt"]),
};
