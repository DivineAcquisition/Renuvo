/**
 * A cleaner's earnings statement, opened from their private link (convex/lib/finance/statementLinks.ts).
 * It shows that cleaner's own completed jobs for the last 90 days: how each job's pay was worked out,
 * the hours, adjustments and their reasons, tips, and what has been approved and paid. Nothing about
 * other cleaners, and nothing about customers beyond the service, day and town of each job.
 */
import { statementQuery } from "./lib/builders";
import { STATEMENT_DAYS } from "./lib/finance/statementLinks";
import { localDateKey } from "./lib/finance/settings";
import { hoursWords, owedOn } from "./lib/finance/teamPay";

const DAY = 86_400_000;

const STATE_WORDS = { calculated: "Being reviewed", needs_review: "Being reviewed", approved: "Approved, not paid yet", payment_started: "Payment on its way", paid: "Paid", void: "Set aside" } as const;
const METHOD_WORDS = { zelle: "Zelle", venmo: "Venmo", cash: "Cash", check: "Check", bank_transfer: "Bank transfer", payroll: "Payroll", other: "Other" } as const;

export const view = statementQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.statement) return null;
    const { cleaner, company, link } = ctx.statement;
    const tz = company.timezone;
    const since = Date.now() - STATEMENT_DAYS * DAY;
    const earnings = (
      await ctx.db
        .query("earnings")
        .withIndex("by_company_cleaner", (q) => q.eq("companyId", company._id).eq("cleanerId", cleaner._id).gte("jobStartsAt", since))
        .order("desc")
        .take(300)
    ).filter((e) => e.status !== "void");
    const jobs = [];
    for (const e of earnings) {
      const job = await ctx.db.get(e.jobId);
      const property = job ? await ctx.db.get(job.propertyId) : null;
      jobs.push({
        id: e._id,
        date: localDateKey(e.jobStartsAt, tz),
        service: job?.serviceSnapshot?.name ?? job?.serviceType ?? "Job",
        town: property?.address.city ?? null,
        basis: e.basis,
        hours: e.method === "hourly" ? hoursWords(e.facts.paidMinutes) : null,
        hoursNote: e.hoursCorrection ? `Hours corrected: ${e.hoursCorrection.reason}` : e.facts.minutesSource === "scheduled" && e.method === "hourly" ? "Scheduled hours used" : null,
        baseCents: e.baseCents,
        adjustments: e.adjustments.filter((a) => !a.reversed).map((a) => ({ cents: a.cents, reason: a.reason })),
        tipCents: e.tipCents,
        totalCents: e.totalCents,
        state: STATE_WORDS[e.status],
        paid: e.status === "paid",
        owedCents: owedOn(e).jobCents + owedOn(e).lateTipCents,
      });
    }
    const payments = (
      await ctx.db
        .query("teamPayments")
        .withIndex("by_company_cleaner", (q) => q.eq("companyId", company._id).eq("cleanerId", cleaner._id).gte("createdAt", since))
        .order("desc")
        .take(100)
    ).filter((p) => p.status !== "canceled");
    return {
      company: company.name,
      cleaner: cleaner.name,
      employee: cleaner.engagement === "employee",
      from: localDateKey(since, tz),
      to: localDateKey(Date.now(), tz),
      validUntil: localDateKey(link.expiresAt, tz),
      jobs,
      payments: payments.map((p) => ({ id: p._id, amountCents: p.amountCents, method: METHOD_WORDS[p.method], status: p.status === "paid" ? "Paid" : "On its way", on: p.paidOn ?? localDateKey(p.startedAt, tz), jobs: p.parts.length })),
      totals: {
        earnedCents: jobs.reduce((s, j) => s + (j.totalCents ?? 0), 0),
        paidCents: payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amountCents, 0),
        onTheWayCents: payments.filter((p) => p.status === "started").reduce((s, p) => s + p.amountCents, 0),
        approvedUnpaidCents: jobs.filter((j) => j.state === "Approved, not paid yet").reduce((s, j) => s + (j.totalCents ?? 0), 0),
      },
    };
  },
});
