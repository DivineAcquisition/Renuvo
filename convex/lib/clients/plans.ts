/**
 * Service plans keep their visits booked ahead (the owner's decision of November 18, 2026). A recurring
 * plan books each day of its series through the same path as any visit, so each one is checked, priced
 * at the plan's agreed price, and staffed by Dispatch. A standing arrangement (a short-term rental's
 * agreed turnover terms) books nothing on its own: turnovers follow guests, not a calendar.
 *
 * Nothing about a plan changes a booked visit silently. Pausing, ending or changing the series lists
 * the visits it would cancel first, and the change names the visits it was shown.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { addDays } from "../agreements/store";
import { localDay } from "../chat/localDay";
import { recordEvent, type Actor } from "../events";
import { createVisit } from "../jobs/visits";
import { scheduleDates } from "../services/engine";
import { dayOf } from "../services/propertyPrices";
import { liveTaskByKey, openTask } from "../taskState";
import { refreshClient } from "./directory";

/** How far ahead a running plan keeps its visits booked. */
export const HORIZON_DAYS = 28;

/** "HH:MM" on the company's clock on that day, as an instant. */
export function instantOn(day: string, time: string, timezone: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  const minutes = match ? Number(match[1]) * 60 + Number(match[2]) : 9 * 60;
  return localDay(day, timezone) + minutes * 60_000;
}

/** The days of a recurring plan's series from `from` through `through`, without skipped, paused or ended days. */
export function seriesDays(plan: Pick<Doc<"servicePlans">, "cadence" | "startsOn" | "skipped" | "pausedFrom" | "pausedUntil" | "endsOn" | "state">, from: string, through: string): string[] {
  if (!plan.cadence) return [];
  const months = Math.min(36, Math.max(1, monthsBetween(plan.startsOn, through) + 1));
  return scheduleDates(plan.cadence, plan.startsOn, months).filter((day) => {
    if (day < from || day > through) return false;
    if (plan.skipped.includes(day)) return false;
    if (plan.endsOn && day >= plan.endsOn) return false;
    if (plan.pausedFrom && day >= plan.pausedFrom && (!plan.pausedUntil || day < plan.pausedUntil)) return false;
    return true;
  });
}

function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/** A plan's visits that have not started, from a day on: what a pause, an end or a series change would cancel. */
export async function upcomingPlanVisits(ctx: QueryCtx, plan: Doc<"servicePlans">, fromDay: string): Promise<Doc<"jobs">[]> {
  const rows = await ctx.db
    .query("jobs")
    .withIndex("by_company_plan", (q) => q.eq("companyId", plan.companyId).eq("planId", plan._id))
    .take(400);
  return rows.filter((job) => job.status === "scheduled" && (job.planDate ?? "") >= fromDay).sort((a, b) => a.startsAt - b.startsAt);
}

/**
 * Books a running recurring plan's visits through the horizon. A day already booked is left alone, and a
 * day that cannot be booked (outside the company's hours or area, say) is not forced: one task asks a
 * person to look, and the rest of the series is still booked.
 */
export async function bookAhead(ctx: MutationCtx, plan: Doc<"servicePlans">, actor: Actor): Promise<{ booked: number; problems: string[] }> {
  if (plan.kind !== "recurring" || plan.state !== "active" || !plan.cadence) return { booked: 0, problems: [] };
  const company = (await ctx.db.get(plan.companyId))!;
  const service = await ctx.db.get(plan.serviceId);
  if (!service || service.status !== "active") return { booked: 0, problems: ["The plan's service is not live, so no visits were booked."] };
  const today = dayOf(Date.now(), company.timezone);
  const through = addDays(today, HORIZON_DAYS);
  const after = plan.bookedThrough ? addDays(plan.bookedThrough, 1) : plan.startsOn;
  const from = [after, plan.startsOn, today].sort().pop()!;
  const existing = await ctx.db
    .query("jobs")
    .withIndex("by_company_plan", (q) => q.eq("companyId", plan.companyId).eq("planId", plan._id))
    .take(400);
  const bookedDays = new Set(existing.filter((job) => job.status !== "cancelled" || job.skipped).map((job) => job.planDate));
  let isFirst = existing.length === 0;
  let booked = 0;
  const problems: string[] = [];
  const scoped = { ...ctx, company, companyId: company._id };
  for (const day of seriesDays(plan, from, through)) {
    if (bookedDays.has(day)) continue;
    const startsAt = instantOn(day, plan.startTime, company.timezone);
    const duration = isFirst && plan.firstVisit ? plan.firstVisit.durationMinutes : plan.durationMinutes;
    const price = isFirst && plan.firstVisit?.priceCents != null ? plan.firstVisit.priceCents : plan.priceCents;
    try {
      await createVisit(
        scoped,
        actor,
        {
          customerId: plan.customerId,
          propertyId: plan.propertyId,
          serviceId: service.key,
          ...(price !== null ? { priceCents: price } : {}),
          startsAt,
          endsAt: startsAt + Math.max(15, duration) * 60_000,
          requiredCrew: plan.crewSize,
          arrivalWindowMinutes: plan.arrivalWindowMinutes,
          ...(isFirst && plan.firstVisit?.note ? { instructions: `First visit: ${plan.firstVisit.note}` } : plan.scopeNote ? { instructions: plan.scopeNote } : {}),
        },
        { planId: plan._id, planDate: day, priceSource: "plan" },
      );
      booked += 1;
      isFirst = false;
    } catch (error) {
      const why = (error as { data?: { message?: string } }).data?.message ?? "It could not be booked.";
      problems.push(`${day}: ${why}`);
    }
  }
  await ctx.db.patch(plan._id, { bookedThrough: through, updatedAt: Date.now() });
  if (problems.length) {
    const key = `plan.booking:${plan._id}`;
    if (!(await liveTaskByKey(ctx, plan.companyId, key))) {
      await openTask(ctx, {
        companyId: plan.companyId,
        agent: "dispatch",
        title: `Some visits of a plan could not be booked (${problems.length})`,
        nextAction: `Look at these days and book them by hand or change the plan: ${problems.slice(0, 5).join(" ")}`.slice(0, 500),
        dueAt: Date.now() + 24 * 60 * 60 * 1000,
        completionCondition: "Each day is booked by hand, skipped, or the plan is changed.",
        about: { table: "customers", id: plan.customerId },
        key,
        actor: { kind: "system" },
      });
    }
  }
  if (booked) await recordEvent(ctx, { companyId: plan.companyId, type: "plan.visits_booked", actor, subject: { table: "customers", id: plan.customerId }, data: { visits: booked } });
  await refreshClient(ctx, plan.customerId);
  return { booked, problems };
}

export type PlanId = Id<"servicePlans">;
