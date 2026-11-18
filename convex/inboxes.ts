/**
 * The company's connected inboxes, shared by every agent (docs/email/03-inboxes.md). One Gmail connection
 * can serve several purposes (Sales, Hiring, Care & Retention, Operations). Recruiting settings keep their
 * own way to connect a hiring inbox (convex/recruiterMailbox.ts); both end up as the same kind of row.
 *
 *   list          every inbox, its purposes and agents, its state in words, and what the first read found
 *   startConnect  the Owner chooses purposes, a label, how far back to read and whether it may send,
 *                 then goes to Google (read and send scopes only; never modify or compose)
 *   update        change purposes or the label without reconnecting
 *   disconnect    stop using it now, remove the stored authorization, and end Google's grant when nothing
 *                 else of the company's uses it
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { companyQuery, ownerMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { resumeWaiting, waitingMessages } from "./lib/inbox/events";
import { agentsOf, PURPOSE_INFO, purposesOf } from "./lib/inbox/mailboxes";
import { returnOrigin } from "./lib/invitations";
import { notifyMembers } from "./lib/notify/route";
import { accessToken, authorizationUrl, googleApp, revokeToken } from "./lib/recruiter/gmail";
import { INBOX_PURPOSES, inboxPurposeValidator, type InboxPurpose } from "./lib/recruiter/schema";
import { hashToken, randomToken, secretsConfigured, unseal } from "./lib/recruiter/secrets";
import { DAY } from "./lib/recruiter/settings";
import { optionalText } from "./lib/text";
import { googleRedirectUri } from "./recruiterMailbox";

const STATE_LIFE = 10 * 60 * 1000;
/** How far back the first read may go, in days. 0 is "only mail from now on". */
const HISTORY_CHOICES = [0, 7, 30, 90] as const;

const STATE_WORDS: Record<Doc<"mailboxConnections">["status"], string> = {
  connected: "Connected",
  expired: "Reconnect needed",
  error: "Not answering",
  disconnected: "Disconnected",
};

/** Every inbox the company connected, with what it's for and how it's doing. */
export const list = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("mailboxConnections")
      .withIndex("by_company", (q) => q.eq("companyId", ctx.companyId))
      .take(20);
    const out = [];
    for (const row of rows) {
      if (row.provider === "mock" && process.env.EMAIL_PROVIDER !== "mock") continue;
      const purposes = purposesOf(row);
      const by = await ctx.db.get(row.createdBy);
      // What the first read found, for the review after connecting. Hiring mail only: that's what is read.
      const seen = await ctx.db
        .query("sourceMessages")
        .withIndex("by_company_received", (q) => q.eq("companyId", ctx.companyId).gte("receivedAt", row.processFrom))
        .take(500);
      const mine = seen.filter((m) => m.connectionId === row._id);
      const count = (kind: Doc<"sourceMessages">["classification"]) => mine.filter((m) => m.classification === kind).length;
      out.push({
        id: row._id,
        provider: row.provider,
        address: row.address,
        status: row.status,
        state: STATE_WORDS[row.status],
        problem: row.problem ?? null,
        purposes: purposes.map((p) => ({ id: p, label: PURPOSE_INFO[p].label, does: PURPOSE_INFO[p].does })),
        agents: agentsOf(purposes),
        legacy: row.purposes === undefined,
        label: row.folder ?? null,
        readsFrom: row.processFrom,
        canSend: row.canSend === true,
        lastReadAt: row.lastSyncAt ?? null,
        pushUntil: row.watchExpiresAt ?? null,
        connectedBy: by?.name ?? null,
        connectedAt: row.createdAt,
        disconnectedAt: row.disconnectedAt ?? null,
        grant: row.grant ?? null,
        findings: purposes.includes("hiring")
          ? { read: mine.length, applications: count("new_application"), replies: count("applicant_reply"), duplicates: count("duplicate_notification"), updates: count("status_update"), skipped: count("promotion") + count("unrelated") }
          : null,
      });
    }
    const waiting = (await waitingMessages(ctx, ctx.companyId)).length;
    return { inboxes: out.sort((a, b) => b.connectedAt - a.connectedAt), waiting, canConnect: googleApp() !== null && (await secretsConfigured()) };
  },
});

function cleanPurposes(purposes: readonly InboxPurpose[]): InboxPurpose[] {
  const chosen = INBOX_PURPOSES.filter((p) => purposes.includes(p));
  if (!chosen.length) throw userError("Choose at least one thing this inbox is for.");
  return chosen;
}

/** The Owner's choices, then Google. Answers with the address to send the Owner to. */
export const startConnect = ownerMutation({
  args: {
    purposes: v.array(inboxPurposeValidator),
    label: v.optional(v.string()),
    historyDays: v.number(),
    canSend: v.boolean(),
    returnTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const app = googleApp();
    const redirectUri = googleRedirectUri();
    if (!app || !redirectUri || !(await secretsConfigured())) throw userError("Connecting Gmail isn’t available yet. Please try again a little later.");
    const purposes = cleanPurposes(args.purposes);
    if (!(HISTORY_CHOICES as readonly number[]).includes(args.historyDays)) throw userError("Choose how far back to read: from now on, or the last 7, 30 or 90 days.");
    const now = Date.now();
    const state = await randomToken();
    await ctx.db.insert("oauthStates", {
      companyId: ctx.companyId,
      memberId: ctx.member._id,
      provider: "gmail",
      stateHash: await hashToken(state),
      folder: optionalText(args.label, "The label", 200),
      sources: [],
      processFrom: now - args.historyDays * DAY,
      canSend: args.canSend,
      returnOrigin: returnOrigin(args.returnTo) ?? undefined,
      purposes,
      expiresAt: now + STATE_LIFE,
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "mailbox.connect_started", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { provider: "gmail", purposes: purposes.join(","), canSend: args.canSend } });
    // Read always; send only when the Owner allowed it. Never gmail.modify or gmail.compose.
    return { url: authorizationUrl(app, { redirectUri, state, loginHint: ctx.member.email, canSend: args.canSend }) };
  },
});

async function ownInbox(ctx: MutationCtx & { companyId: Id<"companies"> }, id: Id<"mailboxConnections">): Promise<Doc<"mailboxConnections">> {
  const row = await ctx.db.get(id);
  if (!row || row.companyId !== ctx.companyId) throw userError("That inbox isn't connected to this company.", "not_found");
  return row;
}

/** Changes what an inbox is for, or the label it's read inside, without going back to Google. */
export const update = ownerMutation({
  args: { connectionId: v.id("mailboxConnections"), purposes: v.array(inboxPurposeValidator), label: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const row = await ownInbox(ctx, args.connectionId);
    if (row.status === "disconnected") throw userError("This inbox is disconnected. Connect it again to use it.");
    const purposes = cleanPurposes(args.purposes);
    await ctx.db.patch(row._id, { purposes, ...(args.label !== undefined ? { folder: args.label === null ? undefined : optionalText(args.label, "The label", 200) } : {}) });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "mailbox.updated", actor: byMember(ctx), subject: { table: "mailboxConnections", id: row._id }, data: { purposes: purposes.join(",") } });
    // A purpose taken away: messages waiting for this inbox under it go another way now.
    await resumeWaiting(ctx, ctx.companyId);
    return null;
  },
});

/**
 * Stops using an inbox at once. The stored authorization is deleted here; Google's grant is ended
 * afterwards, unless another of the company's connections uses the same Google account (ending one
 * token ends them all). Waiting messages go through Selestial's shared sender instead.
 */
export const disconnect = ownerMutation({
  args: { connectionId: v.id("mailboxConnections") },
  handler: async (ctx, args) => {
    const row = await ownInbox(ctx, args.connectionId);
    if (row.status === "disconnected") return { grant: row.grant ?? null };
    const credentials = await ctx.db
      .query("mailboxCredentials")
      .withIndex("by_connection", (q) => q.eq("connectionId", row._id))
      .take(10);
    const shared = await sharesGrant(ctx, row);
    const now = Date.now();
    await ctx.db.patch(row._id, { status: "disconnected", problem: undefined, disconnectedAt: now, disconnectedBy: ctx.member._id, canSend: false, watchExpiresAt: undefined, grant: shared ? "kept_shared" : undefined });
    // The token travels to the revoke step in the scheduled call only, never stored again.
    const sealed = credentials[0]?.sealedRefreshToken ?? null;
    for (const credential of credentials) await ctx.db.delete(credential._id);
    if (!shared && sealed) await ctx.scheduler.runAfter(0, internal.inboxes.revokeGrant, { connectionId: row._id, sealed });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "mailbox.disconnected", actor: byMember(ctx), subject: { table: "mailboxConnections", id: row._id }, data: { provider: row.provider, grantShared: shared } });
    await notifyMembers(ctx, { companyId: ctx.companyId, event: "security_change", key: `inbox-disconnected:${row._id}:${now}`, facts: { kind: "inbox_disconnected", address: row.address, byName: ctx.member.name, at: now } });
    await resumeWaiting(ctx, ctx.companyId);
    return { grant: shared ? ("kept_shared" as const) : ("revoking" as const) };
  },
});

/** Whether ending this inbox's Google grant would also end another connection of the company's. */
async function sharesGrant(ctx: MutationCtx, row: Doc<"mailboxConnections">): Promise<boolean> {
  const sameAddress = (
    await ctx.db
      .query("mailboxConnections")
      .withIndex("by_address", (q) => q.eq("address", row.address))
      .take(50)
  ).some((other) => other._id !== row._id && other.status !== "disconnected");
  const google = (
    await ctx.db
      .query("googleConnections")
      .withIndex("by_company", (q) => q.eq("companyId", row.companyId))
      .take(20)
  ).some((connection) => connection.status !== "disconnected" && connection.email.trim().toLowerCase() === row.address);
  return sameAddress || google;
}

export const revokeGrant = internalAction({
  args: { connectionId: v.id("mailboxConnections"), sealed: v.string() },
  handler: async (ctx, args) => {
    const app = googleApp();
    const token = await unseal(args.sealed, args.connectionId);
    let revoked = false;
    if (app && token) {
      // Revoking with the access token or the refresh token ends the same grant; the refresh token always works.
      revoked = await revokeToken(token).catch(() => false);
      if (!revoked) revoked = await accessToken(app, token).then((access) => revokeToken(access)).catch(() => false);
    }
    await ctx.runMutation(internal.inboxes.revokeRecorded, { connectionId: args.connectionId, revoked });
    return revoked;
  },
});

export const revokeRecorded = internalMutation({
  args: { connectionId: v.id("mailboxConnections"), revoked: v.boolean() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.connectionId);
    if (!row || row.status !== "disconnected") return null;
    await ctx.db.patch(row._id, { grant: args.revoked ? "revoked" : "revoke_failed" });
    if (!args.revoked) await recordEvent(ctx, { companyId: row.companyId, type: "mailbox.revoke_failed", actor: { kind: "system" }, subject: { table: "mailboxConnections", id: row._id }, data: {} });
    return null;
  },
});
