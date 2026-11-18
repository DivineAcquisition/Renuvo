/**
 * Clients & Properties: the one directory of the company's clients, shared by Sales, Dispatch, Retention,
 * Agreements and Finance. The client (`customers`) and its properties stay the records every other module
 * already points at; this module adds what a relationship needs around them and never copies them:
 *  - clientContacts: the people at a client, with their roles (primary, billing, signer, site);
 *  - clientViews: one row per directory view a client belongs to, kept in step with the client, so the
 *    directory searches, filters, sorts and pages on the server (a client can sit in several views);
 *  - servicePlans: recurring services and standing arrangements, which keep their visits booked ahead;
 *  - clientNotes and inboundMessages: internal notes, and the texts clients send, beside the outbox.
 *
 * Every table carries companyId and is read through an index that starts with it.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { actorValidator } from "../events";
import { scheduleValidator } from "../services/spec";
import { literals, WORK_KINDS } from "../statuses";

/**
 * The relationship, kept apart from plans, visits, payments and any sales stage. A prospect is the same
 * record before it becomes a client, so becoming one keeps its history.
 */
export const RELATIONSHIPS = ["prospect", "active", "paused", "former"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];
export const relationshipValidator = literals(RELATIONSHIPS);

export const CONTACT_ROLES = ["primary", "billing", "signer", "site"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

/** A property's kind. Office is its own view and is priced and served like commercial work. */
export const PROPERTY_KINDS = [...WORK_KINDS, "office"] as const;
export type PropertyKind = (typeof PROPERTY_KINDS)[number];
export const propertyKindValidator = literals(PROPERTY_KINDS);

/**
 * The directory's views. They overlap on purpose: a recurring home client who also books a one-time clean
 * is in Residential, Recurring and One-time; a business with an office and a rental is in Commercial,
 * Office and STR. Counts are per view and never add up to a total.
 */
export const CLIENT_VIEWS = ["all", "residential", "residential_recurring", "residential_one_time", "commercial", "office", "str", "prospects", "archived"] as const;
export type ClientView = (typeof CLIENT_VIEWS)[number];
export const clientViewValidator = literals(CLIENT_VIEWS);

export const communicationValidator = v.object({
  preferredChannel: v.union(v.literal("sms"), v.literal("email"), v.literal("phone"), v.null()),
  bestTime: v.optional(v.string()),
  language: v.optional(v.string()),
});

/** What a property is like, by kind. Every field is optional: only what the company knows is kept. */
export const propertyDetailsValidator = v.object({
  bedrooms: v.optional(v.number()),
  bathrooms: v.optional(v.number()),
  halfBaths: v.optional(v.number()),
  squareFeet: v.optional(v.number()),
  floors: v.optional(v.number()),
  pets: v.optional(v.string()),
  /** Short-term rentals. */
  beds: v.optional(v.number()),
  maxGuests: v.optional(v.number()),
  laundry: v.optional(v.union(v.literal("on_site"), v.literal("off_site"), v.literal("none"))),
  supplies: v.optional(v.string()),
  checkoutTime: v.optional(v.string()),
  checkinTime: v.optional(v.string()),
  /** Offices and commercial sites: the days and hours the crew may work, and how often each task is done. */
  serviceDays: v.optional(v.array(v.number())),
  serviceWindow: v.optional(v.object({ from: v.string(), to: v.string() })),
  taskSchedule: v.optional(v.array(v.object({ task: v.string(), frequency: v.string() }))),
  occupants: v.optional(v.number()),
});

export const PLAN_STATES = ["setup", "active", "paused", "ended"] as const;
export type PlanState = (typeof PLAN_STATES)[number];

export const clientsTables = {
  clientContacts: defineTable({
    companyId: v.id("companies"),
    customerId: v.id("customers"),
    name: v.string(),
    title: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    roles: v.array(literals(CONTACT_ROLES)),
    /** A site contact can be for some properties only. Empty: all of the client's properties. */
    propertyIds: v.array(v.id("properties")),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_company_customer", ["companyId", "customerId"]),

  /** The directory, one row per view a client is in. Rebuilt from the records by refreshClient; never edited directly. */
  clientViews: defineTable({
    companyId: v.id("companies"),
    customerId: v.id("customers"),
    view: clientViewValidator,
    name: v.string(),
    /** Lowercased name, for sorting. */
    sortName: v.string(),
    /** Name, contacts and addresses. Never access instructions or private notes. */
    searchText: v.string(),
    relationship: relationshipValidator,
    ownerId: v.optional(v.id("members")),
    /** Awaiting service setup: an active client with no property, or with no plan and no visit ever. */
    needsSetup: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_view_name", ["companyId", "view", "sortName"])
    .index("by_company_view_created", ["companyId", "view", "createdAt"])
    .index("by_company_view_updated", ["companyId", "view", "updatedAt"])
    .index("by_company_customer", ["companyId", "customerId"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["companyId", "view"] }),

  /**
   * A recurring service, or a standing arrangement (a short-term rental's agreed turnover terms). A
   * recurring plan keeps its visits booked a set window ahead; a standing arrangement holds terms and
   * never makes a calendar: its turnovers are booked one by one.
   */
  servicePlans: defineTable({
    companyId: v.id("companies"),
    customerId: v.id("customers"),
    propertyId: v.id("properties"),
    serviceId: v.id("services"),
    kind: v.union(v.literal("recurring"), v.literal("standing")),
    state: literals(PLAN_STATES),
    /** Recurring only. */
    cadence: v.union(scheduleValidator, v.null()),
    /** YYYY-MM-DD on the company's calendar: the first visit. */
    startsOn: v.string(),
    /** HH:MM on the company's clock. */
    startTime: v.string(),
    durationMinutes: v.number(),
    arrivalWindowMinutes: v.number(),
    crewSize: v.number(),
    /** The job's facts the price was worked out from (rooms, extras), as JSON. */
    quoteInput: v.string(),
    /** The agreed price of each visit, and of the first one when it differs. */
    priceCents: v.union(v.number(), v.null()),
    firstVisit: v.union(v.null(), v.object({ priceCents: v.union(v.number(), v.null()), durationMinutes: v.number(), note: v.string() })),
    scopeNote: v.string(),
    preferredCleanerIds: v.array(v.id("cleaners")),
    agreementId: v.optional(v.id("agreements")),
    /** Visits are booked through this day. */
    bookedThrough: v.optional(v.string()),
    /** The first day of a pause, and the day it ends (exclusive), if set. */
    pausedFrom: v.optional(v.string()),
    pausedUntil: v.optional(v.string()),
    endsOn: v.optional(v.string()),
    /** Days of the series a person skipped. A skipped day is never booked again. */
    skipped: v.array(v.string()),
    revision: v.number(),
    createdBy: actorValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_customer", ["companyId", "customerId"])
    .index("by_company_property", ["companyId", "propertyId"])
    .index("by_company_state", ["companyId", "state"]),

  /** Internal notes about a client. Never sent and never shown to a client. */
  clientNotes: defineTable({
    companyId: v.id("companies"),
    customerId: v.id("customers"),
    propertyId: v.optional(v.id("properties")),
    jobId: v.optional(v.id("jobs")),
    body: v.string(),
    authorId: v.id("members"),
    createdAt: v.number(),
  }).index("by_company_customer", ["companyId", "customerId", "createdAt"]),

  /** A text a client sent. Kept beside the outbox so a conversation can be read in order. */
  inboundMessages: defineTable({
    companyId: v.id("companies"),
    customerId: v.optional(v.id("customers")),
    channel: v.union(v.literal("sms"), v.literal("email")),
    from: v.string(),
    body: v.string(),
    /** What the reply did: STOP opted out, START opted back in, or an ordinary message. */
    kind: v.union(v.literal("message"), v.literal("opt_out"), v.literal("opt_in"), v.literal("help")),
    taskId: v.optional(v.id("tasks")),
    receivedAt: v.number(),
  }).index("by_company_customer", ["companyId", "customerId", "receivedAt"]),
};
