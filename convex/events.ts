/** Reading the event log. There is no function that writes, changes or removes an event from outside. */
import { v } from "convex/values";

import { companyQuery } from "./lib/builders";
import { subjectValidator } from "./lib/events";

export const recent = companyQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) =>
    ctx.db
      .query("events")
      .withIndex("by_company_at", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(Math.min(Math.max(Math.trunc(args.limit ?? 50), 1), 200)),
});

/** One record's history, oldest first. The index starts with the company, so another company's id finds nothing. */
export const forSubject = companyQuery({
  args: { subject: subjectValidator },
  handler: async (ctx, args) =>
    ctx.db
      .query("events")
      .withIndex("by_company_subject_at", (q) => q.eq("companyId", ctx.companyId).eq("subjectId", args.subject.id))
      .take(500),
});
