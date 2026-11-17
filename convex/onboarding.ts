/**
 * The onboarding queue a person works until Team Coordinator exists. Each handoff lists what the new
 * worker still needs; a named person records each item. Closing the handoff ends the hiring record.
 * It does not make the worker ready for jobs: that is set on the worker's own record, by a person.
 */
import { v } from "convex/values";

import { owned } from "./lib/access";
import { companyQuery, managerMutation, ownerMutation } from "./lib/builders";
import { payWords } from "./lib/recruiter/offers";
import { completeHandoff, recordRequirement } from "./lib/recruiter/handoff";
import { cleanerReadiness } from "./lib/cleaners/records";

export const queue = companyQuery({
  args: { status: v.optional(v.union(v.literal("open"), v.literal("complete"), v.literal("cancelled"))) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("onboardingHandoffs")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", args.status ?? "open"))
      .take(200);
    const out = [];
    for (const handoff of rows) {
      const applicant = await ctx.db.get(handoff.applicantId);
      const cleaner = await ctx.db.get(handoff.cleanerId);
      const responsible = await ctx.db.get(handoff.responsibleId);
      out.push({
        handoffId: handoff._id,
        applicationId: handoff.applicationId,
        applicant: applicant?.name ?? cleaner?.name ?? null,
        role: handoff.terms.role,
        // Pay is the Owner's. Everyone else sees the role and the relationship, never the terms.
        approvedTerms: ctx.role === "owner" ? { ...handoff.terms, payWords: payWords(handoff.terms.pay) } : { role: handoff.terms.role, engagement: handoff.terms.engagement },
        /** What the applicant told us. None of it is verified by being here. */
        information: handoff.information,
        requirements: handoff.requirements,
        responsible: responsible?.name ?? null,
        nextAction: handoff.nextAction,
        dueAt: handoff.dueAt,
        status: handoff.status,
        cleanerId: handoff.cleanerId,
        workerStatus: cleaner?.status ?? null,
        /** Ready for assignments: an active engagement with every requirement for work met (lib/cleaners/readiness.ts). */
        dispatchReady: cleaner ? (await cleanerReadiness(ctx, ctx.company, cleaner, Date.now())).readiness.eligible : false,
      });
    }
    return out;
  },
});

export const record = managerMutation({
  args: { handoffId: v.id("onboardingHandoffs"), requirement: v.string(), done: v.boolean(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await recordRequirement(ctx, await owned(ctx, args.handoffId), args.requirement, args.done, ctx.member, args.note);
    return null;
  },
});

export const complete = ownerMutation({
  args: { handoffId: v.id("onboardingHandoffs") },
  handler: async (ctx, args) => {
    await completeHandoff(ctx, await owned(ctx, args.handoffId), ctx.member);
    return null;
  },
});
