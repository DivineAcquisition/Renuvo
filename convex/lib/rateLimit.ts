import type { MutationCtx } from "../_generated/server";

/**
 * A fixed-window counter. Returns false once `limit` is reached in the current window. The caller must
 * return a result instead of throwing when refused: a thrown mutation rolls the count back.
 */
export async function allow(ctx: MutationCtx, key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!row) {
    await ctx.db.insert("rateLimits", { key, windowStart: now, count: 1 });
    return true;
  }
  if (now - row.windowStart >= windowMs) {
    await ctx.db.patch(row._id, { windowStart: now, count: 1 });
    return true;
  }
  if (row.count >= limit) return false;
  await ctx.db.patch(row._id, { count: row.count + 1 });
  return true;
}
