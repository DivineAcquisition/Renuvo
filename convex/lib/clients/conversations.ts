/**
 * A client's conversation, built from the records that already hold it: the outbox (`messages` with the
 * client's id), the texts the client sent (`inboundMessages`), and internal notes (`clientNotes`).
 * Sending goes through the one sending policy, so consent, suppression and quiet hours decide here as
 * everywhere else.
 *
 * Who a message may go to: the client's own phone and email, which permission is recorded against, and
 * any contact. A contact whose address is not the client's own has no permission record of its own yet,
 * so the policy refuses it and the screen says so. Nothing here records permission on anyone's behalf.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { normalAddress } from "../compliance/recipients";
import type { Channel } from "../compliance/schema";
import { recordEvent, type Actor } from "../events";
import { checkSend, type PolicyAnswer } from "../messaging/policy";
import { emailProvider } from "../messaging/email";
import { messagingProvider } from "../messaging/provider";
import type { SendIntent } from "../messaging/outbox";

type Ctx = QueryCtx | MutationCtx;

/** Billing messages carry invoice amounts and pay links: only the Owner reads them, as in Finance. */
export const BILLING_PURPOSES: readonly Doc<"messages">["purpose"][] = ["invoice_sent", "payment_reminder"];

export type Target = { contactId: Id<"clientContacts"> | null; name: string; roles: string[]; address: Record<Channel, string | null> };

/** The people a message to this client can be addressed to: the client's own phone and email first, then each active contact. */
export async function targetsOf(ctx: Ctx, customer: Doc<"customers">): Promise<Target[]> {
  const contacts = await ctx.db
    .query("clientContacts")
    .withIndex("by_company_customer", (q) => q.eq("companyId", customer.companyId).eq("customerId", customer._id))
    .take(50);
  const out: Target[] = [{ contactId: null, name: customer.name, roles: ["client record"], address: { sms: normalAddress("sms", customer.phone), email: normalAddress("email", customer.email) } }];
  for (const c of contacts) {
    if (c.status !== "active") continue;
    out.push({ contactId: c._id, name: c.name, roles: c.roles, address: { sms: normalAddress("sms", c.phone), email: normalAddress("email", c.email) } });
  }
  return out;
}

/**
 * What the sending policy would say now. The client's own address is checked as the client, whose
 * permission is on record; a contact's own address is checked as whoever is on record with it, which
 * for a contact is nobody yet.
 */
export function intentFor(customer: Doc<"customers">, target: Target, channel: Channel, draftedBy: "person" | "agent"): SendIntent {
  const own = target.address[channel] !== null && target.address[channel] === normalAddress(channel, channel === "sms" ? customer.phone : customer.email);
  return { category: "operational", origin: draftedBy === "agent" ? "agent" : "manual", ...(draftedBy === "agent" ? { agent: "retention" as const } : {}), ...(own ? { recipient: { kind: "customer" as const, id: customer._id } } : {}) };
}

export async function sendCheck(ctx: Ctx, customer: Doc<"customers">, target: Target, channel: Channel, draftedBy: "person" | "agent" = "person", now = Date.now()): Promise<PolicyAnswer> {
  const connected = channel === "email" ? Boolean(emailProvider()) : Boolean(messagingProvider());
  if (!connected) return { ok: false, code: "sender_not_ready", words: channel === "email" ? "Email isn't connected for Selestial yet." : "Texting isn't connected for Selestial yet." };
  const to = target.address[channel];
  if (!to) return { ok: false, code: "no_address", words: channel === "sms" ? `${target.name} has no valid phone number on file.` : `${target.name} has no valid email address on file.` };
  const intent = intentFor(customer, target, channel, draftedBy);
  const answer = await checkSend(ctx, { companyId: customer.companyId, channel, to, now, ...intent });
  if (!answer.ok && answer.code === "no_permission" && target.contactId) {
    return { ...answer, words: `${answer.words} Permission is recorded for the client's own phone and email; this contact has none of their own yet.` };
  }
  // The shared policy calls operational messages "work" messages; to a client they are about their service.
  return answer.ok ? answer : { ...answer, words: answer.words.replace(/\bwork (emails|texts)\b/, "service $1") };
}

/** Follow-ups planned for later that have not gone yet. */
export async function scheduledFollowUps(ctx: Ctx, companyId: Id<"companies">, customerId: Id<"customers">): Promise<Doc<"messages">[]> {
  const rows = await ctx.db
    .query("messages")
    .withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customerId))
    .order("desc")
    .take(200);
  return rows.filter((m) => m.purpose === "customer_message" && m.scheduledFor !== undefined && (m.status === "held" || m.status === "queued"));
}

export type StopReason = "replied" | "opted_out" | "taken_over";
const STOP_WORDS: Record<StopReason, string> = {
  replied: "The client replied before it was due, so it was not sent.",
  opted_out: "The client asked not to be contacted, so it was not sent.",
  taken_over: "A person took over the conversation, so the agent's follow-up was not sent.",
};

/**
 * Stops follow-ups that are no longer right. A reply or an opt-out stops every scheduled follow-up to the
 * client: it was written before the client spoke. A takeover stops only those an agent drafted; the
 * person who took over keeps their own.
 */
export async function stopFollowUps(ctx: MutationCtx, companyId: Id<"companies">, customerId: Id<"customers">, reason: StopReason, actor: Actor): Promise<number> {
  let stopped = 0;
  for (const message of await scheduledFollowUps(ctx, companyId, customerId)) {
    if (reason === "taken_over" && message.draftedBy !== "agent") continue;
    await ctx.db.patch(message._id, { status: "not_sent", problem: STOP_WORDS[reason], refusal: `follow_up_${reason}` });
    await recordEvent(ctx, { companyId, type: "message.not_sent", actor, subject: { table: "messages", id: message._id }, data: { purpose: message.purpose, reason } });
    stopped += 1;
  }
  return stopped;
}

/** The clients whose own phone, or one of whose contacts' phones, is this number. Bounded like recipientsAt. */
export async function clientsAtPhone(ctx: Ctx, companyId: Id<"companies">, address: string): Promise<{ customerId: Id<"customers">; contact: Doc<"clientContacts"> | null }[]> {
  const found = new Map<string, Doc<"clientContacts"> | null>();
  for (const status of ["active", "archived"] as const) {
    const rows = await ctx.db
      .query("customers")
      .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status))
      .take(2000);
    for (const row of rows) if (normalAddress("sms", row.phone) === address) found.set(row._id, null);
  }
  const contacts = await ctx.db
    .query("clientContacts")
    .withIndex("by_company_customer", (q) => q.eq("companyId", companyId))
    .take(4000);
  for (const c of contacts) if (c.status === "active" && normalAddress("sms", c.phone) === address && !found.has(c.customerId)) found.set(c.customerId, c);
  return [...found.entries()].map(([customerId, contact]) => ({ customerId: customerId as Id<"customers">, contact }));
}

/**
 * A text from a number that is a client's, or one of its contacts': kept in the client's conversation
 * (as an excerpt, like every inbound text), and the client's scheduled follow-ups stop on a reply or an
 * opt-out. Returns the clients it was filed under.
 */
export async function fileClientText(
  ctx: MutationCtx,
  input: { companyId: Id<"companies">; from: string; excerpt: string; kind: Doc<"inboundMessages">["kind"]; at: number; taskId?: Id<"tasks"> },
  known?: Awaited<ReturnType<typeof clientsAtPhone>>,
) {
  const clients = known ?? (await clientsAtPhone(ctx, input.companyId, input.from));
  for (const client of clients) {
    await ctx.db.insert("inboundMessages", { companyId: input.companyId, customerId: client.customerId, contactId: client.contact?._id, channel: "sms", from: input.from, body: input.excerpt, kind: input.kind, taskId: input.taskId, receivedAt: input.at });
    if (input.kind === "message") await stopFollowUps(ctx, input.companyId, client.customerId, "replied", { kind: "system" });
    if (input.kind === "opt_out") await stopFollowUps(ctx, input.companyId, client.customerId, "opted_out", { kind: "system" });
  }
  return clients;
}
