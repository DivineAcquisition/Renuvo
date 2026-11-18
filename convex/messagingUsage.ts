/**
 * What the Owner sees about messaging money: the balance and what is set aside, this month's spend broken
 * down by channel, direction and agent, work waiting for funds or a limit, recent charges, payments, the
 * plain rate card and a monthly statement. Owner only. Amounts are units of $0.0001; the page formats them.
 * No provider, lock or message ids leave this file.
 */
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { accountFor, billingState, verifiedPlan } from "./lib/billing/access";
import { AGENT_CATALOG } from "./lib/billing/catalog";
import { ownerQuery } from "./lib/builders";
import { localParts } from "./lib/availability";
import { controlsOf, meteringOn, monthStart, OVERDRAFT_FLOOR, STALE_HOLD_MS } from "./lib/messagingBilling/ledger";
import { KIND_WORDS, MESSAGING_KINDS, rateCardAt, type MessagingKind } from "./lib/messagingBilling/rates";
import { CHARGE_STATE_WORDS, INCLUDED_MESSAGING, TOP_UP_STATE_WORDS, UNAVAILABLE_ROUTES } from "./lib/messagingBilling/wording";
import { TOP_UP_MAX_CENTS, TOP_UP_MIN_CENTS, TOP_UP_PRESETS } from "./messagingFunds";

type Charge = Doc<"messagingCharges">;

const LIMITED_AGENTS = ["sales", "dispatch", "recruiter", "retention"] as const;

function whoOf(charge: Pick<Charge, "agent" | "memberId" | "kind">): { key: string; label: string } {
  if (charge.agent && charge.agent in AGENT_CATALOG) return { key: charge.agent, label: AGENT_CATALOG[charge.agent as keyof typeof AGENT_CATALOG].name };
  if (charge.memberId) return { key: "team", label: "Your team" };
  if (charge.kind === "sms_in" || charge.kind === "mms_in") return { key: "inbound", label: "Replies and incoming texts" };
  return { key: "selestial", label: "Automatic messages" };
}

/** What a charge row counts toward spend: the final amount once known, otherwise what is set aside. */
function spendOf(charge: Charge): number {
  if (charge.state === "captured" || charge.state === "refunded") return charge.amount;
  if (charge.state === "reserving" || charge.state === "reserved" || charge.state === "pending") return charge.reserved;
  return 0;
}

const KIND_LABEL: Record<string, string> = {
  ...Object.fromEntries(MESSAGING_KINDS.map((k) => [k, KIND_WORDS[k].label])),
  number_monthly: "Business number, monthly",
  registration_fee: "Carrier registration fee",
  refund: "Refund",
  adjustment: "Balance adjustment",
};

function describe(charge: Charge) {
  const words = (MESSAGING_KINDS as readonly string[]).includes(charge.kind) ? KIND_WORDS[charge.kind as MessagingKind] : null;
  const count = charge.state === "captured" || charge.state === "refunded" ? charge.count : (charge.estimatedCount ?? charge.count);
  const negative = charge.kind === "refund" || (charge.kind === "adjustment" && charge.amount < 0);
  return {
    at: charge.capturedAt ?? charge.createdAt,
    what: charge.activity ?? KIND_LABEL[charge.kind] ?? "Messaging",
    kind: KIND_LABEL[charge.kind] ?? charge.kind,
    detail: words && count > 0 ? `${count} ${count === 1 ? words.unit : words.units}` : (charge.reason ?? null),
    who: whoOf(charge).label,
    status: negative ? (charge.kind === "refund" ? "Refunded to balance" : "Credited to balance") : charge.kind === "adjustment" ? "Taken from balance" : (CHARGE_STATE_WORDS[charge.state] ?? charge.state),
    /** Positive: money out of the balance. Negative: money back. */
    amount: charge.state === "captured" || charge.state === "refunded" || charge.kind === "refund" || charge.kind === "adjustment" ? charge.amount : charge.state === "released" ? 0 : charge.reserved,
    final: charge.state === "captured" || charge.state === "refunded" || charge.state === "released" || charge.kind === "refund" || charge.kind === "adjustment",
  };
}

async function chargesSince(ctx: QueryCtx, companyId: Doc<"companies">["_id"], since: number, until = Number.MAX_SAFE_INTEGER) {
  return ctx.db
    .query("messagingCharges")
    .withIndex("by_company_created", (q) => q.eq("companyId", companyId).gte("createdAt", since).lt("createdAt", until))
    .order("desc")
    .take(10_000);
}

const HOLD_WORDS: Record<string, string> = {
  messaging_balance: "Add messaging funds to send them.",
  messaging_limit: "They are over a spending limit you set. Raise the limit to send them.",
  billing_unavailable: "Billing could not be reached. They are tried again automatically.",
};

export const overview = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const metering = meteringOn();
    const state = billingState();
    const card = rateCardAt(Date.now());
    const rateCard = {
      version: card.version,
      effectiveFrom: card.effectiveFrom,
      rows: MESSAGING_KINDS.map((kind) => ({ kind, label: KIND_WORDS[kind].label, per: KIND_WORDS[kind].unit, price: card.rates[kind] })),
      numberMonthly: card.numberMonthly,
      included: [...INCLUDED_MESSAGING],
      unavailable: [...UNAVAILABLE_ROUTES],
    };
    const options = { presets: [...TOP_UP_PRESETS], minCents: TOP_UP_MIN_CENTS, maxCents: TOP_UP_MAX_CENTS };
    if (!state.connected) return { connected: false as const, metering, rateCard, options };

    const account = await accountFor(ctx, ctx.companyId, state.env);
    const controls = controlsOf(account);
    const now = Date.now();
    const since = monthStart(ctx.company.timezone, now);
    const month = await chargesSince(ctx, ctx.companyId, since);

    let outbound = 0;
    let inbound = 0;
    let credits = 0;
    let fees = 0;
    const byKind = new Map<string, { kind: string; label: string; count: number; amount: number }>();
    const byAgent = new Map<string, { key: string; label: string; amount: number; count: number }>();
    for (const row of month) {
      const spend = spendOf(row);
      if (row.kind === "refund" || row.kind === "adjustment") {
        credits += row.amount < 0 ? -row.amount : 0;
        if (row.kind === "adjustment" && row.amount > 0) fees += row.amount;
        continue;
      }
      if (row.kind === "number_monthly" || row.kind === "registration_fee") {
        fees += spend;
        continue;
      }
      if (spend === 0 && row.state !== "captured") continue;
      if (row.direction === "in") inbound += spend;
      else outbound += spend;
      const k = byKind.get(row.kind) ?? { kind: row.kind, label: KIND_LABEL[row.kind], count: 0, amount: 0 };
      k.count += row.state === "captured" || row.state === "refunded" ? row.count : (row.estimatedCount ?? row.count);
      k.amount += spend;
      byKind.set(row.kind, k);
      const who = whoOf(row);
      const a = byAgent.get(who.key) ?? { ...who, amount: 0, count: 0 };
      a.amount += spend;
      a.count += 1;
      byAgent.set(who.key, a);
    }
    for (const kind of MESSAGING_KINDS) if (!byKind.has(kind)) byKind.set(kind, { kind, label: KIND_LABEL[kind], count: 0, amount: 0 });

    const reservedRows = month.filter((row) => row.state === "reserving" || row.state === "reserved" || row.state === "pending");
    const reserved = reservedRows.reduce((sum, row) => sum + row.reserved, 0);

    // Work waiting for funds or a limit, grouped by who prepared it, with what it would cost to send now.
    const held: { key: string; label: string; reason: string; count: number; stale: number; estimate: number }[] = [];
    for (const reason of ["messaging_balance", "messaging_limit", "billing_unavailable"] as const) {
      const rows = await ctx.db
        .query("messages")
        .withIndex("by_company_hold", (q) => q.eq("companyId", ctx.companyId).eq("holdReason", reason))
        .take(1_000);
      const groups = new Map<string, (typeof held)[number]>();
      for (const message of rows) {
        if (message.status !== "held") continue;
        const who = whoOf({ agent: message.agent, memberId: message.authorId, kind: "sms_out" });
        const g = groups.get(who.key) ?? { ...who, reason, count: 0, stale: 0, estimate: 0 };
        g.count += 1;
        if (message.heldAt !== undefined && now - message.heldAt > STALE_HOLD_MS) g.stale += 1;
        g.estimate += (message.channel ?? "sms") === "email" ? (message.recipients ?? 1) * card.rates.email_out : (message.segments ?? 1) * card.rates.sms_out;
        groups.set(who.key, g);
      }
      held.push(...groups.values());
    }

    const topUps = await ctx.db
      .query("messagingTopUps")
      .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(24);
    const autoThisMonth = topUps.filter((row) => row.source === "automatic" && row.createdAt >= since && row.status !== "failed").reduce((sum, row) => sum + row.amount, 0);
    const authorizer = controls.autoTopUp.authorizedBy ? await ctx.db.get(controls.autoTopUp.authorizedBy) : null;

    const recent = await ctx.db
      .query("messagingCharges")
      .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(30);

    const balance = account?.messaging ?? null;
    return {
      connected: true as const,
      metering,
      env: state.env,
      hasPlan: !!(account?.plan ?? verifiedPlan(ctx.company)),
      balance: balance
        ? {
            available: balance.remaining,
            reserved,
            purchased: balance.purchased,
            promotional: balance.promotional,
            negative: balance.remaining < 0,
            overdraftFloor: OVERDRAFT_FLOOR,
            at: balance.at,
          }
        : null,
      month: {
        from: since,
        outbound,
        inbound,
        fees,
        credits,
        total: outbound + inbound + fees - credits,
        byKind: [...byKind.values()],
        byAgent: [...byAgent.values()].sort((a, b) => b.amount - a.amount),
        limit: controls.monthlyLimit ?? null,
      },
      controls: {
        monthlyLimit: controls.monthlyLimit ?? null,
        batchLimit: controls.batchLimit ?? null,
        lowBalance: controls.lowBalance,
        agentLimits: LIMITED_AGENTS.map((agent) => ({
          agent,
          label: AGENT_CATALOG[agent].name,
          limit: controls.agentLimits?.[agent] ?? null,
          spent: byAgent.get(agent)?.amount ?? 0,
        })),
        autoTopUp: {
          enabled: controls.autoTopUp.enabled,
          threshold: controls.autoTopUp.threshold,
          amount: controls.autoTopUp.amount,
          monthlyMax: controls.autoTopUp.monthlyMax,
          authorizedAt: controls.autoTopUp.authorizedAt ?? null,
          authorizedBy: authorizer?.name ?? null,
          usedThisMonth: autoThisMonth,
        },
      },
      held: held.map((g) => ({ ...g, words: HOLD_WORDS[g.reason] })),
      recent: recent.map(describe),
      payments: topUps.map((row) => ({
        at: row.createdAt,
        source: row.source === "automatic" ? "Automatic top-up" : "Added by you",
        cents: row.cents,
        amount: row.amount,
        status: TOP_UP_STATE_WORDS[row.status] ?? row.status,
        problem: row.problem ?? null,
        receipt: row.invoiceUrl ?? null,
        returned: row.clawedBack,
      })),
      rateCard,
      options,
    };
  },
});

/** One calendar month of messaging charges, for the downloadable statement. `month` is "YYYY-MM" on the company's clock. */
export const statement = ownerQuery({
  args: { month: v.string() },
  handler: async (ctx, args) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month)) return null;
    const tz = ctx.company.timezone;
    const from = monthStart(tz, Date.parse(`${args.month}-15T12:00:00Z`));
    const [y, m] = args.month.split("-").map(Number);
    const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
    const to = monthStart(tz, Date.parse(`${next}-15T12:00:00Z`));
    const rows = await chargesSince(ctx, ctx.companyId, from, to);
    const topUps = (
      await ctx.db
        .query("messagingTopUps")
        .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId).gte("createdAt", from).lt("createdAt", to))
        .collect()
    ).filter((row) => row.status !== "failed" && row.status !== "payment_needed");
    const lines = rows
      .filter((row) => row.state !== "released" && row.state !== "estimated")
      .map((row) => {
        const d = describe(row);
        return { date: localParts(d.at, tz).day, description: d.what, type: d.kind, quantity: d.detail ?? "", who: d.who, rateVersion: row.rateCardVersion, status: d.status, amount: d.amount };
      })
      .reverse();
    const charged = lines.reduce((sum, line) => sum + line.amount, 0);
    const added = topUps.reduce((sum, row) => sum + row.amount - row.clawedBack, 0);
    return {
      company: ctx.company.name,
      month: args.month,
      timezone: tz,
      lines,
      funds: topUps.map((row) => ({ date: localParts(row.createdAt, tz).day, description: row.source === "automatic" ? "Automatic top-up" : "Messaging funds added", amount: row.amount - row.clawedBack })),
      totals: { charged, added },
    };
  },
});
