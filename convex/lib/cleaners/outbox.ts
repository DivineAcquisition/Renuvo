/**
 * Messages to a cleaner from this workspace: portal invitations, routine follow-ups and sign-in codes. Each is
 * a row first, checked by the one sending policy when planned and again when sent (convex/messaging.ts), with
 * this workspace's own check added at sending time: the follow-up must still be needed and the link still
 * open. Being prepared, sent, delivered and acted on are four separate facts: the message's status says the
 * first three, and the link's last action says the fourth.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Category } from "../compliance/schema";
import { recordEvent, type Actor } from "../events";
import { emailProvider } from "../messaging/email";
import { originOf, type SendIntent } from "../messaging/outbox";
import { checkSend, type PolicyCode } from "../messaging/policy";
import { messagingProvider, sendablePhone } from "../messaging/provider";
import { isEmail } from "../text";
import { followUpBlocker } from "./followUps";
import { portalLinkState, portalTokenFor } from "./portal";

export type CleanerPurpose = "portal_invitation" | "onboarding_reminder" | "availability_check" | "idle_check_in" | "verification_code";

export type PlannedCleanerMessage = {
  company: Doc<"companies">;
  cleaner?: Doc<"cleaners">;
  /** For a subcontractor contact, who has no cleaner record. */
  to?: { sms?: string; email?: string };
  channel: "sms" | "email";
  purpose: CleanerPurpose;
  subject?: string;
  /** With "{link}" where the portal link goes, and "{code}" for a sign-in code (never stored). */
  body: string;
  dedupeKey: string;
  link?: Doc<"portalLinks"> | null;
  followUpId?: Id<"followUps">;
  actor: Actor;
  /** An agent's routine message names the agent, so pausing it stops the message. */
  agent?: "recruiter" | "dispatch";
};

async function byKey(ctx: MutationCtx, companyId: Id<"companies">, dedupeKey: string) {
  return ctx.db
    .query("messages")
    .withIndex("by_company_dedupe", (q) => q.eq("companyId", companyId).eq("dedupeKey", dedupeKey))
    .first();
}

/** The channels this person can be reached on, in the company's order of preference. */
export function channelsFor(cleaner: Pick<Doc<"cleaners">, "phone" | "email">, preference: ("sms" | "email")[]): ("sms" | "email")[] {
  return preference.filter((channel) => (channel === "sms" ? sendablePhone(cleaner.phone) !== null : Boolean(cleaner.email && isEmail(cleaner.email))));
}

/**
 * Plans one message and hands it to the sender. Refused by the policy, it is kept as not sent with the
 * policy's words; not yet (quiet hours), it is held to the end of the window. Asked twice for the same
 * message, it answers with the first, so a retry or a repeated event never sends twice.
 */
export async function queueCleanerMessage(ctx: MutationCtx, planned: PlannedCleanerMessage, scheduledArgs: { code?: string } = {}): Promise<Doc<"messages">> {
  const existing = await byKey(ctx, planned.company._id, planned.dedupeKey);
  if (existing) return existing;
  const email = planned.channel === "email";
  const raw = email ? (planned.to?.email ?? planned.cleaner?.email) : (planned.to?.sms ?? planned.cleaner?.phone);
  const to = email ? (raw && isEmail(raw.trim().toLowerCase()) ? raw.trim().toLowerCase() : null) : sendablePhone(raw);
  const provider = email ? emailProvider() : messagingProvider();
  let problem: string | null = null;
  if (!raw) problem = email ? "No email address on file." : "No mobile number on file.";
  else if (!to) problem = email ? "The email address on file is not valid." : "The mobile number on file is not valid.";
  else if (planned.link === null) problem = "Links are not set up on this deployment, so there was no link to send.";
  else if (!provider) problem = email ? "Email is not connected." : "Text messaging is not connected.";

  const category: Category = "operational";
  const base = originOf(planned.actor);
  const intent: SendIntent = {
    category,
    origin: planned.agent ? "agent" : base.origin,
    agent: planned.agent ?? base.agent,
    ...(planned.cleaner ? { recipient: { kind: "cleaner" as const, id: planned.cleaner._id } } : {}),
  };
  const now = Date.now();
  let code: PolicyCode | null = null;
  let retryAt: number | undefined;
  if (!problem && to) {
    const answer = await checkSend(ctx, { companyId: planned.company._id, channel: planned.channel, to, now, ...intent });
    if (!answer.ok) {
      problem = answer.words;
      code = answer.code;
      retryAt = answer.retryAt;
    }
  }
  const status = !problem ? "queued" : retryAt !== undefined ? "held" : "not_sent";
  const messageId = await ctx.db.insert("messages", {
    companyId: planned.company._id,
    purpose: planned.purpose,
    channel: planned.channel,
    subject: planned.subject,
    cleanerId: planned.cleaner?._id,
    portalLinkId: planned.link?._id,
    followUpId: planned.followUpId,
    to: to ?? undefined,
    body: planned.body,
    dedupeKey: planned.dedupeKey,
    status,
    attempts: 0,
    provider: provider?.name,
    problem: problem ?? undefined,
    refusal: status === "not_sent" && code ? code : undefined,
    queuedAt: now,
  });
  if (to && status !== "not_sent") await ctx.db.insert("sendIntents", { companyId: planned.company._id, messageId, channel: planned.channel, address: to, at: now, ...intent });
  await recordEvent(ctx, { companyId: planned.company._id, type: `message.${status}`, actor: planned.actor, subject: { table: "messages", id: messageId }, data: { purpose: planned.purpose, channel: planned.channel, cleanerId: planned.cleaner?._id ?? null, ...(code ? { policy: code } : {}) } });
  if (status === "queued") await ctx.scheduler.runAfter(0, internal.messaging.deliver, { messageId, ...scheduledArgs });
  if (status === "held") await ctx.scheduler.runAt(retryAt!, internal.messaging.deliver, { messageId, ...scheduledArgs });
  return (await ctx.db.get(messageId))!;
}

/**
 * Checked again at the moment a message goes (convex/messaging.ts claim): the link must still be open and a
 * follow-up still needed. Returns the words for why not, or the body with its link in place.
 */
export async function cleanerMessageAtSend(ctx: MutationCtx, message: Doc<"messages">, siteLink: (token: string) => string): Promise<{ ok: true; body: string } | { ok: false; problem: string }> {
  let body = message.body;
  if (message.portalLinkId) {
    const link = await ctx.db.get(message.portalLinkId);
    const token = link ? await portalTokenFor(link) : null;
    if (!link || !token || portalLinkState(link, Date.now()) !== "active") return { ok: false, problem: "The link was closed before the message went out." };
    body = body.replace("{link}", siteLink(token));
  }
  if (message.cleanerId) {
    const cleaner = await ctx.db.get(message.cleanerId);
    if (!cleaner || cleaner.status === "ended") return { ok: false, problem: "The engagement ended before the message went out." };
  }
  if (message.followUpId) {
    const blocker = await followUpBlocker(ctx, message.followUpId);
    if (blocker) return { ok: false, problem: blocker };
  }
  return { ok: true, body };
}

/** The messages this workspace sent a cleaner, newest first. */
export async function cleanerMessages(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, cleanerId: Id<"cleaners">, limit = 50): Promise<Doc<"messages">[]> {
  return ctx.db
    .query("messages")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", companyId).eq("cleanerId", cleanerId))
    .order("desc")
    .take(limit);
}
