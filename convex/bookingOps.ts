/**
 * The booking work that runs on its own: finishing a paid booking, letting holds go when they end, and
 * keeping sessions honest when a customer walks away. Each step is idempotent, so the scheduler, a
 * webhook and a sweep can all ask for the same thing and it happens once.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { commitBooking } from "./lib/booking/handoff";
import { funnel } from "./lib/booking/funnel";
import { recalc } from "./lib/booking/session";
import { recordEvent } from "./lib/events";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A payment was received (or a booking needs no payment): commit it, or say why not. */
export const finalize = internalMutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.test || session.jobId) return { outcome: "skipped" as const };
    if (session.status !== "active") return { outcome: "skipped" as const };
    return { outcome: await commitBooking(ctx, args.sessionId) };
  },
});

/** A hold reached its end. Marked expired unless it was extended, committed or released meanwhile. */
export const expireHold = internalMutation({
  args: { holdId: v.id("bookingHolds") },
  handler: async (ctx, args) => {
    const hold = await ctx.db.get(args.holdId);
    if (!hold || hold.status !== "held") return;
    if (hold.expiresAt > Date.now()) {
      await ctx.scheduler.runAt(hold.expiresAt, internal.bookingOps.expireHold, { holdId: hold._id });
      return;
    }
    await ctx.db.patch(hold._id, { status: "expired", updatedAt: Date.now() });
    const session = await ctx.db.get(hold.sessionId);
    if (session && session.status === "active") await recalc(ctx, session._id);
  },
});

/**
 * Every few minutes: holds that ended without the scheduler noticing, and sessions nobody touched for a
 * week (abandoned) or whose link ran out (expired). A paid session is never abandoned: it stays with the
 * office until it is confirmed or refunded.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const holds = await ctx.db
      .query("bookingHolds")
      .withIndex("by_status_expires", (q) => q.eq("status", "held").lt("expiresAt", now))
      .take(200);
    for (const hold of holds) {
      await ctx.db.patch(hold._id, { status: "expired", updatedAt: now });
      const session = await ctx.db.get(hold.sessionId);
      if (session?.status === "active") await recalc(ctx, session._id);
    }
    const stale = await ctx.db
      .query("bookingSessions")
      .withIndex("by_status_updated", (q) => q.eq("status", "active").lt("updatedAt", now - 7 * DAY))
      .take(200);
    for (const session of stale) {
      if (session.paymentState === "succeeded" || session.paymentState === "processing" || session.paymentState === "started") continue;
      await ctx.db.patch(session._id, { status: session.expiresAt < now ? "expired" : "abandoned", updatedAt: now });
      if (!session.test) await recordEvent(ctx, { companyId: session.companyId, type: "booking.abandoned", actor: { kind: "system" }, subject: { table: "bookingSessions", id: session._id }, data: { step: session.step } });
    }
  },
});

/** The recovery note a person chose to send: recorded for the funnel. */
export const recoveryOffered = internalMutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;
    await funnel(ctx, session, "recovery_offered");
  },
});
