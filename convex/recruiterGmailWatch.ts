/**
 * Gmail push notifications for hiring inboxes. When Selestial's Pub/Sub topic is configured, each Gmail
 * hiring inbox asks Gmail to notify it of changes, and a notification starts a read at once instead of
 * waiting for the timer. The timer keeps running, so a lost notification only delays a read.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { pubsubTopic } from "./lib/google/platform";
import { accessToken, googleApp, watchMailbox } from "./lib/recruiter/gmail";
import { unseal } from "./lib/recruiter/secrets";

const DAY = 86_400_000;

export const target = internalQuery({
  args: { connectionId: v.id("mailboxConnections") },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.provider !== "gmail" || connection.status !== "connected") return null;
    const credential = await ctx.db.query("mailboxCredentials").withIndex("by_connection", (q) => q.eq("connectionId", connection._id)).first();
    return credential ? { sealed: credential.sealedRefreshToken, label: connection.folder ?? null, expiresAt: connection.watchExpiresAt ?? 0 } : null;
  },
});

export const saved = internalMutation({
  args: { connectionId: v.id("mailboxConnections"), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (connection) await ctx.db.patch(connection._id, { watchExpiresAt: args.expiresAt });
    return null;
  },
});

export const ensure = internalAction({
  args: { connectionId: v.id("mailboxConnections") },
  handler: async (ctx, args): Promise<null> => {
    const topic = pubsubTopic();
    const app = googleApp();
    const found = await ctx.runQuery(internal.recruiterGmailWatch.target, args);
    if (!topic || !app || !found || found.expiresAt > Date.now() + 2 * DAY) return null;
    const refreshToken = await unseal(found.sealed, args.connectionId);
    if (!refreshToken) return null;
    // Labels are named by the Owner; Gmail's watch wants ids, so a labelled inbox is watched whole and the read still filters.
    const watched = await watchMailbox({ token: await accessToken(app, refreshToken), topic });
    await ctx.runMutation(internal.recruiterGmailWatch.saved, { connectionId: args.connectionId, expiresAt: watched.expiration });
    return null;
  },
});

/** A verified Gmail notification: read that inbox now. Unknown addresses are ignored. */
export const notified = internalMutation({
  args: { emailAddress: v.string() },
  handler: async (ctx, args) => {
    const address = args.emailAddress.trim().toLowerCase();
    // Found by its address, so a notification reads only the inboxes it names.
    const rows = await ctx.db
      .query("mailboxConnections")
      .withIndex("by_address", (q) => q.eq("address", address))
      .take(50);
    let started = 0;
    for (const row of rows) {
      if (row.provider !== "gmail" || row.status !== "connected") continue;
      await ctx.scheduler.runAfter(0, internal.recruiterInbox.sync, { connectionId: row._id });
      started += 1;
    }
    return started;
  },
});

/** Daily: renew each Gmail inbox's watch before it lapses (Gmail's last seven days). */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!pubsubTopic()) return 0;
    const rows = await ctx.db.query("mailboxConnections").take(5000);
    let renewed = 0;
    for (const row of rows) {
      if (row.provider !== "gmail" || row.status !== "connected" || (row.watchExpiresAt ?? 0) > Date.now() + 2 * DAY) continue;
      await ctx.scheduler.runAfter(renewed * 1000, internal.recruiterGmailWatch.ensure, { connectionId: row._id });
      renewed += 1;
    }
    return renewed;
  },
});
