/**
 * Connecting a company's Gmail as the hiring inbox, and the steps that use its stored authorization.
 *
 * 1. The Owner asks to connect (`startGmailConnect`). A random state is made, its hash is kept for ten
 *    minutes with the company and the Owner it belongs to, and the Owner is sent to Google.
 * 2. Google sends the Owner's browser back to `/oauth/google/callback` with the state and a code. The state
 *    is used once; the code is exchanged; the refresh token is encrypted and stored; the connection is
 *    recorded. Nothing about the token is ever returned to a browser.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { ownerMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { appOrigin, returnOrigin } from "./lib/invitations";
import { byMember, recordEvent } from "./lib/events";
import { authorizationUrl, googleApp } from "./lib/recruiter/gmail";
import { sourceValidator } from "./lib/recruiter/schema";
import { DAY } from "./lib/recruiter/settings";
import { hashToken, randomToken, secretsConfigured } from "./lib/recruiter/secrets";
import { optionalText } from "./lib/text";

const STATE_LIFE = 10 * 60 * 1000;

export function googleRedirectUri(): string | null {
  const site = process.env.CONVEX_SITE_URL?.trim().replace(/\/+$/, "");
  return site ? `${site}/oauth/google/callback` : null;
}

/** Where the Owner lands after Google: the Recruiting settings, saying how it went. */
export function afterConnect(outcome: "connected" | "failed" | "expired", origin?: string | null): string {
  return `${returnOrigin(origin) ?? appOrigin() ?? ""}/app/settings/recruiting?mailbox=${outcome}`;
}

/** Starts connecting a Gmail mailbox. Answers with the Google address to send the Owner to. */
export const startGmailConnect = ownerMutation({
  args: {
    folder: v.optional(v.string()),
    sources: v.optional(v.array(sourceValidator)),
    processFrom: v.optional(v.number()),
    /** Also allow applicant email to be sent from this mailbox. */
    canSend: v.optional(v.boolean()),
    /** The app address the Owner is on, so Google's answer comes back there. */
    returnTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const app = googleApp();
    const redirectUri = googleRedirectUri();
    if (!app || !redirectUri) throw userError("Connecting Gmail isn’t available yet. Please try again a little later.");
    if (!(await secretsConfigured())) throw userError("Connecting Gmail isn’t available yet. Please try again a little later.");
    const now = Date.now();
    const processFrom = args.processFrom ?? now;
    if (processFrom < now - 180 * DAY) throw userError("A historical import can go back at most 180 days.");
    const state = await randomToken();
    await ctx.db.insert("oauthStates", {
      companyId: ctx.companyId,
      memberId: ctx.member._id,
      provider: "gmail",
      stateHash: await hashToken(state),
      folder: optionalText(args.folder, "The label", 200),
      sources: args.sources ?? [],
      processFrom,
      canSend: args.canSend ?? true,
      returnOrigin: returnOrigin(args.returnTo) ?? undefined,
      expiresAt: now + STATE_LIFE,
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "mailbox.connect_started", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { provider: "gmail" } });
    return { url: authorizationUrl(app, { redirectUri, state, loginHint: ctx.member.email, canSend: args.canSend ?? true }) };
  },
});

/** Uses a state once. Null when it is unknown, used or expired. */
export const takeState = internalMutation({
  args: { stateHash: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_stateHash", (q) => q.eq("stateHash", args.stateHash))
      .unique();
    if (!row || row.usedAt !== undefined) return null;
    await ctx.db.patch(row._id, { usedAt: Date.now() });
    if (row.expiresAt <= Date.now()) return null;
    const member = await ctx.db.get(row.memberId);
    // Only someone who is still this company's Owner can finish connecting its mailbox.
    if (!member || member.companyId !== row.companyId || member.status !== "active" || member.role !== "owner") return null;
    return { stateId: row._id, companyId: row.companyId, memberId: row.memberId, folder: row.folder, sources: row.sources, processFrom: row.processFrom, canSend: row.canSend, returnOrigin: row.returnOrigin ?? null };
  },
});

/** Records the connection and its sealed token. Reconnecting the same address replaces both and keeps the cursor. */
export const completeConnect = internalMutation({
  args: {
    companyId: v.id("companies"),
    memberId: v.id("members"),
    address: v.string(),
    folder: v.optional(v.string()),
    sources: v.array(sourceValidator),
    processFrom: v.number(),
    canSend: v.boolean(),
    scopes: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"mailboxConnections">> => {
    const address = args.address.trim().toLowerCase();
    const existing = (
      await ctx.db
        .query("mailboxConnections")
        .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
        .take(20)
    ).find((row) => row.provider === "gmail" && row.address === address);
    const fields = { status: "connected" as const, problem: undefined, failures: 0, folder: args.folder, sources: args.sources, canSend: args.canSend && args.scopes.includes("https://www.googleapis.com/auth/gmail.send") };
    const connectionId = existing
      ? (await ctx.db.patch(existing._id, fields), existing._id)
      : await ctx.db.insert("mailboxConnections", { companyId: args.companyId, provider: "gmail", address, processFrom: args.processFrom, createdBy: args.memberId, createdAt: Date.now(), ...fields });
    const company = await ctx.db.get(args.companyId);
    // Replies go to the connected inbox unless the Owner already chose another address.
    if (company && !company.recruiter?.replyTo) await ctx.db.patch(company._id, { recruiter: { ...(company.recruiter ?? {}), replyTo: address } });
    await recordEvent(ctx, { companyId: args.companyId, type: "mailbox.connected", actor: { kind: "member", memberId: args.memberId }, subject: { table: "mailboxConnections", id: connectionId }, data: { provider: "gmail", historical: args.processFrom < Date.now() - 60_000, canSend: fields.canSend } });
    return connectionId;
  },
});

export const storeCredential = internalMutation({
  args: { companyId: v.id("companies"), connectionId: v.id("mailboxConnections"), sealedRefreshToken: v.string(), scopes: v.array(v.string()) },
  handler: async (ctx, args) => {
    for (const row of await ctx.db
      .query("mailboxCredentials")
      .withIndex("by_connection", (q) => q.eq("connectionId", args.connectionId))
      .take(10)) {
      await ctx.db.delete(row._id);
    }
    await ctx.db.insert("mailboxCredentials", { ...args, createdAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.recruiterInbox.sync, { connectionId: args.connectionId });
    return null;
  },
});

/** The sealed token for a connection, for the inbox run and the sender. Internal only. */
export const credentialFor = internalQuery({
  args: { connectionId: v.id("mailboxConnections") },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status === "disconnected") return null;
    const row = await ctx.db
      .query("mailboxCredentials")
      .withIndex("by_connection", (q) => q.eq("connectionId", connection._id))
      .first();
    return row ? { sealedRefreshToken: row.sealedRefreshToken, address: connection.address } : null;
  },
});

/** The mailbox applicant email for this company goes from, if the Owner allowed one. */
export const senderFor = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("mailboxConnections")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .take(20);
    const row = rows.find((connection) => connection.provider === "gmail" && connection.canSend && connection.status === "connected");
    return row ? { connectionId: row._id, address: row.address } : null;
  },
});

/** Sending from the mailbox was refused for lack of authorization. The connection says so and stops sending. */
export const sendRefused = internalMutation({
  args: { connectionId: v.id("mailboxConnections") },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return null;
    await ctx.db.patch(connection._id, { status: "expired", problem: "The mailbox's authorization has ended. Reconnect the hiring inbox." });
    await recordEvent(ctx, { companyId: connection.companyId, type: "mailbox.sync_failed", actor: { kind: "system" }, subject: { table: "mailboxConnections", id: connection._id }, data: { kind: "auth", failures: connection.failures + 1 } });
    return null;
  },
});
