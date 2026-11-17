/**
 * Messages to customers about invoices: planned as `messages` rows and sent through the same door as
 * every other message (convex/messaging.ts), so the one sending policy decides: suspension, sender
 * setup, a usable address, the do-not-contact list, recorded permission and quiet hours. A billing
 * message is operational, sent by a person (the Owner approved it), to this customer.
 *
 * The pay link is "{link}" until the moment of sending, when it is made from the invoice. An invoice
 * voided or paid in the meantime stops a message that would no longer be true.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { readProfile } from "../compliance/profile";
import { normalAddress } from "../compliance/recipients";
import { recordEvent, type Actor } from "../events";
import { emailProvider } from "../messaging/email";
import { messageByKey, type SendIntent } from "../messaging/outbox";
import { checkSend, type PolicyAnswer, type PolicyCode } from "../messaging/policy";
import { messagingProvider } from "../messaging/provider";
import { amountRequested } from "./invoiceState";
import { payToken, payUrl } from "./payLinks";

type Ctx = QueryCtx | MutationCtx;
export type Channel = "email" | "sms";

export function customerIntent(customer: Pick<Doc<"customers">, "_id">): SendIntent {
  return { category: "operational", origin: "manual", recipient: { kind: "customer", id: customer._id } };
}

export function addressFor(customer: Pick<Doc<"customers">, "email" | "phone">, channel: Channel): string | null {
  return normalAddress(channel, channel === "email" ? customer.email : customer.phone);
}

async function ownMailbox(ctx: Ctx, companyId: Id<"companies">) {
  return (
    await ctx.db
      .query("mailboxConnections")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(20)
  ).find((row) => row.provider === "gmail" && row.canSend && row.status === "connected");
}

/** Whether a message on this channel could go to this customer now, and if not, why, in the policy's words. */
export async function canSend(ctx: Ctx, companyId: Id<"companies">, customer: Doc<"customers">, channel: Channel): Promise<PolicyAnswer & { address: string | null; connected: boolean }> {
  const address = addressFor(customer, channel);
  const connected = channel === "email" ? Boolean((await ownMailbox(ctx, companyId)) || emailProvider()) : Boolean(messagingProvider());
  if (!connected) return { ok: false, code: "sender_not_ready", words: channel === "email" ? "Email isn't connected for Selestial yet." : "Texting isn't connected for Selestial yet.", address, connected };
  const answer = await checkSend(ctx, { companyId, channel, to: address ?? "", now: Date.now(), ...customerIntent(customer) });
  // The shared policy calls operational messages "work" messages; to a customer they are billing messages.
  if (!answer.ok) return { ...answer, words: answer.words.replace(/\bwork (emails|texts)\b/, "billing $1"), address, connected };
  return { ...answer, address, connected };
}

export type PlannedCustomerMessage = {
  company: Doc<"companies">;
  invoice: Doc<"invoices">;
  customer: Doc<"customers">;
  purpose: "invoice_sent" | "payment_reminder";
  channel: Channel;
  subject?: string;
  /** With "{link}" where the pay link goes. */
  body: string;
  replyTo: string | null;
  dedupeKey: string;
  actor: Actor;
};

/** Plans one customer message and hands it to the sender. Asked twice for the same message, it answers with the first. */
export async function queueCustomerMessage(ctx: MutationCtx, planned: PlannedCustomerMessage): Promise<Doc<"messages">> {
  const existing = await messageByKey(ctx, planned.company._id, planned.dedupeKey);
  if (existing) return existing;
  const { company, customer, invoice, channel } = planned;
  const to = addressFor(customer, channel);
  const email = channel === "email";
  const provider = email ? ((await ownMailbox(ctx, company._id)) ? { name: "gmail" } : emailProvider()) : messagingProvider();
  let problem: string | null = null;
  if (!to) problem = email ? "There is no valid email address for this customer." : "There is no valid phone number for this customer.";
  else if (!provider) problem = email ? "Email isn't connected for Selestial yet." : "Texting isn't connected for Selestial yet.";
  const now = Date.now();
  const intent = customerIntent(customer);
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
    replyTo: email ? (planned.replyTo ?? undefined) : undefined,
    customerId: customer._id,
    invoiceId: invoice._id,
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
  await recordEvent(ctx, {
    companyId: company._id,
    type: `message.${status}`,
    actor: planned.actor,
    subject: { table: "messages", id: messageId },
    data: { purpose: planned.purpose, channel, invoiceId: invoice._id, ...(code ? { policy: code } : {}), ...(retryAt !== undefined ? { retryAt } : {}) },
  });
  if (status === "queued") await ctx.scheduler.runAfter(0, internal.messaging.deliver, { messageId });
  if (status === "held") await ctx.scheduler.runAt(retryAt!, internal.messaging.deliver, { messageId });
  return (await ctx.db.get(messageId))!;
}

/**
 * At the moment of sending: the invoice must still be one this message is true about, and the pay link
 * is made now. Returns words for why it can't go, or what to send and as whom.
 */
export async function customerClaim(
  ctx: MutationCtx,
  message: Doc<"messages">,
): Promise<{ problem: string } | { body: string; fromName: string; via: { connectionId: Id<"mailboxConnections">; address: string } | null }> {
  const invoice = message.invoiceId ? await ctx.db.get(message.invoiceId) : null;
  const company = await ctx.db.get(message.companyId);
  if (!invoice || !company) return { problem: "The invoice no longer exists." };
  if (invoice.status === "void") return { problem: "The invoice was voided before the message went out." };
  if (message.purpose === "payment_reminder" && amountRequested(invoice) === 0) return { problem: "Nothing was owed any more when the reminder was due to go, so it wasn't sent." };
  const token = await payToken(invoice);
  if (message.body.includes("{link}") && !token) return { problem: "Pay links aren't set up, so there was no link to send." };
  const body = token ? message.body.replaceAll("{link}", payUrl(token)) : message.body;
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

/** The messages sent about one invoice, newest first. */
export async function invoiceMessages(ctx: Ctx, invoice: Pick<Doc<"invoices">, "_id" | "companyId">): Promise<Doc<"messages">[]> {
  const rows = await ctx.db
    .query("messages")
    .withIndex("by_company_invoice", (q) => q.eq("companyId", invoice.companyId).eq("invoiceId", invoice._id))
    .take(100);
  return rows.sort((a, b) => b.queuedAt - a.queuedAt);
}
