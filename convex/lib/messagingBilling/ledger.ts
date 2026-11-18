/**
 * The messaging ledger, mutation side: estimate → reserve → send → reconcile, one charge per logical message.
 *
 * Autumn holds the money. A charge row here is created before Autumn is asked to hold anything, so a crash
 * between the two is found by the sweep and released. Retries of the same message reuse its charge and its
 * hold: an internal retry never becomes a second charge. Amounts are whole units of $0.0001.
 *
 * Metering is switched on per deployment (MESSAGING_BILLING=on). Off, nothing is charged and messaging works
 * as before; on without a billing connection, metered messages wait rather than go out unpaid.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { localParts } from "../availability";
import { accountFor, billingState, verifiedPlan } from "../billing/access";
import type { AutumnEnv } from "../billing/autumn";
import { recordEvent } from "../events";
import { localDay } from "../chat/localDay";
import { billingClassOf } from "./classify";
import { formatUnits, UNITS_PER_DOLLAR } from "./money";
import { KIND_WORDS, priceOf, rateCardAt, type MessagingKind } from "./rates";
import { smsRoute } from "./routes";
import { countSegments, plainPunctuation } from "./segments";

type Ctx = MutationCtx;
type Message = Doc<"messages">;
type Account = Doc<"billingAccounts">;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Long enough for a carrier to report, short enough that an abandoned hold comes back the same day. */
export const HOLD_MS = 6 * HOUR;
/** A message held for funds longer than this is not released by itself: a person looks at it again first. */
export const STALE_HOLD_MS = 24 * HOUR;
/** Inbound may take the balance down to this (owner decision, November 18, 2026: -$10). */
export const OVERDRAFT_FLOOR = -10 * UNITS_PER_DOLLAR;
export const OVERDRAFT_WARN = -5 * UNITS_PER_DOLLAR;
/** More inbound than this in an hour is looked at by Selestial staff. */
export const INBOUND_PER_HOUR_ALERT = 300;
export const DEFAULT_LOW_BALANCE = 5 * UNITS_PER_DOLLAR;

export function meteringOn(): boolean {
  return process.env.MESSAGING_BILLING?.trim().toLowerCase() === "on";
}

export const DEFAULT_MESSAGING_CONTROLS: NonNullable<Account["messagingControls"]> = {
  lowBalance: DEFAULT_LOW_BALANCE,
  autoTopUp: { enabled: false, threshold: 5 * UNITS_PER_DOLLAR, amount: 25 * UNITS_PER_DOLLAR, monthlyMax: 100 * UNITS_PER_DOLLAR },
};

export function controlsOf(account: Account | null): NonNullable<Account["messagingControls"]> {
  return account?.messagingControls ?? DEFAULT_MESSAGING_CONTROLS;
}

const ACTIVITY: Partial<Record<Message["purpose"], string>> = {
  offer: "Job offer to a cleaner",
  backup_offer: "Backup job offer to a cleaner",
  assignment_confirmed: "Job confirmation to a cleaner",
  reminder: "Job reminder to a cleaner",
  before_photos: "Photo request to a cleaner",
  check_in_nudge: "Check-in reminder to a cleaner",
  offer_withdrawn: "Offer withdrawn notice to a cleaner",
  assignment_ended: "Assignment ended notice to a cleaner",
  application_invitation: "Application invitation",
  application_follow_up: "Applicant follow-up",
  information_request: "Information request to an applicant",
  interview_invitation: "Interview invitation",
  interview_confirmation: "Interview confirmation",
  interview_reminder: "Interview reminder",
  hiring_offer: "Hiring offer",
  application_decline: "Application decline",
  urgent_outreach: "Urgent hiring outreach",
  invoice_sent: "Invoice to a customer",
  payment_reminder: "Payment reminder to a customer",
  earnings_statement: "Earnings statement to a cleaner",
  portal_invitation: "Cleaner portal invitation",
  onboarding_reminder: "Cleaner onboarding reminder",
  availability_check: "Availability check with a cleaner",
  idle_check_in: "Check-in with an idle cleaner",
  customer_message: "Message to a client",
  booking_confirmation: "Online booking confirmation",
  booking_request_received: "Online booking request received",
  booking_recovery: "Online booking reminder",
};

export function activityOf(purpose: Message["purpose"]): string {
  return ACTIVITY[purpose] ?? purpose.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Distinct real recipients across to, cc and bcc, case- and whitespace-normalised. */
export function recipientCount(addresses: (string | null | undefined)[]): number {
  return new Set(addresses.map((a) => (a ?? "").trim().toLowerCase()).filter((a) => a.includes("@"))).size;
}

/** The first moment of the current calendar month on the company's clock. */
export function monthStart(timezone: string, now = Date.now()): number {
  const day = localParts(now, timezone).day;
  return localDay(`${day.slice(0, 7)}-01`, timezone);
}

/** Outbound messaging this month: captured, plus what is still held for messages in flight. */
export async function outboundSpend(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, since: number, agent?: string): Promise<number> {
  const rows = await ctx.db
    .query("messagingCharges")
    .withIndex("by_company_created", (q) => q.eq("companyId", companyId).gte("createdAt", since))
    .take(20_000);
  let total = 0;
  for (const row of rows) {
    if (row.direction !== "out") continue;
    if (agent !== undefined && row.agent !== agent) continue;
    if (row.state === "captured" || row.state === "refunded") total += row.amount;
    else if (row.state === "reserving" || row.state === "reserved" || row.state === "pending") total += row.reserved;
  }
  return total;
}

export type OutboundPlan =
  | { kind: "free" }
  | { kind: "refuse"; code: string; words: string }
  | { kind: "hold"; reason: "messaging_balance" | "messaging_limit" | "billing_unavailable"; words: string }
  | { kind: "reserve"; chargeId: Id<"messagingCharges">; needsLock: boolean; body: string };

/**
 * Called by the outbox's claim, just before a message is handed over. Decides whether the message is free
 * (included, or delivered through the company's own Gmail), refused (no rate for the route, too long, no
 * plan), held (funds, limits, billing unreachable), or reserved: priced on the card in force now, with its
 * charge recorded and a hold to ask Autumn for.
 */
export async function planOutbound(ctx: Ctx, message: Message, input: { body: string; viaGmail: boolean; agent?: string; memberId?: Id<"members">; origin?: string }): Promise<OutboundPlan> {
  if (!meteringOn()) return { kind: "free" };
  if (billingClassOf(message.purpose) === "included") return { kind: "free" };
  const channel = message.channel ?? "sms";
  if (channel === "email" && input.viaGmail) return { kind: "free" };

  const state = billingState();
  if (!state.connected) return { kind: "hold", reason: "billing_unavailable", words: "Messaging billing isn't connected yet, so this message is waiting. Nothing was charged." };
  const company = (await ctx.db.get(message.companyId))!;
  if (!verifiedPlan(company)) return { kind: "refuse", code: "no_plan", words: "Sending business messages needs an active Operate or Expand plan. Unused messaging funds stay on the account." };

  // Agent-written texts use plain punctuation, so a curly quote never doubles the price. A person's words are sent as written.
  let body = input.body;
  let kind: MessagingKind;
  let count: number;
  let segments: ReturnType<typeof countSegments> | null = null;
  if (channel === "sms") {
    if (input.agent) body = plainPunctuation(body);
    const route = smsRoute(message.to ?? "");
    if (!route.ok) return { kind: "refuse", code: "route_unsupported", words: route.words };
    segments = countSegments(body);
    if (segments.tooLong) return { kind: "refuse", code: "too_long", words: `This text would use ${segments.segments} segments; the most a text can use is 10. Shorten it or send it by email.` };
    kind = "sms_out";
    count = segments.segments;
  } else {
    kind = "email_out";
    count = recipientCount([message.to]);
    if (count === 0) return { kind: "refuse", code: "no_address", words: "There is no email address to send to." };
  }
  const now = Date.now();
  const card = rateCardAt(now);
  const { unitPrice, amount } = priceOf(card, kind, count);
  await ctx.db.patch(message._id, { ...(segments ? { segments: segments.segments, encoding: segments.encoding } : { recipients: count }), ...(input.agent ? { agent: input.agent } : {}) });

  const existing = await ctx.db
    .query("messagingCharges")
    .withIndex("by_message", (q) => q.eq("messageId", message._id))
    .first();
  // The same logical message, tried again: its hold (or its charge) carries over. Never a second charge.
  if (existing && (existing.state === "reserved" || existing.state === "pending" || existing.state === "captured")) return { kind: "reserve", chargeId: existing._id, needsLock: false, body };

  const account = await accountFor(ctx, message.companyId, state.env);
  const controls = controlsOf(account);
  if (account?.messaging && account.messaging.remaining < amount) {
    return { kind: "hold", reason: "messaging_balance", words: `This message needs ${formatUnits(amount)} and the messaging balance is ${formatUnits(account.messaging.remaining)}. Add funds to send it.` };
  }
  const since = monthStart(company.timezone, now);
  if (controls.monthlyLimit !== undefined && (await outboundSpend(ctx, message.companyId, since)) + amount > controls.monthlyLimit) {
    return { kind: "hold", reason: "messaging_limit", words: `This month's messaging limit (${formatUnits(controls.monthlyLimit)}) is reached. Raise it in Usage to send this message.` };
  }
  const agentLimit = input.agent ? controls.agentLimits?.[input.agent] : undefined;
  if (input.agent && agentLimit !== undefined && (await outboundSpend(ctx, message.companyId, since, input.agent)) + amount > agentLimit) {
    return { kind: "hold", reason: "messaging_limit", words: `This agent's monthly messaging limit (${formatUnits(agentLimit)}) is reached. Raise it in Usage to send this message.` };
  }

  const attempt = existing ? Number(existing.lockId?.split("-").pop() ?? "0") + 1 : 1;
  const fields = {
    kind,
    channel: channel === "sms" ? ("sms" as const) : ("email" as const),
    direction: "out" as const,
    count,
    estimatedCount: count,
    rateCardVersion: card.version,
    unitPrice,
    reserved: amount,
    amount: 0,
    state: "reserving" as const,
    lockId: `m-${message._id}-${attempt}`,
    lockExpiresAt: now + HOLD_MS,
    settlement: "none" as const,
    agent: input.agent,
    memberId: input.memberId,
    origin: input.origin,
    activity: activityOf(message.purpose),
    updatedAt: now,
  };
  const note = { at: now, kind: "estimated", amount, note: `${count} ${count === 1 ? KIND_WORDS[kind].unit : KIND_WORDS[kind].units} at ${formatUnits(unitPrice)} (${card.version})` };
  let chargeId: Id<"messagingCharges">;
  if (existing) {
    chargeId = existing._id;
    await ctx.db.patch(existing._id, { ...fields, history: [...existing.history, note].slice(-30) });
  } else {
    chargeId = await ctx.db.insert("messagingCharges", { companyId: message.companyId, env: state.env, messageId: message._id, settleAttempts: 0, history: [note], createdAt: now, ...fields });
  }
  return { kind: "reserve", chargeId, needsLock: true, body };
}

/** Autumn's answer to a hold. Updates the charge and the balance Selestial last saw. */
export async function reserveAnswered(ctx: Ctx, chargeId: Id<"messagingCharges">, outcome: "reserved" | "denied" | "unavailable", remaining?: number) {
  const charge = await ctx.db.get(chargeId);
  if (!charge || charge.state !== "reserving") return;
  const now = Date.now();
  if (outcome === "reserved") {
    await ctx.db.patch(chargeId, { state: "reserved", updatedAt: now, history: [...charge.history, { at: now, kind: "held", amount: charge.reserved }].slice(-30) });
  } else {
    await ctx.db.patch(chargeId, { state: "released", settlement: "released", updatedAt: now, history: [...charge.history, { at: now, kind: outcome === "denied" ? "not_enough" : "billing_unavailable", amount: 0 }].slice(-30) });
  }
  if (remaining !== undefined) await setRemaining(ctx, charge.companyId, charge.env, remaining);
}

async function setRemaining(ctx: Ctx, companyId: Id<"companies">, env: AutumnEnv, remaining: number) {
  const account = await accountFor(ctx, companyId, env);
  if (!account) return;
  const prior = account.messaging ?? { remaining: 0, purchased: 0, promotional: { remaining: 0, expiresAt: null }, at: 0 };
  const promo = Math.min(prior.promotional.remaining, Math.max(0, remaining));
  await ctx.db.patch(account._id, { messaging: { remaining: Math.round(remaining), purchased: Math.round(remaining) - promo, promotional: { ...prior.promotional, remaining: promo }, at: Date.now() } });
  await balanceNotices(ctx, (await ctx.db.get(account._id))!);
}

/** Lowers the balance Selestial last saw by `amount`, until Autumn's next answer replaces it. */
async function spendLocally(ctx: Ctx, companyId: Id<"companies">, env: AutumnEnv, amount: number) {
  const account = await accountFor(ctx, companyId, env);
  if (!account?.messaging) return;
  await setRemaining(ctx, companyId, env, account.messaging.remaining - amount);
}

/**
 * The provider took the message: charge the units it reports (segments for a text, recipients for an email).
 * Never more than once: a charge already captured or being captured is left alone.
 */
export async function captureCharge(ctx: Ctx, chargeId: Id<"messagingCharges">, input: { count?: number; provider: string; providerMessageId: string }) {
  const charge = await ctx.db.get(chargeId);
  if (!charge || (charge.state !== "reserved" && charge.state !== "pending")) return;
  const count = input.count ?? charge.estimatedCount ?? charge.count;
  const amount = charge.unitPrice * count;
  const now = Date.now();
  await ctx.db.patch(chargeId, {
    state: "captured",
    count,
    amount,
    provider: input.provider,
    providerMessageId: input.providerMessageId,
    settlement: "pending_confirm",
    nextSettleAt: now,
    capturedAt: now,
    updatedAt: now,
    history: [...charge.history, { at: now, kind: "captured", amount, note: count !== charge.estimatedCount ? `The provider counted ${count}; ${charge.estimatedCount} were estimated.` : undefined }].slice(-30),
  });
  await spendLocally(ctx, charge.companyId, charge.env, amount);
  await ctx.scheduler.runAfter(0, internal.messagingBilling.settle, { chargeId });
}

/** Nothing billable happened (refused before submission, failed without the provider taking it): return the hold. */
export async function releaseCharge(ctx: Ctx, chargeId: Id<"messagingCharges">, note: string) {
  const charge = await ctx.db.get(chargeId);
  if (!charge || charge.state === "captured" || charge.state === "released" || charge.state === "refunded") return;
  const now = Date.now();
  const held = charge.state === "reserved" || charge.state === "pending";
  await ctx.db.patch(chargeId, {
    state: "released",
    amount: 0,
    settlement: held ? "pending_release" : "released",
    nextSettleAt: held ? now : undefined,
    updatedAt: now,
    history: [...charge.history, { at: now, kind: "released", amount: 0, note }].slice(-30),
  });
  if (held) await ctx.scheduler.runAfter(0, internal.messagingBilling.settle, { chargeId });
}

/** The provider's outcome is not known (a send that never answered). The hold stays until it is reconciled. */
export async function markPending(ctx: Ctx, chargeId: Id<"messagingCharges">) {
  const charge = await ctx.db.get(chargeId);
  if (!charge || charge.state !== "reserved") return;
  const now = Date.now();
  await ctx.db.patch(chargeId, { state: "pending", updatedAt: now, history: [...charge.history, { at: now, kind: "pending", note: "The provider did not answer. Not charged unless it reports the message." }].slice(-30) });
}

/**
 * A credit back for a captured charge: a refund row that names the original, and the original marked as
 * refunded. A charge can be refunded once; asking again changes nothing.
 */
export async function refundCharge(ctx: Ctx, chargeId: Id<"messagingCharges">, input: { reason: string; by?: Id<"members"> }): Promise<Id<"messagingCharges"> | null> {
  const charge = await ctx.db.get(chargeId);
  if (!charge || charge.state !== "captured" || charge.refundedBy || charge.amount <= 0) return null;
  const now = Date.now();
  const refundId = await ctx.db.insert("messagingCharges", {
    companyId: charge.companyId,
    env: charge.env,
    kind: "refund",
    channel: charge.channel,
    direction: charge.direction,
    messageId: charge.messageId,
    agent: charge.agent,
    activity: `Refund: ${charge.activity ?? KIND_WORDS[charge.kind as MessagingKind]?.label ?? charge.kind}`,
    count: charge.count,
    rateCardVersion: charge.rateCardVersion,
    unitPrice: charge.unitPrice,
    reserved: 0,
    amount: -charge.amount,
    state: "captured",
    settlement: "pending_track",
    settleAttempts: 0,
    nextSettleAt: now,
    refundOf: charge._id,
    reason: input.reason.slice(0, 300),
    by: input.by,
    history: [{ at: now, kind: "refund", amount: -charge.amount, note: input.reason.slice(0, 300) }],
    createdAt: now,
    updatedAt: now,
    capturedAt: now,
  });
  await ctx.db.patch(charge._id, { state: "refunded", refundedBy: refundId, updatedAt: now, history: [...charge.history, { at: now, kind: "refunded", amount: -charge.amount, note: input.reason.slice(0, 300) }].slice(-30) });
  await spendLocally(ctx, charge.companyId, charge.env, -charge.amount);
  await ctx.scheduler.runAfter(0, internal.messagingBilling.settle, { chargeId: refundId });
  return refundId;
}

/**
 * An inbound text or picture message: charged after it arrives, because it cannot be refused. It may take
 * the balance below zero down to the overdraft floor; the Owner is told at $0 and at -$5, and Selestial
 * staff are told at -$10, but inbound keeps being received and processed (opt-outs above all). One charge
 * per provider message id.
 */
export async function chargeInbound(ctx: Ctx, input: { companyId: Id<"companies">; providerMessageId: string; provider: string; mms: boolean; parts?: number; activity: string }) {
  if (!meteringOn()) return null;
  const state = billingState();
  if (!state.connected) return null;
  const seen = await ctx.db
    .query("messagingCharges")
    .withIndex("by_company_inbound", (q) => q.eq("companyId", input.companyId).eq("inboundKey", input.providerMessageId))
    .first();
  if (seen) return seen._id;
  const now = Date.now();
  const card = rateCardAt(now);
  const kind: MessagingKind = input.mms ? "mms_in" : "sms_in";
  const count = input.mms ? 1 : Math.max(1, input.parts ?? 1);
  const { unitPrice, amount } = priceOf(card, kind, count);
  const chargeId = await ctx.db.insert("messagingCharges", {
    companyId: input.companyId,
    env: state.env,
    kind,
    channel: input.mms ? "mms" : "sms",
    direction: "in",
    inboundKey: input.providerMessageId,
    provider: input.provider,
    providerMessageId: input.providerMessageId,
    activity: input.activity,
    count,
    estimatedCount: count,
    rateCardVersion: card.version,
    unitPrice,
    reserved: 0,
    amount,
    state: "captured",
    lockId: `in-${input.providerMessageId}`.slice(0, 120),
    settlement: "pending_track",
    settleAttempts: 0,
    nextSettleAt: now,
    history: [{ at: now, kind: "inbound", amount, note: `${count} ${count === 1 ? KIND_WORDS[kind].unit : KIND_WORDS[kind].units} received` }],
    createdAt: now,
    updatedAt: now,
    capturedAt: now,
  });
  await spendLocally(ctx, input.companyId, state.env, amount);
  await ctx.scheduler.runAfter(0, internal.messagingBilling.settle, { chargeId });
  // Unusual inbound volume is looked at by a person: it may be abuse, and it costs money that cannot be refused.
  const lastHour = await ctx.db
    .query("messagingCharges")
    .withIndex("by_company_created", (q) => q.eq("companyId", input.companyId).gte("createdAt", now - HOUR))
    .take(INBOUND_PER_HOUR_ALERT + 1);
  if (lastHour.filter((row) => row.direction === "in").length === INBOUND_PER_HOUR_ALERT + 1) {
    await recordEvent(ctx, { companyId: input.companyId, type: "billing.messaging_inbound_spike", actor: { kind: "system" }, subject: { table: "companies", id: input.companyId }, data: { perHour: INBOUND_PER_HOUR_ALERT } });
  }
  return chargeId;
}

/** Owner notices for the messaging balance: low, empty, overdrawn, and the staff escalation at the floor. */
export async function balanceNotices(ctx: Ctx, account: Account) {
  if (!account.messaging) return;
  const remaining = account.messaging.remaining;
  const controls = controlsOf(account);
  if (remaining <= OVERDRAFT_FLOOR) {
    await noticeOnce(ctx, account, "messaging_overdraft", `Incoming texts have taken the messaging balance to ${formatUnits(remaining)}. Selestial's team has been told. Incoming texts and opt-outs keep working; add funds to bring it back above zero.`);
    await recordEvent(ctx, { companyId: account.companyId, type: "billing.messaging_overdraft_escalation", actor: { kind: "system" }, subject: { table: "billingAccounts", id: account._id }, data: { remaining } });
  } else if (remaining <= OVERDRAFT_WARN) {
    await noticeOnce(ctx, account, "messaging_overdraft", `Incoming texts have taken the messaging balance to ${formatUnits(remaining)}. Outbound messages are paused. Add funds to bring it back above zero.`);
  } else if (remaining <= 0) {
    await noticeOnce(ctx, account, "messaging_empty", "The messaging balance is used up, so new outbound texts and emails are paused and kept. Incoming texts and opt-outs keep working. Add funds to send what is waiting.");
  } else if (remaining < controls.lowBalance) {
    await noticeOnce(ctx, account, "messaging_low", `The messaging balance is ${formatUnits(remaining)}, below your ${formatUnits(controls.lowBalance)} alert. Add funds so messages keep going out.`);
  }
}

async function noticeOnce(ctx: Ctx, account: Account, kind: Account["notices"][number]["kind"], text: string) {
  const now = Date.now();
  if (account.notices.some((row) => row.kind === kind && now - row.at < 24 * HOUR)) return;
  await ctx.db.patch(account._id, { notices: [{ kind, at: now, text }, ...account.notices].slice(0, 10) });
  await recordEvent(ctx, { companyId: account.companyId, type: `billing.${kind}`, actor: { kind: "system" }, subject: { table: "billingAccounts", id: account._id }, data: { env: account.env } });
}
