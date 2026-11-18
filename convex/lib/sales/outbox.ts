/**
 * Sales messages to customers: a booking request with its payment and signing links, a confirmation, a
 * proposal link, a signing request and an assessor's findings link. Planned as `messages` rows and sent
 * through the one door (convex/messaging.ts), so the shared sending policy decides: suspension, sender
 * setup, a usable address, the do-not-contact list, recorded permission and quiet hours.
 *
 * Links are stored as placeholders and made at the moment of sending from the record each names. A
 * record that closed in the meantime (a voided invoice, a withdrawn proposal, an ended signing request)
 * stops the message instead of sending a link that no longer works.
 *
 * A message in a Sales conversation (`opportunity` set) is also written into the conversation, carries
 * the conversation's own reply address when email replies are set up, and, when the Sales agent wrote
 * it, is checked once more as it goes: a reply that arrived, a person who took over, or a closed deal
 * since it was planned stops it. Nothing written before a reply goes out after it.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { readProfile } from "../compliance/profile";
import { recordEvent, type Actor } from "../events";
import { addressFor, customerIntent, type Channel } from "../finance/outbox";
import { payToken, payUrl } from "../finance/payLinks";
import { emailProvider } from "../messaging/email";
import { messageByKey, type SendIntent } from "../messaging/outbox";
import { checkSend, type PolicyAnswer, type PolicyCode } from "../messaging/policy";
import { messagingProvider } from "../messaging/provider";
import { agentStage, type Opp } from "./agentOpportunity";
import { linkToken, linkUrl } from "./links";
import { replyAddressFor } from "./replyAddress";

export type SalesPurpose = "booking_request" | "booking_confirmed" | "proposal_sent" | "signature_request" | "assessment_link" | "sales_reply" | "sales_quote" | "sales_follow_up" | "sales_booking";
export type SalesLink = { placeholder: string; kind: "pay" | "proposal" | "sign" | "assess" | "quote"; id: string };

type Ctx = QueryCtx | MutationCtx;

/** Where a Sales message started, for the policy. A person sending by hand is never held by pausing the agent. */
export function salesIntent(customer: Pick<Doc<"customers">, "_id">, actor: Actor, purpose: SalesPurpose): SendIntent {
  if (actor.kind !== "agent") return customerIntent(customer);
  return { category: "operational", origin: purpose === "sales_follow_up" ? "follow_up" : "agent", agent: "sales", recipient: { kind: "customer", id: customer._id } };
}

export type PlannedSalesMessage = {
  company: Doc<"companies">;
  customer: Doc<"customers">;
  /** The conversation it belongs to, when there is one. */
  opportunity?: Opp | null;
  /** The agent's prepared action it carries out. */
  actionId?: Id<"salesActions">;
  purpose: SalesPurpose;
  channel: Channel;
  /** Send to this address instead of the customer's (a named signer or a site contact). */
  to?: string;
  subject?: string;
  body: string;
  links: SalesLink[];
  dedupeKey: string;
  actor: Actor;
};

export async function ownMailbox(ctx: Ctx, companyId: Id<"companies">) {
  return (
    await ctx.db
      .query("mailboxConnections")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(20)
  ).find((row) => row.provider === "gmail" && row.canSend && row.status === "connected");
}

/** Plans one message and hands it to the sender. Asked twice with the same key, it answers with the first. */
export async function queueSalesMessage(ctx: MutationCtx, planned: PlannedSalesMessage): Promise<Doc<"messages">> {
  const existing = await messageByKey(ctx, planned.company._id, planned.dedupeKey);
  if (existing) return existing;
  const { company, customer, channel } = planned;
  const email = channel === "email";
  const to = planned.to?.trim() ? planned.to.trim().toLowerCase() : addressFor(customer, channel);
  const provider = email ? ((await ownMailbox(ctx, company._id)) ? { name: "gmail" } : emailProvider()) : messagingProvider();
  let problem: string | null = null;
  if (!to) problem = email ? "There is no valid email address to send to." : "There is no valid phone number to send to.";
  else if (!provider) problem = email ? "Email isn't connected for Selestial yet." : "Texting isn't connected for Selestial yet.";
  const now = Date.now();
  const intent = salesIntent(customer, planned.actor, planned.purpose);
  const opportunity = planned.opportunity ?? null;
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
  const messageId = await ctx.db.insert("messages", {
    companyId: company._id,
    purpose: planned.purpose,
    channel,
    subject: email ? planned.subject : undefined,
    // Replies come back to the conversation when the receiving domain is set up; otherwise to the company's own address.
    ...(email && opportunity ? { replyTo: (await replyAddressFor(ctx, opportunity)) ?? (await readProfile(ctx, company._id)).identity.supportEmail ?? undefined } : {}),
    customerId: customer._id,
    salesLinks: planned.links,
    ...(opportunity ? { opportunityId: opportunity._id } : {}),
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
  if (opportunity) {
    await ctx.db.insert("salesMessages", {
      companyId: company._id,
      opportunityId: opportunity._id,
      customerId: customer._id,
      direction: "out",
      channel,
      author: planned.actor.kind === "member" ? { kind: "member", memberId: planned.actor.memberId } : planned.actor.kind === "agent" ? { kind: "agent" } : { kind: "system" },
      subject: email ? planned.subject : undefined,
      body: planned.body,
      messageId,
      actionId: planned.actionId,
      at: now,
    });
    // The first message that actually leaves is the first response. A refused one is not a response.
    if (status !== "not_sent") await ctx.db.patch(opportunity._id, { lastOutboundAt: now, ...(opportunity.firstResponseAt === undefined ? { firstResponseAt: now } : {}), updatedAt: now });
  }
  await recordEvent(ctx, { companyId: company._id, type: `message.${status}`, actor: planned.actor, subject: { table: "messages", id: messageId }, data: { purpose: planned.purpose, channel, ...(opportunity ? { opportunityId: opportunity._id } : {}), ...(code ? { policy: code } : {}) } });
  if (status === "queued") await ctx.scheduler.runAfter(0, internal.messaging.deliver, { messageId });
  if (status === "held") await ctx.scheduler.runAt(retryAt!, internal.messaging.deliver, { messageId });
  return (await ctx.db.get(messageId))!;
}

/**
 * At the moment of sending: every linked record still open, and its link made now. `automated` is true
 * when the Sales agent wrote it: then a person who took over, a closed deal or a reply since it was planned
 * stops it.
 */
export async function salesClaim(ctx: MutationCtx, message: Doc<"messages">, automated = false): Promise<{ problem: string } | { body: string; fromName: string; via: { connectionId: Id<"mailboxConnections">; address: string } | null }> {
  if (automated && message.opportunityId) {
    const opportunity = await ctx.db.get(message.opportunityId);
    if (!opportunity) return { problem: "The opportunity no longer exists." };
    if (opportunity.followUps === "paused") return { problem: "A person took over this conversation before the message went out, so the agent did not send it." };
    if (agentStage(opportunity) === "closed_lost") return { problem: "The opportunity was closed before the message went out." };
    if (opportunity.lastInboundAt !== undefined && opportunity.lastInboundAt > message.queuedAt) return { problem: "The customer replied before this message went out, so it was not sent. The agent reads the reply first." };
  }
  let body = message.body;
  for (const link of message.salesLinks ?? []) {
    let url: string | null = null;
    if (link.kind === "pay") {
      const invoice = await ctx.db.get(link.id as Id<"invoices">);
      if (!invoice || invoice.companyId !== message.companyId || invoice.status === "void" || invoice.status === "draft") return { problem: "The invoice was voided before the message went out." };
      const token = await payToken(invoice);
      url = token ? payUrl(token) : null;
    } else if (link.kind === "proposal") {
      const proposal = await ctx.db.get(link.id as Id<"proposals">);
      if (!proposal || proposal.companyId !== message.companyId || !proposal.publicId || (proposal.status !== "sent" && proposal.status !== "changes_requested")) return { problem: "The proposal was withdrawn or replaced before the message went out." };
      const token = await linkToken("proposal", proposal.publicId);
      url = token ? linkUrl("proposal", token) : null;
    } else if (link.kind === "sign") {
      const row = await ctx.db.get(link.id as Id<"agreementSigningLinks">);
      const request = row ? await ctx.db.get(row.requestId) : null;
      if (!row || row.companyId !== message.companyId || !request || (request.status !== "sent" && request.status !== "partially_signed" && request.status !== "queued")) return { problem: "The signing request ended before the message went out." };
      const token = await linkToken("sign", row.publicId);
      url = token ? linkUrl("sign", token) : null;
    } else if (link.kind === "quote") {
      const quote = await ctx.db.get(link.id as Id<"salesQuotes">);
      if (!quote || quote.companyId !== message.companyId || !quote.publicId) return { problem: "The quote no longer exists." };
      if (quote.status === "withdrawn" || quote.status === "superseded") return { problem: "The quote was withdrawn or replaced before the message went out." };
      if (quote.status === "expired" || (quote.status === "sent" && quote.expiresAt <= Date.now())) return { problem: "The quote expired before the message went out." };
      const token = await linkToken("quote", quote.publicId);
      url = token ? linkUrl("quote", token) : null;
    } else {
      const assessment = await ctx.db.get(link.id as Id<"assessments">);
      if (!assessment || assessment.companyId !== message.companyId || !assessment.publicId || assessment.status === "completed" || assessment.status === "cancelled") return { problem: "The assessment was completed or cancelled before the message went out." };
      const token = await linkToken("assess", assessment.publicId);
      url = token ? linkUrl("assess", token) : null;
    }
    if (!url) return { problem: "Links aren't set up, so there was no link to send." };
    body = body.replaceAll(link.placeholder, url);
  }
  const company = await ctx.db.get(message.companyId);
  const profile = await readProfile(ctx, message.companyId);
  const fromName = profile.messaging.senderName?.trim() || company?.name || "";
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

/** The customer's preferred channel for links: email when there is a usable address, else text. */
export function channelFor(customer: Doc<"customers">, override?: string): Channel {
  if (override?.includes("@")) return "email";
  return addressFor(customer, "email") ? "email" : "sms";
}

/** Whether a Sales message could reach this person on this channel now, and if not, why, in the policy's words. */
export async function canReach(ctx: Ctx, companyId: Id<"companies">, customer: Doc<"customers">, channel: Channel, actor: Actor = { kind: "agent", agent: "sales" }): Promise<PolicyAnswer & { address: string | null; connected: boolean }> {
  const address = addressFor(customer, channel);
  const connected = channel === "sms" ? messagingProvider() !== null : (await ownMailbox(ctx, companyId)) !== undefined || emailProvider() !== null;
  if (!connected) return { ok: false, code: "sender_not_ready", words: channel === "email" ? "Email isn't connected for Selestial yet." : "Texting isn't connected for Selestial yet.", address, connected: false };
  const answer = await checkSend(ctx, { companyId, channel, to: address ?? "", now: Date.now(), ...salesIntent(customer, actor, "sales_reply") });
  if (!answer.ok) return { ...answer, words: answer.words.replace(/\bwork (emails|texts)\b/, "$1 about their request"), address, connected: true };
  return { ...answer, address, connected: true };
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
 * A message in a Sales conversation did not go, or nobody knows whether it did. The agent's action is
 * marked, reminders stop (a second message to an address that just failed helps nobody), and the
 * opportunity goes to a person with what happened. An unconfirmed send is never repeated by the agent.
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
  if (opportunity.stage === "won" || opportunity.stage === "lost") return;
  const customer = opportunity.customerId ? await ctx.db.get(opportunity.customerId) : null;
  const email = (message.channel ?? "sms") === "email";
  const who = customer?.name ?? "the customer";
  const what = unknown ? `It is not known whether ${email ? "an email" : "a text"} to ${who} went. It was not sent again: check with them before sending another.` : `${email ? "An email" : "A text"} to ${who} did not go through: ${why} Reach them another way or correct the address.`;
  await ctx.db.patch(opportunity._id, { nextAction: what.slice(0, 300), nextBy: "owner", nextActionAt: Date.now() + 4 * 60 * 60_000, updatedAt: Date.now() });
  await recordEvent(ctx, { companyId: opportunity.companyId, type: unknown ? "opportunity.send_unknown" : "opportunity.send_failed", actor: { kind: "system" }, subject: { table: "salesOpportunities", id: opportunity._id }, data: { channel: message.channel ?? "sms" } });
}
