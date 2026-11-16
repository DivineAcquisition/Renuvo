/**
 * The company Google connection's records. Every table carries `companyId` and is read through an index
 * that starts with it. Tokens are sealed; nothing a browser can read holds one.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { literals } from "../statuses";
import { FEATURES } from "./features";

export const featureValidator = literals(FEATURES);

export const CONNECTION_STATUS = ["connected", "expired", "disconnected"] as const;
export const RESOURCE_KINDS = ["drive_source", "drive_output", "calendar_sync", "calendar_busy", "business_location", "ads_account", "conversion_destination"] as const;
export const resourceKindValidator = literals(RESOURCE_KINDS);
export const JOB_STATUS = ["queued", "running", "done", "failed", "uncertain", "cancelled"] as const;
export const jobStatusValidator = literals(JOB_STATUS);
export const JOB_KINDS = ["drive_upload", "doc_export", "sheet_export", "calendar_sync", "calendar_event", "review_reply", "ads_campaign", "ads_activate", "conversion", "lsa_poll", "gmail_watch", "calendar_watch", "business_watch", "knowledge_import", "route_proposal", "busy_refresh", "reviews_sync", "ads_snapshot", "travel_refresh"] as const;
export const jobKindValidator = literals(JOB_KINDS);

export const googleTables = {
  googleConnections: defineTable({
    companyId: v.id("companies"),
    /** Google's stable id for the account, and its address. One company may have one active connection. */
    googleSub: v.string(),
    email: v.string(),
    status: literals(CONNECTION_STATUS),
    grantedScopes: v.array(v.string()),
    problem: v.optional(v.string()),
    connectedBy: v.id("members"),
    connectedAt: v.number(),
    lastRefreshAt: v.optional(v.number()),
    disconnectedAt: v.optional(v.number()),
  }).index("by_company", ["companyId"]),

  googleCredentials: defineTable({
    companyId: v.id("companies"),
    connectionId: v.id("googleConnections"),
    /** AES-GCM sealed, bound to the connection id. */
    sealedRefreshToken: v.string(),
    createdAt: v.number(),
  }).index("by_connection", ["connectionId"]),

  googleOAuthStates: defineTable({
    companyId: v.id("companies"),
    memberId: v.id("members"),
    stateHash: v.string(),
    features: v.array(featureValidator),
    /** Set when adding features to an existing connection; the account must be the same one. */
    connectionId: v.optional(v.id("googleConnections")),
    /** The app address the Owner started from, already checked (returnOrigin). */
    returnOrigin: v.optional(v.string()),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  }).index("by_stateHash", ["stateHash"]),

  /** What the Owner authorized Selestial to use: specific files, folders, calendars, locations and accounts. */
  googleResources: defineTable({
    companyId: v.id("companies"),
    connectionId: v.id("googleConnections"),
    kind: resourceKindValidator,
    externalId: v.string(),
    label: v.string(),
    /** For outputs: what is saved there (photos, resumes, agreements, reports, creative). */
    purpose: v.optional(v.string()),
    /** The mime type for Drive, the time zone for a calendar, the login customer for Ads. */
    detail: v.optional(v.string()),
    /** Whether Selestial confirmed it can actually reach it, and when. */
    access: v.union(v.literal("verified"), v.literal("unverified"), v.literal("lost")),
    accessNote: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    addedBy: v.id("members"),
    createdAt: v.number(),
  })
    .index("by_company_kind", ["companyId", "kind"])
    .index("by_connection", ["connectionId"]),

  /**
   * Durable work for Google. One row per intended effect, keyed so the same effect is never queued twice.
   * A write that ended uncertain is reconciled by its key before it is tried again.
   */
  googleJobs: defineTable({
    companyId: v.id("companies"),
    connectionId: v.optional(v.id("googleConnections")),
    kind: jobKindValidator,
    key: v.string(),
    status: jobStatusValidator,
    payload: v.string(),
    attempts: v.number(),
    nextAt: v.number(),
    checkpoint: v.optional(v.string()),
    providerRef: v.optional(v.string()),
    result: v.optional(v.string()),
    lastError: v.optional(v.string()),
    requestedBy: v.optional(v.id("members")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_key", ["companyId", "key"])
    .index("by_status_next", ["status", "nextAt"])
    .index("by_company_status", ["companyId", "status", "updatedAt"]),

  /** One Selestial record mirrored as one Google Calendar event, so a sync updates rather than duplicates. */
  googleCalendarLinks: defineTable({
    companyId: v.id("companies"),
    calendarId: v.string(),
    subject: v.union(v.object({ table: v.literal("jobs"), id: v.id("jobs") }), v.object({ table: v.literal("interviews"), id: v.id("interviews") })),
    subjectId: v.string(),
    eventId: v.string(),
    /** A hash of what Selestial last wrote, so only a real change is sent. */
    writtenHash: v.string(),
    /** When the event was changed or deleted in Google by someone else. */
    externalChange: v.optional(v.union(v.literal("moved"), v.literal("deleted"), v.literal("edited"))),
    updatedAt: v.number(),
  })
    .index("by_company_subject", ["companyId", "subjectId"])
    .index("by_company_event", ["companyId", "eventId"]),

  /** Push channels: Calendar watch channels, Gmail and Business Profile notifications. */
  googleWatches: defineTable({
    companyId: v.id("companies"),
    connectionId: v.id("googleConnections"),
    kind: v.union(v.literal("calendar"), v.literal("business")),
    target: v.string(),
    channelId: v.string(),
    resourceId: v.optional(v.string()),
    tokenHash: v.string(),
    expiresAt: v.number(),
    syncToken: v.optional(v.string()),
    lastNotifiedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_channel", ["channelId"])
    .index("by_company", ["companyId"])
    .index("by_expires", ["expiresAt"]),

  googleReviews: defineTable({
    companyId: v.id("companies"),
    location: v.string(),
    reviewName: v.string(),
    reviewer: v.string(),
    stars: v.number(),
    comment: v.optional(v.string()),
    createdAt: v.number(),
    existingReply: v.optional(v.string()),
    draft: v.optional(v.string()),
    draftBy: v.optional(v.union(v.literal("person"), v.literal("assistant"))),
    state: v.union(v.literal("new"), v.literal("drafted"), v.literal("approved"), v.literal("publishing"), v.literal("published"), v.literal("failed")),
    approvedBy: v.optional(v.id("members")),
    approvedText: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    problem: v.optional(v.string()),
    seenAt: v.number(),
  })
    .index("by_company_review", ["companyId", "reviewName"])
    .index("by_company_created", ["companyId", "createdAt"]),

  /** A lead from a Google lead form or Local Services Ads. The source's own id dedupes it. */
  googleLeads: defineTable({
    companyId: v.id("companies"),
    source: v.union(v.literal("lead_form"), v.literal("local_services")),
    externalId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    /** The Google click id, kept only to report a booked job back to the ad that brought it. */
    gclid: v.optional(v.string()),
    campaign: v.optional(v.string()),
    customerId: v.optional(v.id("customers")),
    taskId: v.optional(v.id("tasks")),
    /** Google's "send test data": kept so the connection can be checked, never turned into a customer. */
    test: v.optional(v.boolean()),
    receivedAt: v.number(),
  })
    .index("by_company_external", ["companyId", "source", "externalId"])
    .index("by_company_received", ["companyId", "receivedAt"])
    .index("by_company_customer", ["companyId", "customerId"]),

  /** The lead-form webhook key, hashed. Google sends it with every lead; anything without it is refused. */
  googleLeadKeys: defineTable({
    companyId: v.id("companies"),
    keyHash: v.string(),
    createdBy: v.id("members"),
    createdAt: v.number(),
  })
    .index("by_company", ["companyId"])
    .index("by_keyHash", ["keyHash"]),

  googleConversions: defineTable({
    companyId: v.id("companies"),
    jobId: v.id("jobs"),
    leadId: v.id("googleLeads"),
    transactionId: v.string(),
    valueCents: v.number(),
    status: v.union(v.literal("queued"), v.literal("sent"), v.literal("rejected"), v.literal("skipped")),
    reason: v.optional(v.string()),
    diagnostics: v.optional(v.string()),
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
  })
    .index("by_company_job", ["companyId", "jobId"])
    .index("by_company_created", ["companyId", "createdAt"]),

  googleAdDrafts: defineTable({
    companyId: v.id("companies"),
    accountId: v.string(),
    name: v.string(),
    dailyBudgetCents: v.number(),
    keywords: v.array(v.string()),
    postalCodes: v.array(v.string()),
    headline: v.string(),
    description: v.string(),
    finalUrl: v.string(),
    state: v.union(v.literal("draft"), v.literal("approved"), v.literal("created_paused"), v.literal("active"), v.literal("failed")),
    googleCampaign: v.optional(v.string()),
    approvedBy: v.optional(v.id("members")),
    approvedBudgetCents: v.optional(v.number()),
    activatedBy: v.optional(v.id("members")),
    problem: v.optional(v.string()),
    createdBy: v.optional(v.id("members")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_company_updated", ["companyId", "updatedAt"]),

  /** What the Owner can choose from (calendars, locations, ad accounts, a folder's readable files), as Google last listed it. */
  googleChoices: defineTable({
    companyId: v.id("companies"),
    kind: v.union(v.literal("calendars"), v.literal("locations"), v.literal("ads_accounts"), v.literal("folder_contents")),
    scope: v.optional(v.string()),
    items: v.array(v.object({ id: v.string(), label: v.string(), detail: v.optional(v.string()) })),
    problem: v.optional(v.string()),
    fetchedAt: v.number(),
  }).index("by_company_kind", ["companyId", "kind"]),

  /** Busy times from the calendars the Owner chose, refreshed on a timer, so scheduling can check them without waiting on Google. */
  googleBusy: defineTable({
    companyId: v.id("companies"),
    calendarId: v.string(),
    from: v.number(),
    to: v.number(),
    busy: v.array(v.object({ start: v.number(), end: v.number() })),
    problem: v.optional(v.string()),
    fetchedAt: v.number(),
  }).index("by_company_calendar", ["companyId", "calendarId"]),

  /** Results by campaign for an authorized ad account, as of when it was read. */
  googleAdsSnapshots: defineTable({
    companyId: v.id("companies"),
    accountId: v.string(),
    rows: v.array(v.object({ campaign: v.string(), status: v.string(), impressions: v.number(), clicks: v.number(), costMicros: v.number(), conversions: v.number() })),
    fetchedAt: v.number(),
  }).index("by_company_account", ["companyId", "accountId"]),

  /** Drive times between two points, as Routes last answered, keyed by rounded coordinates. */
  googleTravel: defineTable({
    companyId: v.id("companies"),
    pairKey: v.string(),
    seconds: v.optional(v.number()),
    meters: v.optional(v.number()),
    ok: v.boolean(),
    fetchedAt: v.number(),
  }).index("by_company_pair", ["companyId", "pairKey"]),

  /** Text read from a Drive file the Owner chose as a knowledge source, as of when it was read. */
  googleDriveTexts: defineTable({
    companyId: v.id("companies"),
    resourceId: v.id("googleResources"),
    fileId: v.string(),
    name: v.string(),
    text: v.string(),
    fetchedAt: v.number(),
  })
    .index("by_company_resource", ["companyId", "resourceId"])
    .index("by_company_file", ["companyId", "fileId"]),

  /** Company-level Google settings that are not resources: conversion consent basis. */
  googleSettings: defineTable({
    companyId: v.id("companies"),
    /** The Owner's statement of the consent basis for sending conversions. Absent means none is sent. */
    conversionConsent: v.optional(v.object({ adUserData: v.boolean(), adPersonalization: v.boolean(), basis: v.string(), recordedBy: v.id("members"), recordedAt: v.number() })),
    updatedAt: v.number(),
  }).index("by_company", ["companyId"]),
};
