/**
 * The retention the Privacy notice states: requests to Selestial and the records that a deletion was
 * done are kept for three years after they close, then deleted. Opt-outs are never deleted here, and
 * company records follow the company's own deletion request (convex/dataRights.ts).
 */
import { internalMutation } from "./_generated/server";

export const RETENTION_YEARS = 3;
const YEAR = 365 * 24 * 60 * 60 * 1000;
const BATCH = 200;
const CLOSED = ["completed", "closed_with_limitation", "spam"] as const;

export const purge = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_YEARS * YEAR;
    let requests = 0;
    for (const status of CLOSED) {
      // Received before the cutoff is a cheap first filter; the close date decides.
      const rows = await ctx.db
        .query("trustRequests")
        .withIndex("by_status_received", (q) => q.eq("status", status).lt("receivedAt", cutoff))
        .take(BATCH);
      for (const row of rows) {
        const closedAt = row.completion?.at ?? row.actions.at(-1)?.at ?? row.receivedAt;
        if (closedAt >= cutoff) continue;
        await ctx.db.delete(row._id);
        requests += 1;
      }
    }
    const records = await ctx.db
      .query("deletionRecords")
      .withIndex("by_at", (q) => q.lt("at", cutoff))
      .take(BATCH);
    for (const row of records) await ctx.db.delete(row._id);
    return { requests, deletionRecords: records.length };
  },
});
