/**
 * Sending a planned message, in three separate steps so a crash between any two is recoverable and
 * nothing is sent twice. claim: queued becomes sending, in one transaction, so two workers cannot both
 * take it. send: the provider is called once, with the message's id as its idempotency key. settle: the
 * outcome is written. A send that never settles is found later and marked unconfirmed. It is not sent
 * again by itself, because nobody knows whether the first one went.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type ActionCtx, type MutationCtx } from "./_generated/server";
import { readProfile } from "./lib/compliance/profile";
import { afterMessageFailed } from "./lib/dispatch/delivery";
import { salesClaim } from "./lib/sales/outbox";
import { customerClaim } from "./lib/finance/outbox";
import { bookingClaim } from "./lib/booking/messages";
import { statementClaim } from "./lib/finance/cleanerOutbox";
import { linkPath, linkState, siteOrigin, tokenFor } from "./lib/dispatch/links";
import { recordEvent } from "./lib/events";
import type { SendIntent } from "./lib/messaging/outbox";
import { checkSend } from "./lib/messaging/policy";
import { emailProvider } from "./lib/messaging/email";
import { accessToken, googleApp, rawMessage, sendFromGmail } from "./lib/recruiter/gmail";
import { MailboxAuthError } from "./lib/recruiter/mailbox";
import { unseal } from "./lib/recruiter/secrets";
import { messagingProvider } from "./lib/messaging/provider";
import { afterApplicantMessage } from "./lib/recruiter/delivery";
import { applicantLinkPath, applicantLinkState } from "./lib/recruiter/links";
import { cleanerMessageAtSend } from "./lib/cleaners/outbox";
import { portalUrl } from "./lib/cleaners/portal";
import { sendProblem, type ApplicantPurpose } from "./lib/recruiter/outbox";
import { recruiterSettings } from "./lib/recruiter/settings";

const MAX_ATTEMPTS = 3;
const ROUTINE_CLEANER: readonly Doc<"messages">["purpose"][] = ["portal_invitation", "onboarding_reminder", "availability_check", "idle_check_in", "verification_code"];
const STUCK_AFTER = 5 * 60 * 1000;

/**
 * What a message was planned for. A message planned before the sending policy existed has no row, and
 * is read as what every such message was: a Dispatch text about work, to its cleaner.
 */
async function intentOf(ctx: MutationCtx, message: Doc<"messages">): Promise<SendIntent> {
  const row = await ctx.db
    .query("sendIntents")
    .withIndex("by_message", (q) => q.eq("messageId", message._id))
    .first();
  if (row) return { category: row.category, origin: row.origin, agent: row.agent, recipient: row.recipient, reply: row.reply };
  return { category: "operational", origin: "dispatch", ...(message.cleanerId ? { recipient: { kind: "cleaner" as const, id: message.cleanerId } } : {}) };
}

/**
 * Takes a queued or held message for sending. Null means there is nothing to send: someone else has it,
 * it was withdrawn, or the sending policy refused it or held it again.
 */
export const claim = internalMutation({
  args: { messageId: v.id("messages"), code: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || (message.status !== "queued" && message.status !== "held") || !message.to) return null;
    // The policy is asked again now: a STOP, a withdrawn permission, a suspension or a pause that came
    // after the message was planned stops it here. A refusal is final; only "not yet" holds it again.
    // Messages to applicants are asked this too, and then also pass the Recruiter's own gate below.
    const answer = await checkSend(ctx, { companyId: message.companyId, channel: message.channel ?? "sms", to: message.to, now: Date.now(), messageId: message._id, ...(await intentOf(ctx, message)) });
    if (!answer.ok) {
      const subject = { table: "messages" as const, id: message._id };
      if (answer.retryAt !== undefined) {
        await ctx.db.patch(message._id, { status: "held", problem: answer.words });
        await ctx.scheduler.runAt(answer.retryAt, internal.messaging.deliver, { messageId: message._id });
        await recordEvent(ctx, { companyId: message.companyId, type: "message.held", actor: { kind: "system" }, subject, data: { purpose: message.purpose, policy: answer.code, retryAt: answer.retryAt } });
        return null;
      }
      await ctx.db.patch(message._id, { status: "not_sent", problem: answer.words, refusal: answer.code });
      await recordEvent(ctx, { companyId: message.companyId, type: "message.not_sent", actor: { kind: "system" }, subject, data: { purpose: message.purpose, policy: answer.code } });
      if (message.assignmentId && (message.purpose === "offer" || message.purpose === "backup_offer")) {
        const intent = await intentOf(ctx, message);
        await ctx.scheduler.runAfter(0, internal.dispatchOps.offerTextRefused, { messageId: message._id, byAgent: intent.agent !== undefined });
      }
      return null;
    }
    let body = message.body;
    if (message.linkId) {
      const link = await ctx.db.get(message.linkId);
      const token = link ? await tokenFor(link) : null;
      // A text is never sent with a link that is already closed.
      if (!link || !token || linkState(link, Date.now()) !== "active") {
        await ctx.db.patch(message._id, { status: "not_sent", problem: "The link was closed before the text went out." });
        await recordEvent(ctx, { companyId: message.companyId, type: "message.not_sent", actor: { kind: "system" }, subject: { table: "messages", id: message._id }, data: { purpose: message.purpose } });
        return null;
      }
      body = body.replace("{link}", `${siteOrigin()}${linkPath(link.purpose, token, message.linkPath ?? "")}`);
    }
    let fromName = "";
    let via: { connectionId: Id<"mailboxConnections">; address: string } | null = null;
    if (message.portalLinkId || message.followUpId || ROUTINE_CLEANER.includes(message.purpose)) {
      // A Cleaners message is checked once more as it goes: the link still open, the follow-up still needed.
      const checked = await cleanerMessageAtSend(ctx, message, (token) => portalUrl(token));
      if (!checked.ok) {
        await ctx.db.patch(message._id, { status: "not_sent", problem: checked.problem });
        await recordEvent(ctx, { companyId: message.companyId, type: "message.not_sent", actor: { kind: "system" }, subject: { table: "messages", id: message._id }, data: { purpose: message.purpose } });
        return null;
      }
      body = checked.body;
    }
    // A sign-in code travels only in the scheduled call, never in the stored message.
    if (args.code && message.purpose === "verification_code") body = body.replace("{code}", args.code);
    if (!message.applicationId && (message.channel ?? "sms") === "email") {
      const company = await ctx.db.get(message.companyId);
      fromName = (await readProfile(ctx, message.companyId)).messaging.senderName ?? company?.name ?? "";
    }
    if (message.applicationId) {
      // A message to an applicant passes the send gate again at the moment it goes: they may have submitted, withdrawn or asked a question since it was planned.
      const application = await ctx.db.get(message.applicationId);
      const applicant = application ? await ctx.db.get(application.applicantId) : null;
      const company = await ctx.db.get(message.companyId);
      const link = message.applicantLinkId ? await ctx.db.get(message.applicantLinkId) : null;
      const token = link ? await tokenFor(link) : null;
      let problem: string | null = null;
      if (!application || !applicant || !company) problem = "The application no longer exists.";
      else problem = await sendProblem(ctx, application, applicant, message.purpose as ApplicantPurpose, recruiterSettings(company));
      if (!problem && message.applicantLinkId && (!link || !token || applicantLinkState(link, Date.now()) !== "active")) problem = "The link was closed before the message went out.";
      if (problem) {
        await ctx.db.patch(message._id, { status: "not_sent", problem });
        await recordEvent(ctx, { companyId: message.companyId, type: "message.not_sent", actor: { kind: "system" }, subject: { table: "messages", id: message._id }, data: { purpose: message.purpose } });
        return null;
      }
      if (link && token) body = body.replace("{link}", `${siteOrigin()}${applicantLinkPath(link.purpose, token)}`);
      fromName = recruiterSettings(company!).fromName;
      // A company that connected its own mailbox and allowed sending: the email goes from its own address.
      if ((message.channel ?? "sms") === "email") {
        const own = (
          await ctx.db
            .query("mailboxConnections")
            .withIndex("by_company", (q) => q.eq("companyId", message.companyId))
            .take(20)
        ).find((row) => row.provider === "gmail" && row.canSend && row.status === "connected");
        if (own) {
          via = { connectionId: own._id, address: own.address };
          await ctx.db.patch(message._id, { provider: "gmail" });
        }
      }
    }
    if (message.purpose === "earnings_statement") {
      const statement = await statementClaim(ctx, message);
      if ("problem" in statement) {
        await ctx.db.patch(message._id, { status: "not_sent", problem: statement.problem });
        await recordEvent(ctx, { companyId: message.companyId, type: "message.not_sent", actor: { kind: "system" }, subject: { table: "messages", id: message._id }, data: { purpose: message.purpose } });
        return null;
      }
      body = statement.body;
      fromName = statement.fromName;
    }
    if (message.invoiceId) {
      // A message to a customer about an invoice: still true now, and its pay link made only now.
      const customer = await customerClaim(ctx, message);
      if ("problem" in customer) {
        await ctx.db.patch(message._id, { status: "not_sent", problem: customer.problem });
        await recordEvent(ctx, { companyId: message.companyId, type: "message.not_sent", actor: { kind: "system" }, subject: { table: "messages", id: message._id }, data: { purpose: message.purpose } });
        return null;
      }
      body = customer.body;
      fromName = customer.fromName;
      via = customer.via;
    }
    if (message.bookingSessionId) {
      // A message to a customer about their booking: still true now, with a fresh private link made only now.
      const booking = await bookingClaim(ctx, message);
      if ("problem" in booking) {
        await ctx.db.patch(message._id, { status: "not_sent", problem: booking.problem });
        await recordEvent(ctx, { companyId: message.companyId, type: "message.not_sent", actor: { kind: "system" }, subject: { table: "messages", id: message._id }, data: { purpose: message.purpose } });
        return null;
      }
      body = booking.body;
      fromName = booking.fromName;
    } else if (message.salesLinks) {
      // A Sales message to a customer: every record it links still open, and its links made only now.
      const sales = await salesClaim(ctx, message);
      if ("problem" in sales) {
        await ctx.db.patch(message._id, { status: "not_sent", problem: sales.problem });
        await recordEvent(ctx, { companyId: message.companyId, type: "message.not_sent", actor: { kind: "system" }, subject: { table: "messages", id: message._id }, data: { purpose: message.purpose } });
        return null;
      }
      body = sales.body;
      fromName = sales.fromName;
      via = sales.via;
    }
    const attempt = message.attempts + 1;
    await ctx.db.patch(message._id, { status: "sending", attempts: attempt, attemptedAt: Date.now() });
    // A text goes from the company's own number. The send policy has already checked it is set and approved.
    const from = (message.channel ?? "sms") === "sms" ? ((await readProfile(ctx, message.companyId)).messaging.smsNumber ?? "") : "";
    return { to: message.to, from, body, attempt, channel: message.channel ?? ("sms" as const), subject: message.subject ?? "", replyTo: message.replyTo ?? "", fromName, via };
  },
});

const resultValidator = v.union(
  v.object({ ok: v.literal(true), providerMessageId: v.string(), delivered: v.boolean() }),
  v.object({ ok: v.literal(false), retryable: v.boolean(), problem: v.string(), bounced: v.optional(v.boolean()) }),
);

export const settle = internalMutation({
  args: { messageId: v.id("messages"), result: resultValidator },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    // Only a send that is in flight can be settled, so a late or repeated answer changes nothing.
    if (!message || message.status !== "sending") return null;
    const now = Date.now();
    const subject = { table: "messages" as const, id: message._id };
    const result = args.result;
    if (result.ok) {
      await ctx.db.patch(message._id, { status: result.delivered ? "delivered" : "sent", providerMessageId: result.providerMessageId, sentAt: now, ...(result.delivered ? { deliveredAt: now } : {}), problem: undefined });
      await recordEvent(ctx, { companyId: message.companyId, type: "message.sent", actor: { kind: "system" }, subject, data: { purpose: message.purpose, attempt: message.attempts } });
      if (result.delivered) await recordEvent(ctx, { companyId: message.companyId, type: "message.delivered", actor: { kind: "system" }, subject, data: { purpose: message.purpose } });
      if (message.applicationId) await afterApplicantMessage(ctx, (await ctx.db.get(message._id))!, "accepted");
      return null;
    }
    if (result.retryable && message.attempts < MAX_ATTEMPTS) {
      await ctx.db.patch(message._id, { status: "queued", problem: result.problem });
      await ctx.scheduler.runAfter(message.attempts * 30_000, internal.messaging.deliver, { messageId: message._id });
      return null;
    }
    await ctx.db.patch(message._id, { status: "failed", failedAt: now, problem: result.problem, ...(result.bounced ? { bouncedAt: now } : {}) });
    await recordEvent(ctx, { companyId: message.companyId, type: result.bounced ? "message.bounced" : "message.failed", actor: { kind: "system" }, subject, data: { purpose: message.purpose, attempts: message.attempts } });
    if (message.applicationId) await afterApplicantMessage(ctx, (await ctx.db.get(message._id))!, "failed");
    else if (!message.invoiceId && !message.bookingSessionId && !message.salesLinks && message.purpose !== "earnings_statement") await afterMessageFailed(ctx, { ...message, status: "failed", problem: result.problem });
    return null;
  },
});

/**
 * Sends one applicant email from the company's own Gmail. Its authorization is opened here and only
 * here. An authorization that has ended stops sending from that mailbox until the Owner reconnects it.
 * A connection that drops mid-send throws: nobody knows whether it went, so it is never sent again by itself.
 */
async function sendThroughMailbox(
  ctx: ActionCtx,
  messageId: Id<"messages">,
  via: { connectionId: Id<"mailboxConnections">; address: string },
  claimed: { to: string; body: string; subject: string; replyTo: string; fromName: string },
): Promise<{ ok: true; providerMessageId: string; delivered: boolean } | { ok: false; retryable: boolean; problem: string }> {
  const app = googleApp();
  const credential = await ctx.runQuery(internal.recruiterMailbox.credentialFor, { connectionId: via.connectionId });
  const refreshToken = credential ? await unseal(credential.sealedRefreshToken, via.connectionId) : null;
  if (!app || !refreshToken) return { ok: false, retryable: false, problem: "The company's mailbox is not connected for sending." };
  let token: string;
  try {
    token = await accessToken(app, refreshToken);
  } catch (error) {
    if (error instanceof MailboxAuthError) {
      await ctx.runMutation(internal.recruiterMailbox.sendRefused, { connectionId: via.connectionId });
      return { ok: false, retryable: false, problem: "The company's mailbox no longer lets Selestial send. Reconnect it." };
    }
    return { ok: false, retryable: true, problem: "Google did not answer." };
  }
  const raw = rawMessage({ from: via.address, fromName: claimed.fromName, to: claimed.to, replyTo: claimed.replyTo || undefined, subject: claimed.subject, text: claimed.body, messageId });
  const result = await sendFromGmail({ token, raw });
  if (!result.ok && result.problem.startsWith("The company's mailbox no longer")) await ctx.runMutation(internal.recruiterMailbox.sendRefused, { connectionId: via.connectionId });
  return result;
}

export const deliver = internalAction({
  args: { messageId: v.id("messages"), code: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const claimed = await ctx.runMutation(internal.messaging.claim, { messageId: args.messageId, code: args.code });
    if (!claimed) return null;
    if (claimed.channel === "email" && claimed.via) {
      const result = await sendThroughMailbox(ctx, args.messageId, claimed.via, claimed);
      await ctx.runMutation(internal.messaging.settle, { messageId: args.messageId, result });
      return null;
    }
    if (claimed.channel === "email") {
      const email = emailProvider();
      if (!email) {
        await ctx.runMutation(internal.messaging.settle, { messageId: args.messageId, result: { ok: false, retryable: false, problem: "Email is not connected." } });
        return null;
      }
      // As with a text: if this throws, the message stays "sending" and the sweep marks it unconfirmed. It is not sent again.
      const sent = await email.send({ to: claimed.to, fromName: claimed.fromName, replyTo: claimed.replyTo, subject: claimed.subject, text: claimed.body, idempotencyKey: args.messageId, attempt: claimed.attempt });
      await ctx.runMutation(internal.messaging.settle, { messageId: args.messageId, result: sent });
      return null;
    }
    const provider = messagingProvider();
    if (!provider) {
      await ctx.runMutation(internal.messaging.settle, { messageId: args.messageId, result: { ok: false, retryable: false, problem: "Text messaging is not connected." } });
      return null;
    }
    // If this throws, nobody knows whether the text went. The message stays "sending" and the sweep marks it unconfirmed.
    const result = await provider.send({ to: claimed.to, from: claimed.from || undefined, body: claimed.body, idempotencyKey: args.messageId, attempt: claimed.attempt });
    await ctx.runMutation(internal.messaging.settle, { messageId: args.messageId, result });
    return null;
  },
});

/**
 * A delivery report from the provider. The same report arriving twice changes nothing the second time.
 * This is what a webhook will call once a provider is connected.
 */
export const receipt = internalMutation({
  args: { provider: v.string(), eventId: v.string(), providerMessageId: v.string(), outcome: v.union(v.literal("delivered"), v.literal("failed"), v.literal("bounced")), problem: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("providerReceipts")
      .withIndex("by_provider_event", (q) => q.eq("provider", args.provider).eq("eventId", args.eventId))
      .first();
    if (seen) return "duplicate" as const;
    await ctx.db.insert("providerReceipts", { provider: args.provider, eventId: args.eventId, receivedAt: Date.now() });
    const message = await ctx.db
      .query("messages")
      .withIndex("by_provider_message", (q) => q.eq("provider", args.provider).eq("providerMessageId", args.providerMessageId))
      .first();
    if (!message || (message.status !== "sent" && message.status !== "unconfirmed")) return "ignored" as const;
    const now = Date.now();
    const subject = { table: "messages" as const, id: message._id };
    if (args.outcome === "delivered") {
      await ctx.db.patch(message._id, { status: "delivered", deliveredAt: now });
      await recordEvent(ctx, { companyId: message.companyId, type: "message.delivered", actor: { kind: "system" }, subject, data: { purpose: message.purpose } });
      return "delivered" as const;
    }
    const bounced = args.outcome === "bounced";
    const problem = args.problem ?? (bounced ? "The address rejected the message." : message.channel === "email" ? "The email service reported that the message was not delivered." : "The carrier reported that the text was not delivered.");
    await ctx.db.patch(message._id, { status: "failed", failedAt: now, problem, ...(bounced ? { bouncedAt: now } : {}) });
    await recordEvent(ctx, { companyId: message.companyId, type: bounced ? "message.bounced" : "message.failed", actor: { kind: "system" }, subject, data: { purpose: message.purpose, attempts: message.attempts } });
    if (message.applicationId) await afterApplicantMessage(ctx, (await ctx.db.get(message._id))!, "failed");
    else if (!message.invoiceId && !message.bookingSessionId && !message.salesLinks && message.purpose !== "earnings_statement") await afterMessageFailed(ctx, { ...message, status: "failed", problem });
    return "failed" as const;
  },
});

/** Run on a schedule: a send that started and never settled is marked unconfirmed and handed on. */
export const sweepStuck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stuck = await ctx.db
      .query("messages")
      .withIndex("by_status_attempted", (q) => q.eq("status", "sending").lt("attemptedAt", Date.now() - STUCK_AFTER))
      .take(100);
    for (const message of stuck) {
      const problem = "The send was started and never finished, so it is not known whether the message went. It was not sent again.";
      await ctx.db.patch(message._id, { status: "unconfirmed", problem });
      await recordEvent(ctx, { companyId: message.companyId, type: "message.unconfirmed", actor: { kind: "system" }, subject: { table: "messages", id: message._id }, data: { purpose: message.purpose } });
      if (message.applicationId) await afterApplicantMessage(ctx, (await ctx.db.get(message._id))!, "failed");
      else if (!message.invoiceId && !message.bookingSessionId && !message.salesLinks && message.purpose !== "earnings_statement") await afterMessageFailed(ctx, { ...message, status: "unconfirmed", problem });
    }
    return stuck.length;
  },
});
