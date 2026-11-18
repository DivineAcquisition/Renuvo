/**
 * The booking funnel, from what actually happened. One row per event; no names, emails, phones,
 * addresses or answers, only the step, the experience, the version, the campaign and an amount. Test
 * sessions are marked so they never count as live.
 */
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

export const FUNNEL_EVENTS = [
  "booking_started",
  "step_completed",
  "quote_calculated",
  "schedule_selected",
  "agreement_completed",
  "payment_started",
  "payment_verified",
  "booking_confirmed",
  "request_sent",
  "needs_attention",
  "recovery_offered",
  "recovery_completed",
] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

export async function funnel(ctx: MutationCtx, session: Doc<"bookingSessions">, type: FunnelEvent, extra: { step?: string; amountCents?: number } = {}): Promise<void> {
  // A step counts once per session, so going back and forth doesn't inflate it.
  if (type === "step_completed" || type === "booking_started" || type === "payment_verified" || type === "booking_confirmed") {
    const rows = await ctx.db
      .query("bookingEvents")
      .withIndex("by_company_session", (q) => q.eq("companyId", session.companyId).eq("sessionId", session._id))
      .take(200);
    if (rows.some((r) => r.type === type && (r.step ?? null) === (extra.step ?? null))) return;
  }
  await ctx.db.insert("bookingEvents", {
    companyId: session.companyId,
    experienceId: session.experienceId,
    sessionId: session._id,
    version: session.version,
    type,
    ...(extra.step ? { step: extra.step } : {}),
    test: session.test,
    ...(session.attribution.source ? { source: session.attribution.source.slice(0, 60) } : {}),
    ...(session.attribution.campaign ? { campaign: session.attribution.campaign.slice(0, 80) } : {}),
    ...(extra.amountCents !== undefined ? { amountCents: extra.amountCents } : {}),
    at: Date.now(),
  });
}
