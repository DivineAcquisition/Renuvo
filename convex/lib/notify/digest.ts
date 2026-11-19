/**
 * The weekly summary's numbers (convex/lib/email/templates/platform.ts › weeklyDigestEmail). Every figure
 * is a count or a sum read from the company's records for the week; nothing is estimated, written by a
 * model, or claimed that the records don't show. An empty week says so.
 */
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { dayOf } from "../email/templates/shared";
import { AGENT_PROFILES } from "../departments";

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export async function weeklyDigestData(ctx: MutationCtx, company: Doc<"companies">, member: Doc<"members">, weekStart: number) {
  const weekEnd = weekStart + WEEK;
  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_company_start", (q) => q.eq("companyId", company._id).gte("startsAt", weekStart).lt("startsAt", weekEnd))
    .take(2000);
  const payments = await ctx.db
    .query("payments")
    .withIndex("by_company_succeeded", (q) => q.eq("companyId", company._id).gte("succeededAt", weekStart).lt("succeededAt", weekEnd))
    .take(2000);
  const decided: Doc<"approvals">[] = [];
  for (const status of ["approved", "changed", "skipped"] as const) {
    const rows = await ctx.db
      .query("approvals")
      .withIndex("by_company_status_decideBy", (q) => q.eq("companyId", company._id).eq("status", status).gte("decideBy", weekStart - WEEK))
      .take(500);
    decided.push(...rows.filter((a) => a.decidedAt !== undefined && a.decidedAt >= weekStart && a.decidedAt < weekEnd));
  }
  const pending = await ctx.db
    .query("approvals")
    .withIndex("by_company_status_decideBy", (q) => q.eq("companyId", company._id).eq("status", "pending"))
    .take(50);
  const applicants = await ctx.db
    .query("applicants")
    .withIndex("by_company_created", (q) => q.eq("companyId", company._id).gte("createdAt", weekStart).lt("createdAt", weekEnd))
    .take(500);
  const won = await ctx.db
    .query("salesOpportunities")
    .withIndex("by_company_stage", (q) => q.eq("companyId", company._id).eq("stage", "won").gte("updatedAt", weekStart).lt("updatedAt", weekEnd))
    .take(500);

  const role = member.role;
  // Approvals are decided by Owners and Managers; Office sees the count only.
  const waiting =
    role === "office"
      ? []
      : pending
          .sort((a, b) => a.decideBy - b.decideBy)
          .map((a) => ({ label: a.summary, detail: `${AGENT_PROFILES[a.agent].name} · decide by ${dayOf(a.decideBy, company.timezone).replace(/, \d{4}$/, "")}`, path: `/app/approvals?open=approval:${a._id}` }));

  return {
    weekStart,
    weekEnd: weekEnd - 1,
    visitsDone: jobs.filter((j) => j.status === "completed").length,
    visitsCancelled: jobs.filter((j) => j.status === "cancelled").length,
    paidCents: payments.filter((p) => p.status === "succeeded").reduce((sum, p) => sum + p.amountCents, 0),
    decisionsMade: decided.length,
    waiting,
    sections: [
      {
        heading: "Sales",
        summary: won.length ? `${won.length} ${won.length === 1 ? "customer" : "customers"} said yes this week.` : undefined,
        items: [],
        empty: "No new customers were won this week.",
      },
      {
        heading: "Hiring",
        summary: applicants.length ? `${applicants.length} new ${applicants.length === 1 ? "applicant" : "applicants"} this week.` : undefined,
        items: applicants.length ? [{ label: "Review applicants", path: "/app/agents/recruiter" }] : [],
        empty: "No new applicants this week.",
      },
    ],
  };
}

/** Monday 00:00 of the week before `now`, on the company's clock, as a timestamp. */
export function lastWeekStart(now: number, timezone: string): number {
  const local = new Date(new Date(now).toLocaleString("en-US", { timeZone: timezone }));
  const offset = now - local.getTime();
  const dayOfWeek = (local.getDay() + 6) % 7; // Monday 0
  const mondayLocal = new Date(local.getFullYear(), local.getMonth(), local.getDate() - dayOfWeek - 7, 0, 0, 0, 0);
  return mondayLocal.getTime() + offset;
}
