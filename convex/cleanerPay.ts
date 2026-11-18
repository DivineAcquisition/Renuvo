/**
 * A worker's pay, for the Owner. It keeps no ledger of its own: the arrangement and its history are the
 * Owner's decisions (payArrangements, personnelRequests), and the pay for each job is what Dispatch stated
 * on the assignment when it was offered. Earnings worked out per job, approvals, adjustments, tips and
 * payments belong to Finance › Team Pay (convex/teamPay.ts); this shows their totals, read from there.
 */
import { v } from "convex/values";

import { owned } from "./lib/access";
import { ownerQuery } from "./lib/builders";
import { DAY } from "./lib/cleaners/settings";
import { jobLabel } from "./lib/cleaners/schedule";
import { EARNING_STATE_WORDS, liveAdjustments, maskReference, owedOn, payMethodWords, TEAM_PAY_METHOD_WORDS } from "./lib/finance/teamPay";
import { payWords } from "./lib/recruiter/offers";

export const summary = ownerQuery({
  args: { cleanerId: v.id("cleaners"), asOf: v.number() },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const sub = cleaner.subcontractorId ? await ctx.db.get(cleaner.subcontractorId) : null;
    const arrangements = await ctx.db
      .query("payArrangements")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .order("desc")
      .take(50);
    const requests = await ctx.db
      .query("personnelRequests")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .order("desc")
      .take(50);

    // Finance › Team Pay's own records for the same 90 days.
    const earnings = (
      await ctx.db
        .query("earnings")
        .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id).gte("jobStartsAt", args.asOf - 90 * DAY))
        .take(300)
    ).filter((e) => e.status !== "void");
    const byAssignment = new Map(earnings.map((e) => [e.assignmentId as string, e]));
    const payments = await ctx.db
      .query("teamPayments")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id).gte("createdAt", args.asOf - 90 * DAY))
      .order("desc")
      .take(200);
    const paid = payments.filter((p) => p.status === "paid");

    // Work done in the last 90 days, with the pay each assignment stated. That is the rate that applied to that job.
    const jobs = [];
    const accepted = await ctx.db
      .query("assignments")
      .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id).eq("status", "accepted"))
      .order("desc")
      .take(300);
    for (const row of accepted) {
      const job = await ctx.db.get(row.jobId);
      if (!job || job.startsAt < args.asOf - 90 * DAY || job.startsAt > args.asOf) continue;
      const customer = await ctx.db.get(job.customerId);
      jobs.push({
        jobId: job._id,
        label: jobLabel(job, customer?.name ?? null, ctx.company.timezone),
        startsAt: job.startsAt,
        payCents: row.payCents,
        /** The crew's report and a person's review are separate from pay; neither approves it. */
        jobStatus: job.status,
        reviewed: job.completionReview?.decision ?? null,
        /** Where Team Pay has this job: its state and total, read from there. Null before Team Pay works it out. */
        teamPay: byAssignment.has(row._id as string)
          ? { state: EARNING_STATE_WORDS[byAssignment.get(row._id as string)!.status], totalCents: byAssignment.get(row._id as string)!.approved?.totalCents ?? byAssignment.get(row._id as string)!.totalCents }
          : null,
      });
    }
    jobs.sort((a, b) => b.startsAt - a.startsAt);
    const completed = jobs.filter((row) => row.jobStatus === "completed");

    return {
      paidThrough: sub ? { subcontractorId: sub._id, name: sub.name, pay: sub.pay ? payWords(sub.pay) : null } : null,
      current: cleaner.pay ? { words: payMethodWords(cleaner.pay, ctx.company.payTiers), pay: cleaner.pay } : null,
      history: await Promise.all(
        arrangements.map(async (row) => ({
          id: row._id,
          words: payWords(row.pay),
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo ?? null,
          setBy: (await ctx.db.get(row.setBy))?.name ?? "A team member",
          upcoming: row.effectiveFrom > args.asOf,
        })),
      ),
      pending: requests
        .filter((row) => row.kind === "pay_change" && row.status === "pending")
        .map((row) => ({ requestId: row._id, words: row.details.pay ? payWords(row.details.pay) : "", effectiveAt: row.details.effectiveAt ?? null, reason: row.reason, requestedAt: row.requestedAt })),
      jobs: jobs.slice(0, 40),
      stated: { completedJobs: completed.length, completedCents: completed.reduce((sum, row) => sum + row.payCents, 0) },
      finance: {
        built: true,
        words: "Worked out from each completed job in Finance › Team Pay, where you review, approve and record payments. The amounts listed below are what each job's offer stated.",
        reviewCents: earnings.filter((e) => e.status === "calculated" || e.status === "needs_review").reduce((sum, e) => sum + (e.totalCents ?? 0), 0),
        approvedUnpaidCents: earnings.reduce((sum, e) => sum + owedOn(e).jobCents + owedOn(e).lateTipCents, 0),
        paidCents: paid.reduce((sum, p) => sum + p.amountCents, 0),
        paidCount: paid.length,
        approvedCents: earnings.filter((e) => e.approved).reduce((sum, e) => sum + (e.approved?.totalCents ?? 0), 0),
      },
      /** Adjustments on jobs not approved yet: they change what is paid only once the Owner approves the job. */
      adjustmentsPending: await (async () => {
        const out = [];
        for (const e of earnings.filter((row) => row.status === "calculated" || row.status === "needs_review")) {
          const live = e.adjustments.filter((a) => !a.reversed);
          if (live.length === 0) continue;
          const job = await ctx.db.get(e.jobId);
          const customer = job ? await ctx.db.get(job.customerId) : null;
          out.push({ earningId: e._id, label: job ? jobLabel(job, customer?.name ?? null, ctx.company.timezone) : "A job", cents: liveAdjustments(e), reasons: live.map((a) => a.reason) });
        }
        return out;
      })(),
      /** Payments recorded in Team Pay, newest first. A reference is shown by its last characters only. */
      payments: payments.slice(0, 20).map((p) => ({
        paymentId: p._id,
        amountCents: p.amountCents,
        method: TEAM_PAY_METHOD_WORDS[p.method],
        status: p.status === "paid" ? "Paid" : p.status === "started" ? "On its way" : "Canceled",
        on: p.paidAt ?? p.startedAt,
        jobs: p.parts.length,
        reference: maskReference(p.reference),
      })),
    };
  },
});
