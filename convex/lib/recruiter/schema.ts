/**
 * Recruiter's record. A person (applicant), their application to one role, and the messages that told us
 * about it are three separate things. Delivery of a message is never the application's stage, and
 * nothing here says a document was verified or a background check was passed: those are things a person
 * records on the onboarding handoff.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { literals } from "../statuses";

// ── Lists ────────────────────────────────────────────────────────────────────────────────────────

export const STAGES = [
  "received",
  "contact_needed",
  "invitation_awaiting_approval",
  "invited",
  "application_started",
  "application_submitted",
  "screening",
  "interview",
  "decision_pending",
  "offer_sent",
  "accepted",
  "onboarding_handoff",
  "withdrawn",
  "closed",
] as const;
export type Stage = (typeof STAGES)[number];
export const stageValidator = literals(STAGES);

export const STAGE_CHANGES: Record<Stage, readonly Stage[]> = {
  received: ["contact_needed", "invitation_awaiting_approval", "invited", "withdrawn", "closed"],
  contact_needed: ["received", "invitation_awaiting_approval", "invited", "withdrawn", "closed"],
  invitation_awaiting_approval: ["received", "contact_needed", "invited", "withdrawn", "closed"],
  invited: ["application_started", "application_submitted", "contact_needed", "withdrawn", "closed"],
  application_started: ["application_submitted", "contact_needed", "withdrawn", "closed"],
  application_submitted: ["screening", "withdrawn", "closed"],
  screening: ["interview", "decision_pending", "withdrawn", "closed"],
  interview: ["decision_pending", "withdrawn", "closed"],
  decision_pending: ["interview", "offer_sent", "withdrawn", "closed"],
  offer_sent: ["accepted", "decision_pending", "withdrawn", "closed"],
  accepted: ["onboarding_handoff", "withdrawn", "closed"],
  onboarding_handoff: ["withdrawn", "closed"],
  withdrawn: [],
  closed: [],
};
/** Stages in which the application is still being worked. */
export const ACTIVE_STAGES: readonly Stage[] = STAGES.filter((stage) => stage !== "withdrawn" && stage !== "closed");
/** Stages in which the applicant still owes the application form. */
export const AWAITING_FORM: readonly Stage[] = ["invited", "application_started"];

/** Why an application was closed. Silence is not in this list unless a person chose it. */
export const CLOSURE_REASONS = ["requirement_not_met", "not_selected", "role_closed", "duplicate", "no_contact_possible", "offer_declined", "no_response", "hired", "other"] as const;
export type ClosureReason = (typeof CLOSURE_REASONS)[number];
export const closureReasonValidator = literals(CLOSURE_REASONS);

export const SOURCES = ["indeed", "ziprecruiter", "direct", "manual", "other"] as const;
export type Source = (typeof SOURCES)[number];
export const sourceValidator = literals(SOURCES);

export const CLASSIFICATIONS = ["new_application", "applicant_reply", "duplicate_notification", "status_update", "suggested_candidate", "promotion", "unrelated"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
export const classificationValidator = literals(CLASSIFICATIONS);

/**
 * direct: an address the applicant gave as their own. relay: a job board's forwarding address the Owner
 * has confirmed reaches applicants. relay_unverified: the same, not confirmed. notification_only: an
 * address that only sends notices. missing and conflict need a person.
 */
export const CONTACT_STATUSES = ["direct", "relay", "relay_unverified", "notification_only", "missing", "conflict"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
export const contactStatusValidator = literals(CONTACT_STATUSES);
export const USABLE_CONTACT: readonly ContactStatus[] = ["direct", "relay"];

export const NEED_STATUSES = ["open", "paused", "closed"] as const;
export const needStatusValidator = literals(NEED_STATUSES);

export const CRITERION_OUTCOMES = ["meets", "does_not_meet", "needs_clarification", "not_applicable"] as const;
export type CriterionOutcome = (typeof CRITERION_OUTCOMES)[number];

// ── Shapes ───────────────────────────────────────────────────────────────────────────────────────

export const answerValidator = v.union(v.string(), v.number(), v.boolean(), v.array(v.string()));
export type Answer = typeof answerValidator.type;
export const answersValidator = v.record(v.string(), answerValidator);
export type Answers = typeof answersValidator.type;

/** A question the Owner adds to the application for one role. */
export const questionValidator = v.object({
  key: v.string(),
  label: v.string(),
  kind: v.union(v.literal("yes_no"), v.literal("text"), v.literal("number"), v.literal("choice")),
  options: v.optional(v.array(v.string())),
  required: v.boolean(),
});
export type Question = typeof questionValidator.type;

/**
 * One job-related requirement and how an answer is checked against it. `person_reviews` is never decided
 * by code. `fixed` marks a published yes-or-no requirement; only those can ever be declined on without a
 * person, and only when the Owner has allowed it.
 */
export const criterionValidator = v.object({
  key: v.string(),
  label: v.string(),
  /** The answer this reads: a standard field or `q.<question key>`. */
  field: v.string(),
  test: v.union(
    v.object({ kind: v.literal("is_true") }),
    v.object({ kind: v.literal("at_least"), value: v.number() }),
    v.object({ kind: v.literal("includes_any"), values: v.array(v.string()) }),
    v.object({ kind: v.literal("includes_all"), values: v.array(v.string()) }),
    v.object({ kind: v.literal("person_reviews") }),
  ),
  fixed: v.boolean(),
});
export type Criterion = typeof criterionValidator.type;

/** Pay an Owner approved for a role. Recruiter copies it into an offer and can never change it. */
export const compensationValidator = v.object({
  pay: v.union(v.object({ kind: v.literal("share"), shareBps: v.number() }), v.object({ kind: v.literal("hourly"), hourlyCents: v.number() })),
  note: v.optional(v.string()),
  approvedBy: v.id("members"),
  approvedAt: v.number(),
});

/** A fact about an applicant and where it came from. */
export const factValidator = v.object({
  field: v.string(),
  value: v.string(),
  from: v.union(v.literal("message"), v.literal("resume"), v.literal("form"), v.literal("owner")),
  /** Where in the source it was found, for example "body: labelled Phone". */
  where: v.string(),
  sourceMessageId: v.optional(v.id("sourceMessages")),
});
export type Fact = typeof factValidator.type;

export const contactEvidenceValidator = v.object({
  address: v.string(),
  kind: v.union(v.literal("direct"), v.literal("relay"), v.literal("notification"), v.literal("unknown")),
  where: v.string(),
  sourceMessageId: v.optional(v.id("sourceMessages")),
});
export type ContactEvidence = typeof contactEvidenceValidator.type;

export const contactValidator = v.object({
  status: contactStatusValidator,
  address: v.optional(v.string()),
  evidence: v.array(contactEvidenceValidator),
  /** Set when a message to `address` bounced. It is not used again until a person corrects it. */
  bouncedAt: v.optional(v.number()),
  /** Set when a person chose or corrected the address. */
  resolvedBy: v.optional(v.id("members")),
});
export type Contact = typeof contactValidator.type;

export const nextActionValidator = v.object({
  what: v.string(),
  by: v.union(v.literal("recruiter"), v.literal("owner"), v.literal("applicant")),
  dueAt: v.optional(v.number()),
});

/** How Recruiter works for this company. Every value is optional and the Owner's; defaults are in settings.ts. */
export const recruiterSettingsValidator = v.object({
  /** review: every invitation is approved by a person. auto: sent when every criterion in invitations.ts holds. */
  invitationMode: v.optional(v.union(v.literal("review"), v.literal("auto"))),
  /** Hours after the invitation for each reminder, for example [48, 120]. */
  followUpHours: v.optional(v.array(v.number())),
  maxFollowUps: v.optional(v.number()),
  /** Messages go out only between these minutes of the company's day, on these weekdays (0 is Sunday). */
  sendFromMinute: v.optional(v.number()),
  sendUntilMinute: v.optional(v.number()),
  sendDays: v.optional(v.array(v.number())),
  /** The name applicants see, and where their replies go: the company's own hiring inbox. */
  fromName: v.optional(v.string()),
  replyTo: v.optional(v.string()),
  /** Job boards whose forwarding addresses the Owner has confirmed reach applicants. */
  verifiedRelays: v.optional(v.array(sourceValidator)),
  linkTtlDays: v.optional(v.number()),
  offerTtlDays: v.optional(v.number()),
  /** Days an application's personal data is kept after it closes. */
  retentionDays: v.optional(v.number()),
  interviewMinutes: v.optional(v.number()),
  interviewReminderHours: v.optional(v.number()),
  /** Hours a person has to decide a Recruiter proposal before it expires. */
  decideWithinHours: v.optional(v.number()),
  /** What a new worker must have before a person may mark them ready. */
  onboardingRequirements: v.optional(v.array(v.object({ key: v.string(), label: v.string() }))),
  /** The Owner's own words: rules, tone and when to escalate. Shown to people and given to the model as context, never as authority. */
  recruitingRules: v.optional(v.string()),
  communicationPolicy: v.optional(v.string()),
  escalationRules: v.optional(v.string()),
});

export const offerTermsValidator = v.object({
  role: v.string(),
  engagement: v.union(v.literal("contractor"), v.literal("employee")),
  pay: compensationValidator.fields.pay,
  startConditions: v.string(),
  expectations: v.string(),
  /** The company's own agreement, by name. Recruiter writes no legal terms. */
  agreementTemplate: v.optional(v.string()),
});

const screeningResultValidator = v.object({
  key: v.string(),
  label: v.string(),
  outcome: literals(CRITERION_OUTCOMES),
  evidence: v.string(),
  source: v.string(),
  fixed: v.boolean(),
});

// ── Tables ───────────────────────────────────────────────────────────────────────────────────────

export const recruiterTables = {
  /** A role the Owner is hiring for. Only the Owner opens one or sets its pay. */
  hiringNeeds: defineTable({
    companyId: v.id("companies"),
    title: v.string(),
    /** Other titles the same role is posted under on job boards. */
    titleAliases: v.array(v.string()),
    responsibilities: v.string(),
    serviceTypes: v.array(v.string()),
    location: v.string(),
    /** Postal codes the role covers. */
    coverageAreas: v.array(v.string()),
    requiredAvailability: v.string(),
    requiredSkills: v.array(v.string()),
    experience: v.optional(v.string()),
    equipment: v.optional(v.string()),
    engagement: v.union(v.literal("contractor"), v.literal("employee")),
    compensation: v.optional(compensationValidator),
    openings: v.number(),
    targetStartAt: v.optional(v.number()),
    questions: v.array(questionValidator),
    criteria: v.array(criterionValidator),
    interviewProcess: v.optional(v.string()),
    status: needStatusValidator,
    /** Set when Dispatch's staffing-gap request led a person to open this. The request itself opens nothing. */
    fromTaskId: v.optional(v.id("tasks")),
    createdBy: v.id("members"),
    createdAt: v.number(),
  }).index("by_company_status", ["companyId", "status"]),

  applicants: defineTable({
    companyId: v.id("companies"),
    name: v.optional(v.string()),
    /** Lower case. The address the person gave as theirs, or a confirmed relay. */
    email: v.optional(v.string()),
    /** Digits only, with country code. */
    phone: v.optional(v.string()),
    location: v.optional(v.string()),
    /** Permission to text about this application, in the applicant's own action, with the words they agreed to. */
    smsConsent: v.optional(v.object({ at: v.number(), wording: v.string(), phone: v.string() })),
    /** The person asked not to be contacted. Nothing is sent after this. */
    doNotContact: v.optional(v.object({ at: v.number(), reason: v.string() })),
    /** Another applicant this may be, by name alone. Never merged without a person. */
    possibleDuplicateOf: v.optional(v.id("applicants")),
    /** Set when personal data was removed. The row stays so the applications keep their history. */
    redactedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_company_email", ["companyId", "email"])
    .index("by_company_phone", ["companyId", "phone"])
    .index("by_company_created", ["companyId", "createdAt"]),

  applications: defineTable({
    companyId: v.id("companies"),
    applicantId: v.id("applicants"),
    /** Absent while the role named in the notification matches no hiring need, or more than one. */
    needId: v.optional(v.id("hiringNeeds")),
    /** The role as the source named it. */
    roleSeen: v.optional(v.string()),
    source: sourceValidator,
    sourceApplicationId: v.optional(v.string()),
    appliedAt: v.number(),
    stage: stageValidator,
    closure: v.optional(v.object({ reason: closureReasonValidator, note: v.optional(v.string()), by: v.optional(v.id("members")), at: v.number() })),
    contact: contactValidator,
    facts: v.array(factValidator),
    nextAction: v.optional(nextActionValidator),
    /** Set while a person has taken this over. Recruiter sends nothing by itself until it is handed back. */
    withPersonSince: v.optional(v.number()),
    /** Set while an applicant's message is unanswered. Reminders wait. */
    questionSince: v.optional(v.number()),
    invitationApprovalId: v.optional(v.id("approvals")),
    invitedAt: v.optional(v.number()),
    followUpsSent: v.number(),
    formStartedAt: v.optional(v.number()),
    submittedAt: v.optional(v.number()),
    /** After this, personal data is removed. Set when the application ends. */
    retainUntil: v.optional(v.number()),
    redactedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_company_stage", ["companyId", "stage"])
    .index("by_company_applicant", ["companyId", "applicantId"])
    .index("by_company_need", ["companyId", "needId"])
    .index("by_company_source", ["companyId", "source", "sourceApplicationId"])
    .index("by_stage_invited", ["stage", "invitedAt"])
    .index("by_retainUntil", ["retainUntil"]),

  /** A mailbox the Owner authorized for hiring mail. Credentials are never stored here. */
  mailboxConnections: defineTable({
    companyId: v.id("companies"),
    provider: v.union(v.literal("gmail"), v.literal("microsoft"), v.literal("mock")),
    address: v.string(),
    /** A label or folder to stay inside, when the Owner keeps hiring mail in one. */
    folder: v.optional(v.string()),
    /** Job boards whose notifications are read. Empty means every board Recruiter knows. */
    sources: v.array(sourceValidator),
    /** Nothing received before this is processed. An earlier date is the Owner's explicit historical import. */
    processFrom: v.number(),
    status: v.union(v.literal("connected"), v.literal("expired"), v.literal("disconnected"), v.literal("error")),
    problem: v.optional(v.string()),
    /** Where the last finished page ended. A crash before this is saved replays that page, and ingest ignores what it already has. */
    cursor: v.optional(v.string()),
    lastSyncAt: v.optional(v.number()),
    failures: v.number(),
    /** The Owner allowed Recruiter to send from this mailbox. Applicant email then goes from the company's own address. */
    canSend: v.optional(v.boolean()),
    createdBy: v.id("members"),
    createdAt: v.number(),
  }).index("by_company", ["companyId"]),

  /**
   * A mailbox's refresh token, encrypted (lib/recruiter/secrets.ts) and bound to its connection. No query
   * a browser can reach reads this table; only the inbox run and the sender do, inside the deployment.
   */
  mailboxCredentials: defineTable({
    companyId: v.id("companies"),
    connectionId: v.id("mailboxConnections"),
    sealedRefreshToken: v.string(),
    scopes: v.array(v.string()),
    createdAt: v.number(),
  }).index("by_connection", ["connectionId"]),

  /** One Owner's request to connect a mailbox, waiting for the provider to send them back. Single use, short lived. */
  oauthStates: defineTable({
    companyId: v.id("companies"),
    memberId: v.id("members"),
    provider: v.literal("gmail"),
    /** The hash of the state sent to the provider. The state itself is not stored. */
    stateHash: v.string(),
    folder: v.optional(v.string()),
    sources: v.array(sourceValidator),
    processFrom: v.number(),
    canSend: v.boolean(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  }).index("by_stateHash", ["stateHash"]),

  /**
   * One message seen in the hiring inbox. For unrelated mail only the provider's id and that verdict are
   * kept: no sender, no subject, no body.
   */
  sourceMessages: defineTable({
    companyId: v.id("companies"),
    connectionId: v.id("mailboxConnections"),
    providerMessageId: v.string(),
    threadId: v.optional(v.string()),
    classification: classificationValidator,
    /** rule: decided by code from a known sender. model: a model read the sender and subject, or the body of hiring mail. */
    classifiedBy: v.union(v.literal("rule"), v.literal("model")),
    reason: v.optional(v.string()),
    source: v.optional(sourceValidator),
    fromAddress: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    subject: v.optional(v.string()),
    receivedAt: v.number(),
    /** Plain text, capped, for hiring mail only. Data to show a person, never instructions. */
    excerpt: v.optional(v.string()),
    attachments: v.optional(v.array(v.object({ name: v.string(), contentType: v.string(), size: v.number(), read: v.boolean() }))),
    applicationId: v.optional(v.id("applications")),
    /** Something about this message a person should look at. */
    flag: v.optional(v.string()),
    redactedAt: v.optional(v.number()),
  })
    .index("by_connection_message", ["connectionId", "providerMessageId"])
    .index("by_company_received", ["companyId", "receivedAt"])
    .index("by_company_application", ["companyId", "applicationId"]),

  /**
   * A link that lets one applicant do named things for one application without signing in. Same token
   * scheme as Dispatch's action links (lib/dispatch/links.ts): the token is never stored.
   */
  applicantLinks: defineTable({
    companyId: v.id("companies"),
    publicId: v.string(),
    purpose: v.union(v.literal("apply"), v.literal("interview"), v.literal("hiring-offer")),
    applicationId: v.id("applications"),
    applicantId: v.id("applicants"),
    allowed: v.array(v.string()),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    revokeReason: v.optional(v.string()),
    issuedAt: v.number(),
    lastActionAt: v.optional(v.number()),
    lastAction: v.optional(v.string()),
  })
    .index("by_publicId", ["publicId"])
    .index("by_company_application", ["companyId", "applicationId"]),

  /** The application form as the applicant has filled it so far. One per application. */
  formSessions: defineTable({
    companyId: v.id("companies"),
    applicationId: v.id("applications"),
    answers: answersValidator,
    startedAt: v.number(),
    savedAt: v.number(),
    submittedAt: v.optional(v.number()),
  }).index("by_company_application", ["companyId", "applicationId"]),

  /** A file an applicant gave us. Stored privately. Having it says nothing about whether it is genuine. */
  applicantAttachments: defineTable({
    companyId: v.id("companies"),
    applicationId: v.id("applications"),
    kind: v.union(v.literal("resume"), v.literal("supporting")),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    clientKey: v.string(),
    uploadedAt: v.number(),
  }).index("by_company_application", ["companyId", "applicationId"]),

  /** One evaluation of a submitted application against the role's criteria. A recommendation, never a decision. */
  screenings: defineTable({
    companyId: v.id("companies"),
    applicationId: v.id("applications"),
    needId: v.id("hiringNeeds"),
    results: v.array(screeningResultValidator),
    contradictions: v.array(v.string()),
    missing: v.array(v.string()),
    summary: v.object({
      experience: v.string(),
      availability: v.string(),
      met: v.array(v.string()),
      concerns: v.array(v.string()),
      suggestedNextStep: v.string(),
    }),
    recommendation: v.union(v.literal("advance"), v.literal("clarify"), v.literal("review_requirement")),
    createdAt: v.number(),
  }).index("by_company_application", ["companyId", "applicationId", "createdAt"]),

  /** A decision a person made about an application. Only people write here. */
  hiringDecisions: defineTable({
    companyId: v.id("companies"),
    applicationId: v.id("applications"),
    decision: v.union(v.literal("interview"), v.literal("hold"), v.literal("offer"), v.literal("reject")),
    reason: v.optional(v.string()),
    screeningId: v.optional(v.id("screenings")),
    /** Set when an allowed automatic decline on a published fixed requirement closed it. */
    automatic: v.optional(v.boolean()),
    decidedBy: v.optional(v.id("members")),
    at: v.number(),
  }).index("by_company_application", ["companyId", "applicationId", "at"]),

  /** A time an interviewer said they are free. */
  interviewSlots: defineTable({
    companyId: v.id("companies"),
    interviewerId: v.id("members"),
    startsAt: v.number(),
    endsAt: v.number(),
    status: v.union(v.literal("open"), v.literal("booked"), v.literal("cancelled")),
    interviewId: v.optional(v.id("interviews")),
  })
    .index("by_company_start", ["companyId", "startsAt"])
    .index("by_company_interviewer", ["companyId", "interviewerId", "startsAt"]),

  interviews: defineTable({
    companyId: v.id("companies"),
    applicationId: v.id("applications"),
    /**
     * awaiting_slots: no time can be offered yet and a person has a scheduling task. proposed: the
     * applicant has been asked to pick. reserving: a slot is held while the calendar is asked.
     * confirmed: the slot is reserved. Nothing else is ever shown as a confirmed interview.
     */
    status: v.union(v.literal("awaiting_slots"), v.literal("proposed"), v.literal("reserving"), v.literal("confirmed"), v.literal("completed"), v.literal("cancelled"), v.literal("no_show")),
    interviewerId: v.optional(v.id("members")),
    slotId: v.optional(v.id("interviewSlots")),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    how: v.optional(v.string()),
    calendarEventId: v.optional(v.string()),
    reschedules: v.number(),
    reminderQueuedAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
    feedback: v.optional(v.object({ by: v.id("members"), at: v.number(), attended: v.boolean(), notes: v.string(), recommendation: v.union(v.literal("advance"), v.literal("hold"), v.literal("do_not_advance")) })),
    taskId: v.optional(v.id("tasks")),
    createdAt: v.number(),
  })
    .index("by_company_application", ["companyId", "applicationId"])
    .index("by_status_start", ["status", "startsAt"])
    .index("by_company_status", ["companyId", "status"]),

  hiringOffers: defineTable({
    companyId: v.id("companies"),
    applicationId: v.id("applications"),
    needId: v.id("hiringNeeds"),
    terms: offerTermsValidator,
    status: v.union(v.literal("draft"), v.literal("awaiting_approval"), v.literal("approved"), v.literal("sent"), v.literal("accepted"), v.literal("declined"), v.literal("withdrawn"), v.literal("expired")),
    approvalId: v.optional(v.id("approvals")),
    approvedBy: v.optional(v.id("members")),
    sentAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    respondedAt: v.optional(v.number()),
    /** The agreement is its own thing. Accepting an offer does not complete it. */
    agreement: v.object({
      status: v.union(v.literal("not_started"), v.literal("sent"), v.literal("completed")),
      provider: v.optional(v.string()),
      envelopeId: v.optional(v.string()),
      completedAt: v.optional(v.number()),
      recordedBy: v.optional(v.id("members")),
    }),
    createdAt: v.number(),
  }).index("by_company_application", ["companyId", "applicationId"]),

  /** What onboarding has to finish before a person may mark the new worker ready. */
  onboardingHandoffs: defineTable({
    companyId: v.id("companies"),
    applicationId: v.id("applications"),
    applicantId: v.id("applicants"),
    needId: v.id("hiringNeeds"),
    /** The worker record, created in "onboarding". Dispatch offers nothing to it until a person marks it ready. */
    cleanerId: v.id("cleaners"),
    terms: offerTermsValidator,
    /** What the applicant told us, each with where it came from. Told, not verified. */
    information: v.array(factValidator),
    requirements: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        status: v.union(v.literal("outstanding"), v.literal("done")),
        note: v.optional(v.string()),
        recordedBy: v.optional(v.id("members")),
        at: v.optional(v.number()),
      }),
    ),
    responsibleId: v.id("members"),
    nextAction: v.string(),
    dueAt: v.number(),
    status: v.union(v.literal("open"), v.literal("complete"), v.literal("cancelled")),
    taskId: v.optional(v.id("tasks")),
    createdAt: v.number(),
  })
    .index("by_company_status", ["companyId", "status"])
    .index("by_company_application", ["companyId", "applicationId"]),
};
