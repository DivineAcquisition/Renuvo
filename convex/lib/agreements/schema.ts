/**
 * The agreements record. Every table carries `companyId` and is read through an index that starts with it.
 *
 * Four things are kept apart on purpose:
 *  - drafting: versions, which are immutable once saved (agreementVersions);
 *  - workflow: who reviewed, approved, sent and signed which exact version (`workflow` and the request rows);
 *  - lifecycle: whether the agreement is in force, renewing, ended or replaced (`lifecycle`);
 *  - provenance: whether a signature came through a signing provider or was verified by a person from an uploaded file.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { literals } from "../statuses";

export const WORKFLOW = ["draft", "needs_review", "approved", "sent", "partially_signed", "signed", "declined", "withdrawn", "expired", "delivery_failed"] as const;
export type Workflow = (typeof WORKFLOW)[number];
export const workflowValidator = literals(WORKFLOW);

export const ACCESS = ["company", "workforce", "restricted"] as const;
export const accessValidator = literals(ACCESS);

export const CATEGORIES = ["customer", "workforce", "supporting", "business"] as const;
export const categoryValidator = literals(CATEGORIES);

export const ORIGINS = ["chat", "template", "upload", "manual", "amendment"] as const;
export const originValidator = literals(ORIGINS);

/** unsigned: no signature exists. selestial_signed: a signing provider reported every required signature. externally_signed: signed elsewhere, uploaded, and verified by a named person. */
export const PROVENANCE = ["unsigned", "provider_signed", "externally_signed"] as const;
export const provenanceValidator = literals(PROVENANCE);

export const TEMPLATE_STATUS = ["draft", "in_review", "approved", "archived"] as const;
export const templateStatusValidator = literals(TEMPLATE_STATUS);

export const REQUEST_STATUS = ["queued", "sent", "partially_signed", "completed", "declined", "withdrawn", "expired", "failed"] as const;
export type RequestStatus = (typeof REQUEST_STATUS)[number];
export const requestStatusValidator = literals(REQUEST_STATUS);

export const SIGNER_STATUS = ["pending", "delivered", "viewed", "signed", "declined", "bounced"] as const;
export const signerStatusValidator = literals(SIGNER_STATUS);

export const termValueValidator = v.union(v.string(), v.number(), v.boolean(), v.array(v.string()));
export const termsValidator = v.record(v.string(), termValueValidator);

export const partyValidator = v.object({
  /** For example "company", "customer", "worker", "witness". */
  role: v.string(),
  name: v.string(),
  email: v.optional(v.string()),
  /** True when this person must sign. */
  signer: v.boolean(),
  /** Signing order where the provider supports it. Lower goes first. */
  order: v.optional(v.number()),
  /** The Selestial record this party is. */
  record: v.optional(v.object({ table: v.union(v.literal("customers"), v.literal("cleaners"), v.literal("applications")), id: v.string() })),
});
export type Party = typeof partyValidator.type;

export const clauseValidator = v.object({
  key: v.string(),
  version: v.number(),
  title: v.string(),
  body: v.string(),
  flags: v.optional(v.array(v.string())),
  when: v.optional(v.string()),
  unless: v.optional(v.string()),
});

export const customVarValidator = v.object({
  key: v.string(),
  label: v.string(),
  type: literals(["text", "longtext", "money", "date", "int", "bool", "choice", "list"] as const),
  group: v.string(),
  ask: v.string(),
  choices: v.optional(v.array(v.string())),
});

export const lifecycleValidator = v.object({
  /** Dates are on the company's calendar, YYYY-MM-DD. */
  effectiveOn: v.optional(v.string()),
  termMonths: v.optional(v.number()),
  renewalOn: v.optional(v.string()),
  expiresOn: v.optional(v.string()),
  terminatedOn: v.optional(v.string()),
  terminationNote: v.optional(v.string()),
  /** The agreement that replaces this one. */
  supersededBy: v.optional(v.id("agreements")),
});
export type Lifecycle = typeof lifecycleValidator.type;

export const authorValidator = v.union(v.object({ kind: v.literal("member"), memberId: v.id("members") }), v.object({ kind: v.literal("assistant"), runId: v.id("chatRuns") }), v.object({ kind: v.literal("system") }));

export const agreementTables = {
  agreements: defineTable({
    companyId: v.id("companies"),
    title: v.string(),
    docType: v.string(),
    category: categoryValidator,
    access: accessValidator,
    workflow: workflowValidator,
    lifecycle: lifecycleValidator,
    currentVersion: v.number(),
    /** The version a person approved, and the hash it had. Cleared when the text changes. */
    approvedVersion: v.optional(v.number()),
    approvedHash: v.optional(v.string()),
    approvedBy: v.optional(v.id("members")),
    approvedAt: v.optional(v.number()),
    /** Scale: a second, different person must also approve. */
    secondApprovedBy: v.optional(v.id("members")),
    requiresSecondApproval: v.optional(v.boolean()),
    reviewRequestedBy: v.optional(v.id("members")),
    sentVersion: v.optional(v.number()),
    signedVersion: v.optional(v.number()),
    /** What the answers are. Never the whole story: the words are in the versions. */
    terms: termsValidator,
    /** Terms the owner marked as genuinely unresolved, to be settled in review. */
    skipped: v.array(v.string()),
    /** Material assumptions the owner confirmed, with who and when. */
    assumptions: v.array(v.object({ text: v.string(), confirmedBy: v.optional(v.id("members")), at: v.number() })),
    /** Where a prefilled fact came from, by term, so the owner can see and correct it. */
    sources: v.record(v.string(), v.string()),
    parties: v.array(partyValidator),
    governingState: v.optional(v.string()),
    /** The clauses this agreement is built from, copied at creation. */
    kit: v.object({ clauses: v.array(clauseValidator), extra: v.optional(v.array(customVarValidator)) }),
    sourceTemplate: v.optional(v.object({ kind: v.union(v.literal("catalog"), v.literal("company")), key: v.string(), templateId: v.optional(v.id("agreementTemplates")), version: v.optional(v.number()) })),
    conversationId: v.optional(v.id("conversations")),
    origin: originValidator,
    provenance: provenanceValidator,
    /** For an externally signed upload: who checked it, and what they checked. */
    externalVerification: v.optional(v.object({ verifiedBy: v.id("members"), verifiedAt: v.number(), signedOn: v.optional(v.string()), signers: v.array(v.string()), note: v.string() })),
    originalFileId: v.optional(v.id("agreementFiles")),
    supersedes: v.optional(v.id("agreements")),
    /** Names, types, party names and linked-record labels. Never the document's words or any term. */
    searchText: v.string(),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
    archiveReason: v.optional(v.string()),
  })
    .index("by_company_updated", ["companyId", "updatedAt"])
    .index("by_company_workflow", ["companyId", "workflow", "updatedAt"])
    .index("by_company_conversation", ["companyId", "conversationId"])
    .index("by_company_renewal", ["companyId", "lifecycle.renewalOn"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["companyId", "access"] }),

  /** Immutable. A change is a new row; approval and signatures name one row and its hash. */
  agreementVersions: defineTable({
    companyId: v.id("companies"),
    agreementId: v.id("agreements"),
    version: v.number(),
    title: v.string(),
    markdown: v.string(),
    hash: v.string(),
    clauses: v.array(v.object({ key: v.string(), version: v.number() })),
    terms: termsValidator,
    unresolved: v.array(v.string()),
    author: authorValidator,
    note: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_company_agreement_version", ["companyId", "agreementId", "version"]),

  /** Links between an agreement and the records it is about, so a record can list its agreements. */
  agreementLinks: defineTable({
    companyId: v.id("companies"),
    agreementId: v.id("agreements"),
    table: v.union(v.literal("customers"), v.literal("properties"), v.literal("cleaners"), v.literal("jobs"), v.literal("applications")),
    recordId: v.string(),
    label: v.string(),
    access: accessValidator,
  })
    .index("by_company_record", ["companyId", "table", "recordId"])
    .index("by_company_agreement", ["companyId", "agreementId"]),

  agreementComments: defineTable({
    companyId: v.id("companies"),
    agreementId: v.id("agreements"),
    version: v.number(),
    memberId: v.id("members"),
    text: v.string(),
    /** Review notes can be resolved; a comment is never deleted. */
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_company_agreement", ["companyId", "agreementId", "createdAt"]),

  agreementTemplates: defineTable({
    companyId: v.id("companies"),
    title: v.string(),
    docType: v.string(),
    status: templateStatusValidator,
    currentVersion: v.number(),
    approvedVersion: v.optional(v.number()),
    approvedBy: v.optional(v.id("members")),
    /** Evidence a person recorded that a lawyer or specialist reviewed this version. Selestial never infers it. */
    review: v.optional(v.object({ version: v.number(), reviewer: v.string(), reviewedOn: v.string(), note: v.optional(v.string()), recordedBy: v.id("members") })),
    /** Services or engagements this template is the default for. */
    defaultFor: v.array(v.string()),
    sourceCatalogKey: v.optional(v.string()),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_status", ["companyId", "status", "updatedAt"])
    .index("by_company_doctype", ["companyId", "docType"]),

  agreementTemplateVersions: defineTable({
    companyId: v.id("companies"),
    templateId: v.id("agreementTemplates"),
    version: v.number(),
    clauses: v.array(clauseValidator),
    extra: v.array(customVarValidator),
    note: v.optional(v.string()),
    authorId: v.id("members"),
    createdAt: v.number(),
  }).index("by_company_template_version", ["companyId", "templateId", "version"]),

  /** An uploaded original. Kept as it was received; extraction and classification are separate and may fail. */
  agreementFiles: defineTable({
    companyId: v.id("companies"),
    agreementId: v.optional(v.id("agreements")),
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
    sha256: v.optional(v.string()),
    /** "agreement" becomes an agreements row. "supporting" is a record kept beside agreements, never mislabeled as one. */
    classification: v.union(v.literal("unclassified"), v.literal("agreement"), v.literal("supporting")),
    supportingKind: v.optional(v.string()),
    access: accessValidator,
    /** pending: not inspected yet. rejected: failed validation, and the stored bytes were removed. */
    extraction: v.object({ state: v.union(v.literal("pending"), v.literal("read"), v.literal("failed"), v.literal("not_supported"), v.literal("rejected")), note: v.optional(v.string()) }),
    /** The extracted text, held only until the person finalizes the upload. */
    text: v.optional(v.string()),
    suggestion: v.optional(v.object({ classification: v.string(), docType: v.optional(v.string()), supportingKind: v.optional(v.string()), confidence: v.string(), reasons: v.array(v.string()) })),
    /** Selestial does not scan files for malware. This says so instead of implying a clean result. */
    scan: v.literal("not_scanned"),
    linked: v.optional(v.object({ table: v.union(v.literal("customers"), v.literal("properties"), v.literal("cleaners"), v.literal("jobs"), v.literal("applications")), id: v.string(), label: v.string() })),
    expiresOn: v.optional(v.string()),
    uploadedBy: v.id("members"),
    createdAt: v.number(),
  })
    .index("by_company_created", ["companyId", "createdAt"])
    .index("by_company_agreement", ["companyId", "agreementId"])
    .index("by_storage", ["storageId"]),

  agreementSignatureRequests: defineTable({
    companyId: v.id("companies"),
    agreementId: v.id("agreements"),
    /** The exact version and hash the signers were shown. */
    version: v.number(),
    hash: v.string(),
    provider: v.string(),
    providerRequestId: v.optional(v.string()),
    status: requestStatusValidator,
    signers: v.array(v.object({ role: v.string(), name: v.string(), email: v.string(), order: v.number(), status: signerStatusValidator, deliveredAt: v.optional(v.number()), viewedAt: v.optional(v.number()), signedAt: v.optional(v.number()), problem: v.optional(v.string()) })),
    expiresAt: v.number(),
    sentBy: v.id("members"),
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    withdrawnAt: v.optional(v.number()),
    problem: v.optional(v.string()),
    /** The completed document as the provider returned it, and its hash. */
    signedFileId: v.optional(v.id("_storage")),
    signedFileHash: v.optional(v.string()),
    evidenceNote: v.optional(v.string()),
    reminders: v.number(),
    lastReminderAt: v.optional(v.number()),
    replacedBy: v.optional(v.id("agreementSignatureRequests")),
  })
    .index("by_company_agreement", ["companyId", "agreementId", "createdAt"])
    .index("by_company_status", ["companyId", "status", "expiresAt"])
    .index("by_provider_request", ["provider", "providerRequestId"])
    .index("by_status_expires", ["status", "expiresAt"]),

  /** Provider events already handled, so a delivery that arrives twice changes nothing the second time. */
  agreementProviderEvents: defineTable({
    provider: v.string(),
    eventId: v.string(),
    at: v.number(),
  }).index("by_provider_event", ["provider", "eventId"]),
};
