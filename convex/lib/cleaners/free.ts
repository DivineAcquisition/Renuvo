/**
 * Who is free for a window of time, read from the same records Dispatch uses: weekly hours, single dates,
 * time away and work already held. Free is not ready: each answer also says whether they can be offered work
 * at all, and what stops them if not. The directory's "free at a time" and Chat both read this.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { availabilityFor, type Span } from "../availability";
import { startOfLocalDay } from "../time";
import { companyCleaners, companyFacts, readinessOf } from "./records";
import { commitmentsBetween, companyTime } from "./schedule";

const DAY = 86_400_000;

export const FREE_REASON_WORDS = {
  outside_hours: "has not said they can work then",
  time_off: "has time away then",
  already_booked: "already has work then",
  exception: "said they cannot work that day",
  not_active: "is not active",
} as const;

export type FreeAnswer = { cleanerId: Id<"cleaners">; name: string; available: boolean; reason: string | null; ready: boolean; notReady: string[] };

export async function whoIsFree(ctx: QueryCtx | MutationCtx, company: Doc<"companies">, span: Span): Promise<FreeAnswer[]> {
  const cleaners = await companyCleaners(ctx, company._id);
  const facts = await companyFacts(ctx, company);
  const commitments = await commitmentsBetween(ctx, company, startOfLocalDay(span.startsAt, company.timezone) - DAY, span.endsAt + DAY);
  const time = await companyTime(ctx, company, span.startsAt - DAY);
  return cleaners.map((cleaner) => {
    const readiness = readinessOf(cleaner, facts, company, span.startsAt);
    const base = { cleanerId: cleaner._id, name: cleaner.name, ready: readiness.eligible, notReady: readiness.blockers.map((view) => view.label) };
    const windows = (facts.windows.get(cleaner._id) ?? []).map((row) => ({ weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute }));
    const own = time.get(cleaner._id) ?? { absences: [], extraAvailable: [] };
    const held = (commitments.get(cleaner._id) ?? []).map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt }));
    if (cleaner.status !== "ready") return { ...base, available: false, reason: FREE_REASON_WORDS.not_active };
    if (own.absences.some((row) => row.kind === "exception" && row.span.startsAt < span.endsAt && span.startsAt < row.span.endsAt)) return { ...base, available: false, reason: FREE_REASON_WORDS.exception };
    const extra = own.extraAvailable.some((row) => row.startsAt <= span.startsAt && span.endsAt <= row.endsAt);
    const answer = availabilityFor({ windows: extra ? [] : windows, timeOff: own.absences.filter((row) => row.kind === "time_off").map((row) => row.span), booked: held, span, timezone: company.timezone });
    if (extra && !answer.available && answer.reason === "outside_hours") {
      const booked = held.some((row) => row.startsAt < span.endsAt && span.startsAt < row.endsAt);
      return booked ? { ...base, available: false, reason: FREE_REASON_WORDS.already_booked } : { ...base, available: true, reason: null };
    }
    return answer.available ? { ...base, available: true, reason: null } : { ...base, available: false, reason: FREE_REASON_WORDS[answer.reason] };
  });
}
