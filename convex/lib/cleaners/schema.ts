/**
 * The Cleaners workspace's own records (docs/cleaners/00-architecture.md, section 3). The person is still
 * the `cleaners` row in convex/schema.ts; everything here hangs off it. Six things are kept apart and none
 * is inferred from another: relationship type, engagement status, onboarding progress, job eligibility,
 * availability and payout readiness.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { literals } from "../statuses";

// ── Lists ────────────────────────────────────────────────────────────────────────────────────────

/** Relationship type. A subcontractor worker is a real person supplied by a subcontractor company. */
export const ENGAGEMENTS = ["employee", "contractor", "subcontractor"] as const;
export type Engagement = (typeof ENGAGEMENTS)[number];
export const engagementValidator = literals(ENGAGEMENTS);

export const REQUIREMENT_KINDS = ["contact", "agreement", "document", "payment", "availability", "service_areas", "skills", "equipment", "training", "acknowledgment", "custom"] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];
export const requirementKindValidator = literals(REQUIREMENT_KINDS);

/** What an unmet requirement holds up. Informational ones are shown and hold up nothing. */
export const REQUIREMENT_EFFECTS = ["blocks_assignments", "blocks_payment", "informational"] as const;
export type RequirementEffect = (typeof REQUIREMENT_EFFECTS)[number];
export const requirementEffectValidator = literals(REQUIREMENT_EFFECTS);

/**
 * One requirement for one cleaner. submitted: the cleaner (or someone for them) gave something that is
 * not yet complete or not yet checkable, for example a payment setup that was started. awaiting_review: a
 * person has to look at it. accepted: a named person (or a signed agreement) satisfied it. waived: a named
 * person set it aside, with a reason. expired: it was accepted and its validity ran out.
 */
export const REQUIREMENT_STATES = ["not_started", "submitted", "awaiting_review", "accepted", "needs_changes", "expired", "waived"] as const;
export type RequirementState = (typeof REQUIREMENT_STATES)[number];
export const requirementStateValidator = literals(REQUIREMENT_STATES);

export const PROVIDERS = ["company", "cleaner", "crew"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Who may accept, ask for changes to or waive a requirement. */
export const REVIEWERS = ["manager", "owner"] as const;
export type Reviewer = (typeof REVIEWERS)[number];

export const SUBCONTRACTOR_STATUSES = ["active", "paused", "ended"] as const;
export const subcontractorStatusValidator = literals(SUBCONTRACTOR_STATUSES);

export const CREW_KINDS = ["permanent", "temporary"] as const;
export type CrewKind = (typeof CREW_KINDS)[number];

export const FOLLOW_UP_TOPICS = ["onboarding", "availability", "idle_check_in"] as const;
export type FollowUpTopic = (typeof FOLLOW_UP_TOPICS)[number];
export const followUpTopicValidator = literals(FOLLOW_UP_TOPICS);

/**
 * scheduled: due later. awaiting_approval: the agent is on Propose and a person decides. sent: the message
 * was handed to the sender (its own status says what became of it). answered: the cleaner acted through the
 * link. resolved: what it was about is no longer open. stopped: a stop condition ended it. not_sent: it could
 * not go, with the reason.
 */
export const FOLLOW_UP_STATES = ["scheduled", "awaiting_approval", "sent", "answered", "resolved", "stopped", "not_sent"] as const;
export type FollowUpState = (typeof FOLLOW_UP_STATES)[number];
export const followUpStateValidator = literals(FOLLOW_UP_STATES);

export const COACHING_KINDS = ["note", "coaching", "training", "feedback"] as const;
export const COACHING_STATES = ["draft", "awaiting_review", "active", "resolved", "withdrawn"] as const;
export type CoachingState = (typeof COACHING_STATES)[number];

/** Changes that always need an authorized person (brief, section 7). No agent can request one. */
export const PERSONNEL_KINDS = ["pay_change", "disciplinary", "suspend", "reinstate", "end_engagement", "rehire_restriction", "remove_record"] as const;
export type PersonnelKind = (typeof PERSONNEL_KINDS)[number];
export const personnelKindValidator = literals(PERSONNEL_KINDS);

export const PORTAL_PURPOSES = ["portal", "task", "availability", "check_in"] as const;
export type PortalPurpose = (typeof PORTAL_PURPOSES)[number];

// ── Shapes ───────────────────────────────────────────────────────────────────────────────────────

export const payArrangementValidator = v.union(
  v.object({ kind: v.literal("share"), shareBps: v.number() }),
  v.object({ kind: v.literal("hourly"), hourlyCents: v.number() }),
);

/** The company's rules for this workspace. Every value is optional; defaults are in lib/cleaners/settings.ts. */
export const cleanersSettingsValidator = v.object({
  /** Ask a cleaner to confirm their weekly availability when it was last confirmed this many days ago. */
  availabilityConfirmDays: v.optional(v.number()),
  /** A worker with no accepted work in this many days gets a friendly check-in, never a consequence. */
  idleAfterDays: v.optional(v.number()),
  /** Hours between routine reminders about the same thing. */
  reminderEveryHours: v.optional(v.number()),
  /** The most routine reminders about one thing before a person is asked to step in. */
  maxReminders: v.optional(v.number()),
  /** Channels routine follow-ups may use, in order of preference. */
  followUpChannels: v.optional(v.array(v.union(v.literal("sms"), v.literal("email")))),
  /** Show a document as nearing expiry this many days before it expires. */
  expiryWarningDays: v.optional(v.number()),
  /** Days a portal link stays valid. */
  portalLinkDays: v.optional(v.number()),
  /** Who decides sensitive personnel requests. */
  personnelDecider: v.optional(v.union(v.literal("owner"), v.literal("owner_or_manager"))),
  /** What happens to portal access when an engagement ends. */
  endedAccess: v.optional(v.union(v.literal("revoke"), v.literal("history_only"))),
});

export const fileRefValidator = v.object({
  storageId: v.id("_storage"),
  name: v.string(),
  contentType: v.string(),
  size: v.number(),
  uploadedAt: v.number(),
});

export const evidenceValidator = v.object({
  files: v.optional(v.array(fileRefValidator)),
  agreementId: v.optional(v.id("agreements")),
  /** What the cleaner or a person wrote, for example a confirmed phone number or "has own vacuum". */
  text: v.optional(v.string()),
});

/** Who did something on a requirement. A cleaner acts only through their own portal link. */
export const byValidator = v.union(
  v.object({ kind: v.literal("member"), memberId: v.id("members") }),
  v.object({ kind: v.literal("cleaner"), linkId: v.id("portalLinks") }),
  v.object({ kind: v.literal("subcontractor"), linkId: v.id("portalLinks") }),
  v.object({ kind: v.literal("system") }),
);

export const evidenceRefValidator = v.object({
  kind: v.union(v.literal("job"), v.literal("assignment"), v.literal("measure"), v.literal("requirement"), v.literal("message")),
  id: v.optional(v.string()),
  label: v.string(),
});

// ── Tables ───────────────────────────────────────────────────────────────────────────────────────

export const cleanersTables = {
  /** A company that supplies its own cleaners. Its workers are `cleaners` rows; jobs go to real people. */
  subcontractors: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    status: subcontractorStatusValidator,
    /** The person authorized to act for the subcontractor company. */
    contact: v.object({ name: v.string(), title: v.optional(v.string()), email: v.optional(v.string()), phone: v.optional(v.string()) }),
    serviceAreas: v.array(v.string()),
    notes: v.optional(v.string()),
    /** The Owner's arrangement with the subcontractor company. Its workers are paid through it. */
    pay: v.optional(payArrangementValidator),
    createdAt: v.number(),
    endedAt: v.optional(v.number()),
  }).index("by_company_status", ["companyId", "status"]),

  /** Which subcontractor a cleaner worked through, and when. A job's affiliation is read from these dates. */
  workerAffiliations: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    subcontractorId: v.id("subcontractors"),
    from: v.number(),
    to: v.optional(v.number()),
  })
    .index("by_company_cleaner", ["companyId", "cleanerId", "from"])
    .index("by_company_subcontractor", ["companyId", "subcontractorId", "from"]),

  /**
   * The company's onboarding template, one requirement per row. Which workers it applies to, what an unmet
   * one holds up, who reviews it and how long it stays valid are the Owner's.
   */
  requirementDefinitions: defineTable({
    companyId: v.id("companies"),
    key: v.string(),
    label: v.string(),
    /** What the cleaner is asked to do, in their words. */
    description: v.optional(v.string()),
    kind: requirementKindValidator,
    effect: requirementEffectValidator,
    appliesTo: v.array(engagementValidator),
    reviewer: v.union(v.literal("manager"), v.literal("owner")),
    /** Days an accepted requirement stays valid. Absent means it does not expire. */
    validForDays: v.optional(v.number()),
    /** For equipment: who provides it. Crew equipment is checked on the crew, not on each person. */
    providedBy: v.optional(v.union(v.literal("company"), v.literal("cleaner"), v.literal("crew"))),
    /** Services (or skills) this requirement is for, lower case. Empty means every job. */
    forServices: v.array(v.string()),
    /** The cleaner can complete or submit it from their portal. */
    cleanerCompletes: v.boolean(),
    /** For an agreement: the Agreements document type that satisfies it once signed. */
    agreementDocType: v.optional(v.string()),
    /** For an acknowledgment: when its words last changed. Agreements from before then are asked again. */
    wordsChangedAt: v.optional(v.number()),
    order: v.number(),
    status: v.union(v.literal("active"), v.literal("retired")),
    updatedBy: v.optional(v.id("members")),
    updatedAt: v.number(),
  }).index("by_company_key", ["companyId", "key"]),

  /** One requirement for one cleaner. What it holds up is read from its definition, so a rule change applies. */
  workerRequirements: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    key: v.string(),
    status: requirementStateValidator,
    evidence: v.optional(evidenceValidator),
    submittedAt: v.optional(v.number()),
    submittedBy: v.optional(byValidator),
    reviewedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.id("members")),
    /** What the reviewer said: why changes are needed, or what they checked. */
    reviewNote: v.optional(v.string()),
    acceptedAt: v.optional(v.number()),
    /** When an accepted requirement stops counting. */
    expiresAt: v.optional(v.number()),
    waiver: v.optional(v.object({ by: v.id("members"), at: v.number(), reason: v.string() })),
    /** For an acknowledgment: the exact words the cleaner agreed to. New words need a new agreement. */
    acknowledged: v.optional(v.object({ words: v.string(), at: v.number() })),
    updatedAt: v.number(),
  })
    .index("by_company_cleaner", ["companyId", "cleanerId", "key"])
    .index("by_company_status", ["companyId", "status", "updatedAt"])
    .index("by_status_expires", ["status", "expiresAt"]),

  /** A date the cleaner can or cannot work, outside their weekly pattern. On the company's calendar. */
  availabilityExceptions: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    /** YYYY-MM-DD on the company's calendar. */
    date: v.string(),
    kind: v.union(v.literal("unavailable"), v.literal("available")),
    /** Minutes from midnight. Absent means the whole day. */
    startMinute: v.optional(v.number()),
    endMinute: v.optional(v.number()),
    note: v.optional(v.string()),
    by: byValidator,
    createdAt: v.number(),
  }).index("by_company_cleaner_date", ["companyId", "cleanerId", "date"]),

  /** A skill a cleaner says they have. Dispatch reads only the skills a person confirmed (on the cleaner). */
  skillClaims: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    skill: v.string(),
    note: v.optional(v.string()),
    status: v.union(v.literal("claimed"), v.literal("confirmed"), v.literal("declined")),
    claimedAt: v.number(),
    decidedBy: v.optional(v.id("members")),
    decidedAt: v.optional(v.number()),
  })
    .index("by_company_cleaner", ["companyId", "cleanerId"])
    .index("by_company_status", ["companyId", "status"]),

  /** A permanent crew with a lead, or a temporary team put together for one job. */
  crews: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    kind: v.union(v.literal("permanent"), v.literal("temporary")),
    status: v.union(v.literal("active"), v.literal("archived")),
    /** A temporary team's job. Its members stay as they were assigned, whatever the permanent crew does later. */
    jobId: v.optional(v.id("jobs")),
    /** A crew supplied by a subcontractor company. */
    subcontractorId: v.optional(v.id("subcontractors")),
    /** What the crew brings between them, for equipment the crew provides. */
    equipment: v.array(v.string()),
    notes: v.optional(v.string()),
    createdBy: v.id("members"),
    createdAt: v.number(),
  })
    .index("by_company_status", ["companyId", "status"])
    .index("by_company_job", ["companyId", "jobId"]),

  /** Membership with dates, so history survives a change. A lead is a member with role "lead". */
  crewMemberships: defineTable({
    companyId: v.id("companies"),
    crewId: v.id("crews"),
    cleanerId: v.id("cleaners"),
    role: v.union(v.literal("lead"), v.literal("member")),
    from: v.number(),
    to: v.optional(v.number()),
  })
    .index("by_company_crew", ["companyId", "crewId"])
    .index("by_company_cleaner", ["companyId", "cleanerId"]),

  /**
   * Portal access for one cleaner or one subcontractor contact, or a focused link for one task. The token
   * is never stored: it is the public id plus a signature (same scheme as lib/dispatch/links.ts). Opening a
   * link changes nothing; only a named action does, and each is recorded.
   */
  portalLinks: defineTable({
    companyId: v.id("companies"),
    publicId: v.string(),
    /** Whose access this is: a cleaner, or a subcontractor company's authorized contact. Exactly one id is set. */
    holder: v.union(v.literal("cleaner"), v.literal("subcontractor")),
    cleanerId: v.optional(v.id("cleaners")),
    subcontractorId: v.optional(v.id("subcontractors")),
    purpose: v.union(v.literal("portal"), v.literal("task"), v.literal("availability"), v.literal("check_in")),
    /** For a task link: the one requirement it opens. */
    requirementKey: v.optional(v.string()),
    followUpId: v.optional(v.id("followUps")),
    allowed: v.array(v.string()),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    revokeReason: v.optional(v.string()),
    issuedAt: v.number(),
    issuedBy: v.union(v.object({ kind: v.literal("member"), memberId: v.id("members") }), v.object({ kind: v.literal("agent"), agent: v.union(v.literal("recruiter"), v.literal("dispatch")) }), v.object({ kind: v.literal("system") })),
    /** Until when sensitive records (pay, tax, personnel) are unlocked by a one-time code. */
    verifiedUntil: v.optional(v.number()),
    lastActionAt: v.optional(v.number()),
    lastAction: v.optional(v.string()),
  })
    .index("by_publicId", ["publicId"])
    .index("by_company_issued", ["companyId", "issuedAt"])
    .index("by_company_cleaner", ["companyId", "cleanerId", "issuedAt"])
    .index("by_company_subcontractor", ["companyId", "subcontractorId", "issuedAt"]),

  /** A one-time code sent to the address on file, to unlock sensitive records in the portal. Only its hash is kept. */
  portalCodes: defineTable({
    companyId: v.id("companies"),
    linkId: v.id("portalLinks"),
    codeHash: v.string(),
    channel: v.union(v.literal("sms"), v.literal("email")),
    expiresAt: v.number(),
    attempts: v.number(),
    usedAt: v.optional(v.number()),
    messageId: v.optional(v.id("messages")),
    createdAt: v.number(),
  }).index("by_link", ["linkId", "createdAt"]),

  /**
   * One routine follow-up. `key` names what it is about (topic and cleaner), so Recruiter, Dispatch and this
   * workspace never send two reminders about the same thing: there is one open row per key.
   */
  followUps: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    topic: followUpTopicValidator,
    key: v.string(),
    agent: v.union(v.literal("recruiter"), v.literal("dispatch")),
    status: followUpStateValidator,
    /** What it is about and why, in words, with the records behind it. */
    summary: v.string(),
    evidence: v.array(evidenceRefValidator),
    attempt: v.number(),
    dueAt: v.number(),
    channel: v.optional(v.union(v.literal("sms"), v.literal("email"))),
    lastSentAt: v.optional(v.number()),
    messageId: v.optional(v.id("messages")),
    linkId: v.optional(v.id("portalLinks")),
    approvalId: v.optional(v.id("approvals")),
    taskId: v.optional(v.id("tasks")),
    stopReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_key", ["companyId", "key", "createdAt"])
    .index("by_company_cleaner", ["companyId", "cleanerId", "createdAt"])
    .index("by_status_due", ["status", "dueAt"])
    .index("by_company_status", ["companyId", "status", "dueAt"]),

  /**
   * Notes, coaching, training recommendations and feedback. `internal` is never shown to the cleaner;
   * `shared` is what was deliberately given to them. A draft prepared by Selestial is a draft until a person
   * reviews it, and none of it is a disciplinary action.
   */
  coachingNotes: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    kind: literals(COACHING_KINDS),
    visibility: v.union(v.literal("internal"), v.literal("shared")),
    status: literals(COACHING_STATES),
    title: v.string(),
    body: v.string(),
    evidence: v.array(evidenceRefValidator),
    actions: v.array(v.object({ text: v.string(), dueAt: v.optional(v.number()), doneAt: v.optional(v.number()) })),
    followUpAt: v.optional(v.number()),
    author: v.union(v.object({ kind: v.literal("member"), memberId: v.id("members") }), v.object({ kind: v.literal("selestial"), scoreVersion: v.optional(v.string()) })),
    reviewedBy: v.optional(v.id("members")),
    reviewedAt: v.optional(v.number()),
    sharedAt: v.optional(v.number()),
    response: v.optional(v.object({ text: v.string(), at: v.number() })),
    outcome: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_cleaner", ["companyId", "cleanerId", "createdAt"])
    .index("by_company_status", ["companyId", "status", "updatedAt"]),

  /** A performance record someone says is wrong. While open it is shown flagged and left out of the score. */
  recordDisputes: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    assignmentId: v.id("assignments"),
    /** The measure the record counts toward, for example "no_show". */
    measure: v.string(),
    raisedBy: byValidator,
    reason: v.string(),
    status: v.union(v.literal("open"), v.literal("upheld"), v.literal("corrected")),
    resolution: v.optional(v.string()),
    decidedBy: v.optional(v.id("members")),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
  }).index("by_company_cleaner", ["companyId", "cleanerId", "createdAt"]),

  /**
   * A sensitive change a person asked for and an authorized person decides. Carrying it out happens only
   * on approval, after the checks are run again.
   */
  personnelRequests: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.optional(v.id("cleaners")),
    subcontractorId: v.optional(v.id("subcontractors")),
    kind: personnelKindValidator,
    /** What exactly would change. */
    details: v.object({
      pay: v.optional(payArrangementValidator),
      effectiveAt: v.optional(v.number()),
      /** For a disciplinary record: what happened, as documented. */
      summary: v.optional(v.string()),
      /** For a rehire restriction: until when, or absent for no end date. */
      until: v.optional(v.number()),
      /** The job records it rests on, named as they were when it was asked for. */
      evidence: v.optional(v.array(v.object({ assignmentId: v.id("assignments"), label: v.string() }))),
    }),
    reason: v.string(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("declined"), v.literal("withdrawn")),
    requestedBy: v.id("members"),
    requestedAt: v.number(),
    decidedBy: v.optional(v.id("members")),
    decidedAt: v.optional(v.number()),
    decisionNote: v.optional(v.string()),
    carriedOut: v.optional(v.object({ ok: v.boolean(), detail: v.string(), at: v.number() })),
  })
    .index("by_company_status", ["companyId", "status", "requestedAt"])
    .index("by_company_cleaner", ["companyId", "cleanerId", "requestedAt"]),

  /** Each compensation arrangement and when it applied. The current one is copied to `cleaners.pay`. */
  payArrangements: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.optional(v.id("cleaners")),
    subcontractorId: v.optional(v.id("subcontractors")),
    pay: payArrangementValidator,
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    setBy: v.id("members"),
    requestId: v.optional(v.id("personnelRequests")),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_company_cleaner", ["companyId", "cleanerId", "effectiveFrom"])
    .index("by_company_subcontractor", ["companyId", "subcontractorId", "effectiveFrom"]),
};
