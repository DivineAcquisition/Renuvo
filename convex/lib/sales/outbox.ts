/**
 * Messages from Sales to a person who asked about service: planned as `messages` rows and sent through
 * the same door as every other message (convex/messaging.ts), so the one sending policy decides:
 * suspension, a paused agent, sender setup, a usable address, the do-not-contact list, recorded
 * permission and quiet hours. Sales adds nothing of its own to that policy and takes nothing away.
 *
 * An inquiry reply is "operational": it answers the person's own request. Permission still has to be on
 * record: a text the person sent, a box they ticked on a form, or what a person at the company recorded.
 * An imported contact is not permission, and the policy refuses it.
 *
 * The message is checked a second time at the moment it goes (`salesClaim`): a reply that arrived, a
 * person who took over, or a quote that was revised since it was planned stops it. The quote link is
 * "{link}" until then, so no token is ever at rest.
 */
import { replyAddressFor } from "./replyAddress";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { readProfile } from "../compliance/profile";
import { normalAddress } from "../compliance/recipients";
import type { Channel } from "../compliance/schema";
import { recordEvent, type Actor } from "../events";
import { ownMailbox } from "../finance/outbox";
import { emailProvider } from "../messaging/email";
import { messageByKey, type SendIntent } from "../messaging/outbox";
import { checkSend, type PolicyAnswer, type PolicyCode } from "../messaging/policy";
import { messagingProvider } from "../messaging/provider";
import { quoteToken, quoteUrl } from "./links";

type Ctx = QueryCtx | MutationCtx;
export type SalesPurpose = "sales_reply" | "sales_quote" | "sales_follow_up" | "sales_booking";

/** Where a Sales message started, for the policy. A person sending by hand is never held by pausing Sales. */
export function salesIntent(customer: Pick<Doc<"customers">, "_id">, actor: Actor, purpose: SalesPurpose): SendIntent {
  const recipient = { kind: "customer" as const, id: customer._id };
  if (actor.kind === "member") return { category: "operational", origin: "manual", recipient };
  return { category: "operational", origin: purpose === "sales_follow_up" ? "follow_up" : "agent", agent: "sales", recipient };
}

export function addressFor(customer: Pick<Doc<"customers">, "email" | "phone">, channel: Channel): string | null {
  return normalAddress(channel, channel === "email" ? customer.email : customer.phone);
}

async function connected(ctx: Ctx, companyId: Id<"companies">, channel: Channel): Promise<{ name: string } | null> {
  if (channel === "sms") return messagingProvider();
  return (await ownMailbox(ctx, companyId)) ? { name: "gmail" } : emailProvider();
}

/** Whether Sales could message this person on this channel now, and if not, why, in the policy's words. */
export async function canReach(ctx: Ctx, companyId: Id<"companies">, customer: Doc<"customers">, channel: Channel, actor: Actor = { kind: "agent", agent: "sales" }): Promise<PolicyAnswer & { address: string | null; connected: boolean }> {
  const address = addressFor(customer, channel);
  const provider = await connected(ctx, companyId, channel);
  if (!provider) return { ok: false, code: "sender_not_ready", words: channel === "email" ? "Email isn't connected for Selestial yet." : "Texting isn't connected for Selestial yet.", address, connected: false };
  const answer = await checkSend(ctx, { companyId, channel, to: address ?? "", now: Date.now(), ...salesIntent(customer, actor, "sales_reply") });
  if (!answer.ok) return { ...answer, words: answer.words.replace(/\bwork (emails|texts)\b/, "$1 about their request"), address, connected: true };
  return { ...answer, address, connected: true };
}

export type PlannedSalesMessage = {
  company: Doc<"companies">;
  opportunity: Doc<"salesOpportunities">;
  customer: Doc<"customers">;
  purpose: SalesPurpose;
  channel: Channel;
  subject?: string;
  /** With "{link}" where the quote link goes. */
  body: string;
  quoteId?: Id<"salesQuotes">;
  actionId?: Id<"salesActions">;
  dedupeKey: string;
  actor: Actor;
};

/**
 * Plans one message, records it in the conversation, and hands it to the sender. Asked twice for the
 * same message, it answers with the first. A message the policy refuses is kept as not sent, with the
 * policy's words, and still appears in the conversation so nobody thinks it went.
 */
export async function queueSalesMessage(ctx: MutationCtx, planned: PlannedSalesMessage): Promise<Doc<"messages">> {
  const existing = await messageByKey(ctx, planned.company._id, planned.dedupeKey);
  if (existing) return existing;
  const { company, customer, opportunity, channel } = planned;
  const to = addressFor(customer, channel);
  const email = channel === "email";
  const provider = await connected(ctx, company._id, channel);
  let problem: string | null = null;
  if (!to) problem = email ? "There is no valid email address for this person." : "There is no valid phone number for this person.";
  else if (!provider) problem = email ? "Email isn't connected for Selestial yet." : "Texting isn't connected for Selestial yet.";
  const now = Date.now();
  const intent = salesIntent(customer, planned.actor, planned.purpose);
  let code: PolicyCode | null = null;
  let retryAt: number | undefined;
  if (!problem && to) {
    const answer = await checkSend(ctx, { companyId: company._id, channel, to, now, ...intent });
    if (!answer.ok) {
      problem = answer.words;
      code = answer.code;
      retryAt = answer.retryAt;
    }
  }
  const status = !problem ? "queued" : retryAt !== undefined ? "held" : "not_sent";
  const profile = await readProfile(ctx, company._id);
  const messageId = await ctx.db.insert("messages", {
    companyId: company._id,
    purpose: planned.purpose,
    channel,
    subject: email ? planned.subject : undefined,
    // Replies come back to this conversation when the receiving domain is set up; otherwise to the company's own address.
    replyTo: email ? ((await replyAddressFor(ctx, opportunity)) ?? profile.identity.supportEmail ?? undefined) : undefined,
    customerId: customer._id,
    opportunityId: opportunity._id,
    salesQuoteId: planned.quoteId,
    to: status === "not_sent" ? undefined : (to ?? undefined),
    body: planned.body,
    dedupeKey: planned.dedupeKey,
    status,
    attempts: 0,
    provider: provider?.name,
    problem: problem ?? undefined,
    refusal: status === "not_sent" && code ? code : undefined,
    queuedAt: now,
  });
  if (status !== "not_sent" && to) await ctx.db.insert("sendIntents", { companyId: company._id, messageId, channel, address: to, at: now, ...intent });
  await ctx.db.insert("salesMessages", {
    companyId: company._id,
    opportunityId: opportunity._id,
    customerId: customer._id,
    direction: "out",
    channel,
    author: planned.actor.kind === "member" ? { kind: "member", memberId: planned.actor.memberId } : { kind: "agent" },
    subject: email ? planned.subject : undefined,
    body: planned.body,
    messageId,
    actionId: planned.actionId,
    at: now,
  });
  await recordEvent(ctx, { companyId: company._id, type: `message.${status}`, actor: planned.actor, subject: { table: "messages", id: messageId }, data: { purpose: planned.purpose, channel, opportunityId: opportunity._id, ...(code ? { policy: code } : {}), ...(retryAt !== undefined ? { retryAt } : {}) } });
  if (status !== "not_sent") {
    // The first message that actually leaves is the first response. A refused one is not a response.
    await ctx.db.patch(opportunity._id, { lastOutboundAt: now, ...(opportunity.firstResponseAt === undefined ? { firstResponseAt: now } : {}), updatedAt: now });
  }
  if (status === "queued") await ctx.scheduler.runAfter(0, internal.messaging.deliver, { messageId });
  if (status === "held") await ctx.scheduler.runAt(retryAt!, internal.messaging.deliver, { messageId });
  return (await ctx.db.get(messageId))!;
}

/**
 * At the moment of sending: is this message still true, and still Sales's to send? Returns words for why
 * it can't go, or what to send and as whom. The quote link is made only now.
 */
export async function salesClaim(
  ctx: MutationCtx,
  message: Doc<"messages">,
  automated: boolean,
): Promise<{ problem: string } | { body: string; fromName: string; via: { connectionId: Id<"mailboxConnections">; address: string } | null }> {
  const opportunity = message.opportunityId ? await ctx.db.get(message.opportunityId) : null;
  const company = await ctx.db.get(message.companyId);
  if (!opportunity || !company) return { problem: "The opportunity no longer exists." };
  if (automated) {
    // A person stepping in, a decline, or a reply that arrived after this was planned: Sales does not talk over any of them.
    if (opportunity.takeover) return { problem: "A person took over this conversation before the message went out, so Sales did not send it." };
    if (opportunity.stage === "closed_lost") return { problem: "The opportunity was closed before the message went out." };
    if (opportunity.lastInboundAt !== undefined && opportunity.lastInboundAt > message.queuedAt) return { problem: "The customer replied before this message went out, so it was not sent. Sales reads the reply first." };
  }
  let body = message.body;
  if (body.includes("{link}")) {
    const quote = message.salesQuoteId ? await ctx.db.get(message.salesQuoteId) : null;
    if (!quote || quote.companyId !== message.companyId) return { problem: "The quote no longer exists." };
    if (quote.status === "revoked") return { problem: "The quote was withdrawn before the message went out." };
    if (quote.status === "expired") return { problem: "The quote expired before the message went out." };
    const token = await quoteToken(quote);
    if (!token) return { problem: "Quote links aren't set up, so there was no link to send." };
    body = body.replaceAll("{link}", quoteUrl(token));
  }
  const profile = await readProfile(ctx, message.companyId);
  const fromName = profile.messaging.senderName?.trim() || company.name;
  let via: { connectionId: Id<"mailboxConnections">; address: string } | null = null;
  if ((message.channel ?? "sms") === "email") {
    const own = await ownMailbox(ctx, message.companyId);
    if (own) {
      via = { connectionId: own._id, address: own.address };
      await ctx.db.patch(message._id, { provider: "gmail" });
    }
  }
  return { body, fromName, via };
}

/** The messages about one opportunity, oldest first, for delivery states in the conversation. */
export async function opportunityMessages(ctx: Ctx, opportunity: Pick<Doc<"salesOpportunities">, "_id" | "companyId">): Promise<Doc<"messages">[]> {
  return ctx.db
    .query("messages")
    .withIndex("by_company_opportunity", (q) => q.eq("companyId", opportunity.companyId).eq("opportunityId", opportunity._id))
    .take(300);
}

/** How a message's delivery reads to an owner. "Delivered" is the provider's word; nothing records "read". */
export function deliveryWords(message: Pick<Doc<"messages">, "status" | "problem" | "channel">): { state: "pending" | "sent" | "delivered" | "failed" | "unknown" | "not_sent"; words: string } {
  switch (message.status) {
    case "queued":
    case "sending":
      return { state: "pending", words: "Sending" };
    case "held":
      return { state: "pending", words: message.problem ?? "Held until quiet hours end" };
    case "sent":
      return { state: "sent", words: "Sent" };
    case "delivered":
      return { state: "delivered", words: "Delivered" };
    case "failed":
      return { state: "failed", words: message.problem ?? "Not delivered" };
    case "unconfirmed":
      return { state: "unknown", words: "Not known whether it went. It was not sent again." };
    case "not_sent":
      return { state: "not_sent", words: message.problem ?? "Not sent" };
  }
}

/**
 * A Sales message did not go, or nobody knows whether it did. The draft it came from is marked, any
 * reminders stop (a second message to an address that just failed helps nobody), and the opportunity
 * goes to a person with what happened. An unconfirmed send is never repeated by Sales: only a person,
 * who can ask the customer, knows whether to send again.
 */
export async function afterSalesMessage(ctx: MutationCtx, message: Doc<"messages">): Promise<void> {
  const opportunity = message.opportunityId ? await ctx.db.get(message.opportunityId) : null;
  if (!opportunity) return;
  const entry = await ctx.db
    .query("salesMessages")
    .withIndex("by_company_message", (q) => q.eq("companyId", message.companyId).eq("messageId", message._id))
    .first();
  const action = entry?.actionId ? await ctx.db.get(entry.actionId) : null;
  const unknown = message.status === "unconfirmed";
  const why = message.problem ?? (unknown ? "It is not known whether the message went." : "The message was not delivered.");
  if (action && action.status === "sent") await ctx.db.patch(action._id, { status: "failed", result: unknown ? `Unknown. ${why}` : `Not delivered. ${why}`, updatedAt: Date.now() });
  const scheduled = await ctx.db
    .query("salesFollowUps")
    .withIndex("by_company_opportunity", (q) => q.eq("companyId", opportunity.companyId).eq("opportunityId", opportunity._id))
    .take(50);
  for (const row of scheduled) if (row.status === "scheduled") await ctx.db.patch(row._id, { status: "stopped", stopReason: "A message to this customer did not go through.", doneAt: Date.now() });
  if (opportunity.stage === "won" || opportunity.stage === "closed_lost") return;
  const customer = await ctx.db.get(opportunity.customerId);
  const email = (message.channel ?? "sms") === "email";
  const who = customer?.name ?? "the customer";
  const what = unknown ? `It is not known whether ${email ? "an email" : "a text"} to ${who} went. It was not sent again: check with them before sending another.` : `${email ? "An email" : "A text"} to ${who} did not go through: ${why} Reach them another way or correct the address.`;
  await ctx.db.patch(opportunity._id, { nextAction: { what: what.slice(0, 300), by: "owner", dueAt: Date.now() + 4 * 60 * 60_000 }, updatedAt: Date.now() });
  await recordEvent(ctx, { companyId: opportunity.companyId, type: unknown ? "opportunity.send_unknown" : "opportunity.send_failed", actor: { kind: "system" }, subject: { table: "salesOpportunities", id: opportunity._id }, data: { channel: message.channel ?? "sms" } });
}
