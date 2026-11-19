/**
 * Retention's messages to customers: a feedback request, an update about an open case, a question about
 * whether a correction worked, a return offer. Planned as `messages` rows and sent through the one door
 * (convex/messaging.ts), so the shared sending policy decides: suspension, a paused agent, sender setup,
 * a usable address, the do-not-contact list, recorded permission, quiet hours and weekly limits.
 *
 * Before anything is planned, Retention checks that the conversation is its to write in: a person who
 * took the conversation over, a case a person holds, and an open Sales conversation each stop it, so two
 * agents never answer the same customer at once. The same checks run again as the message goes, and its
 * private link is made only then.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { readProfile } from "../compliance/profile";
import type { Category, Origin } from "../compliance/schema";
import { recordEvent, type Actor } from "../events";
import { addressFor, type Channel } from "../finance/outbox";
import { emailProvider } from "../messaging/email";
import { messageByKey, type SendIntent } from "../messaging/outbox";
import { checkSend, type PolicyAnswer, type PolicyCode } from "../messaging/policy";
import { messagingProvider } from "../messaging/provider";
import { ownMailbox } from "../sales/outbox";
import { careLinkState, careLinkUrl } from "./links";

type Ctx = QueryCtx | MutationCtx;
export type CarePurpose = "feedback_request" | "care_update" | "return_offer";

/** The customer's preferred channel when it has a usable address, otherwise email, otherwise text. */
export function careChannel(customer: Doc<"customers">): Channel | null {
  const preferred = customer.communication?.preferredChannel;
  if ((preferred === "sms" || preferred === "email") && addressFor(customer, preferred)) return preferred;
  if (addressFor(customer, "email")) return "email";
  return addressFor(customer, "sms") ? "sms" : null;
}

/** A return offer is marketing and needs that permission. Everything else is about a service the customer had. */
export function careIntent(customer: Pick<Doc<"customers">, "_id">, purpose: CarePurpose, actor: Actor): SendIntent {
  const category: Category = purpose === "return_offer" ? "marketing" : "operational";
  const origin: Origin = actor.kind !== "agent" ? "manual" : purpose === "return_offer" ? "win_back" : "agent";
  return { category, origin, ...(actor.kind === "agent" ? { agent: "retention" as const } : {}), recipient: { kind: "customer", id: customer._id } };
}

/**
 * Whose conversation this is right now. Retention writes to a customer only when nobody else is: a person
 * who took over, or Sales working an open request with them, comes first.
 */
export async function conversationOwner(ctx: Ctx, customer: Doc<"customers">): Promise<{ free: true } | { free: false; who: "person" | "sales"; words: string }> {
  if (customer.conversationHeld) return { free: false, who: "person", words: "A person is handling this customer's conversation, so Retention sends nothing until it is handed back." };
  const opportunities = await ctx.db
    .query("salesOpportunities")
    .withIndex("by_company_customer", (q) => q.eq("companyId", customer.companyId).eq("customerId", customer._id))
    .take(20);
  if (opportunities.some((row) => row.stage !== "won" && row.stage !== "lost" && row.followUps === "on")) {
    return { free: false, who: "sales", words: "Sales is in conversation with this customer about an open request, so Retention does not write to them at the same time." };
  }
  return { free: true };
}

/**
 * Selestial does not meter or cap a company's texts and emails yet, so there is no messaging balance to
 * check. The screens say so instead of showing a made-up number.
 */
export const MESSAGING_BALANCE = { metered: false as const, words: "Messaging usage is not metered in Selestial yet, so there is no balance to check." };

/** Whether a Retention message could reach this customer on this channel now, and if not, why. */
export async function canReach(ctx: Ctx, customer: Doc<"customers">, channel: Channel, purpose: CarePurpose, actor: Actor): Promise<PolicyAnswer & { address: string | null }> {
  const address = addressFor(customer, channel);
  const connected = channel === "sms" ? messagingProvider() !== null : (await ownMailbox(ctx, customer.companyId)) !== undefined || emailProvider() !== null;
  if (!connected) return { ok: false, code: "sender_not_ready", words: channel === "email" ? "Email isn't connected for Selestial yet." : "Texting isn't connected for Selestial yet.", address };
  const answer = await checkSend(ctx, { companyId: customer.companyId, channel, to: address ?? "", now: Date.now(), ...careIntent(customer, purpose, actor) });
  if (!answer.ok) return { ...answer, words: answer.words.replace(/\bwork (emails|texts)\b/, "service $1"), address };
  return { ...answer, address };
}

export type PlannedCareMessage = {
  company: Doc<"companies">;
  customer: Doc<"customers">;
  action: Doc<"retentionActions">;
  purpose: CarePurpose;
  channel: Channel;
  subject?: string;
  /** With "{link}" where the customer's private link goes, when the message carries one. */
  body: string;
  jobId?: Id<"jobs">;
  dedupeKey: string;
  actor: Actor;
};

/** Plans one message and hands it to the sender. Asked twice with the same key, it answers with the first. */
export async function queueCareMessage(ctx: MutationCtx, planned: PlannedCareMessage): Promise<Doc<"messages">> {
  const existing = await messageByKey(ctx, planned.company._id, planned.dedupeKey);
  if (existing) return existing;
  const { company, customer, channel } = planned;
  const email = channel === "email";
  const to = addressFor(customer, channel);
  const provider = email ? ((await ownMailbox(ctx, company._id)) ? { name: "gmail" } : emailProvider()) : messagingProvider();
  const intent = careIntent(customer, planned.purpose, planned.actor);
  const now = Date.now();
  let problem: string | null = null;
  let code: PolicyCode | null = null;
  let refusal: string | undefined;
  let retryAt: number | undefined;
  if (!to) problem = email ? "There is no valid email address for this customer." : "There is no valid phone number for this customer.";
  else if (!provider) problem = email ? "Email isn't connected for Selestial yet." : "Texting isn't connected for Selestial yet.";
  // An agent's message waits for whoever holds the conversation. A person sending by hand is not stopped by this.
  if (!problem && planned.actor.kind === "agent") {
    const owner = await conversationOwner(ctx, customer);
    if (!owner.free) {
      problem = owner.words;
      refusal = owner.who === "person" ? "conversation_held" : "conversation_with_sales";
    }
  }
  if (!problem && to) {
    const answer = await checkSend(ctx, { companyId: company._id, channel, to, now, ...intent });
    if (!answer.ok) {
      problem = answer.words.replace(/\bwork (emails|texts)\b/, "service $1");
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
    ...(email ? { replyTo: (await readProfile(ctx, company._id)).identity.supportEmail ?? undefined } : {}),
    customerId: customer._id,
    jobId: planned.jobId,
    retentionActionId: planned.action._id,
    draftedBy: planned.actor.kind === "agent" ? "agent" : "person",
    ...(planned.actor.kind === "member" ? { authorId: planned.actor.memberId } : {}),
    to: status === "not_sent" ? undefined : (to ?? undefined),
    body: planned.body,
    dedupeKey: planned.dedupeKey,
    status,
    attempts: 0,
    provider: provider?.name,
    problem: problem ?? undefined,
    refusal: status === "not_sent" ? (code ?? refusal) : undefined,
    queuedAt: now,
  });
  if (status !== "not_sent" && to) await ctx.db.insert("sendIntents", { companyId: company._id, messageId, channel, address: to, at: now, ...intent });
  await recordEvent(ctx, { companyId: company._id, type: `message.${status}`, actor: planned.actor, subject: { table: "messages", id: messageId }, data: { purpose: planned.purpose, channel, ...(code ? { policy: code } : {}), ...(refusal ? { refusal } : {}) } });
  if (status === "queued") await ctx.scheduler.runAfter(0, internal.messaging.deliver, { messageId });
  if (status === "held") await ctx.scheduler.runAt(retryAt!, internal.messaging.deliver, { messageId });
  return (await ctx.db.get(messageId))!;
}

/**
 * At the moment of sending: the action is still the one to carry out, its case is still open and not
 * held by a person, the conversation is still Retention's, and the link (if the message has one) is
 * still open. The link's address is made now and never stored.
 */
export async function careClaim(ctx: MutationCtx, message: Doc<"messages">): Promise<{ problem: string } | { body: string; fromName: string; via: { connectionId: Id<"mailboxConnections">; address: string } | null }> {
  const action = message.retentionActionId ? await ctx.db.get(message.retentionActionId) : null;
  if (!action || action.companyId !== message.companyId) return { problem: "The case this message belongs to no longer exists." };
  const row = await ctx.db.get(action.caseId);
  if (!row || row.status === "closed") return { problem: "The case was closed before the message went out." };
  if (action.status !== "underway") return { problem: "This message was withdrawn before it went out." };
  const customer = message.customerId ? await ctx.db.get(message.customerId) : null;
  if (!customer) return { problem: "The customer no longer exists." };
  if (message.draftedBy === "agent") {
    if (row.heldBy || row.serious) return { problem: "A person took over this case before the message went out, so Retention did not send it." };
    const owner = await conversationOwner(ctx, customer);
    if (!owner.free) return { problem: owner.words };
  }
  let body = message.body;
  if (body.includes("{link}")) {
    const link = action.linkId ? await ctx.db.get(action.linkId) : null;
    if (!link || careLinkState(link, Date.now()) !== "active") return { problem: "The link was closed before the message went out." };
    const url = await careLinkUrl(link);
    if (!url) return { problem: "Links aren't set up, so there was no link to send." };
    body = body.replaceAll("{link}", url);
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

export function deliveryWords(message: Pick<Doc<"messages">, "status" | "problem">): { state: "pending" | "sent" | "delivered" | "failed" | "unknown" | "not_sent"; words: string } {
  switch (message.status) {
    case "queued":
    case "sending":
      return { state: "pending", words: "Sending" };
    case "held":
      return { state: "pending", words: message.problem ?? "Held until quiet hours end" };
    case "sent":
      return { state: "sent", words: "Sent. Delivery not yet confirmed." };
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
