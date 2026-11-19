/** Shared by the Retention scenario tests: a company that can text, a customer with a phone, and a completed visit. */
import { vi } from "vitest";

import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { mockOutbox } from "../convex/lib/messaging/provider";
import { dispatchJob, HOUR, JOB_END, JOB_START } from "./harness";
import { flush, setup } from "./dispatchHarness";

export const CUSTOMER_PHONE = "+15550107777";
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

/** The newest Retention link texted to this number, as the customer would receive it. */
export function careLink(phone = CUSTOMER_PHONE): string {
  const digits = phone.replace(/\D/g, "");
  for (const text of mockOutbox.filter((row) => row.to.endsWith(digits) && row.result === "accepted").reverse()) {
    const match = text.body.match(/\/c\/care\/([A-Za-z0-9_.-]+)/);
    if (match) return match[1].replace(/\.$/, "");
  }
  throw new Error(`no care link was texted to ${phone}`);
}

export const textsTo = (phone = CUSTOMER_PHONE) => mockOutbox.filter((row) => row.to.endsWith(phone.replace(/\D/g, "")) && row.result === "accepted").map((row) => row.body);

export async function retentionSetup() {
  const s = await setup(["Lena", "Rosa"]);
  const { t, as, companyId, place } = s;
  await as.mutation(api.customers.update, { companyId, customerId: place.customerId, phone: CUSTOMER_PHONE });
  await as.mutation(api.consent.record, { companyId, recipient: { kind: "customer", id: place.customerId }, channel: "sms", category: "operational", status: "granted", source: "web_form", evidence: "Booking form." });
  const db = <R>(work: Parameters<typeof t.run>[0]) => t.run(work) as Promise<R>;
  const helpers = {
    ...s,
    /** A visit that happened: reported done by the crew and closed by a person's review, which is what tells Retention. */
    completed: async (fields: { startsAt?: number; scope?: string; checklist?: { label: string; state: "done" | "skipped" | "pending"; skipReason?: string }[]; propertyId?: Id<"properties">; customerId?: Id<"customers">; planId?: Id<"servicePlans"> } = {}) => {
      const startsAt = fields.startsAt ?? JOB_START;
      const jobId = await dispatchJob(as, companyId, { customerId: fields.customerId ?? place.customerId, propertyId: fields.propertyId ?? place.propertyId }, { startsAt, endsAt: startsAt + 2 * HOUR });
      await t.run(async (ctx) => {
        if (fields.scope) await ctx.db.patch(jobId, { scope: fields.scope });
        await ctx.db.patch(jobId, { status: "in_progress", completionReportedAt: startsAt + 2 * HOUR });
        const assignmentId = await ctx.db.insert("assignments", { companyId, jobId, cleanerId: s.cleaners.Lena, status: "accepted", scope: "As booked", payCents: 8000, offeredAt: startsAt - DAY, respondBy: startsAt - HOUR, respondedAt: startsAt - 2 * HOUR, completion: { submittedAt: startsAt + 2 * HOUR, incomplete: false } });
        let order = 0;
        for (const item of fields.checklist ?? []) await ctx.db.insert("checklistItems", { companyId, jobId, order: (order += 1), label: item.label, requiresPhoto: false, state: item.state, skipReason: item.skipReason, byCleanerId: s.cleaners.Lena });
        return assignmentId;
      });
      if (Date.now() < startsAt + 3 * HOUR) vi.setSystemTime(startsAt + 3 * HOUR);
      await as.mutation(api.jobs.reviewCompletion, { companyId, jobId, decision: "close" });
      await flush(t);
      return jobId;
    },
    /** Closes a visit Retention booked (a correction), the way the office would after the crew reports. */
    finish: async (jobId: Id<"jobs">) => {
      const job = await db<{ startsAt: number; endsAt: number }>(async (ctx) => (await ctx.db.get(jobId))!);
      vi.setSystemTime(Math.max(Date.now(), job.endsAt + HOUR));
      await t.run(async (ctx) => {
        await ctx.db.patch(jobId, { status: "in_progress", completionReportedAt: job.endsAt });
        await ctx.db.insert("assignments", { companyId, jobId, cleanerId: s.cleaners.Rosa, status: "accepted", scope: "Correction", payCents: 2000, offeredAt: job.startsAt - DAY, respondBy: job.startsAt - HOUR, respondedAt: job.startsAt - 2 * HOUR, completion: { submittedAt: job.endsAt, incomplete: false } });
      });
      await as.mutation(api.jobs.reviewCompletion, { companyId, jobId, decision: "close" });
      await flush(t);
    },
    cases: () => db<import("../convex/_generated/dataModel").Doc<"retentionCases">[]>(async (ctx) => (await ctx.db.query("retentionCases").collect()).filter((row) => row.companyId === companyId)),
    actions: () => db<import("../convex/_generated/dataModel").Doc<"retentionActions">[]>(async (ctx) => (await ctx.db.query("retentionActions").collect()).filter((row) => row.companyId === companyId)),
    signals: () => db<import("../convex/_generated/dataModel").Doc<"retentionSignals">[]>(async (ctx) => (await ctx.db.query("retentionSignals").collect()).filter((row) => row.companyId === companyId)),
    feedback: () => db<import("../convex/_generated/dataModel").Doc<"retentionFeedback">[]>(async (ctx) => (await ctx.db.query("retentionFeedback").collect()).filter((row) => row.companyId === companyId)),
    pending: async () => (await as.query(api.approvals.list, { companyId })).filter((row) => row.agent === "retention"),
    approve: async (approvalId: Id<"approvals">) => {
      const result = await as.mutation(api.approvals.decide, { companyId, approvalId, decision: "approved" });
      await flush(t);
      return result.carriedOut;
    },
    /** The Owner sets the crew's pay on the correction visits waiting for it, which books them. */
    setPay: async (cents = 6000) => {
      const waiting = (await helpers.actions()).filter((a) => a.kind === "correction_visit" && a.status === "proposed" && a.visit?.payBasisCents === undefined);
      const results = [];
      for (const action of waiting) results.push(await as.mutation(api.retentionAgent.setCorrectionPay, { companyId, actionId: action._id, payBasisCents: cents }));
      await flush(t);
      return results;
    },
    /** Approves whatever Retention has waiting, and sets pay on its correction visits, until nothing is. */
    approveAll: async () => {
      for (let i = 0; i < 6; i += 1) {
        await helpers.setPay();
        const rows = (await as.query(api.approvals.list, { companyId })).filter((row) => row.agent === "retention");
        if (!rows.length) return;
        for (const row of rows) await as.mutation(api.approvals.decide, { companyId, approvalId: row._id, decision: "approved" });
        await flush(t);
      }
    },
    /** The Owner lets Retention act without asking on the actions named. Money actions get limits. */
    trust: async (actions: string[] = ["retention.request_feedback", "retention.send_case_message", "retention.apply_plan_change", "retention.cancel_on_request"]) => {
      for (const action of actions) await as.mutation(api.permissions.set, { companyId, action, level: "execute" });
    },
    reconcile: async () => {
      await t.mutation(internal.retentionWork.sweep, {});
      await flush(t);
    },
    detail: (caseId: Id<"retentionCases">) => as.query(api.retentionAgent.caseDetail, { companyId, caseId, asOf: Date.now() }),
  };
  return helpers;
}

export { flush, JOB_END, JOB_START, HOUR };
