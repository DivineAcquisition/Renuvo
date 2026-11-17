/**
 * One worker's history, read from the append-only event log: what happened to their own record, to the
 * offers and visits they held, and to the onboarding from their hire. Read only through indexes that
 * start with the company, so nothing from another company can appear.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";

export async function eventsAbout(ctx: QueryCtx, companyId: Id<"companies">, worker: Doc<"cleaners">): Promise<Doc<"events">[]> {
  const subjects: string[] = [worker._id];
  for (const status of ["offered", "accepted", "declined", "expired", "cancelled"] as const) {
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", companyId).eq("cleanerId", worker._id).eq("status", status))
      .order("desc")
      .take(25);
    subjects.push(...assignments.map((row) => row._id));
  }
  const handoffs = await ctx.db
    .query("onboardingHandoffs")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId))
    .take(1000);
  subjects.push(...handoffs.filter((row) => row.cleanerId === worker._id).map((row) => row._id));
  const events: Doc<"events">[] = [];
  for (const subjectId of subjects) {
    events.push(
      ...(await ctx.db
        .query("events")
        .withIndex("by_company_subject_at", (q) => q.eq("companyId", companyId).eq("subjectId", subjectId))
        .order("desc")
        .take(60)),
    );
  }
  // Newest first. Links issued and messages planned are summarized by the assignment events themselves.
  return events.sort((a, b) => b.at - a.at);
}
