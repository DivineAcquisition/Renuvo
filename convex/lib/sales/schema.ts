/**
 * The Sales record. Every table carries `companyId` and is read through an index that starts with it.
 *
 * Five things are kept apart on purpose, and none is inferred from another:
 *  - the opportunity: one request for service, with its own stage. A customer may have several;
 *  - the conversation: what was said, by whom, on which channel (salesMessages). An outbound entry points
 *    at its row in `messages`, the one outbox, where delivery is recorded;
 *  - the work Sales prepared or did (salesActions), each with its evidence, its permission and its result;
 *  - the quote: a customer-facing offer whose versions never change once saved (salesQuoteVersions);
 *  - the booking: reserved time (salesHolds), then a job made through the same path a person uses.
 *
 * A message sent is not a conversation, a quote sent is not a sale, and an accepted quote is not a
 * confirmed booking. Each has its own status list.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { channelValidator } from "../compliance/schema";
import { actorValidator } from "../events";
import { lineValidator, outcomeValidator } from "../services/schema";
import { literals } from "../statuses";

// ── Opportunities ───────────────────────────────────────────────────────────────────────────────────

/** The lifecycle of one request for service. Attention ("needs your review", "waiting for a reply") is worked out, never stored here. */
export const STAGES = ["new", "qualifying", "quote_ready", "quote_sent", "booking_pending", "won", "deferred", "closed_lost"] as const;
export type Stage = (typeof STAGES)[number];
export const stageValidator = literals(STAGES);
/** Still being worked. Deferred is parked with a date; won and closed lost are outcomes. */
export const OPEN_STAGES: readonly Stage[] = ["new", "qualifying", "quote_ready", "quote_sent", "booking_pending"];
export const BOARD_STAGES: readonly Stage[] = ["new", "qualifying", "quote_ready", "quote_sent", "booking_pending", "won"];

export const SOURCES = ["form", "sms", "email", "manual", "import", "google_lead"] as const;
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

export const nextActionValidator = v.object({ what: v.string(), by: literals(["sales", "owner", "customer"] as const), dueAt: v.number() });
export type NextAction = typeof nextActionValidator.type;

export const slotValidator = v.object({ startsAt: v.number(), endsAt: v.number() });

// ── Conversations and the work Sales does ───────────────────────────────────────────────────────────

export const ACTION_KINDS = ["reply", "question", "send_quote", "follow_up", "booking_steps", "booking_confirmation", "escalation"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export const actionKindValidator = literals(ACTION_KINDS);

/**
 * prepared: written, not yet routed (or held in the first review batch). awaiting_approval: in the
 * approvals queue. sent: handed to the outbox; delivery is on the message. done: finished with nothing
 * to send (an escalation a person closed). stale: the conversation moved on, so it was not sent.
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

// ── Quotes ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * draft: being prepared. awaiting_approval: needs a person before it can go. approved: may be sent.
 * sent: the customer has the link. accepted / declined: the customer's answer, for one exact version.
 * expired: the validity period passed. revoked: withdrawn by the company. A revised quote keeps its row:
 * the earlier sent version is superseded and its link says so.
 */
export const QUOTE_STATUSES = ["draft", "awaiting_approval", "approved", "sent", "accepted", "declined", "expired", "revoked"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const quoteStatusValidator = literals(QUOTE_STATUSES);

export const discountValidator = v.object({
  cents: v.number(),
  label: v.string(),
  /** Why, in the words of the rule or the person. */
  reason: v.string(),
  /** in_band: inside the Owner's allowed band and limits. approved: a person approved this exact amount. */
  source: literals(["in_band", "approved"] as const),
  approvedBy: v.optional(v.id("members")),
});

// ── Follow-ups ──────────────────────────────────────────────────────────────────────────────────────

export const FOLLOW_UP_PURPOSES = ["missing_info", "quote", "requested_date", "agreement", "deposit", "deferred"] as const;
export type FollowUpPurpose = (typeof FOLLOW_UP_PURPOSES)[number];
export const followUpPurposeValidator = literals(FOLLOW_UP_PURPOSES);
/** stopped: a stop condition was met (a reply, a decline, an opt-out, a booking, a person took over). */
export const FOLLOW_UP_STATUSES = ["scheduled", "sent", "proposed", "skipped", "cancelled", "stopped", "failed"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];
export const followUpStatusValidator = literals(FOLLOW_UP_STATUSES);

// ── Booking forms ───────────────────────────────────────────────────────────────────────────────────

export const FIELD_KINDS = ["text", "longtext", "number", "choice", "yes_no", "date", "email", "phone", "postal_code"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];
export const formFieldValidator = v.object({
  id: v.string(),
  label: v.string(),
  kind: literals(FIELD_KINDS),
  required: v.boolean(),
  options: v.array(v.string()),
  help: v.optional(v.string()),
  /** The fact this answer becomes, for example "bedrooms" or "postalCode". Absent: kept as a note. */
  factKey: v.optional(v.string()),
  /** Shown only when another field has this answer. */
  showIf: v.optional(v.object({ fieldId: v.string(), equals: v.string() })),
});
export type FormField = typeof formFieldValidator.type;

export const formDefinitionValidator = v.object({
  title: v.string(),
  intro: v.string(),
  /** estimate: the person is asking for a price. booking_request: they are asking for a time, which is still not a confirmed booking. */
  intent: literals(["estimate", "booking_request"] as const),
  kind: serviceKindValidator,
  /** Services offered on the form, by key. Empty: the person describes what they need. */
  serviceKeys: v.array(v.string()),
  fields: v.array(formFieldValidator),
  consent: v.object({
    /** Ask, in a separate unticked box, whether the company may text about this request. */
    sms: v.boolean(),
    /** The exact words beside the box. Kept with every permission it produces. */
    smsText: v.string(),
  }),
  accent: v.optional(v.string()),
  submitLabel: v.string(),
  confirmation: v.object({ title: v.string(), body: v.string() }),
});
export type FormDefinition = typeof formDefinitionValidator.type;

const answerValidator = v.union(v.string(), v.number(), v.boolean());

// ── The Playbook: how Sales works for this company (the Owner's, with defaults in settings.ts) ───────

export const TONES = ["warm", "direct", "formal"] as const;
export const depositRuleValidator = v.union(v.object({ kind: v.literal("none") }), v.object({ kind: v.literal("percent"), percent: v.number() }), v.object({ kind: v.literal("fixed"), cents: v.number() }));
export type DepositRule = typeof depositRuleValidator.type;

export const salesSettingsValidator = v.object({
  voice: v.optional(v.object({ tone: literals(TONES), signature: v.optional(v.string()) })),
  /** What Sales handles. A request outside it goes to a person. */
  eligibility: v.optional(v.object({ kinds: v.array(serviceKindValidator), textInquiries: v.boolean(), commercialNeedsWalkthrough: v.boolean() })),
  /** Answers the Owner approved for common questions and objections. Sales answers only from these and the service catalog. */
  answers: v.optional(v.array(v.object({ id: v.string(), topic: v.string(), question: v.string(), answer: v.string() }))),
  /** Hours after the last message before each reminder. The list's length is the most reminders sent. */
  followUp: v.optional(v.object({ missingInfoHours: v.array(v.number()), quoteHours: v.array(v.number()), bookingHours: v.array(v.number()) })),
  /** The most Sales may take off a quote without asking, as a percent of the cleaning amount. 0: never. */
  discounts: v.optional(v.object({ maxPercent: v.number(), reasons: v.array(v.string()) })),
  booking: v.optional(v.object({ agreementRequired: v.boolean(), deposit: depositRuleValidator, holdMinutes: v.number(), minimumNoticeHours: v.number() })),
  quotes: v.optional(v.object({ validDays: v.number(), paymentTerms: v.string(), cancellationTerms: v.string(), reviewAboveCents: v.union(v.number(), v.null()) })),
  /** Words that always send a conversation to a person. Damage, disputes and legal matters always do, whatever is listed. */
  escalation: v.optional(v.object({ keywords: v.array(v.string()) })),
  /** Set when the Owner decided the first review batch. Until then nothing Sales prepares is sent. */
  firstBatchDecidedAt: v.optional(v.number()),
  revision: v.optional(v.number()),
});
export type SalesSettingsInput = typeof salesSettingsValidator.type;

// ── Tables ──────────────────────────────────────────────────────────────────────────────────────────

export const salesTables = {
  /** One request for service. */
  salesOpportunities: defineTable({
    companyId: v.id("companies"),
    customerId: v.id("customers"),
    propertyId: v.optional(v.id("properties")),
    source: v.object({
      kind: sourceKindValidator,
      formId: v.optional(v.id("salesForms")),
      submissionId: v.optional(v.id("salesFormSubmissions")),
      /** The other system's id for this inquiry, kept so the same one is never filed twice. */
      externalId: v.optional(v.string()),
      campaign: v.optional(v.string()),
      medium: v.optional(v.string()),
      referrer: v.optional(v.string()),
    }),
    /** What the person first wrote or submitted, as it arrived. */
    inquiry: v.string(),
    receivedAt: v.number(),
    kind: serviceKindValidator,
    /** The service asked for, by its key in Services & Pricing. Absent until it is known. */
    serviceKey: v.optional(v.string()),
    /** When the customer wants the service, in their words, and as a time once one is chosen. */
    timing: v.optional(v.object({ text: v.optional(v.string()), slot: v.optional(slotValidator) })),
    facts: v.array(factValidator),
    /** Questions already put to the customer, so none is asked twice in a row. */
    asked: v.array(v.object({ key: v.string(), at: v.number(), times: v.number() })),
    stage: stageValidator,
    stageAt: v.number(),
    nextAction: v.optional(nextActionValidator),
    /** How the customer record was found. needs_review: someone similar exists and a person must say whether they are the same. */
    match: v.object({ state: literals(["created", "matched", "needs_review"] as const), candidates: v.optional(v.array(v.id("customers"))) }),
    /** The channel replies go out on: the one the person used or chose. */
    channel: channelValidator,
    /** Set while a person is handling the conversation. Sales sends nothing and schedules nothing until it is handed back. */
    takeover: v.optional(v.object({ by: v.id("members"), at: v.number() })),
    quoteId: v.optional(v.id("salesQuotes")),
    booking: v.optional(
      v.object({
        holdId: v.optional(v.id("salesHolds")),
        depositInvoiceId: v.optional(v.id("invoices")),
        /** A person confirmed the booking without verified capacity, and said why. Kept apart so it is never read as a check that passed. */
        override: v.optional(v.object({ by: v.id("members"), reason: v.string(), at: v.number() })),
      }),
    ),
    /** The job made from this opportunity. Set once, in the same step that makes the job. */
    jobId: v.optional(v.id("jobs")),
    outcome: v.optional(v.object({ kind: literals(["won", "lost", "deferred"] as const), reason: v.optional(lostReasonValidator), note: v.optional(v.string()), at: v.number(), by: actorValidator })),
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
    humanTouches: v.number(),
    /** Names this one inquiry, so an intake that runs twice files it once. */
    dedupeKey: v.string(),
    /** Counts material changes. Work prepared against an older revision is checked again before it goes. */
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_stage", ["companyId", "stage", "updatedAt"])
    .index("by_company_customer", ["companyId", "customerId"])
    .index("by_company_dedupe", ["companyId", "dedupeKey"])
    .index("by_company_created", ["companyId", "createdAt"])
    .index("by_stage_updated", ["stage", "updatedAt"]),

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

  /** One thing Sales prepared or did for one opportunity: what, why, on what evidence, under which permission, and what came of it. */
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
    quoteVersion: v.optional(v.number()),
    followUpId: v.optional(v.id("salesFollowUps")),
    /** What Sales wants to do, in a sentence. */
    summary: v.string(),
    /** Why, in words a person can check. */
    reason: v.string(),
    /** The facts it rests on. */
    evidence: v.array(v.object({ label: v.string(), detail: v.string() })),
    nextStep: v.optional(v.string()),
    /** The permission it goes out under, and the level when it was prepared. Both are read again before it is sent. */
    permission: v.string(),
    level: v.string(),
    /** What it was prepared against. A reply, a new quote version or a stage change since then makes it stale. */
    basis: v.object({ revision: v.number(), lastInboundAt: v.optional(v.number()), quoteVersion: v.optional(v.number()) }),
    approvalId: v.optional(v.id("approvals")),
    batchId: v.optional(v.id("salesBatches")),
    messageId: v.optional(v.id("messages")),
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

  /** One run of the Sales workflow for one opportunity, as the steps it actually took. */
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

  /** A customer-facing offer. Its versions are in salesQuoteVersions and never change. */
  salesQuotes: defineTable({
    companyId: v.id("companies"),
    opportunityId: v.id("salesOpportunities"),
    customerId: v.id("customers"),
    /** Counted per company, from 1001. */
    number: v.number(),
    status: quoteStatusValidator,
    currentVersion: v.number(),
    approvedVersion: v.optional(v.number()),
    approvedBy: v.optional(v.union(v.id("members"), v.literal("rules"))),
    sentVersion: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    /** When the sent version stops being open to accept. */
    validUntil: v.optional(v.number()),
    /** 128 random bits, given when the quote is first sent. With the deployment's secret it makes the customer's link. */
    publicId: v.optional(v.string()),
    acceptance: v.optional(v.object({ version: v.number(), name: v.string(), at: v.number() })),
    declined: v.optional(v.object({ version: v.number(), reason: v.optional(v.string()), at: v.number() })),
    revoked: v.optional(v.object({ reason: v.string(), by: v.id("members"), at: v.number() })),
    /** The customer's last question from the quote page, kept until Sales or a person answers it. */
    question: v.optional(v.object({ text: v.string(), at: v.number() })),
    approvalId: v.optional(v.id("approvals")),
    createdBy: actorValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_opportunity", ["companyId", "opportunityId", "createdAt"])
    .index("by_company_status", ["companyId", "status", "updatedAt"])
    .index("by_company_number", ["companyId", "number"])
    .index("by_publicId", ["publicId"])
    .index("by_status_valid", ["status", "validUntil"]),

  /** One saved version of a quote: the service version, the inputs and the price the engine gave, and the terms offered. Never edited. */
  salesQuoteVersions: defineTable({
    companyId: v.id("companies"),
    quoteId: v.id("salesQuotes"),
    version: v.number(),
    serviceId: v.id("services"),
    serviceKey: v.string(),
    serviceName: v.string(),
    serviceVersionId: v.id("serviceVersions"),
    serviceVersion: v.number(),
    /** The engine's own record of this price, with the inputs and the version it was given for. */
    pricingQuoteId: v.id("serviceQuotes"),
    input: v.string(),
    outcome: outcomeValidator,
    per: v.string(),
    lines: v.array(lineValidator),
    /** What the engine gave, before any discount Sales was allowed to add and before tax. */
    priceCents: v.number(),
    discount: v.optional(discountValidator),
    taxCents: v.number(),
    taxLabel: v.optional(v.string()),
    totalCents: v.number(),
    depositCents: v.optional(v.number()),
    included: v.array(v.string()),
    excluded: v.array(v.string()),
    extras: v.array(v.object({ label: v.string(), quantity: v.number(), amountCents: v.number(), included: v.boolean() })),
    frequency: v.optional(v.string()),
    timing: v.optional(v.string()),
    durationMinutes: v.number(),
    crewSize: v.number(),
    terms: v.object({ payment: v.string(), cancellation: v.string() }),
    validDays: v.number(),
    agreementRequired: v.boolean(),
    /** A note to the customer, written by a person. */
    note: v.optional(v.string()),
    /** A fingerprint of everything above. The customer accepts this, so a different version cannot be accepted by mistake. */
    hash: v.string(),
    createdBy: actorValidator,
    createdAt: v.number(),
  }).index("by_company_quote_version", ["companyId", "quoteId", "version"]),

  /** One planned reminder, with why it exists and what stops it. It is checked against the conversation again at the moment it is due. */
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
    basis: v.object({ lastInboundAt: v.optional(v.number()), quoteVersion: v.optional(v.number()) }),
    createdBy: actorValidator,
    createdAt: v.number(),
    doneAt: v.optional(v.number()),
  })
    .index("by_company_status_due", ["companyId", "status", "dueAt"])
    .index("by_status_due", ["status", "dueAt"])
    .index("by_company_opportunity", ["companyId", "opportunityId", "dueAt"])
    .index("by_company_key", ["companyId", "key"]),

  /** An intake form the company publishes. The published copy is what the public page shows; the draft is the Owner's working copy. */
  salesForms: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    status: literals(["draft", "published", "archived"] as const),
    /** 128 random bits in the public address. Given on first publish and kept, so a shared link keeps working. */
    publicId: v.optional(v.string()),
    draft: formDefinitionValidator,
    published: v.optional(formDefinitionValidator),
    publishedVersion: v.number(),
    publishedAt: v.optional(v.number()),
    revision: v.number(),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_status", ["companyId", "status", "updatedAt"])
    .index("by_publicId", ["publicId"]),

  /** What one person submitted on a form, as they submitted it, with the consent they gave and where they came from. */
  salesFormSubmissions: defineTable({
    companyId: v.id("companies"),
    formId: v.id("salesForms"),
    formVersion: v.number(),
    answers: v.record(v.string(), answerValidator),
    contact: v.object({ name: v.string(), email: v.optional(v.string()), phone: v.optional(v.string()) }),
    consent: v.object({ sms: v.boolean(), smsText: v.optional(v.string()), at: v.number() }),
    source: v.object({ campaign: v.optional(v.string()), medium: v.optional(v.string()), referrer: v.optional(v.string()) }),
    /** Chosen by the browser for one submission, so a double click or a retried request is kept once. */
    clientKey: v.string(),
    status: literals(["accepted", "duplicate"] as const),
    opportunityId: v.optional(v.id("salesOpportunities")),
    receivedAt: v.number(),
  })
    .index("by_company_form", ["companyId", "formId", "receivedAt"])
    .index("by_company_key", ["companyId", "clientKey"]),

  /**
   * Time reserved for an opportunity while its booking steps are finished. Reserved is not booked: a hold
   * expires on its own, and it becomes a job only in the step that checks capacity again.
   */
  salesHolds: defineTable({
    companyId: v.id("companies"),
    opportunityId: v.id("salesOpportunities"),
    startsAt: v.number(),
    endsAt: v.number(),
    crew: v.number(),
    postalCode: v.string(),
    status: literals(["held", "released", "converted", "expired"] as const),
    expiresAt: v.number(),
    jobId: v.optional(v.id("jobs")),
    createdAt: v.number(),
  })
    .index("by_company_start", ["companyId", "startsAt"])
    .index("by_company_opportunity", ["companyId", "opportunityId", "createdAt"])
    .index("by_status_expires", ["status", "expiresAt"]),

  /** The first review batch: everything Sales prepared before the Owner had seen any of its work. Deciding it grants nothing afterwards. */
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
