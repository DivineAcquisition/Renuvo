/**
 * A worker's pay, for the Owner. It keeps no ledger of its own: the arrangement and its history are the
 * Owner's decisions (payArrangements, personnelRequests), and the pay for each job is what Dispatch stated
 * on the assignment when it was offered. Approved earnings, adjustments and payments belong to Finance,
 * which is not built, so this says so instead of showing a number it does not have.
 */
import { v } from "convex/values";

import { owned } from "./lib/access";
import { ownerQuery } from "./lib/builders";
import { DAY } from "./lib/cleaners/settings";
import { jobLabel } from "./lib/cleaners/schedule";
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
      });
    }
    jobs.sort((a, b) => b.startsAt - a.startsAt);
    const completed = jobs.filter((row) => row.jobStatus === "completed");

    return {
      paidThrough: sub ? { subcontractorId: sub._id, name: sub.name, pay: sub.pay ? payWords(sub.pay) : null } : null,
      current: cleaner.pay ? { words: payWords(cleaner.pay), pay: cleaner.pay } : null,
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
      finance: { built: false, words: "Finance is not built yet, so no approved earnings, adjustments or payments are recorded. The amounts below are what each job's offer stated, not what was approved or paid." },
    };
  },
});
