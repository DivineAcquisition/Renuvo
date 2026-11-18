/**
 * Conversations on a client's profile: SMS and email both ways, internal notes, scheduled follow-ups,
 * and a person taking over from the agents. Read from the outbox, the texts the client sent and the
 * notes, never a copy. Sending is planned like every other message and checked by the one sending
 * policy now and again when it goes (convex/messaging.ts).
 *
 * Billing messages (invoices, payment reminders) are the Owner's, as in Finance: other roles see that
 * some exist, never their words or amounts.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyMutation, companyQuery, type MemberAccess } from "./lib/builders";
import { BILLING_PURPOSES, scheduledFollowUps, sendCheck, intentFor, stopFollowUps, targetsOf, type Target } from "./lib/clients/conversations";
import { propertiesOf } from "./lib/clients/directory";
import { readProfile } from "./lib/compliance/profile";
import { channelValidator, type Channel } from "./lib/compliance/schema";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { emailProvider } from "./lib/messaging/email";
import { messagingProvider } from "./lib/messaging/provider";
import { isManager } from "./lib/roles";
import { literals } from "./lib/statuses";

type Ctx = QueryCtx & MemberAccess;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ABOUT_TABLES = ["jobs", "servicePlans", "agreements", "properties"] as const;

async function memberNames(ctx: Ctx, ids: (Id<"members"> | undefined)[]) {
  const names = new Map<string, string>();
  for (const id of new Set(ids.filter(Boolean) as Id<"members">[])) {
    const m = await ctx.db.get(id);
    names.set(id, m && m.companyId === ctx.companyId ? m.name : "A former team member");
  }
  return names;
}

const STATUS_WORDS: Record<Doc<"messages">["status"], string> = {
  queued: "Sending",
  held: "Waiting to send",
  sending: "Sending",
  sent: "Sent, delivery not confirmed",
  delivered: "Delivered",
  failed: "Failed",
  unconfirmed: "Unknown: the send never confirmed",
  not_sent: "Not sent",
};

/** The conversation, oldest first: messages both ways and internal notes, plus who holds it and what is scheduled. */
export const thread = companyQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const owner = ctx.role === "owner";
    const contacts = await ctx.db
      .query("clientContacts")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .take(50);
    const contactName = (id: Id<"clientContacts"> | undefined) => (id ? (contacts.find((c) => c._id === id)?.name ?? "A former contact") : customer.name);
    const out = await ctx.db
      .query("messages")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .order("desc")
      .take(150);
    const inbound = await ctx.db
      .query("inboundMessages")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .order("desc")
      .take(150);
    const notes = await ctx.db
      .query("clientNotes")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .order("desc")
      .take(150);
    const hiddenBilling = owner ? 0 : out.filter((m) => BILLING_PURPOSES.includes(m.purpose)).length;
    const visible = out.filter((m) => owner || !BILLING_PURPOSES.includes(m.purpose));
    const names = await memberNames(ctx, [...visible.map((m) => m.authorId), ...notes.map((n) => n.authorId), customer.conversationHeld?.by]);
    const properties = await propertiesOf(ctx, ctx.companyId, customer._id, true);
    const propertyName = (id: Id<"properties"> | undefined) => {
      const p = id ? properties.find((row) => row._id === id) : null;
      return p ? p.label?.trim() || p.address.line1 : null;
    };
    type Item =
      | { type: "out"; id: string; at: number; channel: Channel; to: string; toName: string; subject: string | null; body: string; status: Doc<"messages">["status"]; statusWords: string; problem: string | null; by: string; draftedBy: "person" | "agent" | null; billing: boolean; about: { table: string; id: string; label: string } | null; scheduledFor: number | null }
      | { type: "in"; id: string; at: number; channel: Channel; from: string; fromName: string; body: string; kind: Doc<"inboundMessages">["kind"]; taskId: string | null }
      | { type: "note"; id: string; at: number; body: string; by: string; about: string | null };
    const items: Item[] = [];
    for (const m of visible) {
      items.push({
        type: "out",
        id: m._id,
        at: m.sentAt ?? m.scheduledFor ?? m.queuedAt,
        channel: m.channel ?? "sms",
        to: m.to ?? "",
        toName: contactName(m.contactId),
        subject: m.subject ?? null,
        body: m.body,
        status: m.status,
        statusWords: m.scheduledFor && m.status === "held" ? "Scheduled" : STATUS_WORDS[m.status],
        problem: m.problem ?? null,
        by: m.authorId ? (names.get(m.authorId) ?? "A team member") : BILLING_PURPOSES.includes(m.purpose) ? "Finance" : "Selestial",
        draftedBy: m.draftedBy ?? null,
        billing: BILLING_PURPOSES.includes(m.purpose),
        about: m.about ?? (m.invoiceId ? { table: "invoices", id: m.invoiceId, label: "An invoice" } : null),
        scheduledFor: m.scheduledFor ?? null,
      });
    }
    for (const m of inbound) items.push({ type: "in", id: m._id, at: m.receivedAt, channel: m.channel, from: m.from, fromName: m.contactId ? contactName(m.contactId) : customer.name, body: m.body, kind: m.kind, taskId: m.taskId ?? null });
    for (const n of notes) items.push({ type: "note", id: n._id, at: n.createdAt, body: n.body, by: names.get(n.authorId) ?? "A team member", about: propertyName(n.propertyId) });
    items.sort((a, b) => a.at - b.at);
    const held = customer.conversationHeld ? { by: names.get(customer.conversationHeld.by) ?? "A team member", since: customer.conversationHeld.since, mine: customer.conversationHeld.by === ctx.member._id } : null;
    const scheduled = (await scheduledFollowUps(ctx, ctx.companyId, customer._id)).filter((m) => owner || !BILLING_PURPOSES.includes(m.purpose));
    return {
      items: items.slice(-200),
      held,
      scheduled: scheduled.map((m) => ({ id: m._id, at: m.scheduledFor!, channel: m.channel ?? "sms", toName: contactName(m.contactId), body: m.body, draftedBy: m.draftedBy ?? "person" })),
      hiddenBilling,
      timezone: ctx.company.timezone,
      /** Texts the client sends are kept as their first 200 characters with links taken out, as for every inbound text. */
      inboundKept: "excerpt",
    };
  },
});

/**
 * Who a message can go to and what the sending policy says now for each, on each channel; and the records a
 * message can be about. For the composer: the person sees the recipient, the address and any refusal before
 * writing.
 */
export const composer = companyQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const targets = await targetsOf(ctx, customer);
    const recipients = [];
    for (const t of targets) {
      const sms = await sendCheck(ctx, customer, t, "sms");
      const email = await sendCheck(ctx, customer, t, "email");
      recipients.push({ contactId: t.contactId, name: t.name, roles: t.roles, sms: { address: t.address.sms, ok: sms.ok, words: sms.ok ? null : sms.words, until: !sms.ok && sms.retryAt ? sms.retryAt : null }, email: { address: t.address.email, ok: email.ok, words: email.ok ? null : email.words, until: !email.ok && email.retryAt ? email.retryAt : null } });
    }
    const today = Date.now() - DAY;
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_company_customer_start", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id).gte("startsAt", today))
      .take(10);
    const plans = await ctx.db
      .query("servicePlans")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .take(20);
    const planOptions = [];
    for (const p of plans.filter((row) => row.state !== "ended")) planOptions.push({ table: "servicePlans" as const, id: p._id as string, label: await planLabel(ctx, p) });
    const properties = await propertiesOf(ctx, ctx.companyId, customer._id);
    const preferred = customer.communication?.preferredChannel ?? null;
    return {
      recipients,
      preferred,
      about: [
        ...jobs.filter((j) => j.status !== "cancelled").map((j) => ({ table: "jobs" as const, id: j._id as string, label: `Visit: ${j.serviceType}, ${new Date(j.startsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: ctx.company.timezone })}` })),
        ...planOptions,
        ...properties.map((p) => ({ table: "properties" as const, id: p._id as string, label: `Property: ${p.label?.trim() || p.address.line1}` })),
      ],
      held: customer.conversationHeld ? { mine: customer.conversationHeld.by === ctx.member._id } : null,
      archived: customer.status === "archived",
      timezone: ctx.company.timezone,
    };
  },
});

async function planLabel(ctx: QueryCtx, plan: Doc<"servicePlans">) {
  const service = await ctx.db.get(plan.serviceId);
  return `Plan: ${service?.name ?? "Service plan"}`;
}

async function aboutLabel(ctx: MutationCtx & MemberAccess, customer: Doc<"customers">, about: { table: (typeof ABOUT_TABLES)[number]; id: string }) {
  const id = ctx.db.normalizeId(about.table, about.id);
  const doc = id ? await ctx.db.get(id) : null;
  if (!doc || doc.companyId !== ctx.companyId) throw userError("That record isn't this client's.");
  if (about.table === "jobs") {
    const job = doc as Doc<"jobs">;
    if (job.customerId !== customer._id) throw userError("That visit isn't this client's.");
    return `Visit: ${job.serviceType}, ${new Date(job.startsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: ctx.company.timezone })}`;
  }
  if (about.table === "servicePlans") {
    const plan = doc as Doc<"servicePlans">;
    if (plan.customerId !== customer._id) throw userError("That plan isn't this client's.");
    return planLabel(ctx, plan);
  }
  if (about.table === "properties") {
    const p = doc as Doc<"properties">;
    if (p.customerId !== customer._id) throw userError("That property isn't this client's.");
    return `Property: ${p.label?.trim() || p.address.line1}`;
  }
  return `Agreement: ${(doc as Doc<"agreements">).title}`;
}

/**
 * Sends a message to the client, now or at a time, to the recipient and address the person saw. Refused
 * outright when the sending policy refuses it now; held, and sent when the window ends, for quiet hours.
 * A scheduled follow-up is asked the policy again when it is due, and stops if the client replies first.
 */
export const send = companyMutation({
  args: {
    customerId: v.id("customers"),
    contactId: v.union(v.id("clientContacts"), v.null()),
    channel: channelValidator,
    /** The address the person saw. If the record changed since, nothing is sent. */
    to: v.string(),
    subject: v.optional(v.string()),
    body: v.string(),
    about: v.optional(v.object({ table: literals(ABOUT_TABLES), id: v.string() })),
    sendAt: v.optional(v.number()),
    /** An agent drafted it and this person approved it. */
    fromAgentDraft: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    if (customer.status === "archived") throw userError("Restore the client before messaging them.");
    const draftedBy = args.fromAgentDraft ? "agent" : "person";
    if (draftedBy === "agent" && customer.conversationHeld) throw userError("A person has taken over this conversation, so agent drafts aren't sent. Write it yourself, or resume the agents first.");
    const target: Target | undefined = (await targetsOf(ctx, customer)).find((t) => t.contactId === args.contactId);
    if (!target) throw userError("Choose who the message is to.");
    const to = target.address[args.channel];
    if (!to || to !== args.to) throw userError("The address changed since you opened this. Check who it is going to and try again.");
    const body = args.body.trim();
    const limit = args.channel === "sms" ? 1600 : 10_000;
    if (!body) throw userError("Write the message first.");
    if (body.length > limit) throw userError(`Keep it under ${limit} characters.`);
    const subject = args.subject?.trim();
    if (args.channel === "email" && !subject) throw userError("Give the email a subject.");
    const now = Date.now();
    if (args.sendAt !== undefined && (args.sendAt < now + MINUTE || args.sendAt > now + 60 * DAY)) throw userError("Schedule it between a minute and 60 days from now.");
    const answer = await sendCheck(ctx, customer, target, args.channel, draftedBy, args.sendAt ?? now);
    if (!answer.ok && answer.retryAt === undefined) throw userError(`Not sent: ${answer.words}`);
    const provider = args.channel === "email" ? emailProvider() : messagingProvider();
    const sendAt = args.sendAt ?? (answer.ok ? undefined : answer.retryAt);
    const status = sendAt === undefined ? "queued" : "held";
    const about = args.about ? { ...args.about, label: await aboutLabel(ctx, customer, args.about) } : undefined;
    const replyTo = args.channel === "email" ? ((await readProfile(ctx, ctx.companyId)).identity.supportEmail ?? undefined) : undefined;
    const messageId = await ctx.db.insert("messages", {
      companyId: ctx.companyId,
      purpose: "customer_message",
      channel: args.channel,
      subject: args.channel === "email" ? subject : undefined,
      replyTo,
      customerId: customer._id,
      contactId: target.contactId ?? undefined,
      authorId: ctx.member._id,
      draftedBy,
      about,
      jobId: about?.table === "jobs" ? (about.id as Id<"jobs">) : undefined,
      scheduledFor: args.sendAt,
      to,
      body,
      dedupeKey: `client:${customer._id}:${ctx.member._id}:${now}`,
      status,
      attempts: 0,
      provider: provider?.name,
      problem: status === "held" && !args.sendAt && !answer.ok ? answer.words : undefined,
      queuedAt: now,
    });
    await ctx.db.insert("sendIntents", { companyId: ctx.companyId, messageId, channel: args.channel, address: to, at: now, ...intentFor(customer, target, args.channel, draftedBy) });
    await recordEvent(ctx, { companyId: ctx.companyId, type: `message.${status}`, actor: byMember(ctx), subject: { table: "messages", id: messageId }, data: { purpose: "customer_message", channel: args.channel, customerId: customer._id, ...(args.sendAt ? { scheduledFor: args.sendAt } : {}) } });
    if (status === "queued") await ctx.scheduler.runAfter(0, internal.messaging.deliver, { messageId });
    else await ctx.scheduler.runAt(sendAt!, internal.messaging.deliver, { messageId });
    return { messageId, status, sendAt: sendAt ?? null, words: status === "held" && !args.sendAt && !answer.ok ? answer.words : null };
  },
});

/** Cancels a scheduled follow-up that has not gone. */
export const cancelScheduled = companyMutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const message = await owned(ctx, args.messageId);
    if (message.purpose !== "customer_message" || message.scheduledFor === undefined) throw userError("Only a scheduled follow-up can be cancelled here.");
    if (message.status !== "held" && message.status !== "queued") throw userError("It has already gone, or was already stopped.");
    if (message.authorId !== ctx.member._id && !isManager(ctx.role)) throw userError("Only the person who scheduled it, or an Owner or Manager, can cancel it.", "not_allowed");
    await ctx.db.patch(message._id, { status: "not_sent", problem: "Cancelled before it was due.", refusal: "follow_up_cancelled" });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "message.cancelled", actor: byMember(ctx), subject: { table: "messages", id: message._id }, data: { purpose: message.purpose } });
  },
});

/** An internal note. Never sent, never shown to the client, and kept as written. */
export const addNote = companyMutation({
  args: { customerId: v.id("customers"), body: v.string(), propertyId: v.optional(v.id("properties")), jobId: v.optional(v.id("jobs")) },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const body = args.body.trim();
    if (!body) throw userError("Write the note first.");
    if (body.length > 4000) throw userError("Keep a note under 4,000 characters.");
    if (args.propertyId) {
      const p = await owned(ctx, args.propertyId);
      if (p.customerId !== customer._id) throw userError("That property isn't this client's.");
    }
    if (args.jobId) {
      const j = await owned(ctx, args.jobId);
      if (j.customerId !== customer._id) throw userError("That visit isn't this client's.");
    }
    const noteId = await ctx.db.insert("clientNotes", { companyId: ctx.companyId, customerId: customer._id, propertyId: args.propertyId, jobId: args.jobId, body, authorId: ctx.member._id, createdAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "customer.note_added", actor: byMember(ctx), subject: { table: "customers", id: customer._id } });
    return noteId;
  },
});

/**
 * A person takes the conversation from the agents. Until they resume, agent drafts are not sent and the
 * agents' scheduled follow-ups are stopped now. The person's own scheduled messages stay.
 */
export const takeOver = companyMutation({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    if (customer.conversationHeld?.by === ctx.member._id) return { stopped: 0 };
    await ctx.db.patch(customer._id, { conversationHeld: { by: ctx.member._id, since: Date.now() } });
    const stopped = await stopFollowUps(ctx, ctx.companyId, customer._id, "taken_over", byMember(ctx));
    await recordEvent(ctx, { companyId: ctx.companyId, type: "customer.conversation_taken_over", actor: byMember(ctx), subject: { table: "customers", id: customer._id }, data: { stopped } });
    return { stopped };
  },
});

/** Hands the conversation back to the agents. The person holding it, or an Owner or Manager. */
export const resume = companyMutation({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    if (!customer.conversationHeld) return;
    if (customer.conversationHeld.by !== ctx.member._id && !isManager(ctx.role)) throw userError("Only the person who took over, or an Owner or Manager, can hand it back.", "not_allowed");
    await ctx.db.patch(customer._id, { conversationHeld: undefined });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "customer.conversation_resumed", actor: byMember(ctx), subject: { table: "customers", id: customer._id } });
  },
});
