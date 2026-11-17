/**
 * Finance → Selestial's prepared work: invoice and reminder messages to customers, drafted by Selestial on
 * the schedule or when the Owner asks, and sent only when a person approves the exact words, channel,
 * recipient and amount. A change in what the invoice says after a draft was reviewed refuses the
 * approval; the person reviews again.
 *
 * What a sent message did next (scheduled for quiet hours, sending, sent, delivered, failed, not sent
 * and why) is read from its `messages` row, which the shared sending policy and the provider update.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { ownerMutation, ownerQuery, type MemberAccess } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { requireFinance } from "./lib/finance/authority";
import { basisOf, defaultChannel, invoiceDrafts, LAST_STEP_AFTER_DAYS, noLongerNeeded, prepareDraft, refreshDraft, sameBasis, SCHEDULE, stageDue } from "./lib/finance/collections";
import { bindsTo, requireSame } from "./lib/finance/confirm";
import { amountRequested, STATE_WORDS, invoiceState } from "./lib/finance/invoiceState";
import { dollars } from "./lib/finance/money";
import { addressFor, canSend, invoiceMessages, queueCustomerMessage, type Channel } from "./lib/finance/outbox";
import { settingsOf, settingsRow } from "./lib/finance/settings";
import { STAGE_WORDS } from "./lib/finance/templates";
import { isEmail } from "./lib/text";

type Ctx = (QueryCtx | MutationCtx) & MemberAccess;
const DAY = 86_400_000;
const channelValidator = v.union(v.literal("email"), v.literal("sms"));

/** What happened to a sent message, as one of the states the Finance screens show. */
export function deliveryState(message: Doc<"messages"> | null): { state: "scheduled" | "processing" | "completed" | "needs_attention"; words: string; detail: string | null } {
  if (!message) return { state: "processing", words: "Processing", detail: null };
  switch (message.status) {
    case "held":
      return { state: "scheduled", words: "Scheduled", detail: message.problem ?? "Waiting for the end of quiet hours." };
    case "queued":
    case "sending":
      return { state: "processing", words: "Sending", detail: null };
    case "sent":
      return { state: "completed", words: "Sent", detail: message.channel === "email" ? "Accepted by the email service." : "Accepted by the carrier." };
    case "delivered":
      return { state: "completed", words: "Delivered", detail: null };
    case "unconfirmed":
      return { state: "needs_attention", words: "Not confirmed", detail: message.problem ?? "The send started and was never confirmed, so it isn't sent again by itself." };
    case "failed":
      return { state: "needs_attention", words: message.bouncedAt ? "Bounced" : "Failed", detail: message.problem ?? null };
    case "not_sent":
      return { state: "needs_attention", words: "Not sent", detail: message.problem ?? null };
  }
}

async function factsFor(draft: Doc<"financeMessages">, invoice: Doc<"invoices">, customer: Doc<"customers">, now: number) {
  const basis = basisOf(invoice, now);
  return {
    draft: draft._id,
    updatedAt: draft.updatedAt,
    channel: draft.channel,
    to: addressFor(customer, draft.channel),
    requested: basis.requestedCents,
    state: basis.state,
    dueAt: basis.dueAt,
    status: draft.status,
  };
}

async function draftView(ctx: Ctx, draft: Doc<"financeMessages">, now: number) {
  const invoice = (await ctx.db.get(draft.invoiceId))!;
  const customer = (await ctx.db.get(draft.customerId))!;
  const message = draft.messageId ? await ctx.db.get(draft.messageId) : null;
  const check = draft.status === "draft" ? await canSend(ctx, ctx.companyId, customer, draft.channel) : null;
  const other: Channel = draft.channel === "email" ? "sms" : "email";
  const otherCheck = draft.status === "draft" ? await canSend(ctx, ctx.companyId, customer, other) : null;
  const current = basisOf(invoice, now);
  const gone = draft.status === "draft" ? noLongerNeeded(draft, invoice) : null;
  return {
    id: draft._id,
    kind: draft.kind,
    stage: draft.stage,
    stageWords: STAGE_WORDS[draft.stage],
    status: draft.status,
    closedReason: draft.closedReason ?? gone ?? null,
    invoiceId: invoice._id,
    invoiceNumber: invoice.number ?? null,
    invoiceStateWords: STATE_WORDS[invoiceState(invoice, now)],
    customerId: customer._id,
    customer: customer.name,
    channel: draft.channel,
    to: addressFor(customer, draft.channel),
    subject: draft.subject ?? null,
    body: draft.body,
    edited: draft.edited,
    requestedCents: current.requestedCents,
    /** The invoice changed since the words were written. */
    changed: !sameBasis(draft.basis, current),
    preparedBySelestial: draft.preparedBy.kind === "selestial",
    createdAt: draft.createdAt,
    approvedAt: draft.approvedAt ?? null,
    canSend: check ? { ok: check.ok, words: check.ok ? null : check.words, code: check.ok ? null : check.code, retryAt: check.ok ? null : (check.retryAt ?? null) } : null,
    otherChannel: otherCheck ? { channel: other, available: Boolean(otherCheck.address), ok: otherCheck.ok, words: otherCheck.ok ? null : otherCheck.words } : null,
    delivery: draft.status === "approved" ? deliveryState(message) : null,
    sentAt: message?.sentAt ?? null,
    bindsTo: draft.status === "draft" && !gone ? await bindsTo("send_customer_message", await factsFor(draft, invoice, customer, now)) : null,
  };
}

/** Selestial's prepared work in Finance: drafts waiting for the Owner, and what happened to recent approvals. */
export const queue = ownerQuery({
  args: {},
  handler: async (ctx) => {
    requireFinance(ctx, "read");
    const now = Date.now();
    const drafts = await ctx.db
      .query("financeMessages")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "draft"))
      .order("desc")
      .take(100);
    const approved = await ctx.db
      .query("financeMessages")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "approved").gte("createdAt", now - 14 * DAY))
      .order("desc")
      .take(30);
    const waiting = [];
    for (const draft of drafts) {
      const view = await draftView(ctx, draft, now);
      // A draft whose invoice was paid or voided is no longer work; the sweep sets it aside.
      if (!view.closedReason) waiting.push(view);
    }
    const recent = [];
    for (const draft of approved) recent.push(await draftView(ctx, draft, now));
    const settings = settingsOf(await settingsRow(ctx, ctx.companyId));
    return { waiting, recent, remindersOn: settings.remindersOn, checkedAt: now };
  },
});

/** The messages prepared and sent for one invoice, for its drawer. */
export const forInvoice = ownerQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    requireFinance(ctx, "read");
    const invoice = await owned(ctx, args.invoiceId);
    const customer = await owned(ctx, invoice.customerId);
    const now = Date.now();
    const drafts = (await invoiceDrafts(ctx, invoice)).sort((a, b) => b.createdAt - a.createdAt);
    const views = [];
    for (const draft of drafts) views.push(await draftView(ctx, draft, now));
    const draftMessages = new Set(drafts.map((d) => d.messageId).filter(Boolean));
    const others = (await invoiceMessages(ctx, invoice)).filter((m) => !draftMessages.has(m._id));
    const email = await canSend(ctx, ctx.companyId, customer, "email");
    const sms = await canSend(ctx, ctx.companyId, customer, "sms");
    const sent = views.filter((view) => view.status === "approved");
    const reminderSteps = sent.filter((view) => view.kind === "reminder").length;
    return {
      drafts: views.filter((view) => view.status === "draft" && !view.closedReason),
      history: views.filter((view) => view.status !== "draft" || view.closedReason),
      otherMessages: others.map((m) => ({ id: m._id, purpose: m.purpose, channel: m.channel ?? "sms", delivery: deliveryState(m), at: m.queuedAt })),
      channels: {
        email: { address: email.address, ok: email.ok, words: email.ok ? null : email.words, code: email.ok ? null : email.code },
        sms: { address: sms.address, ok: sms.ok, words: sms.ok ? null : sms.words, code: sms.ok ? null : sms.code },
      },
      defaultChannel: defaultChannel(customer),
      invoiceDelivered: sent.some((view) => view.kind === "invoice" && view.delivery?.state === "completed"),
      reminderSteps,
      scheduleDone: reminderSteps > 0 && sent.some((view) => view.stage === "overdue_14"),
      canPrepareInvoice: invoice.status === "open",
      canPrepareReminder: invoice.status === "open" && amountRequested(invoice) > 0,
    };
  },
});

/** The Owner asks Selestial to prepare a message now: the invoice itself, or a reminder. Nothing is sent. */
export const prepare = ownerMutation({
  args: { invoiceId: v.id("invoices"), kind: v.union(v.literal("invoice"), v.literal("reminder")), channel: v.optional(channelValidator) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "draft");
    const invoice = await owned(ctx, args.invoiceId);
    if (invoice.status !== "open") throw userError(invoice.status === "draft" ? "Issue the invoice first." : "This invoice isn't open.");
    if (args.kind === "reminder" && amountRequested(invoice) === 0) throw userError("Nothing is being asked for on this invoice right now.");
    const stage = args.kind === "invoice" ? "invoice" : "manual";
    const { draftId } = await prepareDraft(ctx, { invoice, stage, channel: args.channel, preparedBy: { kind: "member", memberId: ctx.member._id }, actor: byMember(ctx) });
    return { draftId };
  },
});

const LIMITS = { subject: 150, email: 5000, sms: 640 };

/** The Owner changes a draft's words or channel before approving it. */
export const edit = ownerMutation({
  args: { draftId: v.id("financeMessages"), channel: channelValidator, subject: v.union(v.string(), v.null()), body: v.string() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "draft");
    const draft = await owned(ctx, args.draftId);
    if (draft.status !== "draft") throw userError("This message was already approved or set aside.");
    const invoice = await owned(ctx, draft.invoiceId);
    const body = args.body.trim();
    if (!body) throw userError("The message can't be empty.");
    if (body.length > (args.channel === "sms" ? LIMITS.sms : LIMITS.email)) throw userError(args.channel === "sms" ? "Keep a text under 640 characters." : "Keep the email under 5,000 characters.");
    const subject = args.channel === "email" ? args.subject?.trim() || null : null;
    if (args.channel === "email" && !subject) throw userError("An email needs a subject.");
    if (subject && subject.length > LIMITS.subject) throw userError("Keep the subject under 150 characters.");
    // Switching channel with the words untouched: Selestial writes them for the new channel.
    if (args.channel !== draft.channel && body === draft.body.trim() && !draft.edited) {
      await refreshDraft(ctx, draft, invoice, args.channel);
      return { ok: true };
    }
    await ctx.db.patch(draft._id, { channel: args.channel, subject: subject ?? undefined, body, edited: true, basis: basisOf(invoice, Date.now()), updatedAt: Date.now() });
    return { ok: true };
  },
});

/** Rewrites a draft from the invoice as it is now, undoing the Owner's edits. */
export const rewrite = ownerMutation({
  args: { draftId: v.id("financeMessages") },
  handler: async (ctx, args) => {
    requireFinance(ctx, "draft");
    const draft = await owned(ctx, args.draftId);
    if (draft.status !== "draft") throw userError("This message was already approved or set aside.");
    await refreshDraft(ctx, draft, await owned(ctx, draft.invoiceId));
    return { ok: true };
  },
});

export const skip = ownerMutation({
  args: { draftId: v.id("financeMessages"), reason: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "draft");
    const draft = await owned(ctx, args.draftId);
    if (draft.status !== "draft") return { already: true };
    const reason = args.reason?.trim().slice(0, 300) || "Skipped by you.";
    await ctx.db.patch(draft._id, { status: "skipped", closedReason: reason, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "collection.skipped", actor: byMember(ctx), subject: { table: "financeMessages", id: draft._id }, data: { stage: draft.stage } });
    return { already: false };
  },
});

type Outcome = { draftId: Id<"financeMessages">; ok: true; words: string } | { draftId: Id<"financeMessages">; ok: false; words: string };

/**
 * Approves and sends one draft, if it is exactly what the person reviewed. Never throws for a refusal:
 * Send all reports each message on its own. The message itself still passes the sending policy.
 */
async function approveOne(ctx: MutationCtx & MemberAccess, draftId: Id<"financeMessages">, given: string): Promise<Outcome> {
  const draft = await owned(ctx, draftId);
  if (draft.status !== "draft") return { draftId, ok: false, words: "Already approved or set aside." };
  const invoice = await owned(ctx, draft.invoiceId);
  const customer = await owned(ctx, draft.customerId);
  const now = Date.now();
  const gone = noLongerNeeded(draft, invoice);
  if (gone) {
    await ctx.db.patch(draft._id, { status: "stale", closedReason: gone, updatedAt: now });
    return { draftId, ok: false, words: `Not sent: ${gone}` };
  }
  try {
    await requireSame(given, "send_customer_message", await factsFor(draft, invoice, customer, now));
  } catch {
    return { draftId, ok: false, words: "Something changed since you reviewed it, so it wasn't sent. Review it again." };
  }
  // The amount or due date in the words must still be true. Selestial's own words are rewritten; the Owner's are left to them.
  if (!sameBasis(draft.basis, basisOf(invoice, now))) {
    if (!draft.edited) {
      await refreshDraft(ctx, draft, invoice);
      return { draftId, ok: false, words: `What's owed changed (now ${dollars(amountRequested(invoice))}), so Selestial rewrote the message. Review it again.` };
    }
    await ctx.db.patch(draft._id, { basis: basisOf(invoice, now), updatedAt: now });
    return { draftId, ok: false, words: `What's owed changed (now ${dollars(amountRequested(invoice))}) since you wrote this. Check your words and approve again.` };
  }
  const settings = settingsOf(await settingsRow(ctx, ctx.companyId));
  const replyTo = settings.replyTo ?? (isEmail(ctx.member.email) ? ctx.member.email : null);
  const message = await queueCustomerMessage(ctx, {
    company: ctx.company,
    invoice,
    customer,
    purpose: draft.kind === "invoice" ? "invoice_sent" : "payment_reminder",
    channel: draft.channel,
    subject: draft.subject,
    body: draft.body,
    replyTo,
    dedupeKey: `finance:${draft._id}`,
    actor: byMember(ctx),
  });
  await ctx.db.patch(draft._id, { status: "approved", approvedBy: ctx.member._id, approvedAt: now, messageId: message._id, updatedAt: now });
  await recordEvent(ctx, { companyId: ctx.companyId, type: "collection.approved", actor: byMember(ctx), subject: { table: "financeMessages", id: draft._id }, data: { stage: draft.stage, channel: draft.channel, amountCents: amountRequested(invoice) } });
  const delivery = deliveryState(message);
  return delivery.state === "needs_attention" ? { draftId, ok: false, words: `Not sent: ${delivery.detail ?? delivery.words}` } : { draftId, ok: true, words: delivery.state === "scheduled" ? `Scheduled: ${delivery.detail}` : "Sending" };
}

/** Approves and sends one draft. */
export const approve = ownerMutation({
  args: { draftId: v.id("financeMessages"), bindsTo: v.string() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "send");
    return approveOne(ctx, args.draftId, args.bindsTo);
  },
});

/** Send all: each message exactly as reviewed, each checked on its own; one refusal never stops the others. */
export const approveAll = ownerMutation({
  args: { items: v.array(v.object({ draftId: v.id("financeMessages"), bindsTo: v.string() })) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "send");
    if (args.items.length > 50) throw userError("Send up to 50 at a time.");
    const results: Outcome[] = [];
    for (const item of args.items) results.push(await approveOne(ctx, item.draftId, item.bindsTo));
    return { results, sent: results.filter((r) => r.ok).length };
  },
});

// ── The schedule, kept by the system ─────────────────────────────────────────────────────────────

/**
 * Every hour: prepare the reminder each open invoice is due for, and set aside drafts that no longer
 * apply. Prepares only; nothing here sends. Companies that switched reminders off get nothing prepared.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("invoices")
      .withIndex("by_status_due", (q) => q.eq("status", "open").gte("dueAt", now - (LAST_STEP_AFTER_DAYS + 30) * DAY).lte("dueAt", now + 3 * DAY))
      .take(500);
    const settingsCache = new Map<string, boolean>();
    let prepared = 0;
    for (const invoice of due) {
      let on = settingsCache.get(invoice.companyId);
      if (on === undefined) {
        on = settingsOf(await settingsRow(ctx, invoice.companyId)).remindersOn;
        settingsCache.set(invoice.companyId, on);
      }
      if (!on) continue;
      const stage = stageDue(invoice, now);
      if (!stage) continue;
      const drafts = await invoiceDrafts(ctx, invoice);
      // A later step already prepared (or skipped) makes this one unnecessary.
      const reached = drafts.some((row) => row.stage !== "invoice" && row.stage !== "manual" && SCHEDULE.indexOf(row.stage) >= SCHEDULE.indexOf(stage));
      if (reached) continue;
      const result = await prepareDraft(ctx, { invoice, stage, preparedBy: { kind: "selestial" }, actor: { kind: "system" } });
      if (result.created) prepared += 1;
    }
    const waiting = await ctx.db
      .query("financeMessages")
      .withIndex("by_status_updated", (q) => q.eq("status", "draft"))
      .take(500);
    let setAside = 0;
    for (const draft of waiting) {
      const reason = noLongerNeeded(draft, await ctx.db.get(draft.invoiceId));
      if (reason) {
        await ctx.db.patch(draft._id, { status: "stale", closedReason: reason, updatedAt: now });
        setAside += 1;
      }
    }
    return { prepared, setAside };
  },
});

/** Turns Selestial's reminder drafting on or off, and where customers' email replies go. */
export const saveReminders = ownerMutation({
  args: { remindersOn: v.boolean(), replyTo: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const replyTo = args.replyTo?.trim().toLowerCase() || undefined;
    if (replyTo && !isEmail(replyTo)) throw userError("Enter a valid email address for replies, or leave it empty.");
    const row = await settingsRow(ctx, ctx.companyId);
    const current = settingsOf(row);
    const fields = { remindersOn: args.remindersOn, replyTo, revision: current.revision + 1, updatedBy: ctx.member._id, updatedAt: Date.now() };
    const id = row
      ? (await ctx.db.patch(row._id, fields), row._id)
      : await ctx.db.insert("financeSettings", { companyId: ctx.companyId, taxableServiceIds: [], paymentTermsDays: current.paymentTermsDays, allowPartialPayments: current.allowPartialPayments, nextInvoiceNumber: current.nextInvoiceNumber, invoicePrefix: current.invoicePrefix, ...fields });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "finance_settings.saved", actor: byMember(ctx), subject: { table: "financeSettings", id }, data: { remindersOn: args.remindersOn } });
    return { revision: fields.revision };
  },
});

