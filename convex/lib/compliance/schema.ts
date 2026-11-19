/**
 * Messaging consent, the company compliance profile, and agreement acceptance.
 *
 * Three layers, kept apart on purpose, never one checkbox or one record for several:
 * 1. Selestial itself: only the agreements a company accepts (agreementAcceptances).
 * 2. The cleaning company's own setup: who it is and how it sends (complianceProfiles, consentDisclosures).
 * 3. Each recipient's own choices: what they agreed to and what they asked to stop (contactPermissions,
 *    permissionHistory, suppressions).
 *
 * Categories, by what the message is about:
 * - operational: about work already arranged. A cleaner's assigned job, a customer's booked visit.
 * - marketing: promotions, win-back, review requests.
 * - recruiting: messages to applicants about applying or being hired.
 * Sign-in codes and other authentication messages are sent by the sign-in service, not from here.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { literals, agentValidator } from "../statuses";
import { DOCUMENT_KINDS } from "../trust/documents";

export const CHANNELS = ["sms", "email"] as const;
export type Channel = (typeof CHANNELS)[number];
export const channelValidator = literals(CHANNELS);

export const CATEGORIES = ["operational", "marketing", "recruiting"] as const;
export type Category = (typeof CATEGORIES)[number];
export const categoryValidator = literals(CATEGORIES);

export const RECIPIENT_KINDS = ["customer", "cleaner", "applicant"] as const;
export type RecipientKind = (typeof RECIPIENT_KINDS)[number];
/** Who a permission belongs to. The id is a string because applicants are not records here yet. */
export const recipientValidator = v.object({ kind: literals(RECIPIENT_KINDS), id: v.string() });
export type Recipient = typeof recipientValidator.type;

export const PERMISSION_STATUSES = ["granted", "withdrawn"] as const;
export type PermissionStatus = (typeof PERMISSION_STATUSES)[number];
export const permissionStatusValidator = literals(PERMISSION_STATUSES);

/**
 * How the person told the company. "import" is kept only to say where a contact came from: an imported
 * number, a payment, a resume or a booking is not consent, and the sending policy never counts it.
 * "job_application": the person applied for a job with the company. Recruiter records it for email about
 * that application only (category recruiting, channel email), never for texts (the owner's decision of
 * November 16, 2026; listed for legal review in docs/recruiter/05-assumptions.md).
 */
export const PERMISSION_SOURCES = ["web_form", "paper_form", "verbal", "text_reply", "email_reply", "onboarding", "applicant_form", "job_application", "import", "staff"] as const;
export type PermissionSource = (typeof PERMISSION_SOURCES)[number];
export const permissionSourceValidator = literals(PERMISSION_SOURCES);

export const recordedByValidator = v.union(
  v.object({ kind: v.literal("member"), memberId: v.id("members") }),
  /** The person themselves, for example by replying STOP. */
  v.object({ kind: v.literal("recipient") }),
  v.object({ kind: v.literal("system") }),
);
export type RecordedBy = typeof recordedByValidator.type;

export const SUPPRESSION_SCOPES = ["all", "operational", "marketing", "recruiting"] as const;
export type SuppressionScope = (typeof SUPPRESSION_SCOPES)[number];
export const suppressionScopeValidator = literals(SUPPRESSION_SCOPES);

export const SUPPRESSION_REASONS = ["stop_keyword", "unsubscribe", "natural_language", "manual", "bounce", "complaint"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];
export const suppressionReasonValidator = literals(SUPPRESSION_REASONS);

/** Where a send started. A person sending by hand is "manual"; every other origin is automation. */
export const ORIGINS = ["agent", "manual", "bulk", "follow_up", "win_back", "recruiting", "dispatch", "integration"] as const;
export type Origin = (typeof ORIGINS)[number];
export const originValidator = literals(ORIGINS);

/** A direct answer to a keyword the person just texted. */
export const REPLY_KINDS = ["stop", "help", "start"] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];
export const replyKindValidator = literals(REPLY_KINDS);

/** suspended: it was approved, and the carriers have since suspended or expired it. Texts stop until it is restored. */
export const REGISTRATION_STATUSES = ["not_started", "submitted", "approved", "rejected", "suspended"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];
export const registrationStatusValidator = literals(REGISTRATION_STATUSES);

export const countryValidator = v.union(v.literal("US"), v.literal("CA"));

export const companyAddressValidator = v.object({
  line1: v.string(),
  line2: v.optional(v.string()),
  city: v.string(),
  region: v.string(),
  postalCode: v.string(),
  country: countryValidator,
});

export const representativeValidator = v.object({ name: v.string(), title: v.string(), email: v.string() });

export const identityValidator = v.object({
  legalName: v.optional(v.string()),
  tradingName: v.optional(v.string()),
  address: v.optional(companyAddressValidator),
  representative: v.optional(representativeValidator),
  supportEmail: v.optional(v.string()),
  /** E.164, for example +15125550100. */
  supportPhone: v.optional(v.string()),
});
export type Identity = typeof identityValidator.type;

export const quietHoursValidator = v.object({
  /** HH:MM on the company's clock. The window may run past midnight, for example 21:00 to 08:00. */
  start: v.string(),
  end: v.string(),
  appliesToOperational: v.boolean(),
});
export type QuietHours = typeof quietHoursValidator.type;

export const frequencyValidator = v.object({ marketingPerWeek: v.number(), recruitingPerWeek: v.number() });
export type Frequency = typeof frequencyValidator.type;

export const registrationValidator = v.object({
  status: registrationStatusValidator,
  /** The provider's reference for the registration, when there is one. */
  reference: v.optional(v.string()),
  updatedAt: v.number(),
  /** An owner may record only not_started or submitted. Approved and rejected are set by Selestial staff. */
  updatedBy: v.union(v.literal("owner"), v.literal("staff")),
  note: v.optional(v.string()),
  /**
   * Who the approved registration covers: each audience and category of text it was filed for. Absent on
   * registrations recorded before coverage existed, which keep sending exactly as they did.
   */
  coverage: v.optional(v.array(v.object({ audience: literals(RECIPIENT_KINDS), category: categoryValidator }))),
  activities: v.optional(v.array(v.string())),
});
export type Registration = typeof registrationValidator.type;

export const messagingSetupValidator = v.object({
  /** The business name every text starts with or names. */
  senderName: v.optional(v.string()),
  /** The company's texting number, E.164. Inbound texts find the company by it. */
  smsNumber: v.optional(v.string()),
  emailFromAddress: v.optional(v.string()),
  registration: registrationValidator,
  /** Null means no quiet hours. */
  quietHours: v.union(v.null(), quietHoursValidator),
  frequency: frequencyValidator,
});
export type MessagingSetup = typeof messagingSetupValidator.type;

/**
 * A cleaning company's request for a texting number and its carrier registration. The Owner asks;
 * Selestial staff approve, because buying the number and filing the registration are charged to
 * Selestial's Telnyx account. Each step's Telnyx reference is kept so a retry continues, never repeats.
 */
export const TEXTING_REQUEST_STATUSES = ["requested", "approved", "provisioning", "waiting_on_carriers", "needs_you", "active", "interrupted", "failed", "rejected", "cancelled"] as const;
export type TextingRequestStatus = (typeof TEXTING_REQUEST_STATUSES)[number];

export const brandDetailsValidator = v.object({
  displayName: v.string(),
  companyName: v.string(),
  /** Older requests only. New requests keep the tax ID sealed on the request (taxIdSealed), never readable here. */
  ein: v.optional(v.string()),
  phone: v.string(),
  street: v.string(),
  city: v.string(),
  state: v.string(),
  postalCode: v.string(),
  email: v.string(),
  website: v.string(),
  vertical: v.string(),
  /** A sole proprietor's own name and mobile number. The mobile receives the carriers' one-time code. */
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  mobilePhone: v.optional(v.string()),
  stockSymbol: v.optional(v.string()),
  stockExchange: v.optional(v.string()),
});

/** One number a search found. `features` is what Telnyx says the number can do (sms, mms, voice). */
export const numberResultValidator = v.object({
  phoneNumber: v.string(),
  locality: v.union(v.string(), v.null()),
  region: v.union(v.string(), v.null()),
  upfrontCents: v.union(v.number(), v.null()),
  monthlyCents: v.union(v.number(), v.null()),
  features: v.optional(v.array(v.string())),
});

export const complianceTables = {
  textingRequests: defineTable({
    companyId: v.id("companies"),
    status: literals(TEXTING_REQUEST_STATUSES),
    /** The number the Owner chose, and what Telnyx said it costs when they chose it. */
    phoneNumber: v.string(),
    upfrontCents: v.optional(v.number()),
    monthlyCents: v.optional(v.number()),
    brand: brandDetailsValidator,
    /** The consent wording the campaign is filed with. It is also kept on file as the company's work-text wording. */
    consentWording: v.string(),
    requestedBy: v.id("members"),
    requestedAt: v.number(),
    decidedAt: v.optional(v.number()),
    decidedBy: v.optional(v.id("staff")),
    note: v.optional(v.string()),
    /** Where provisioning stands, in words, and the step it is on. */
    step: v.optional(v.string()),
    problem: v.optional(v.string()),
    numberOrderId: v.optional(v.string()),
    brandId: v.optional(v.string()),
    campaignId: v.optional(v.string()),
    assignedAt: v.optional(v.number()),
    lastCheckedAt: v.optional(v.number()),
    activeAt: v.optional(v.number()),
    /** The Owner's authorization for the number's monthly fee and the registration fees, in the exact words shown. */
    fees: v.optional(v.object({ authorizedAt: v.number(), authorizedBy: v.id("members"), wording: v.string() })),
    /** The last calendar month ("YYYY-MM") the monthly number fee was charged for. */
    feeMonth: v.optional(v.string()),
    // ── Guided setup (convex/textingSetup.ts). Absent on requests made with the older form. ──
    setupId: v.optional(v.id("textingSetups")),
    /** The submission this request is working from (textingSubmissions.version). A correction raises it. */
    submissionVersion: v.optional(v.number()),
    entityType: v.optional(v.string()),
    usecase: v.optional(v.string()),
    subUsecases: v.optional(v.array(v.string())),
    activities: v.optional(v.array(v.string())),
    privacyLink: v.optional(v.string()),
    termsLink: v.optional(v.string()),
    signupLink: v.optional(v.string()),
    samples: v.optional(v.array(v.string())),
    drafts: v.optional(v.record(v.string(), v.string())),
    taxIdSealed: v.optional(v.string()),
    taxIdLast4: v.optional(v.string()),
    /** The registration prices the owner authorized (convex/lib/texting/prices.ts). */
    pricesVersion: v.optional(v.string()),
    /** The customer_reference of the current number order, so a retry finds the order instead of buying again. */
    orderReference: v.optional(v.string()),
    numberOrderedAt: v.optional(v.number()),
    /** When a call that creates something at Telnyx was last attempted. With no reference saved yet, the outcome is uncertain: look before trying again. */
    orderAttemptAt: v.optional(v.number()),
    brandAttemptAt: v.optional(v.number()),
    campaignAttemptAt: v.optional(v.number()),
    /** The submission version last filed with the carriers, and what was filed, to tell what a correction changed. */
    filedVersion: v.optional(v.number()),
    brandShape: v.optional(v.string()),
    campaignShape: v.optional(v.string()),
    /** One provisioning pass at a time: a pass holds this until it finishes or the time passes. */
    leaseUntil: v.optional(v.number()),
    leaseToken: v.optional(v.string()),
    /** The referenceId of the current campaign filing, unique per filing. */
    campaignReference: v.optional(v.string()),
    brandVerifiedAt: v.optional(v.number()),
    campaignFiledAt: v.optional(v.number()),
    campaignApprovedAt: v.optional(v.number()),
    /** A sole proprietor's one-time code: when it was sent, its reference, and when it was confirmed. */
    otp: v.optional(v.object({ referenceId: v.optional(v.string()), sentAt: v.number(), verifiedAt: v.optional(v.number()), attempts: v.number() })),
    /** What the owner must do, in plain words, while status is needs_you. Their earlier answers are kept. */
    needs: v.optional(v.object({ kind: v.union(v.literal("correction"), v.literal("code"), v.literal("number")), words: v.string(), fields: v.array(v.string()), at: v.number() })),
    /** How many corrected registrations have been filed. Each one is charged once (prices.resubmission). */
    resubmissions: v.optional(v.number()),
    registrationMonth: v.optional(v.string()),
    /** Raw provider states for Selestial staff. Never shown to the owner. */
    diagnostics: v.optional(v.object({ brand: v.optional(v.string()), campaign: v.optional(v.string()), assignment: v.optional(v.string()), order: v.optional(v.string()), at: v.number() })),
    /** When anything about this request last changed, for "last update" on each milestone. */
    updatedAt: v.optional(v.number()),
  })
    .index("by_company_requested", ["companyId", "requestedAt"])
    .index("by_status_requested", ["status", "requestedAt"])
    .index("by_brand", ["brandId"])
    .index("by_campaign", ["campaignId"]),

  /** One search for numbers an Owner can pick from. Results are shown to that company only. */
  numberSearches: defineTable({
    companyId: v.id("companies"),
    areaCode: v.string(),
    status: v.union(v.literal("pending"), v.literal("done"), v.literal("failed")),
    results: v.optional(v.array(numberResultValidator)),
    /** Set when the area code had no numbers and the results come from elsewhere in this state instead. */
    nearbyRegion: v.optional(v.string()),
    problem: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_company_created", ["companyId", "createdAt"]),

  /** One per company: who the company is and how it sends. Recipient choices are not here. */
  complianceProfiles: defineTable({
    companyId: v.id("companies"),
    identity: identityValidator,
    messaging: messagingSetupValidator,
    updatedAt: v.number(),
  })
    .index("by_company", ["companyId"])
    .index("by_sms_number", ["messaging.smsNumber"]),

  /** The exact wording a recipient was shown and agreed to. Never edited: new text is a new version. */
  consentDisclosures: defineTable({
    companyId: v.id("companies"),
    channel: channelValidator,
    category: categoryValidator,
    text: v.string(),
    version: v.number(),
    createdAt: v.number(),
    createdBy: v.id("members"),
  })
    .index("by_company_channel_category", ["companyId", "channel", "category", "version"])
    .index("by_company_created", ["companyId", "createdAt"]),

  /** The current answer, one row per company, recipient, channel and category. Every change is also in permissionHistory. */
  contactPermissions: defineTable({
    companyId: v.id("companies"),
    recipient: recipientValidator,
    channel: channelValidator,
    category: categoryValidator,
    status: permissionStatusValidator,
    source: permissionSourceValidator,
    disclosureId: v.optional(v.id("consentDisclosures")),
    /** The wording, kept as shown, when there is no disclosure record to point at. */
    disclosureText: v.optional(v.string()),
    /** Where the proof is kept, for example "signed onboarding form in the office drawer". */
    evidence: v.optional(v.string()),
    recordedBy: recordedByValidator,
    /** Set when the withdrawal came from a STOP reply, so only START undoes it. */
    stopKeyword: v.optional(v.boolean()),
    at: v.number(),
  })
    .index("by_company_recipient", ["companyId", "recipient.kind", "recipient.id", "channel", "category"])
    .index("by_company_channel_category", ["companyId", "channel", "category"]),

  /** Append-only: a copy of every change to a permission, with what it was before. Never changed or removed. */
  permissionHistory: defineTable({
    companyId: v.id("companies"),
    permissionId: v.id("contactPermissions"),
    recipient: recipientValidator,
    channel: channelValidator,
    category: categoryValidator,
    status: permissionStatusValidator,
    previousStatus: v.union(v.null(), permissionStatusValidator),
    source: permissionSourceValidator,
    disclosureId: v.optional(v.id("consentDisclosures")),
    disclosureText: v.optional(v.string()),
    evidence: v.optional(v.string()),
    recordedBy: recordedByValidator,
    stopKeyword: v.optional(v.boolean()),
    at: v.number(),
  })
    .index("by_company_recipient_at", ["companyId", "recipient.kind", "recipient.id", "at"])
    .index("by_permission_at", ["permissionId", "at"]),

  /**
   * An address that must not be sent to. Kept by the address itself (E.164 for texts, lower case for
   * email), not by provider, so switching providers cannot get around it. No IP or device data is kept.
   */
  suppressions: defineTable({
    companyId: v.id("companies"),
    channel: channelValidator,
    address: v.string(),
    scope: suppressionScopeValidator,
    reason: suppressionReasonValidator,
    at: v.number(),
    /** The first 200 characters of what the person wrote, with any link taken out. */
    sourceMessage: v.optional(v.string()),
    note: v.optional(v.string()),
    liftedAt: v.optional(v.number()),
    liftedBy: v.optional(recordedByValidator),
    liftNote: v.optional(v.string()),
  })
    .index("by_company_channel_address", ["companyId", "channel", "address"])
    .index("by_company_at", ["companyId", "at"])
    .index("by_company_channel_at", ["companyId", "channel", "at"]),

  /** Append-only: a company accepting one exact version of a Selestial agreement. */
  agreementAcceptances: defineTable({
    companyId: v.id("companies"),
    documentId: v.string(),
    kind: literals(DOCUMENT_KINDS),
    acceptedBy: v.object({ memberId: v.id("members"), userId: v.string() }),
    at: v.number(),
  })
    .index("by_company_document", ["companyId", "documentId"])
    .index("by_company_at", ["companyId", "at"]),

  /**
   * What each planned message was for, so the policy can be asked again at the moment of sending and
   * the weekly limits can be counted. One row per message.
   */
  sendIntents: defineTable({
    companyId: v.id("companies"),
    messageId: v.id("messages"),
    channel: channelValidator,
    address: v.string(),
    category: categoryValidator,
    origin: originValidator,
    agent: v.optional(agentValidator),
    recipient: v.optional(recipientValidator),
    reply: v.optional(replyKindValidator),
    at: v.number(),
  })
    .index("by_message", ["messageId"])
    .index("by_company_address_category_at", ["companyId", "channel", "address", "category", "at"]),
};
