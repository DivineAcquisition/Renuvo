/**
 * What happened to relationships, measured from records. Every measure carries its denominator and the
 * period it was observed over, and each kind of relationship has its own: recurring retention is not
 * mixed with one-time repeat purchases, and neither is mixed with reactivation.
 *
 * Planned completion, pause, cancellation, loss and unknown are kept as separate counts. Nothing here is
 * a projection, and nothing claims a customer stayed because of an intervention: "two services were
 * completed after the correction" is a fact; what would have happened otherwise is not known.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { lifecycleStatus } from "../agreements/store";
import { localParts } from "../availability";
import { DAY, OUTCOME_WORDS, VERIFIED_OUTCOMES } from "./cases";
import type { Outcome } from "./schema";

export type Measure = {
  key: string;
  label: string;
  /** What it tells the owner, and what it does not. */
  meaning: string;
  /** "12 of 15", or null when no record supports a figure. */
  numerator: number | null;
  denominator: number | null;
  /** A plain value where a ratio makes no sense (days, cents). */
  value: number | null;
  unit: "ratio" | "days" | "cents" | "count";
  period: string;
  /** How the rest of the denominator is split, each under its own name. */
  breakdown: { label: string; count: number }[];
  /** Why there is no figure, when there is none. */
  empty: string | null;
};

const none = (key: string, label: string, meaning: string, period: string, empty: string, unit: Measure["unit"] = "ratio"): Measure => ({ key, label, meaning, numerator: null, denominator: null, value: null, unit, period, breakdown: [], empty });

export async function measures(ctx: QueryCtx, company: Doc<"companies">, now: number, options: { money: boolean }) {
  const companyId = company._id;
  const tz = company.timezone;
  const today = localParts(now, tz).day;
  const out: Measure[] = [];
  const WINDOW = 90 * DAY;

  // ── Recurring retention by cohort: plans that started in each of the last six months ──
  const servicePlans = [];
  for (const state of ["active", "paused", "ended"] as const) servicePlans.push(...(await ctx.db.query("servicePlans").withIndex("by_company_state", (q) => q.eq("companyId", companyId).eq("state", state)).take(800)));
  const salesPlans = [];
  for (const status of ["active", "paused", "ended"] as const) salesPlans.push(...(await ctx.db.query("recurringPlans").withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status)).take(800)));
  type Started = { month: string; state: "active" | "paused" | "ended" };
  const started: Started[] = [
    ...servicePlans.filter((p) => p.kind === "recurring").map((p) => ({ month: p.startsOn.slice(0, 7), state: p.state as Started["state"] })),
    ...salesPlans.map((p) => ({ month: p.startDate.slice(0, 7), state: p.status as Started["state"] })),
  ];
  const cohorts: { month: string; started: number; running: number; paused: number; ended: number }[] = [];
  for (let back = 6; back >= 1; back -= 1) {
    const date = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - back);
    const month = date.toISOString().slice(0, 7);
    const rows = started.filter((s) => s.month === month);
    if (rows.length) cohorts.push({ month, started: rows.length, running: rows.filter((r) => r.state === "active").length, paused: rows.filter((r) => r.state === "paused").length, ended: rows.filter((r) => r.state === "ended").length });
  }
  const cohortStarted = cohorts.reduce((s, c) => s + c.started, 0);
  out.push(
    cohortStarted
      ? { key: "recurring_cohorts", label: "Recurring plans still running", meaning: "Of the recurring plans that started in each of the last six months, how many are running today. A paused plan is counted as paused, not as running or lost.", numerator: cohorts.reduce((s, c) => s + c.running, 0), denominator: cohortStarted, value: null, unit: "ratio", period: `Plans started ${cohorts[0].month} to ${cohorts[cohorts.length - 1].month}, as of today`, breakdown: [{ label: "Paused", count: cohorts.reduce((s, c) => s + c.paused, 0) }, { label: "Ended", count: cohorts.reduce((s, c) => s + c.ended, 0) }], empty: null }
      : none("recurring_cohorts", "Recurring plans still running", "Of the recurring plans that started in each of the last six months, how many are running today.", "Last six months", "No recurring plan started in the last six months."),
  );

  // ── Recovery cases closed in the window ──
  const closed = (
    await ctx.db
      .query("retentionCases")
      .withIndex("by_company_closed", (q) => q.eq("companyId", companyId).gte("closedAt", now - WINDOW))
      .take(1000)
  ).filter((row) => row.closedAt !== undefined);
  const recoveries = closed.filter((row) => row.kind === "recovery");
  const period90 = "Cases closed in the last 90 days";

  // Continued paid visits after an intervention: ordinary services completed at the same property after the case closed.
  let withOne = 0;
  let withTwo = 0;
  let observable = 0;
  let revenueAfterCents = 0;
  for (const row of recoveries) {
    if (!row.propertyId || now - row.closedAt! < 14 * DAY) continue;
    observable += 1;
    const after = (
      await ctx.db
        .query("jobs")
        .withIndex("by_company_property_start", (q) => q.eq("companyId", companyId).eq("propertyId", row.propertyId!).gte("startsAt", row.closedAt!))
        .take(60)
    ).filter((job) => job.status === "completed" && !job.recovery);
    if (after.length >= 1) withOne += 1;
    if (after.length >= 2) withTwo += 1;
    if (row.outcome && VERIFIED_OUTCOMES.includes(row.outcome.code)) revenueAfterCents += after.reduce((sum, job) => sum + (job.priceCents ?? 0), 0);
  }
  out.push(
    observable
      ? { key: "visits_after", label: "Service continued after a recovery", meaning: "Of recovery cases closed at least 14 days ago, how many properties had another ordinary service completed afterwards. It says the relationship continued; it does not say why.", numerator: withOne, denominator: observable, value: null, unit: "ratio", period: "Recovery cases closed 14 to 90 days ago", breakdown: [{ label: "Two or more services completed after", count: withTwo }, { label: "None completed yet", count: observable - withOne }], empty: null }
      : none("visits_after", "Service continued after a recovery", "Of recovery cases closed at least 14 days ago, how many properties had another ordinary service completed afterwards.", "Recovery cases closed 14 to 90 days ago", "No recovery case has been closed long enough to observe what followed."),
  );

  // Repeated-issue rate: the next ordinary service after a completed correction.
  const watched = recoveries.filter((row) => row.verification?.nextService);
  out.push(
    watched.length
      ? { key: "repeat_issue", label: "Same issue reported again", meaning: "Of corrections whose next ordinary service has been completed, how many had the same area reported again. A correction that does not hold has not fixed the cause.", numerator: watched.filter((row) => row.verification!.nextService!.repeatReported).length, denominator: watched.length, value: null, unit: "ratio", period: period90, breakdown: [], empty: null }
      : none("repeat_issue", "Same issue reported again", "Of corrections whose next ordinary service has been completed, how many had the same area reported again.", period90, "No correction has had its next service completed yet."),
  );

  // Resolution time, and what is overdue now.
  const days = recoveries.map((row) => (row.closedAt! - row.createdAt) / DAY).sort((a, b) => a - b);
  out.push(
    days.length
      ? { key: "resolution_days", label: "Median days to close a recovery", meaning: "From the concern being recorded to the case closing with an outcome. Closing is not the same as the customer confirming: see the outcomes.", numerator: null, denominator: days.length, value: Math.round(days[Math.floor(days.length / 2)] * 10) / 10, unit: "days", period: period90, breakdown: [], empty: null }
      : none("resolution_days", "Median days to close a recovery", "From the concern being recorded to the case closing with an outcome.", period90, "No recovery case was closed in this period.", "days"),
  );
  let overdue = 0;
  let openCount = 0;
  for (const status of ["needs_context", "needs_attention", "action_underway", "waiting_on_customer", "monitoring"] as const) {
    const rows = await ctx.db.query("retentionCases").withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status)).take(500);
    openCount += rows.length;
    if (status === "needs_attention" || status === "action_underway" || status === "needs_context") overdue += rows.filter((row) => row.dueAt < now).length;
  }
  out.push({ key: "overdue", label: "Commitments past their deadline", meaning: "Open cases whose next commitment was due before now.", numerator: overdue, denominator: openCount, value: null, unit: "ratio", period: "Open cases, right now", breakdown: [], empty: openCount ? null : "No case is open." });

  // ── Commercial renewals among contracts that reached their end of term ──
  const agreements = await ctx.db.query("agreements").withIndex("by_company_updated", (q) => q.eq("companyId", companyId)).order("desc").take(600);
  const from = localParts(now - 180 * DAY, tz).day;
  const eligible = agreements.filter((a) => a.category === "customer" && !a.archivedAt && (a.workflow === "signed" || a.provenance !== "unsigned") && (() => { const target = a.lifecycle.terminatedOn ?? a.lifecycle.expiresOn ?? null; const replaced = a.lifecycle.supersededBy !== undefined; return replaced || (target !== null && target >= from && target <= today); })());
  const renewed = eligible.filter((a) => a.lifecycle.supersededBy !== undefined).length;
  const ended = eligible.filter((a) => !a.lifecycle.supersededBy && (lifecycleStatus(a, today) === "terminated" || lifecycleStatus(a, today) === "expired")).length;
  out.push(
    eligible.length
      ? { key: "renewal_rate", label: "Contracts renewed", meaning: "Of customer agreements that reached their end of term or were replaced, how many were replaced by a new signed agreement. An agreement that renewed automatically keeps running and is not counted here until its term ends.", numerator: renewed, denominator: eligible.length, value: null, unit: "ratio", period: "End of term in the last 180 days", breakdown: [{ label: "Ended", count: ended }, { label: "Outcome unknown", count: eligible.length - renewed - ended }], empty: null }
      : none("renewal_rate", "Contracts renewed", "Of customer agreements that reached their end of term, how many were replaced by a new signed agreement.", "End of term in the last 180 days", "No customer agreement reached its end of term in this period."),
  );

  // ── Site retention: properties of business accounts served in the previous 90 days and again in this one ──
  const before = await ctx.db.query("jobs").withIndex("by_company_status_start", (q) => q.eq("companyId", companyId).eq("status", "completed").gte("startsAt", now - 2 * WINDOW).lt("startsAt", now - WINDOW)).take(2000);
  const during = await ctx.db.query("jobs").withIndex("by_company_status_start", (q) => q.eq("companyId", companyId).eq("status", "completed").gte("startsAt", now - WINDOW)).take(2000);
  const upcoming = await ctx.db.query("jobs").withIndex("by_company_status_start", (q) => q.eq("companyId", companyId).eq("status", "scheduled").gte("startsAt", now)).take(2000);
  const kinds = new Map<string, Doc<"properties">["kind"] | null>();
  const kindOf = async (id: Id<"properties">) => {
    if (!kinds.has(id)) kinds.set(id, (await ctx.db.get(id))?.kind ?? null);
    return kinds.get(id)!;
  };
  const priorSites = new Set<string>();
  const priorAccounts = new Set<string>();
  for (const job of before) {
    const kind = await kindOf(job.propertyId);
    if (kind === "commercial" || kind === "office" || kind === "property_manager" || kind === "short_term_rental") {
      priorSites.add(job.propertyId);
      priorAccounts.add(job.customerId);
    }
  }
  const stillSites = new Set([...during, ...upcoming].map((job) => job.propertyId as string));
  const stillAccounts = new Set([...during, ...upcoming].map((job) => job.customerId as string));
  out.push(
    priorSites.size
      ? { key: "site_retention", label: "Sites still served", meaning: "Of commercial, office, managed and rental properties served in the previous 90 days, how many were served again in the last 90 days or have a visit booked. A retained account can still be losing sites: compare the two counts.", numerator: [...priorSites].filter((id) => stillSites.has(id)).length, denominator: priorSites.size, value: null, unit: "ratio", period: "Served 91 to 180 days ago, observed over the last 90 days", breakdown: [{ label: `Accounts still served, of ${priorAccounts.size}`, count: [...priorAccounts].filter((id) => stillAccounts.has(id)).length }], empty: null }
      : none("site_retention", "Sites still served", "Of commercial, office, managed and rental properties served in the previous 90 days, how many were served again.", "Served 91 to 180 days ago, observed over the last 90 days", "No commercial, office, managed or rental property was served in the earlier period."),
  );

  // ── Repeat purchase: one-time home customers, observed for 90 days after their first service ──
  const firstWindow = await ctx.db.query("jobs").withIndex("by_company_status_start", (q) => q.eq("companyId", companyId).eq("status", "completed").gte("startsAt", now - 2 * WINDOW).lt("startsAt", now - WINDOW)).take(2000);
  const firstByCustomer = new Map<string, Doc<"jobs">>();
  for (const job of firstWindow) {
    if (job.planId || job.recovery || (await kindOf(job.propertyId)) !== "home") continue;
    const seen = firstByCustomer.get(job.customerId);
    if (!seen || job.startsAt < seen.startsAt) firstByCustomer.set(job.customerId, job);
  }
  let oneTime = 0;
  let again = 0;
  let becameRecurring = 0;
  for (const [customerId, job] of firstByCustomer) {
    const all = await ctx.db.query("jobs").withIndex("by_company_customer_start", (q) => q.eq("companyId", companyId).eq("customerId", customerId as Id<"customers">)).take(200);
    // Only customers whose first completed service is this one: a returning customer is not a first purchase.
    if (all.some((other) => other.status === "completed" && other.startsAt < job.startsAt && !other.recovery)) continue;
    oneTime += 1;
    const later = all.filter((other) => other._id !== job._id && !other.recovery && other.status !== "cancelled" && other.startsAt > job.startsAt && other.startsAt <= job.startsAt + WINDOW);
    if (later.some((other) => other.planId)) becameRecurring += 1;
    else if (later.length) again += 1;
  }
  out.push(
    oneTime
      ? { key: "repeat_purchase", label: "One-time customers who bought again", meaning: "Of home customers whose first service was a one-time job, how many booked another one-time service within 90 days. Customers who started a recurring plan are counted separately: that is a different outcome.", numerator: again, denominator: oneTime, value: null, unit: "ratio", period: "First service 91 to 180 days ago, observed for 90 days each", breakdown: [{ label: "Started a recurring plan instead", count: becameRecurring }, { label: "No further service in 90 days", count: oneTime - again - becameRecurring }], empty: null }
      : none("repeat_purchase", "One-time customers who bought again", "Of home customers whose first service was a one-time job, how many booked another one-time service within 90 days.", "First service 91 to 180 days ago, observed for 90 days each", "No one-time first service falls in the period that can be observed yet."),
  );

  // ── Reactivation, by itself ──
  const offers = closed.filter((row) => row.kind === "reactivation");
  out.push(
    offers.length
      ? { key: "reactivation", label: "Former customers who returned", meaning: "Of return offers that have closed, how many were followed by a completed service. Counted apart from recurring retention and from repeat purchases.", numerator: offers.filter((row) => row.outcome?.code === "reactivated").length, denominator: offers.length, value: null, unit: "ratio", period: period90, breakdown: [{ label: "No response", count: offers.filter((row) => row.outcome?.code === "no_response").length }, { label: "Asked not to be contacted", count: offers.filter((row) => row.outcome?.code === "declined_contact").length }], empty: null }
      : none("reactivation", "Former customers who returned", "Of return offers that have closed, how many were followed by a completed service.", period90, "No return offer has closed in this period."),
  );

  // ── Recurring plans offered after a good first service ──
  const recurringOffers = closed.filter((row) => row.key.startsWith("recurring:") && (row.outcome?.code === "recurring_started" || row.outcome?.code === "offer_made_no_plan"));
  out.push(
    recurringOffers.length
      ? { key: "recurring_offers", label: "Recurring plans started after an offer", meaning: "Of recurring-plan offers handed to Sales that have closed, how many were followed by a recurring plan on record. An offer still with Sales, or still being watched, is not counted yet.", numerator: recurringOffers.filter((row) => row.outcome?.code === "recurring_started").length, denominator: recurringOffers.length, value: null, unit: "ratio", period: period90, breakdown: [{ label: "Offered, no plan started", count: recurringOffers.filter((row) => row.outcome?.code === "offer_made_no_plan").length }], empty: null }
      : none("recurring_offers", "Recurring plans started after an offer", "Of recurring-plan offers handed to Sales that have closed, how many were followed by a recurring plan on record.", period90, "No recurring-plan offer has closed in this period."),
  );

  // ── Recovery costs, and revenue after verified recoveries, for the Owner ──
  const actions = [];
  for (const status of ["done", "underway", "failed"] as const) actions.push(...(await ctx.db.query("retentionActions").withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status).gte("updatedAt", now - WINDOW)).take(800)));
  const costed = actions.filter((a) => a.actualCostCents !== undefined);
  const uncosted = actions.filter((a) => a.actualCostCents === undefined && (a.kind === "correction_visit" || a.kind === "credit" || a.kind === "refund") && a.status === "done").length;
  const costCents = costed.reduce((sum, a) => sum + (a.actualCostCents ?? 0), 0);
  if (options.money) {
    out.push(
      costed.length
        ? { key: "recovery_cost", label: "Recovery costs", meaning: "Crew pay and recorded expenses on correction visits, plus credits and refunds recorded for retention cases. Office time is not included.", numerator: null, denominator: costed.length, value: costCents, unit: "cents", period: "Actions in the last 90 days", breakdown: uncosted ? [{ label: "Remedies with no cost on record", count: uncosted }] : [], empty: null }
        : none("recovery_cost", "Recovery costs", "Crew pay and recorded expenses on correction visits, plus credits and refunds recorded for retention cases.", "Actions in the last 90 days", "No remedy with a recorded cost in this period.", "cents"),
    );
    out.push(
      revenueAfterCents > 0
        ? { key: "revenue_after", label: "Services completed after a verified recovery", meaning: "The price of ordinary services completed at a property after its recovery case closed with a verified outcome, less recovery costs. It is revenue that happened, not revenue the recovery is known to have caused: what the customer would have done otherwise is not known.", numerator: null, denominator: null, value: revenueAfterCents - costCents, unit: "cents", period: "Recovery cases closed 14 to 90 days ago", breakdown: [{ label: "Completed-service prices, in cents", count: revenueAfterCents }, { label: "Recovery costs, in cents", count: costCents }], empty: null }
        : none("revenue_after", "Services completed after a verified recovery", "The price of ordinary services completed after a recovery case closed with a verified outcome, less recovery costs. Not a claim about what would have happened otherwise.", "Recovery cases closed 14 to 90 days ago", "No service has been completed after a verified recovery in the observable period.", "cents"),
    );
  }

  // ── Outcomes, each under its own name ──
  const counts = new Map<Outcome, number>();
  for (const row of closed) if (row.outcome) counts.set(row.outcome.code, (counts.get(row.outcome.code) ?? 0) + 1);
  const outcomes = [...counts.entries()].map(([code, count]) => ({ code, words: OUTCOME_WORDS[code], count, verified: VERIFIED_OUTCOMES.includes(code) })).sort((a, b) => b.count - a.count);

  return { measures: out, outcomes, closedCases: closed.length, cohorts, asOf: now };
}
