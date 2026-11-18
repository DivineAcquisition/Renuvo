/**
 * Sales messages to customers: a booking request with its payment and signing links, a confirmation, a
 * proposal link, a signing request and an assessor's findings link. Planned as `messages` rows and sent
 * through the one door (convex/messaging.ts), so the shared sending policy decides: suspension, sender
 * setup, a usable address, the do-not-contact list, recorded permission and quiet hours.
 *
 * Links are stored as placeholders and made at the moment of sending from the record each names. A
 * record that closed in the meantime (a voided invoice, a withdrawn proposal, an ended signing request)
 * stops the message instead of sending a link that no longer works.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { readProfile } from "../compliance/profile";
import { recordEvent, type Actor } from "../events";
import { addressFor, customerIntent, type Channel } from "../finance/outbox";
import { payToken, payUrl } from "../finance/payLinks";
import { emailProvider } from "../messaging/email";
import { messageByKey } from "../messaging/outbox";
import { checkSend, type PolicyCode } from "../messaging/policy";
import { messagingProvider } from "../messaging/provider";
import { linkToken, linkUrl } from "./links";

export type SalesPurpose = "booking_request" | "booking_confirmed" | "proposal_sent" | "signature_request" | "assessment_link";
export type SalesLink = { placeholder: string; kind: "pay" | "proposal" | "sign" | "assess"; id: string };

export type PlannedSalesMessage = {
  company: Doc<"companies">;
  customer: Doc<"customers">;
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

async function ownMailbox(ctx: MutationCtx, companyId: Id<"companies">) {
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
    customerId: customer._id,
    salesLinks: planned.links,
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
  await recordEvent(ctx, { companyId: company._id, type: `message.${status}`, actor: planned.actor, subject: { table: "messages", id: messageId }, data: { purpose: planned.purpose, channel, ...(code ? { policy: code } : {}) } });
  if (status === "queued") await ctx.scheduler.runAfter(0, internal.messaging.deliver, { messageId });
  if (status === "held") await ctx.scheduler.runAt(retryAt!, internal.messaging.deliver, { messageId });
  return (await ctx.db.get(messageId))!;
}

/** At the moment of sending: every linked record still open, and its link made now. */
export async function salesClaim(ctx: MutationCtx, message: Doc<"messages">): Promise<{ problem: string } | { body: string; fromName: string; via: { connectionId: Id<"mailboxConnections">; address: string } | null }> {
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
