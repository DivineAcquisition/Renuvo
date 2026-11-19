/**
 * Reading customers' replies in an inbox the Owner connected for Care & Retention.
 *
 * Off until the Owner turns it on in Retention's Playbook, and then narrow on purpose:
 *  - Nothing received before the moment it was turned on is read.
 *  - Headers are listed; a message is opened only when its sender's address is on exactly one active
 *    customer's record. Everything else in the inbox is never opened and nothing about it is kept.
 *  - Only the customer's own new lines are read (convex/lib/retention/mail.ts), by the same rules that
 *    read a customer's text. An email cannot instruct Retention, change a rule or approve anything.
 *  - Nothing is sent, deleted, moved or marked. The inbox stays the company's.
 *
 * It has its own cursor and lease on the connection, so an inbox that is also the hiring inbox is read
 * by Recruiter and by Retention independently. Internal only: a browser cannot start a run.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { AGENT_PROFILES } from "./lib/departments";
import { inboxBroke } from "./lib/inbox/events";
import { purposesOf } from "./lib/inbox/mailboxes";
import { allow } from "./lib/rateLimit";
import { accessToken, gmailConnector, googleApp } from "./lib/recruiter/gmail";
import { addressOf } from "./lib/recruiter/mail";
import { connectorFor, MailboxAuthError } from "./lib/recruiter/mailbox";
import { unseal } from "./lib/recruiter/secrets";
import { isAutomatic, replyText } from "./lib/retention/mail";
import { enqueueRun } from "./lib/retention/runs";
import { retentionSettings } from "./lib/retention/settings";

const LEASE = 3 * 60 * 1000;
const HOUR = 3_600_000;
const PAGE = 25;
const MAX_PAGES = 4;

/** What a run needs to start. Null when this inbox is not one Retention may read now. */
export const begin = internalQuery({
  args: { connectionId: v.id("mailboxConnections") },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status !== "connected" || !purposesOf(connection).includes("care")) return null;
    const company = await ctx.db.get(connection.companyId);
    if (!company || company.suspendedAt || company.pausedAgents.includes("retention")) return null;
    if (!AGENT_PROFILES.retention.built || !retentionSettings(company).readCareInbox) return null;
    return { provider: connection.provider, address: connection.address, folder: connection.folder, cursor: connection.careCursor ?? null, from: connection.careFrom ?? null };
  },
});

/** One read at a time. The first run fixes the moment reading starts: nothing earlier is ever read. */
export const lease = internalMutation({
  args: { connectionId: v.id("mailboxConnections") },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    const now = Date.now();
    if (!connection || (connection.careLeaseUntil ?? 0) > now) return null;
    const from = connection.careFrom ?? now;
    await ctx.db.patch(connection._id, { careLeaseUntil: now + LEASE, careFrom: from });
    return { from };
  },
});

/** Which senders are a customer, from the address alone. Reads no message. */
export const triage = internalQuery({
  args: { connectionId: v.id("mailboxConnections"), senders: v.array(v.string()) },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return [];
    const out: { address: string; customerId: Id<"customers"> }[] = [];
    for (const address of [...new Set(args.senders)].slice(0, PAGE)) {
      const matches = await ctx.db
        .query("customers")
        .withIndex("by_company_email", (q) => q.eq("companyId", connection.companyId).eq("email", address))
        .take(3);
      const active = matches.filter((row) => row.status === "active");
      // An address on two customers' records does not say which one is writing: a person reads that mail.
      if (active.length === 1) out.push({ address, customerId: active[0]._id });
    }
    return out;
  },
});

/** Hands one customer's own words to Retention's worker. Asked twice for the same message, it queues once. */
export const file = internalMutation({
  args: { connectionId: v.id("mailboxConnections"), messageId: v.string(), customerId: v.id("customers"), text: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    const customer = await ctx.db.get(args.customerId);
    if (!connection || !customer || customer.companyId !== connection.companyId) return false;
    if (!(await allow(ctx, `retention-email:${connection.companyId}:${customer._id}`, 6, HOUR))) return false;
    const runId = await enqueueRun(ctx, { companyId: connection.companyId, kind: "customer_email", key: `email:${connection._id}:${args.messageId.slice(0, 200)}`, customerId: customer._id, payload: args.text });
    return runId !== null;
  },
});

export const commit = internalMutation({
  args: { connectionId: v.id("mailboxConnections"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (connection) await ctx.db.patch(connection._id, { careCursor: args.cursor ?? connection.careCursor, careSyncAt: Date.now() });
    return null;
  },
});

/** The run ended. An authorization that has ended is the Owner's to fix, and they are told once. */
export const release = internalMutation({
  args: { connectionId: v.id("mailboxConnections"), auth: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return null;
    await ctx.db.patch(connection._id, { careLeaseUntil: undefined });
    if (args.auth && connection.status === "connected") {
      await ctx.db.patch(connection._id, { status: "expired", problem: "The mailbox's authorization has ended. Reconnect the inbox." });
      await inboxBroke(ctx, (await ctx.db.get(connection._id))!);
    }
    return null;
  },
});

export const sync = internalAction({
  args: { connectionId: v.id("mailboxConnections") },
  handler: async (ctx, args): Promise<{ listed: number; opened: number; filed: number } | null> => {
    const start = await ctx.runQuery(internal.retentionInbox.begin, { connectionId: args.connectionId });
    if (!start) return null;
    const leased = await ctx.runMutation(internal.retentionInbox.lease, { connectionId: args.connectionId });
    if (!leased) return null;
    let auth = false;
    try {
      let connector = connectorFor(start.provider);
      if (start.provider === "gmail") {
        const app = googleApp();
        const credential = await ctx.runQuery(internal.recruiterMailbox.credentialFor, { connectionId: args.connectionId });
        const refreshToken = credential ? await unseal(credential.sealedRefreshToken, args.connectionId) : null;
        if (!app || !refreshToken) return null;
        connector = gmailConnector({ token: await accessToken(app, refreshToken) });
      }
      if (!connector) return null;
      const scope = { address: start.address, folder: start.folder, after: leased.from };
      let cursor = start.cursor;
      let listed = 0;
      let opened = 0;
      let filed = 0;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const found = await connector.list(scope, cursor, PAGE);
        listed += found.headers.length;
        const people = found.headers.filter((header) => !isAutomatic(header));
        const senders = people.map((header) => addressOf(header.from)).filter((address): address is string => address !== null && address !== start.address.toLowerCase());
        const customers = senders.length ? await ctx.runQuery(internal.retentionInbox.triage, { connectionId: args.connectionId, senders }) : [];
        for (const header of people) {
          const customer = customers.find((row) => row.address === addressOf(header.from));
          if (!customer) continue;
          const message = await connector.fetch(scope, header.id);
          if (!message) continue;
          opened += 1;
          const text = replyText(message.text);
          if (!text) continue;
          if (await ctx.runMutation(internal.retentionInbox.file, { connectionId: args.connectionId, messageId: header.id, customerId: customer.customerId, text })) filed += 1;
        }
        cursor = found.cursor;
        // Saved after the page is filed: a crash replays the page, and filing ignores what it already has.
        await ctx.runMutation(internal.retentionInbox.commit, { connectionId: args.connectionId, cursor });
        if (!found.more) break;
      }
      return { listed, opened, filed };
    } catch (error) {
      // Anything else is the provider failing for now: the cursor is untouched and the next run starts where this one did.
      auth = error instanceof MailboxAuthError;
      return null;
    } finally {
      await ctx.runMutation(internal.retentionInbox.release, { connectionId: args.connectionId, auth });
    }
  },
});

/** Every ten minutes: a run for each inbox Retention may read. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!AGENT_PROFILES.retention.built) return 0;
    let started = 0;
    for await (const connection of ctx.db.query("mailboxConnections")) {
      if (connection.status !== "connected" || !purposesOf(connection).includes("care")) continue;
      const company = await ctx.db.get(connection.companyId);
      if (!company || !retentionSettings(company).readCareInbox) continue;
      await ctx.scheduler.runAfter(0, internal.retentionInbox.sync, { connectionId: connection._id });
      started += 1;
    }
    return started;
  },
});
