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
import { afterSalesMessage, salesClaim } from "./lib/sales/outbox";
import { customerClaim } from "./lib/finance/outbox";
import { bookingClaim } from "./lib/booking/messages";
import { statementClaim } from "./lib/finance/cleanerOutbox";
import { linkPath, linkState, siteOrigin, tokenFor } from "./lib/dispatch/links";
import { recordEvent } from "./lib/events";
import type { SendIntent } from "./lib/messaging/outbox";
import { checkSend } from "./lib/messaging/policy";
import { emailProvider, noticeEmailProvider } from "./lib/messaging/email";
import { companyEmail } from "./lib/messaging/companyMail";
import { composeNotice } from "./lib/notify/compose";
import { suppressAfterProblem } from "./lib/notify/delivery";
import { accessToken, googleApp, rawMessage, replySubject, sendFromGmail, threadReplyHeaders } from "./lib/recruiter/gmail";
import { inboxPurposeOf, routeFor, threadFor, WAITING_FOR_INBOX } from "./lib/inbox/mailboxes";
import { MailboxAuthError } from "./lib/recruiter/mailbox";
import { unseal } from "./lib/recruiter/secrets";
import { messagingProvider } from "./lib/messaging/provider";
import { afterApplicantMessage } from "./lib/recruiter/delivery";
import { applicantLinkPath, applicantLinkState } from "./lib/recruiter/links";
import { cleanerMessageAtSend } from "./lib/cleaners/outbox";
import { portalUrl } from "./lib/cleaners/portal";
import { sendProblem, type ApplicantPurpose } from "./lib/recruiter/outbox";
import { recruiterSettings } from "./lib/recruiter/settings";
import { captureCharge, heldNotice, markPending, planOutbound, refundCharge, releaseCharge } from "./lib/messagingBilling/ledger";
import { reserveCharge } from "./messagingBilling";

const MAX_ATTEMPTS = 3;

/**
 * The event for a message's step, except for Selestial's own notices to members, which stay out of the
 * company's activity log (their row and the person's Recent notices record them).
 */
async function logStep(ctx: MutationCtx, message: Doc<"messages">, event: Omit<Parameters<typeof recordEvent>[1], "companyId" | "subject" | "actor"> & { actor?: Parameters<typeof recordEvent>[1]["actor"] }) {
  if (message.purpose === "member_notice") return;
  await recordEvent(ctx, { companyId: message.companyId, actor: event.actor ?? { kind: "system" }, subject: { table: "messages", id: message._id }, type: event.type, data: event.data });
}
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
    // A notice to a member of the company is Selestial's own mail: its checks are the member's, not a contact's.
    if (message.purpose === "member_notice") return claimNotice(ctx, message);
    // The policy is asked again now: a STOP, a withdrawn permission, a suspension or a pause that came
    // after the message was planned stops it here. A refusal is final; only "not yet" holds it again.
    // Messages to applicants are asked this too, and then also pass the Recruiter's own gate below.
    const answer = await checkSend(ctx, { companyId: message.companyId, channel: message.channel ?? "sms", to: message.to, now: Date.now(), messageId: message._id, ...(await intentOf(ctx, message)) });
    if (!answer.ok) {
      // A sign-in code is only useful now, and its code travels only in this call: it is never held for later.
      if (answer.retryAt !== undefined && message.purpose !== "verification_code") {
        await ctx.db.patch(message._id, { status: "held", problem: answer.words });
        await ctx.scheduler.runAt(answer.retryAt, internal.messaging.deliver, { messageId: message._id });
        await logStep(ctx, message, { type: "message.held", data: { purpose: message.purpose, policy: answer.code, retryAt: answer.retryAt } });
        return null;
      }
      await ctx.db.patch(message._id, { status: "not_sent", problem: answer.words, refusal: answer.code });
      await logStep(ctx, message, { type: "message.not_sent", data: { purpose: message.purpose, policy: answer.code } });
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
        await logStep(ctx, message, { type: "message.not_sent", data: { purpose: message.purpose } });
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
        await logStep(ctx, message, { type: "message.not_sent", data: { purpose: message.purpose } });
        return null;
      }
      body = checked.body;
    }
    // A sign-in code travels only in the scheduled call, never in the stored message. Without it, nothing goes.
    if (message.purpose === "verification_code") {
      if (!args.code) {
        await ctx.db.patch(message._id, { status: "not_sent", problem: "The sign-in code wasn't available when this was due to go, so nothing was sent. Ask for a new code." });
        await logStep(ctx, message, { type: "message.not_sent", data: { purpose: message.purpose } });
        return null;
      }
      body = body.replace("{code}", args.code);
    }
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
        await logStep(ctx, message, { type: "message.not_sent", data: { purpose: message.purpose } });
        return null;
      }
      if (link && token) body = body.replace("{link}", `${siteOrigin()}${applicantLinkPath(link.purpose, token)}`);
      fromName = recruiterSettings(company!).fromName;
      // Whether it goes from the company's own inbox is decided below, with every other message's.
    }
    if (message.purpose === "earnings_statement") {
      const statement = await statementClaim(ctx, message);
      if ("problem" in statement) {
        await ctx.db.patch(message._id, { status: "not_sent", problem: statement.problem });
        await logStep(ctx, message, { type: "message.not_sent", data: { purpose: message.purpose } });
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
        await logStep(ctx, message, { type: "message.not_sent", data: { purpose: message.purpose } });
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
        await logStep(ctx, message, { type: "message.not_sent", data: { purpose: message.purpose } });
        return null;
      }
      body = booking.body;
      fromName = booking.fromName;
    } else if (message.salesLinks) {
      // A Sales message to a customer: every record it links still open, and its links made only now.
      const sales = await salesClaim(ctx, message, (await intentOf(ctx, message)).agent !== undefined);
      if ("problem" in sales) {
        await ctx.db.patch(message._id, { status: "not_sent", problem: sales.problem });
        await logStep(ctx, message, { type: "message.not_sent", data: { purpose: message.purpose } });
        if (message.opportunityId) await afterSalesMessage(ctx, { ...message, status: "not_sent", problem: sales.problem });
        return null;
      }
      body = sales.body;
      fromName = sales.fromName;
      via = sales.via;
    }
    const channel = message.channel ?? ("sms" as const);
    // Which way it goes: the company's own inbox for this purpose, waiting for that inbox, or Selestial's
    // shared sender (convex/lib/inbox/mailboxes.ts). One way only, decided here for every message.
    let threadId: string | null = null;
    const inboxPurpose = inboxPurposeOf(message);
    if (inboxPurpose) {
      const route = await routeFor(ctx, message.companyId, inboxPurpose);
      if (route.kind === "wait") {
        await ctx.db.patch(message._id, { status: "held", problem: route.words, refusal: WAITING_FOR_INBOX });
        await logStep(ctx, message, { type: "message.held", data: { purpose: message.purpose, policy: WAITING_FOR_INBOX } });
        return null;
      }
      via = route.kind === "gmail" ? { connectionId: route.connectionId, address: route.address } : null;
      if (via) threadId = await threadFor(ctx, message, via.connectionId);
    }
    // Messaging billing, once the route is known: free (included, or the company's own Gmail), refused (no rate
    // for the route), held (funds, limits, billing unreachable; the message and its words are kept) or reserved.
    const sendIntent = await intentOf(ctx, message);
    const billed = await planOutbound(ctx, message, { body, viaGmail: via !== null, agent: message.agent ?? sendIntent.agent, memberId: message.authorId, origin: sendIntent.origin });
    if (billed.kind === "refuse") {
      await ctx.db.patch(message._id, { status: "not_sent", problem: billed.words, refusal: billed.code });
      await logStep(ctx, message, { type: "message.not_sent", data: { purpose: message.purpose, policy: billed.code } });
      if (message.assignmentId && (message.purpose === "offer" || message.purpose === "backup_offer")) await ctx.scheduler.runAfter(0, internal.dispatchOps.offerTextRefused, { messageId: message._id, byAgent: sendIntent.agent !== undefined });
      return null;
    }
    if (billed.kind === "hold") {
      await ctx.db.patch(message._id, { status: "held", holdReason: billed.reason, heldAt: message.heldAt ?? Date.now(), problem: billed.words });
      await logStep(ctx, message, { type: "message.held", data: { purpose: message.purpose, policy: billed.reason } });
      if (billed.reason === "billing_unavailable") await ctx.scheduler.runAfter(10 * 60_000, internal.messaging.deliver, { messageId: message._id });
      else await heldNotice(ctx, message.companyId, billed.reason);
      return null;
    }
    if (billed.kind === "reserve") body = billed.body;
    // Email through Selestial's shared sender goes as "{Company} via Selestial", in the company's frame.
    let email: { from: string; html: string; text: string; headers: Record<string, string> } | null = null;
    if (channel === "email" && !via) {
      const framed = await companyEmail(ctx, message, { fromName, text: body });
      if (!framed.ok) {
        await ctx.db.patch(message._id, { status: "not_sent", problem: framed.problem });
        await logStep(ctx, message, { type: "message.not_sent", data: { purpose: message.purpose } });
        // Nothing went: whatever was set aside for it is returned.
        if (billed.kind === "reserve") await releaseCharge(ctx, billed.chargeId, "The email could not be prepared, so it was not sent.");
        return null;
      }
      email = { from: framed.from, html: framed.html, text: framed.text, headers: {} };
    }
    const attempt = message.attempts + 1;
    // The provider is the one this send really uses, so its delivery reports find the message.
    const provider = channel === "email" ? (via ? "gmail" : (emailProvider()?.name ?? message.provider)) : (messagingProvider()?.name ?? message.provider);
    await ctx.db.patch(message._id, { status: "sending", attempts: attempt, attemptedAt: Date.now(), provider, sentVia: provider, holdReason: undefined });
    // A text goes from the company's own number. The send policy has already checked it is set and approved.
    const from = channel === "sms" ? ((await readProfile(ctx, message.companyId)).messaging.smsNumber ?? "") : "";
    return { to: message.to, from, body, attempt, channel, subject: message.subject ?? "", replyTo: message.replyTo ?? "", fromName, via, email, threadId, notice: false, billing: billed.kind === "reserve" ? { chargeId: billed.chargeId, needsLock: billed.needsLock } : null };
  },
});

/**
 * Takes a notice to a member for sending: written now from the records (convex/lib/notify/compose.ts),
 * or held until morning, or not sent with the reason on the row.
 */
async function claimNotice(ctx: MutationCtx, message: Doc<"messages">) {
  const now = Date.now();
  const composed = await composeNotice(ctx, message, now);
  if (!composed.ok) {
    if (composed.retryAt !== undefined) {
      await ctx.db.patch(message._id, { status: "held", problem: composed.problem });
      await ctx.scheduler.runAt(composed.retryAt, internal.messaging.deliver, { messageId: message._id });
      await logStep(ctx, message, { type: "message.held", data: { purpose: message.purpose, event: message.notice?.event ?? null, retryAt: composed.retryAt } });
      return null;
    }
    await ctx.db.patch(message._id, { status: "not_sent", problem: composed.problem, ...(composed.refusal ? { refusal: composed.refusal } : {}) });
    await logStep(ctx, message, { type: "message.not_sent", data: { purpose: message.purpose, event: message.notice?.event ?? null } });
    return null;
  }
  const attempt = message.attempts + 1;
  // What went is kept on the row: the subject and the plain words. The HTML is rebuilt from the same records.
  await ctx.db.patch(message._id, { status: "sending", attempts: attempt, attemptedAt: now, subject: composed.email.subject, body: composed.email.text, provider: emailProvider()?.name ?? message.provider, problem: undefined });
  return {
    to: message.to!,
    from: "",
    body: composed.email.text,
    attempt,
    channel: "email" as const,
    subject: composed.email.subject,
    replyTo: composed.replyTo ?? "",
    fromName: "",
    via: null,
    email: { from: composed.from, html: composed.email.html, text: composed.email.text, headers: composed.headers },
    threadId: null,
    notice: true,
    // Notices to a company's own people are included with the plan and never charged.
    billing: null,
  };
}

const resultValidator = v.union(
  v.object({ ok: v.literal(true), providerMessageId: v.string(), delivered: v.boolean(), parts: v.optional(v.number()) }),
  v.object({ ok: v.literal(false), retryable: v.boolean(), problem: v.string(), bounced: v.optional(v.boolean()), waitForInbox: v.optional(v.boolean()) }),
);

export const settle = internalMutation({
  args: { messageId: v.id("messages"), result: resultValidator },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    // Only a send that is in flight can be settled, so a late or repeated answer changes nothing.
    if (!message || message.status !== "sending") return null;
    const now = Date.now();
    const result = args.result;
    const charge = await ctx.db
      .query("messagingCharges")
      .withIndex("by_message", (q) => q.eq("messageId", message._id))
      .first();
    if (result.ok) {
      await ctx.db.patch(message._id, { status: result.delivered ? "delivered" : "sent", providerMessageId: result.providerMessageId, sentAt: now, ...(result.delivered ? { deliveredAt: now } : {}), ...(result.parts ? { segments: result.parts } : {}), problem: undefined });
      // Charged on what the provider took: the segments it counted for a text, the recipients for an email.
      if (charge) await captureCharge(ctx, charge._id, { count: (message.channel ?? "sms") === "sms" ? result.parts : message.recipients, provider: message.provider ?? "unknown", providerMessageId: result.providerMessageId });
      await logStep(ctx, message, { type: "message.sent", data: { purpose: message.purpose, attempt: message.attempts } });
      if (result.delivered) await logStep(ctx, message, { type: "message.delivered", data: { purpose: message.purpose } });
      if (message.applicationId) await afterApplicantMessage(ctx, (await ctx.db.get(message._id))!, "accepted");
      // A delivery report that arrived before this settled is applied now instead of being lost.
      if (message.earlyReceipt && !result.delivered) await applyOutcome(ctx, (await ctx.db.get(message._id))!, message.earlyReceipt.outcome, message.earlyReceipt.problem);
      const early = message.provider
        ? await ctx.db
            .query("providerReceipts")
            .withIndex("by_provider_early", (q) => q.eq("provider", message.provider!).eq("early.providerMessageId", result.providerMessageId))
            .take(10)
        : [];
      for (const row of early) {
        if (!row.early || row.early.appliedAt !== undefined) continue;
        await ctx.db.patch(row._id, { early: { ...row.early, appliedAt: now } });
        await reconcileCharge(ctx, message._id, { providerCost: row.early.providerCost, errorCode: row.early.errorCode });
        await applyOutcome(ctx, (await ctx.db.get(message._id))!, row.early.outcome, row.early.problem);
      }
      return null;
    }
    // The company's inbox stopped letting Selestial send as it tried: nothing went, so the message waits
    // for the inbox to be reconnected rather than failing or going another way.
    if (result.waitForInbox) {
      await ctx.db.patch(message._id, { status: "held", problem: result.problem, refusal: WAITING_FOR_INBOX });
      await logStep(ctx, message, { type: "message.held", data: { purpose: message.purpose, policy: WAITING_FOR_INBOX } });
      if (charge) await releaseCharge(ctx, charge._id, "Nothing was sent; the message waits for the inbox to be reconnected.");
      return null;
    }
    if (result.retryable && message.attempts < MAX_ATTEMPTS && message.purpose !== "verification_code") {
      // The hold stays for the next try of the same message: a retry is never a second charge.
      await ctx.db.patch(message._id, { status: "queued", problem: result.problem });
      await ctx.scheduler.runAfter(message.attempts * 30_000, internal.messaging.deliver, { messageId: message._id });
      return null;
    }
    await ctx.db.patch(message._id, { status: "failed", failedAt: now, problem: result.problem, ...(result.bounced ? { bouncedAt: now } : {}) });
    if (charge) await releaseCharge(ctx, charge._id, "The provider did not take the message, so nothing was charged.");
    await logStep(ctx, message, { type: result.bounced ? "message.bounced" : "message.failed", data: { purpose: message.purpose, attempts: message.attempts } });
    if (result.bounced) await suppressAfterProblem(ctx, message, "bounce", now);
    if (message.purpose === "member_notice") return null;
    if (message.applicationId) await afterApplicantMessage(ctx, (await ctx.db.get(message._id))!, "failed");
    else if (!message.invoiceId && !message.bookingSessionId && !message.salesLinks && message.purpose !== "earnings_statement") await afterMessageFailed(ctx, { ...message, status: "failed", problem: result.problem });
    else if (message.opportunityId) await afterSalesMessage(ctx, { ...message, status: "failed", problem: result.problem });
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
  claimed: { to: string; body: string; subject: string; replyTo: string; fromName: string; threadId: string | null },
): Promise<{ ok: true; providerMessageId: string; delivered: boolean } | { ok: false; retryable: boolean; problem: string; waitForInbox?: boolean }> {
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
      return { ok: false, retryable: false, problem: `${via.address} no longer lets Selestial send. It's waiting until the inbox is reconnected.`, waitForInbox: true };
    }
    return { ok: false, retryable: true, problem: "Google did not answer." };
  }
  // A reply joins the person's own thread: Gmail needs the thread id and a matching subject, their mail
  // program needs In-Reply-To and References. A thread that can't be found means a new conversation.
  let reply: Awaited<ReturnType<typeof threadReplyHeaders>> = null;
  if (claimed.threadId) {
    try {
      reply = await threadReplyHeaders({ token, threadId: claimed.threadId });
    } catch {
      await ctx.runMutation(internal.recruiterMailbox.sendRefused, { connectionId: via.connectionId });
      return { ok: false, retryable: false, problem: `${via.address} no longer lets Selestial send. It's waiting until the inbox is reconnected.`, waitForInbox: true };
    }
  }
  const subject = reply?.subject ? replySubject(reply.subject) : claimed.subject;
  const raw = rawMessage({ from: via.address, fromName: claimed.fromName, to: claimed.to, replyTo: claimed.replyTo || undefined, subject, text: claimed.body, messageId, inReplyTo: reply?.inReplyTo, references: reply?.references });
  const result = await sendFromGmail({ token, raw, threadId: reply ? claimed.threadId! : undefined });
  if (!result.ok && result.problem.startsWith("The company's mailbox no longer")) {
    await ctx.runMutation(internal.recruiterMailbox.sendRefused, { connectionId: via.connectionId });
    return { ok: false, retryable: false, problem: `${via.address} no longer lets Selestial send. It's waiting until the inbox is reconnected.`, waitForInbox: true };
  }
  return result;
}

export const deliver = internalAction({
  args: { messageId: v.id("messages"), code: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const claimed = await ctx.runMutation(internal.messaging.claim, { messageId: args.messageId, code: args.code });
    if (!claimed) return null;
    if (claimed.billing?.needsLock) {
      // The estimate is held in Autumn before the provider is asked. Not held: the message waits, unsent.
      const held = await reserveCharge(ctx, claimed.billing.chargeId);
      if (held !== "reserved") {
        await ctx.runMutation(internal.messagingBilling.holdMessage, {
          messageId: args.messageId,
          reason: held === "denied" ? "messaging_balance" : "billing_unavailable",
          words: held === "denied" ? "The messaging balance doesn't cover this message, so it is waiting with its content kept. Add funds to send it." : "Messaging billing could not be checked, so this message is waiting. It will be tried again; nothing was charged.",
        });
        return null;
      }
    }
    if (claimed.channel === "email" && claimed.via) {
      const result = await sendThroughMailbox(ctx, args.messageId, claimed.via, claimed);
      await ctx.runMutation(internal.messaging.settle, { messageId: args.messageId, result });
      return null;
    }
    if (claimed.channel === "email") {
      const email = claimed.notice ? noticeEmailProvider() : emailProvider();
      if (!email) {
        await ctx.runMutation(internal.messaging.settle, { messageId: args.messageId, result: { ok: false, retryable: false, problem: "Email is not connected." } });
        return null;
      }
      // As with a text: if this throws, the message stays "sending" and the sweep marks it unconfirmed. It is not sent again.
      const framed = claimed.email;
      const sent = await email.send({ to: claimed.to, fromName: claimed.fromName, replyTo: claimed.replyTo, subject: claimed.subject, text: framed?.text ?? claimed.body, idempotencyKey: args.messageId, attempt: claimed.attempt, ...(framed ? { from: framed.from, html: framed.html, headers: framed.headers } : {}) });
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
 *
 * Each outcome is kept apart: delivered; bounced (the address doesn't work); complained (it works, the
 * person called it spam); suppressed (the provider refused because of an earlier bounce or complaint);
 * failed (it didn't go, for a reason that says nothing about the address); delayed (still trying).
 * A complaint can come after "delivered", so it is accepted then too, and the delivery stands.
 */
export const receipt = internalMutation({
  args: {
    provider: v.string(),
    eventId: v.string(),
    providerMessageId: v.string(),
    outcome: v.union(v.literal("delivered"), v.literal("failed"), v.literal("bounced"), v.literal("complained"), v.literal("suppressed"), v.literal("delayed")),
    problem: v.optional(v.string()),
    /** What the provider charged Selestial for it, in units of $0.0001, when it says. */
    providerCost: v.optional(v.number()),
    errorCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("providerReceipts")
      .withIndex("by_provider_event", (q) => q.eq("provider", args.provider).eq("eventId", args.eventId))
      .first();
    if (seen) return "duplicate" as const;
    const receiptId = await ctx.db.insert("providerReceipts", { provider: args.provider, eventId: args.eventId, receivedAt: Date.now() });
    const message = await ctx.db
      .query("messages")
      .withIndex("by_provider_message", (q) => q.eq("provider", args.provider).eq("providerMessageId", args.providerMessageId))
      .first();
    if (!message) {
      // Out of order: the report beat the send's own answer, which is what records the provider's id. Kept, and
      // applied when that send settles (a later retry of this report would be a duplicate and dropped).
      await ctx.db.patch(receiptId, { early: { providerMessageId: args.providerMessageId, outcome: args.outcome, problem: args.problem, providerCost: args.providerCost, errorCode: args.errorCode } });
      return "early" as const;
    }
    // Reconciliation: what the provider charged Selestial, and no charge to the company for a text the provider did not charge for.
    await reconcileCharge(ctx, message._id, { providerCost: args.providerCost, errorCode: args.errorCode });
    if (message.status === "sending" && (args.outcome === "delivered" || args.outcome === "failed" || args.outcome === "bounced")) {
      // The report beat the send's own answer. Kept, and applied when the send settles.
      await ctx.db.patch(message._id, { earlyReceipt: { outcome: args.outcome, problem: args.problem, at: Date.now() } });
      return "deferred" as const;
    }
    return applyOutcome(ctx, message, args.outcome, args.problem);
  },
});

/** Telnyx does not charge for a text that expired in its own queue before it was sent (40014). */
const PROVIDER_NOT_CHARGED = new Set(["40014"]);

async function reconcileCharge(ctx: MutationCtx, messageId: Id<"messages">, input: { providerCost?: number; errorCode?: string }) {
  const charge = await ctx.db
    .query("messagingCharges")
    .withIndex("by_message", (q) => q.eq("messageId", messageId))
    .first();
  if (!charge) return;
  if (input.providerCost !== undefined) await ctx.db.patch(charge._id, { providerCost: input.providerCost, updatedAt: Date.now() });
  if (input.errorCode && PROVIDER_NOT_CHARGED.has(input.errorCode)) {
    if (charge.state === "captured") await refundCharge(ctx, charge._id, { reason: "The provider expired this text before sending it, so it was not charged." });
    else await releaseCharge(ctx, charge._id, "The provider expired this text before sending it.");
  }
}

async function applyOutcome(ctx: MutationCtx, message: Doc<"messages">, outcome: "delivered" | "failed" | "bounced" | "complained" | "suppressed" | "delayed", reported?: string) {
    const args = { outcome, problem: reported };
    const now = Date.now();
    const open = message.status === "sent" || message.status === "unconfirmed";

    if (args.outcome === "complained") {
      if (message.status !== "sent" && message.status !== "delivered" && message.status !== "unconfirmed") return "ignored" as const;
      if (message.complainedAt !== undefined) return "ignored" as const;
      // The message did arrive; the person doesn't want this mail. Nothing more goes to the address without a person.
      await ctx.db.patch(message._id, { complainedAt: now, ...(message.status !== "delivered" ? { status: "delivered" as const, deliveredAt: now } : {}) });
      await logStep(ctx, message, { type: "message.complained", data: { purpose: message.purpose } });
      await suppressAfterProblem(ctx, message, "complaint", now);
      return "complained" as const;
    }
    if (args.outcome === "delayed") {
      if (!open) return "ignored" as const;
      await logStep(ctx, message, { type: "message.delayed", data: { purpose: message.purpose } });
      return "delayed" as const;
    }
    if (!open) return "ignored" as const;
    if (args.outcome === "delivered") {
      await ctx.db.patch(message._id, { status: "delivered", deliveredAt: now });
      await logStep(ctx, message, { type: "message.delivered", data: { purpose: message.purpose } });
      return "delivered" as const;
    }
    const bounced = args.outcome === "bounced";
    const suppressed = args.outcome === "suppressed";
    const problem =
      args.problem ??
      (bounced
        ? "The address rejected the message."
        : suppressed
          ? "The email service didn't send it, because this address bounced or reported spam before."
          : message.channel === "email"
            ? "The email service reported that the message was not delivered."
            : "The carrier reported that the text was not delivered.");
    await ctx.db.patch(message._id, { status: "failed", failedAt: now, problem, ...(bounced ? { bouncedAt: now } : {}) });
    await logStep(ctx, message, { type: bounced ? "message.bounced" : suppressed ? "message.suppressed" : "message.failed", data: { purpose: message.purpose, attempts: message.attempts } });
    if (bounced || suppressed) await suppressAfterProblem(ctx, message, bounced ? "bounce" : "provider", now);
    if (message.purpose === "member_notice") return bounced ? ("bounced" as const) : ("failed" as const);
    if (message.applicationId) await afterApplicantMessage(ctx, (await ctx.db.get(message._id))!, "failed");
    else if (!message.invoiceId && !message.bookingSessionId && !message.salesLinks && message.purpose !== "earnings_statement") await afterMessageFailed(ctx, { ...message, status: "failed", problem });
    else if (message.opportunityId) await afterSalesMessage(ctx, { ...message, status: "failed", problem });
    return bounced ? ("bounced" as const) : ("failed" as const);
}

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
      // Not known whether the provider took it: the hold stays until it is reconciled, and is released uncharged if it never is.
      const charge = await ctx.db
        .query("messagingCharges")
        .withIndex("by_message", (q) => q.eq("messageId", message._id))
        .first();
      if (charge) await markPending(ctx, charge._id);
      await logStep(ctx, message, { type: "message.unconfirmed", data: { purpose: message.purpose } });
      if (message.purpose === "member_notice") continue;
      if (message.applicationId) await afterApplicantMessage(ctx, (await ctx.db.get(message._id))!, "failed");
      else if (!message.invoiceId && !message.bookingSessionId && !message.salesLinks && message.purpose !== "earnings_statement") await afterMessageFailed(ctx, { ...message, status: "unconfirmed", problem });
    else if (message.opportunityId) await afterSalesMessage(ctx, { ...message, status: "unconfirmed", problem });
    }
    return stuck.length;
  },
});
