/**
 * Connections to the systems an established company is moving from (Jobber, Housecall Pro), used during
 * setup to bring clients in. A connection only reads: nothing is ever written back to the other system.
 *
 * The credential (Jobber's refresh token, a Housecall Pro API key) is sealed and kept apart from the
 * connection, so the connection can be exported and the credential never leaves. What a read brings back is
 * kept for a day at most, for the owner to check and import through the same path as a spreadsheet.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const connectorSystemValidator = v.union(
  v.literal("jobber"),
  v.literal("housecall_pro"),
);
export type ConnectorSystem = typeof connectorSystemValidator.type;

/** One row to import: the same shape a spreadsheet row becomes (lib/clients/importing.ts). */
export const importRowValidator = v.object({
  name: v.string(),
  type: v.optional(v.string()),
  kind: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  line1: v.optional(v.string()),
  line2: v.optional(v.string()),
  city: v.optional(v.string()),
  region: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  notes: v.optional(v.string()),
  schedule: v.optional(v.string()),
  externalId: v.optional(v.string()),
});

export const connectorTables = {
  connectorConnections: defineTable({
    companyId: v.id("companies"),
    system: connectorSystemValidator,
    /** checking: a Housecall Pro key not yet accepted. expired: the other system ended the authorization. */
    status: v.union(
      v.literal("checking"),
      v.literal("connected"),
      v.literal("expired"),
      v.literal("disconnected"),
    ),
    /** The account's name in the other system, as it reported it. */
    account: v.optional(v.string()),
    problem: v.optional(v.string()),
    connectedBy: v.id("members"),
    connectedAt: v.number(),
    lastReadAt: v.optional(v.number()),
    disconnectedAt: v.optional(v.number()),
  }).index("by_company_system", ["companyId", "system"]),

  /** The sealed credential for one connection, bound to its id. Never sent to a browser and never exported. */
  connectorCredentials: defineTable({
    companyId: v.id("companies"),
    connectionId: v.id("connectorConnections"),
    sealed: v.string(),
    createdAt: v.number(),
  }).index("by_connection", ["connectionId"]),

  /** Ten-minute, single-use records of a Jobber sign-in in progress. Only the state's hash is kept. */
  connectorStates: defineTable({
    companyId: v.id("companies"),
    memberId: v.id("members"),
    stateHash: v.string(),
    returnOrigin: v.optional(v.string()),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  }).index("by_stateHash", ["stateHash"]),

  /** What one read brought back, waiting for the owner to check and import. Deleted after a day. */
  connectorReads: defineTable({
    companyId: v.id("companies"),
    connectionId: v.id("connectorConnections"),
    system: connectorSystemValidator,
    status: v.union(
      v.literal("reading"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    rows: v.array(importRowValidator),
    /** Upcoming visits found, kept as each client's schedule note. None is booked in Selestial. */
    visits: v.number(),
    /** More clients than one import takes: only the first ones were read. */
    truncated: v.boolean(),
    problem: v.optional(v.string()),
    requestedBy: v.id("members"),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_company_started", ["companyId", "startedAt"]),
};
