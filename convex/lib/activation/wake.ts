/**
 * Event-driven re-checking of blocked activation work (convex/activation.ts reevaluate). Called by
 * recordEvent for the few events that can unblock a task. It costs one index read when nothing is
 * blocked, and never runs a model: the re-check itself is the plan's own prerequisite rules.
 */
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

export const ACTIVATION_WAKE_TYPES = new Set([
  "mailbox.connected",
  "clients.imported",
  "customer.created",
  "opportunity.created",
  "job.created",
  "cleaner.status_changed",
  "cleaner.availability_set",
  "cleaner.import_finished",
  "hiring_need.opened",
  "service.approved",
  "company.agents_paused_changed",
  "company.plan_changed",
  "compliance.messaging_updated",
  "compliance.registration_recorded",
  "credit.added",
  "billing.updated",
]);

export async function wakeActivation(ctx: MutationCtx, companyId: Id<"companies">): Promise<void> {
  for (const state of ["waiting_info", "waiting_connection", "paused"] as const) {
    const blocked = await ctx.db
      .query("activationTasks")
      .withIndex("by_company_state", (q) => q.eq("companyId", companyId).eq("state", state))
      .first();
    if (blocked) {
      await ctx.scheduler.runAfter(0, internal.activation.reevaluate, { companyId });
      return;
    }
  }
}
