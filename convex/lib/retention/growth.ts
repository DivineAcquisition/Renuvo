/**
 * Earning the next service: after a first service the customer says went well, a recurring plan is
 * offered. Retention does not make the offer itself. It hands Sales the customer and the reason, under
 * the Owner's "Offer a recurring plan at the standard price" permission, and then watches the record.
 *
 * The offer is prepared only from facts:
 *  - the customer gave feedback and described no issue, and did not rate the service 3 or lower;
 *  - they are a home customer with no recurring plan running or paused;
 *  - nothing about them is unresolved (no open recovery or plan-change case);
 *  - they have not been offered one this way before.
 * Retention names no price and no discount: the price is Sales' and the service catalog's.
 *
 * What it claims afterwards is what the record shows: a recurring plan started, or none has.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { authorityFor } from "../authority";
import { actionsOf, prepareAction, submitAction } from "./actions";
import { addEntry, caseByKey, closeCase, DAY, moveCase, openCase, propertyName, recurringPlansAt, RETENTION, segmentFor, SYSTEM } from "./cases";
import { dayName } from "../time";

type Case = Doc<"retentionCases">;

/** How long the record is watched for a plan after Sales has finished with the offer. */
export const OFFER_WATCH_DAYS = 30;

const running = (plans: Awaited<ReturnType<typeof recurringPlansAt>>) => [...plans.service.filter((p) => p.kind === "recurring" && (p.state === "active" || p.state === "paused")).map((p) => p._creationTime), ...plans.sales.filter((p) => p.status === "active" || p.status === "paused").map((p) => p._creationTime)];

export async function offerRecurring(ctx: MutationCtx, company: Doc<"companies">, input: { customer: Doc<"customers">; property: Doc<"properties"> | null; job: Doc<"jobs">; rating?: number; feedbackId: Id<"retentionFeedback"> }): Promise<Case | null> {
  const { customer, property, job } = input;
  if (customer.status !== "active") return null;
  // Switched off by the Owner, or Retention is paused: nothing is prepared at all.
  const authority = await authorityFor(ctx, company._id, "retention.offer_recurring_plan");
  if (authority.kind !== "level" || authority.level === "off") return null;
  // A low rating with nothing described is not a reason to sell more service.
  if (input.rating !== undefined && input.rating <= 3) return null;
  if ((await segmentFor(ctx, company._id, customer, null)) !== "residential_one_time") return null;
  const key = `recurring:${customer._id}`;
  if (await caseByKey(ctx, company._id, key)) return null;
  const others = await ctx.db
    .query("retentionCases")
    .withIndex("by_company_customer", (q) => q.eq("companyId", company._id).eq("customerId", customer._id))
    .take(100);
  if (others.some((row) => row.status !== "closed" && (row.kind === "recovery" || row.kind === "continuity"))) return null;
  const tz = company.timezone;
  const service = job.serviceSnapshot?.name ?? job.serviceType;
  const opened = await openCase(ctx, {
    companyId: company._id,
    kind: "continuity",
    key,
    status: "action_underway",
    customer,
    property,
    jobId: job._id,
    title: `${customer.name}: recurring plan offer`,
    happened: `${customer.name} gave feedback on their ${service} of ${dayName(job.startsAt, tz)} and described no issue. They have no recurring plan.`,
    doing: "Preparing a recurring-plan offer for Sales.",
    origin: "feedback",
    dueAt: Date.now() + 5 * DAY,
    actor: RETENTION,
  });
  if (!opened.created) return opened.row;
  const row = opened.row;
  await addEntry(ctx, row, { kind: "evidence", basis: "customer_stated", text: `Feedback with no issue described${input.rating !== undefined ? ` (${input.rating} of 5)` : ""}.`, source: { table: "retentionFeedback", id: input.feedbackId, label: "Feedback" }, actor: SYSTEM });
  await addEntry(ctx, row, { kind: "evidence", basis: "fact", text: "No recurring plan is running or paused for this customer, and nothing about them is unresolved.", actor: SYSTEM });
  const action = await prepareAction(ctx, row, {
    kind: "recurring_offer",
    key: "recurring-offer-1",
    summary: `Offer ${customer.name} a recurring plan for ${propertyName(property)} at the standard price`,
    reason: `They described no issue after their ${service} on ${dayName(job.startsAt, tz)} and have no recurring plan. Retention names no price or discount: the offer and its price are Sales'.`,
    permission: "retention.offer_recurring_plan",
    dueAt: row.dueAt,
    actor: RETENTION,
  });
  const routed = await submitAction(ctx, company, action._id, RETENTION);
  const fresh = (await ctx.db.get(row._id))!;
  if (routed.status === "awaiting_approval") return moveCase(ctx, fresh, { status: "needs_attention", doing: "A recurring-plan offer is prepared and waiting for approval.", needs: "Approve handing this customer to Sales for a recurring-plan offer, or decline it." }, SYSTEM);
  if (routed.status === "blocked") return closeCase(ctx, fresh, "no_action_needed", SYSTEM, routed.detail);
  return fresh;
}

/**
 * Reads what came of the offers: a recurring plan that started after the offer closes the case as
 * exactly that. Once Sales has finished and the watch has run out with no plan, it closes as an offer
 * made with no plan started. Nothing in between is called a success.
 */
export async function recurringOfferUpkeep(ctx: MutationCtx, company: Doc<"companies">, now: number): Promise<number> {
  let closed = 0;
  for (const status of ["action_underway", "monitoring", "needs_attention"] as const) {
    const rows = await ctx.db
      .query("retentionCases")
      .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", status))
      .take(200);
    for (const row of rows) {
      if (!row.key.startsWith("recurring:") || row.heldBy) continue;
      const started = running(await recurringPlansAt(ctx, company._id, row.customerId)).some((at) => at >= row.createdAt);
      if (started) {
        await addEntry(ctx, row, { kind: "verification", basis: "fact", text: "A recurring plan for this customer started after the offer was prepared.", actor: SYSTEM });
        await closeCase(ctx, row, "recurring_started", SYSTEM);
        closed += 1;
        continue;
      }
      const offer = (await actionsOf(ctx, row)).find((a) => a.kind === "recurring_offer");
      if (!offer) continue;
      if (status === "action_underway" && (offer.status === "done" || offer.status === "failed")) {
        // Sales has finished. Whether the customer takes the plan up is still to be seen.
        await moveCase(ctx, row, { status: "monitoring", doing: `Sales finished with the offer: ${offer.handoff?.result ?? offer.result ?? "no result recorded"} Watching for a recurring plan to start.`, dueAt: now + OFFER_WATCH_DAYS * DAY, clearNeeds: true }, SYSTEM);
        continue;
      }
      if (status === "monitoring" && row.dueAt < now) {
        await closeCase(ctx, row, offer.status === "failed" ? "no_action_needed" : "offer_made_no_plan", SYSTEM, offer.status === "failed" ? "Sales did not make the offer." : undefined);
        closed += 1;
      }
    }
  }
  return closed;
}
