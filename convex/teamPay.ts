/**
 * Finance › Team Pay (docs/finance/00-plan.md, phase 3). What each cleaner earned on each completed job,
 * reviewed and approved by the Owner, then paid outside Selestial and recorded here. The states stay
 * apart: Calculated → Needs review → Approved → Payment started → Paid. Approval is never proof of
 * payment; "Paid" needs the Owner's explicit confirmation.
 *
 * For employees, Selestial records hours and gross pay for the company's payroll. It does not calculate
 * or withhold taxes or file payroll.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { ownerMutation, ownerQuery, type MemberAccess } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { money } from "./lib/dispatch/pay";
import { requireFinance } from "./lib/finance/authority";
import { bindsTo, requireSame } from "./lib/finance/confirm";
import { endOfLocalDate, localDateKey, settingsOf, settingsRow } from "./lib/finance/settings";
import { TEAM_PAY_METHODS, teamPayMethodValidator, type TeamPayMethod } from "./lib/finance/schema";
import { issueStatementLink, liveStatementLink, statementLinksConfigured, statementToken, statementUrl } from "./lib/finance/statementLinks";
import { jobCrew, liveAdjustments, owedOn, payMethodWords, payUsedFor, splitEvenly, syncJobEarnings } from "./lib/finance/teamPay";
import { canSendTo, queueCleanerStatement } from "./lib/finance/cleanerOutbox";
import { allow } from "./lib/rateLimit";

type Ctx = (QueryCtx | MutationCtx) & MemberAccess;
const DAY = 86_400_000;

const STATUS_WORDS: Record<Doc<"earnings">["status"], string> = {
  calculated: "Calculated",
  needs_review: "Needs review",
  approved: "Approved",
  payment_started: "Payment started",
  paid: "Paid",
  void: "Set aside",
};

const METHOD_WORDS: Record<TeamPayMethod, string> = { zelle: "Zelle", venmo: "Venmo", cash: "Cash", check: "Check", bank_transfer: "Bank transfer", payroll: "Payroll", other: "Other" };


/** Whether the pay an earning was worked out with matches the cleaner's pay method now. */
function samePay(a: NonNullable<Doc<"earnings">["payUsed"]>, b: Doc<"earnings">["payUsed"]): boolean {
  if (!b || a.kind !== b.kind) return false;
  if (a.kind === "share" && b.kind === "share") return a.shareBps === b.shareBps && (a.tierName ?? null) === (b.tierName ?? null);
  if (a.kind === "fixed" && b.kind === "fixed") return a.perJobCents === b.perJobCents;
  if (a.kind === "hourly" && b.kind === "hourly") return a.hourlyCents === b.hourlyCents;
  return false;
}

async function jobLabel(ctx: QueryCtx, job: Doc<"jobs">, timezone: string) {
  const customer = await ctx.db.get(job.customerId);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric" }).format(new Date(job.startsAt));
  return { service: job.serviceSnapshot?.name ?? job.serviceType, customer: customer?.name ?? "Customer", day, date: localDateKey(job.startsAt, timezone) };
}

async function earningFacts(earning: Doc<"earnings">) {
  return { earning: earning._id, status: earning.status, total: earning.totalCents, base: earning.baseCents, tips: earning.tipCents, adjustments: liveAdjustments(earning), minutes: earning.facts.paidMinutes, basis: earning.basis, updatedAt: earning.updatedAt };
}

async function earningRow(ctx: QueryCtx, earning: Doc<"earnings">, timezone: string, cache: Map<string, Doc<"cleaners"> | null>) {
  let cleaner = cache.get(earning.cleanerId);
  if (cleaner === undefined) {
    cleaner = await ctx.db.get(earning.cleanerId);
    cache.set(earning.cleanerId, cleaner);
  }
  const job = (await ctx.db.get(earning.jobId))!;
  const label = await jobLabel(ctx, job, timezone);
  const owed = owedOn(earning);
  const approvable = (earning.status === "calculated" || earning.status === "needs_review") && earning.totalCents !== null;
  return {
    id: earning._id,
    cleanerId: earning.cleanerId,
    cleaner: cleaner?.name ?? "Cleaner",
    engagement: cleaner?.engagement ?? "contractor",
    jobId: earning.jobId,
    ...label,
    status: earning.status,
    statusWords: STATUS_WORDS[earning.status],
    method: earning.method,
    basis: earning.basis,
    minutes: earning.facts.paidMinutes,
    minutesSource: earning.facts.minutesSource,
    baseCents: earning.baseCents,
    adjustmentCents: liveAdjustments(earning),
    tipCents: earning.tipCents,
    totalCents: earning.totalCents,
    flags: earning.flags,
    owedCents: owed.jobCents + owed.lateTipCents,
    lateTipCents: owed.lateTipCents,
    paymentId: earning.paymentId ?? null,
    bindsTo: approvable ? await bindsTo("approve_earning", await earningFacts(earning)) : null,
  };
}

const FILTERS = ["review", "approved", "started", "paid", "all"] as const;
const filterValidator = v.union(...FILTERS.map((f) => v.literal(f)));
const IN_FILTER: Record<(typeof FILTERS)[number], readonly Doc<"earnings">["status"][]> = {
  review: ["calculated", "needs_review"],
  approved: ["approved"],
  started: ["payment_started"],
  paid: ["paid"],
  all: ["calculated", "needs_review", "approved", "payment_started", "paid"],
};

/** The Team Pay tab: earnings by state, what is owed to whom, and the counts behind each filter. */
export const overview = ownerQuery({
  args: { filter: filterValidator },
  handler: async (ctx, args) => {
    requireFinance(ctx, "read");
    const tz = ctx.company.timezone;
    const since = Date.now() - 120 * DAY;
    const byStatus = new Map<Doc<"earnings">["status"], Doc<"earnings">[]>();
    for (const status of ["calculated", "needs_review", "approved", "payment_started", "paid"] as const) {
      byStatus.set(
        status,
        await ctx.db
          .query("earnings")
          .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", status).gte("jobStartsAt", status === "paid" ? since : 0))
          .order("desc")
          .take(400),
      );
    }
    const cache = new Map<string, Doc<"cleaners"> | null>();
    const rows = [];
    for (const status of IN_FILTER[args.filter]) for (const earning of byStatus.get(status) ?? []) rows.push(await earningRow(ctx, earning, tz, cache));
    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.cleaner.localeCompare(b.cleaner)));
    const sum = (list: Doc<"earnings">[] | undefined, f: (e: Doc<"earnings">) => number) => (list ?? []).reduce((s, e) => s + f(e), 0);
    const review = [...(byStatus.get("calculated") ?? []), ...(byStatus.get("needs_review") ?? [])];
    const approved = byStatus.get("approved") ?? [];
    const started = byStatus.get("payment_started") ?? [];
    const lateTips = [...started, ...(byStatus.get("paid") ?? [])].reduce((s, e) => s + owedOn(e).lateTipCents, 0);
    const monthStart = endOfLocalDate(`${localDateKey(Date.now(), tz).slice(0, 8)}01`, tz) - DAY + 1;
    const paidThisMonth = await ctx.db
      .query("teamPayments")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "paid").gte("createdAt", monthStart - 31 * DAY))
      .take(500);
    // Who is owed what, approved and not yet paid.
    const owedBy = new Map<string, { cleanerId: Id<"cleaners">; cleaner: string; cents: number; count: number }>();
    for (const e of [...approved, ...started, ...(byStatus.get("paid") ?? [])]) {
      const owed = owedOn(e);
      const cents = owed.jobCents + owed.lateTipCents;
      if (!cents) continue;
      const name = cache.get(e.cleanerId)?.name ?? (await ctx.db.get(e.cleanerId))?.name ?? "Cleaner";
      const row = owedBy.get(e.cleanerId) ?? { cleanerId: e.cleanerId, cleaner: name, cents: 0, count: 0 };
      row.cents += cents;
      row.count += 1;
      owedBy.set(e.cleanerId, row);
    }
    const cleaners = await ctx.db
      .query("cleaners")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "ready"))
      .take(200);
    return {
      rows,
      counts: { review: review.length, approved: approved.length, started: started.length, paid: (byStatus.get("paid") ?? []).length, all: review.length + approved.length + started.length + (byStatus.get("paid") ?? []).length },
      totals: {
        reviewCents: sum(review, (e) => e.totalCents ?? 0),
        reviewMissing: review.filter((e) => e.totalCents === null).length,
        needsReview: (byStatus.get("needs_review") ?? []).length,
        approvedUnpaidCents: sum(approved, (e) => e.totalCents ?? 0) + lateTips,
        startedCents: started.reduce((s, e) => s + (e.approved?.totalCents ?? e.totalCents ?? 0), 0),
        paidThisMonthCents: paidThisMonth.filter((p) => (p.paidAt ?? p.createdAt) >= monthStart).reduce((s, p) => s + p.amountCents, 0),
      },
      owed: [...owedBy.values()].sort((a, b) => b.cents - a.cents),
      // Workers supplied by a subcontractor company carry no pay terms of their own, so they aren't "missing" pay.
      noPay: cleaners.filter((c) => !c.pay && c.engagement !== "subcontractor").map((c) => ({ id: c._id, name: c.name })),
      hasEmployees: cleaners.some((c) => c.engagement === "employee"),
      tiers: (ctx.company.payTiers ?? []).filter((t) => !t.archived),
    };
  },
});

/** One earning in full, for its drawer. */
export const earning = ownerQuery({
  args: { earningId: v.id("earnings") },
  handler: async (ctx, args) => {
    requireFinance(ctx, "read");
    const earning = await owned(ctx, args.earningId);
    const tz = ctx.company.timezone;
    const cleaner = await ctx.db.get(earning.cleanerId);
    const job = (await ctx.db.get(earning.jobId))!;
    const label = await jobLabel(ctx, job, tz);
    const payment = earning.paymentId ? await ctx.db.get(earning.paymentId) : null;
    const tips = await ctx.db
      .query("tips")
      .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", job._id))
      .take(50);
    const members = new Map<string, string>();
    const memberName = async (id: Id<"members">) => {
      if (!members.has(id)) members.set(id, (await ctx.db.get(id))?.name ?? "Owner");
      return members.get(id)!;
    };
    const history = await ctx.db
      .query("events")
      .withIndex("by_company_subject_at", (q) => q.eq("companyId", ctx.companyId).eq("subjectId", earning._id))
      .order("desc")
      .take(30);
    const row = await earningRow(ctx, earning, tz, new Map());
    return {
      ...row,
      engagement: cleaner?.engagement ?? "contractor",
      currentPay: payMethodWords(cleaner?.pay, ctx.company.payTiers),
      payUsedDiffers: earning.payUsed !== undefined && cleaner !== null && !samePay(earning.payUsed, payUsedFor(cleaner, ctx.company.payTiers ?? [])),
      facts: earning.facts,
      hoursCorrection: earning.hoursCorrection ? { minutes: earning.hoursCorrection.minutes, reason: earning.hoursCorrection.reason, at: earning.hoursCorrection.at } : null,
      adjustments: await Promise.all(earning.adjustments.map(async (a) => ({ id: a.id, cents: a.cents, reason: a.reason, at: a.at, by: await memberName(a.by), reversed: a.reversed ? { reason: a.reversed.reason, at: a.reversed.at } : null }))),
      tips: tips.filter((t) => t.status !== "refunded").map((t) => ({ id: t._id, totalCents: t.amountCents, mineCents: t.allocations.find((a) => a.cleanerId === earning.cleanerId)?.cents ?? 0, source: t.source, status: t.status, crew: t.allocations.length, at: t.createdAt })),
      approved: earning.approved ? { at: earning.approved.at, totalCents: earning.approved.totalCents, by: await memberName(earning.approved.by) } : null,
      payment: payment ? { id: payment._id, status: payment.status, method: METHOD_WORDS[payment.method], amountCents: payment.amountCents, paidOn: payment.paidOn ?? null, reference: payment.reference ?? null, startedAt: payment.startedAt } : null,
      voidReason: earning.voidReason ?? null,
      scheduledDay: label.date,
      timeline: history.map((e) => ({ id: e._id, at: e.at, type: e.type, amountCents: typeof e.data?.amountCents === "number" ? e.data.amountCents : null })),
    };
  },
});

/** One cleaner: their pay method, what they are owed, their recent earnings and payments, and their statement link. */
export const cleaner = ownerQuery({
  args: { cleanerId: v.id("cleaners") },
  handler: async (ctx, args) => {
    requireFinance(ctx, "read");
    const cleaner = await owned(ctx, args.cleanerId);
    const tz = ctx.company.timezone;
    const earnings = await ctx.db
      .query("earnings")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id).gte("jobStartsAt", Date.now() - 120 * DAY))
      .order("desc")
      .take(200);
    const payments = await ctx.db
      .query("teamPayments")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .order("desc")
      .take(50);
    const cache = new Map<string, Doc<"cleaners"> | null>([[cleaner._id, cleaner]]);
    const rows = [];
    for (const e of earnings) if (e.status !== "void") rows.push(await earningRow(ctx, e, tz, cache));
    const link = await liveStatementLink(ctx, ctx.companyId, cleaner._id);
    const token = link ? await statementToken(link) : null;
    return {
      id: cleaner._id,
      name: cleaner.name,
      engagement: cleaner.engagement,
      pay: cleaner.pay ?? null,
      payWords: payMethodWords(cleaner.pay, ctx.company.payTiers),
      tiers: (ctx.company.payTiers ?? []).filter((t) => !t.archived),
      owedCents: rows.reduce((s, r) => s + r.owedCents, 0),
      rows,
      payments: payments.map((p) => ({ id: p._id, status: p.status, method: METHOD_WORDS[p.method], amountCents: p.amountCents, paidOn: p.paidOn ?? null, startedAt: p.startedAt, reference: p.reference ?? null, jobs: p.parts.length, canceled: p.canceled ? p.canceled.reason : null })),
      statement: { configured: statementLinksConfigured(), url: token ? statementUrl(token) : null, expiresAt: link?.expiresAt ?? null, issuedAt: link?.issuedAt ?? null },
      channels: { sms: await canSendTo(ctx, ctx.companyId, cleaner, "sms"), email: await canSendTo(ctx, ctx.companyId, cleaner, "email") },
    };
  },
});

// ── Keeping earnings current ─────────────────────────────────────────────────────────────────────

async function syncRecent(ctx: MutationCtx, companyId: Id<"companies">, days: number) {
  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_company_status_start", (q) => q.eq("companyId", companyId).eq("status", "completed").gte("startsAt", Date.now() - days * DAY))
    .take(300);
  for (const job of jobs) await syncJobEarnings(ctx, job);
  return jobs.length;
}

/** The Owner opened Team Pay: bring every recent completed job's earnings up to date now. */
export const refresh = ownerMutation({
  args: {},
  handler: async (ctx) => {
    requireFinance(ctx, "read");
    if (!(await allow(ctx, `teampay-refresh:${ctx.companyId}`, 30, 10 * 60_000))) return { jobs: 0 };
    return { jobs: await syncRecent(ctx, ctx.companyId, 60) };
  },
});

/** Every 15 minutes: completed jobs get their earnings worked out, for every company. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_status_start", (q) => q.eq("status", "completed").gte("startsAt", Date.now() - 45 * DAY))
      .take(500);
    for (const job of jobs) await syncJobEarnings(ctx, job);
    return { jobs: jobs.length };
  },
});

async function editable(ctx: Ctx, earningId: Id<"earnings">): Promise<Doc<"earnings">> {
  const earning = await owned(ctx, earningId);
  if (earning.status === "payment_started" || earning.status === "paid") throw userError("A payment was already started for this, so it can't change. Cancel the payment first if it was recorded by mistake.");
  if (earning.status === "void") throw userError("This was set aside.");
  return earning;
}

async function resync(ctx: MutationCtx & MemberAccess, earning: Doc<"earnings">) {
  const job = (await ctx.db.get(earning.jobId))!;
  await syncJobEarnings(ctx, job, byMember(ctx));
}

// ── The Owner's changes, each with a reason ──────────────────────────────────────────────────────

export const correctHours = ownerMutation({
  args: { earningId: v.id("earnings"), minutes: v.union(v.number(), v.null()), reason: v.string() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const earning = await editable(ctx, args.earningId);
    const reason = args.reason.trim();
    if (args.minutes === null) {
      await ctx.db.patch(earning._id, { hoursCorrection: undefined, updatedAt: Date.now() });
    } else {
      if (!Number.isInteger(args.minutes) || args.minutes < 1 || args.minutes > 16 * 60) throw userError("Enter between 1 minute and 16 hours.");
      if (!reason) throw userError("Say why the hours changed, so the cleaner's statement makes sense.");
      await ctx.db.patch(earning._id, { hoursCorrection: { minutes: args.minutes, reason: reason.slice(0, 300), by: ctx.member._id, at: Date.now() }, updatedAt: Date.now() });
    }
    await recordEvent(ctx, { companyId: ctx.companyId, type: "earning.hours_corrected", actor: byMember(ctx), subject: { table: "earnings", id: earning._id }, data: { minutes: args.minutes } });
    await resync(ctx, earning);
    return { ok: true };
  },
});

export const addAdjustment = ownerMutation({
  args: { earningId: v.id("earnings"), cents: v.number(), reason: v.string() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const earning = await editable(ctx, args.earningId);
    if (!Number.isSafeInteger(args.cents) || args.cents === 0 || Math.abs(args.cents) > 500_000) throw userError("Enter an amount to add or take off, up to $5,000.");
    const reason = args.reason.trim();
    if (!reason) throw userError("Say why, so the cleaner's statement makes sense.");
    if (earning.totalCents !== null && earning.totalCents + args.cents < 0) throw userError("That would make the pay for this job less than $0.");
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await ctx.db.patch(earning._id, { adjustments: [...earning.adjustments, { id, cents: args.cents, reason: reason.slice(0, 300), by: ctx.member._id, at: Date.now() }], updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "earning.adjusted", actor: byMember(ctx), subject: { table: "earnings", id: earning._id }, data: { amountCents: args.cents } });
    await resync(ctx, earning);
    return { ok: true };
  },
});

export const reverseAdjustment = ownerMutation({
  args: { earningId: v.id("earnings"), adjustmentId: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const earning = await editable(ctx, args.earningId);
    const reason = args.reason.trim();
    if (!reason) throw userError("Say why.");
    const target = earning.adjustments.find((a) => a.id === args.adjustmentId);
    if (!target || target.reversed) return { already: true };
    await ctx.db.patch(earning._id, { adjustments: earning.adjustments.map((a) => (a.id === args.adjustmentId ? { ...a, reversed: { at: Date.now(), by: ctx.member._id, reason: reason.slice(0, 300) } } : a)), updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "earning.adjustment_reversed", actor: byMember(ctx), subject: { table: "earnings", id: earning._id }, data: { amountCents: -target.cents } });
    await resync(ctx, earning);
    return { already: false };
  },
});

/** Works the job out again with the cleaner's current pay method, for an earning that hasn't been paid. */
export const useCurrentPay = ownerMutation({
  args: { earningId: v.id("earnings") },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const earning = await editable(ctx, args.earningId);
    await ctx.db.patch(earning._id, { payUsed: undefined, approved: undefined, status: "needs_review", updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "earning.recalculated", actor: byMember(ctx), subject: { table: "earnings", id: earning._id } });
    await resync(ctx, earning);
    return { ok: true };
  },
});

// ── Approving ────────────────────────────────────────────────────────────────────────────────────

async function approveOne(ctx: MutationCtx & MemberAccess, earningId: Id<"earnings">, given: string): Promise<{ ok: boolean; words: string }> {
  const earning = await owned(ctx, earningId);
  if (earning.status !== "calculated" && earning.status !== "needs_review") return { ok: false, words: earning.status === "approved" ? "Already approved." : "Can't be approved now." };
  if (earning.totalCents === null) return { ok: false, words: "Its pay can't be worked out yet." };
  try {
    await requireSame(given, "approve_earning", await earningFacts(earning));
  } catch {
    return { ok: false, words: "It changed since you reviewed it. Review it again." };
  }
  const now = Date.now();
  await ctx.db.patch(earning._id, { status: "approved", approved: { by: ctx.member._id, at: now, totalCents: earning.totalCents }, updatedAt: now });
  await recordEvent(ctx, { companyId: ctx.companyId, type: "earning.approved", actor: byMember(ctx), subject: { table: "earnings", id: earning._id }, data: { amountCents: earning.totalCents } });
  return { ok: true, words: `Approved ${money(earning.totalCents)}` };
}

export const approve = ownerMutation({
  args: { earningId: v.id("earnings"), bindsTo: v.string() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "approve_earnings");
    return approveOne(ctx, args.earningId, args.bindsTo);
  },
});

/** Approve several, each exactly as reviewed. One that changed is reported and left; the others go ahead. */
export const approveMany = ownerMutation({
  args: { items: v.array(v.object({ earningId: v.id("earnings"), bindsTo: v.string() })) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "approve_earnings");
    if (args.items.length > 100) throw userError("Approve up to 100 at a time.");
    const results = [];
    for (const item of args.items) results.push({ earningId: item.earningId, ...(await approveOne(ctx, item.earningId, item.bindsTo)) });
    return { results, approved: results.filter((r) => r.ok).length };
  },
});

/** Takes an approval back before any payment, for example to look again at the hours. */
export const unapprove = ownerMutation({
  args: { earningId: v.id("earnings") },
  handler: async (ctx, args) => {
    requireFinance(ctx, "approve_earnings");
    const earning = await owned(ctx, args.earningId);
    if (earning.status !== "approved") return { ok: false };
    await ctx.db.patch(earning._id, { status: "needs_review", approved: undefined, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "earning.unapproved", actor: byMember(ctx), subject: { table: "earnings", id: earning._id } });
    await resync(ctx, earning);
    return { ok: true };
  },
});

// ── Paying, outside Selestial, recorded here ─────────────────────────────────────────────────────

async function paymentFacts(earnings: Doc<"earnings">[]) {
  return { list: earnings.map((e) => `${e._id}:${e.status}:${e.approved?.totalCents ?? ""}:${e.tipCents}:${e.tipsPaidCents ?? 0}`).join(","), count: earnings.length };
}

/** What a payment would cover, before the Owner records it. */
export const paymentPreview = ownerQuery({
  args: { cleanerId: v.id("cleaners"), earningIds: v.array(v.id("earnings")) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "initiate_payments");
    const cleaner = await owned(ctx, args.cleanerId);
    const earnings = [];
    for (const id of args.earningIds) earnings.push(await owned(ctx, id));
    const parts = earnings.map((e) => ({ earning: e, owed: owedOn(e) }));
    const blocked = earnings.some((e) => e.cleanerId !== cleaner._id) ? "These aren't all for this cleaner." : parts.some((p) => p.owed.jobCents + p.owed.lateTipCents === 0) ? "Something here isn't approved, or is already being paid." : null;
    const total = parts.reduce((s, p) => s + p.owed.jobCents + p.owed.lateTipCents, 0);
    return {
      blocked,
      totalCents: total,
      employee: cleaner.engagement === "employee",
      lines: [
        `${money(total)} to ${cleaner.name} for ${earnings.length} job${earnings.length === 1 ? "" : "s"}${parts.some((p) => p.owed.lateTipCents) ? ", including tips that came later" : ""}.`,
        "Selestial doesn't send this money. Pay them the way you usually do, then record it here.",
        cleaner.engagement === "employee" ? "For an employee, this is gross pay for your payroll. Selestial doesn't calculate or withhold taxes." : "They can see this on their earnings statement.",
      ],
      bindsTo: await bindsTo("team_payment", await paymentFacts(earnings)),
    };
  },
});

/**
 * Records a payment to a cleaner. "started" when the money is on its way; "paid" only with the Owner's
 * confirmation that it arrived. A repeated click (same key) records once.
 */
export const recordPayment = ownerMutation({
  args: {
    cleanerId: v.id("cleaners"),
    earningIds: v.array(v.id("earnings")),
    method: teamPayMethodValidator,
    stage: v.union(v.literal("started"), v.literal("paid")),
    paidOn: v.union(v.string(), v.null()),
    reference: v.union(v.string(), v.null()),
    note: v.union(v.string(), v.null()),
    confirmedPaid: v.boolean(),
    bindsTo: v.string(),
    clientKey: v.string(),
  },
  handler: async (ctx, args) => {
    requireFinance(ctx, "initiate_payments");
    if (!/^[\w-]{8,80}$/.test(args.clientKey)) throw userError("Reload the page and try again.");
    const repeat = await ctx.db
      .query("teamPayments")
      .withIndex("by_company_clientKey", (q) => q.eq("companyId", ctx.companyId).eq("clientKey", args.clientKey))
      .unique();
    if (repeat) return { paymentId: repeat._id, repeated: true };
    if (!TEAM_PAY_METHODS.includes(args.method)) throw userError("Choose how you paid.");
    const cleaner = await owned(ctx, args.cleanerId);
    if (!args.earningIds.length || args.earningIds.length > 50) throw userError("Choose the jobs this payment is for.");
    const earnings = [];
    for (const id of args.earningIds) earnings.push(await owned(ctx, id));
    await requireSame(args.bindsTo, "team_payment", await paymentFacts(earnings));
    if (earnings.some((e) => e.cleanerId !== cleaner._id)) throw userError("These aren't all for this cleaner.");
    const parts = earnings.map((e) => ({ e, owed: owedOn(e) }));
    if (parts.some((p) => p.owed.jobCents + p.owed.lateTipCents === 0)) throw userError("Something here isn't approved, or is already being paid.");
    if (args.stage === "paid" && !args.confirmedPaid) throw userError("Confirm that the cleaner was paid.");
    const tz = ctx.company.timezone;
    if (args.stage === "paid") {
      if (!args.paidOn) throw userError("Choose the day it was paid.");
      if (endOfLocalDate(args.paidOn, tz) - DAY > Date.now()) throw userError("The day paid can't be in the future.");
    }
    const reference = args.reference?.trim().slice(0, 80) || undefined;
    const note = args.note?.trim().slice(0, 500) || undefined;
    const now = Date.now();
    const amount = parts.reduce((s, p) => s + p.owed.jobCents + p.owed.lateTipCents, 0);
    const paymentId = await ctx.db.insert("teamPayments", {
      companyId: ctx.companyId,
      cleanerId: cleaner._id,
      parts: parts.map((p) => ({ earningId: p.e._id, jobCents: p.owed.jobCents, tipCents: p.owed.jobCents ? p.e.tipCents - (p.e.tipsPaidCents ?? 0) : p.owed.lateTipCents })),
      amountCents: amount,
      method: args.method,
      status: args.stage,
      reference,
      note,
      startedAt: now,
      paidOn: args.stage === "paid" ? args.paidOn! : undefined,
      paidAt: args.stage === "paid" ? now : undefined,
      recordedBy: ctx.member._id,
      clientKey: args.clientKey,
      createdAt: now,
      updatedAt: now,
    });
    for (const { e, owed } of parts) {
      // A late tip on an earning already being paid is paid on its own; the earning itself keeps its state.
      if (owed.jobCents) await ctx.db.patch(e._id, { status: args.stage === "paid" ? "paid" : "payment_started", paymentId, tipsPaidCents: e.tipCents, updatedAt: now });
      else await ctx.db.patch(e._id, { tipsPaidCents: e.tipCents, updatedAt: now });
    }
    await recordEvent(ctx, { companyId: ctx.companyId, type: args.stage === "paid" ? "team_payment.paid" : "team_payment.started", actor: byMember(ctx), subject: { table: "teamPayments", id: paymentId }, data: { amountCents: amount, method: args.method, cleanerId: cleaner._id } });
    return { paymentId, repeated: false };
  },
});

/** A started payment arrived: the Owner confirms it. */
export const confirmPaid = ownerMutation({
  args: { paymentId: v.id("teamPayments"), paidOn: v.string(), confirmedPaid: v.boolean() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "initiate_payments");
    const payment = await owned(ctx, args.paymentId);
    if (payment.status === "paid") return { already: true };
    if (payment.status !== "started") throw userError("This payment was canceled.");
    if (!args.confirmedPaid) throw userError("Confirm that the cleaner was paid.");
    if (endOfLocalDate(args.paidOn, ctx.company.timezone) - DAY > Date.now()) throw userError("The day paid can't be in the future.");
    const now = Date.now();
    await ctx.db.patch(payment._id, { status: "paid", paidOn: args.paidOn, paidAt: now, updatedAt: now });
    for (const part of payment.parts) {
      const e = await ctx.db.get(part.earningId);
      if (e && e.paymentId === payment._id && e.status === "payment_started") await ctx.db.patch(e._id, { status: "paid", updatedAt: now });
    }
    await recordEvent(ctx, { companyId: ctx.companyId, type: "team_payment.paid", actor: byMember(ctx), subject: { table: "teamPayments", id: payment._id }, data: { amountCents: payment.amountCents, cleanerId: payment.cleanerId } });
    return { already: false };
  },
});

/** A started payment that didn't happen: canceled with a reason, and the jobs it covered are owed again. */
export const cancelPayment = ownerMutation({
  args: { paymentId: v.id("teamPayments"), reason: v.string() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "initiate_payments");
    const payment = await owned(ctx, args.paymentId);
    if (payment.status === "canceled") return { already: true };
    if (payment.status === "paid") throw userError("A confirmed payment can't be canceled. If it was recorded by mistake, add an adjustment on a future job and explain why.");
    const reason = args.reason.trim();
    if (!reason) throw userError("Say why, so the history makes sense.");
    const now = Date.now();
    await ctx.db.patch(payment._id, { status: "canceled", canceled: { at: now, by: ctx.member._id, reason: reason.slice(0, 300) }, updatedAt: now });
    for (const part of payment.parts) {
      const e = await ctx.db.get(part.earningId);
      if (!e) continue;
      const tipsPaid = Math.max(0, (e.tipsPaidCents ?? 0) - part.tipCents);
      if (e.paymentId === payment._id && part.jobCents) await ctx.db.patch(e._id, { status: "approved", paymentId: undefined, tipsPaidCents: tipsPaid, updatedAt: now });
      else await ctx.db.patch(e._id, { tipsPaidCents: tipsPaid, updatedAt: now });
    }
    await recordEvent(ctx, { companyId: ctx.companyId, type: "team_payment.canceled", actor: byMember(ctx), subject: { table: "teamPayments", id: payment._id }, data: { amountCents: payment.amountCents } });
    return { already: false };
  },
});

// ── Tips ─────────────────────────────────────────────────────────────────────────────────────────

/** A tip the customer gave outside the pay page (cash, another app): all of it to the job's crew, split evenly. */
export const recordTip = ownerMutation({
  args: { jobId: v.id("jobs"), amountCents: v.number(), note: v.union(v.string(), v.null()), confirmedReceived: v.boolean() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const job = await owned(ctx, args.jobId);
    if (job.status !== "completed") throw userError("Tips are for completed jobs.");
    if (!Number.isSafeInteger(args.amountCents) || args.amountCents <= 0 || args.amountCents > 100_000) throw userError("Enter the tip, up to $1,000.");
    if (!args.confirmedReceived) throw userError("Confirm that you received the tip.");
    const crew = await jobCrew(ctx, job);
    if (!crew.length) throw userError("Nobody was on this job's crew to give it to.");
    const now = Date.now();
    const tipId = await ctx.db.insert("tips", { companyId: ctx.companyId, jobId: job._id, amountCents: args.amountCents, source: "recorded", status: "received", allocations: splitEvenly(args.amountCents, crew.map((a) => a.cleanerId)), note: args.note?.trim().slice(0, 300) || undefined, recordedBy: ctx.member._id, createdAt: now, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "tip.recorded", actor: byMember(ctx), subject: { table: "tips", id: tipId }, data: { amountCents: args.amountCents, jobId: job._id } });
    await syncJobEarnings(ctx, job, byMember(ctx));
    return { tipId };
  },
});

// ── Pay tiers ────────────────────────────────────────────────────────────────────────────────────

export const saveTiers = ownerMutation({
  args: { tiers: v.array(v.object({ id: v.union(v.string(), v.null()), name: v.string(), sharePercent: v.number() })) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    if (args.tiers.length > 12) throw userError("Up to 12 tiers.");
    const current = ctx.company.payTiers ?? [];
    const names = new Set<string>();
    const kept = args.tiers.map((t) => {
      const name = t.name.trim();
      if (!name || name.length > 30) throw userError("Give each tier a short name.");
      if (names.has(name.toLowerCase())) throw userError(`Two tiers are called "${name}".`);
      names.add(name.toLowerCase());
      const bps = Math.round(t.sharePercent * 100);
      if (!Number.isFinite(t.sharePercent) || bps < 0 || bps > 10_000) throw userError(`${name}: the share must be between 0% and 100%.`);
      const id = t.id && current.some((c) => c.id === t.id) ? t.id : `tier-${crypto.randomUUID().slice(0, 8)}`;
      return { id, name, shareBps: bps };
    });
    // A tier removed while cleaners are on it is archived, so their past and current pay still reads.
    const cleaners = await ctx.db
      .query("cleaners")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "ready"))
      .take(500);
    const removed = current.filter((c) => !kept.some((k) => k.id === c.id));
    const inUse = removed.filter((tier) => cleaners.some((c) => c.pay?.kind === "tier" && c.pay.tierId === tier.id));
    if (inUse.length) throw userError(`Move the cleaners on ${inUse.map((t) => t.name).join(", ")} to another tier before removing ${inUse.length === 1 ? "it" : "them"}.`);
    const next = [...kept, ...removed.map((t) => ({ ...t, archived: true }))];
    await ctx.db.patch(ctx.companyId, { payTiers: next });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "finance_settings.saved", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { tiers: kept.length } });
    return { tiers: kept };
  },
});

/** Whether customers may add a tip on the pay page. */
export const saveTips = ownerMutation({
  args: { tipsOn: v.boolean() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "edit");
    const row = await settingsRow(ctx, ctx.companyId);
    const current = settingsOf(row);
    const fields = { tipsOn: args.tipsOn, revision: current.revision + 1, updatedBy: ctx.member._id, updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert("financeSettings", { companyId: ctx.companyId, taxableServiceIds: [], paymentTermsDays: current.paymentTermsDays, allowPartialPayments: current.allowPartialPayments, nextInvoiceNumber: current.nextInvoiceNumber, invoicePrefix: current.invoicePrefix, ...fields });
    return { ok: true };
  },
});

// ── Statements ───────────────────────────────────────────────────────────────────────────────────

/** Makes (or remakes) the cleaner's private statement link. Making a new one closes the old. */
export const issueStatement = ownerMutation({
  args: { cleanerId: v.id("cleaners") },
  handler: async (ctx, args) => {
    requireFinance(ctx, "send");
    const cleaner = await owned(ctx, args.cleanerId);
    if (!statementLinksConfigured()) throw userError("Private links aren't switched on for this deployment yet.");
    const link = await issueStatementLink(ctx, { companyId: ctx.companyId, cleanerId: cleaner._id, by: ctx.member._id });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "statement.issued", actor: byMember(ctx), subject: { table: "statementLinks", id: link._id }, data: { cleanerId: cleaner._id } });
    return { url: statementUrl((await statementToken(link))!) };
  },
});

function statementText(company: string, cleaner: string, channel: "sms" | "email") {
  const first = cleaner.split(/\s+/)[0];
  return channel === "sms"
    ? { body: `${company}: hi ${first}, your earnings statement is here: {link} It shows your jobs, pay and payments. Reply STOP to stop texts.` }
    : { subject: `Your earnings statement from ${company}`, body: `Hi ${first},\n\nYour earnings statement is ready. It shows each job, how your pay was worked out, tips, and what has been paid:\n\n{link}\n\nThe link is private to you and works for 90 days.\n\nThank you,\n${company}` };
}

export const statementPreview = ownerQuery({
  args: { cleanerId: v.id("cleaners"), channel: v.union(v.literal("sms"), v.literal("email")) },
  handler: async (ctx, args) => {
    requireFinance(ctx, "send");
    const cleaner = await owned(ctx, args.cleanerId);
    const check = await canSendTo(ctx, ctx.companyId, cleaner, args.channel);
    const words = statementText(ctx.company.name, cleaner.name, args.channel);
    return { to: check.address, canSend: check, ...words, preview: words.body.replace("{link}", "[private link]"), bindsTo: await bindsTo("send_statement", { cleaner: cleaner._id, channel: args.channel, to: check.address, ok: check.ok }) };
  },
});

/** Sends the cleaner their link, exactly as previewed, after the Owner approves it. */
export const sendStatement = ownerMutation({
  args: { cleanerId: v.id("cleaners"), channel: v.union(v.literal("sms"), v.literal("email")), bindsTo: v.string() },
  handler: async (ctx, args) => {
    requireFinance(ctx, "send");
    const cleaner = await owned(ctx, args.cleanerId);
    const check = await canSendTo(ctx, ctx.companyId, cleaner, args.channel);
    await requireSame(args.bindsTo, "send_statement", { cleaner: cleaner._id, channel: args.channel, to: check.address, ok: check.ok });
    if (!statementLinksConfigured()) throw userError("Private links aren't switched on for this deployment yet.");
    const link = (await liveStatementLink(ctx, ctx.companyId, cleaner._id)) ?? (await issueStatementLink(ctx, { companyId: ctx.companyId, cleanerId: cleaner._id, by: ctx.member._id }));
    const words = statementText(ctx.company.name, cleaner.name, args.channel);
    const message = await queueCleanerStatement(ctx, { company: ctx.company, cleaner, channel: args.channel, subject: words.subject, body: words.body, replyTo: ctx.member.email, dedupeKey: `statement:${link._id}:${args.channel}:${Date.now()}`, actor: byMember(ctx) });
    return { status: message.status, problem: message.problem ?? null };
  },
});

