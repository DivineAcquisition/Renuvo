import type { MutationCtx } from "../_generated/server";
import type { SignedIn } from "./builders";
import { recordEvent } from "./events";

/**
 * Moving the company's sign-in to a new service (for example from Clerk's development instance to its
 * production instance) gives every person a new sign-in id, and their memberships still point at the old
 * one. This re-points them, by the person's verified email, and only across services: a membership bound
 * under the same issuer as the person signing in is never moved by email, so an email address reused
 * inside one sign-in service can never take over someone else's place.
 *
 * Returns how many memberships were reconnected. Each one is recorded in its company's activity.
 */
export async function reconnectAfterSignInMove(ctx: MutationCtx & SignedIn): Promise<number> {
  if (!ctx.emailVerified || !ctx.email || !ctx.issuer) return 0;
  const rows = await ctx.db
    .query("members")
    .withIndex("by_email_status", (q) => q.eq("email", ctx.email).eq("status", "active"))
    .take(50);
  let moved = 0;
  for (const row of rows) {
    if (!row.userId || row.userId === ctx.userId || row.userIssuer === ctx.issuer) continue;
    const already = await ctx.db
      .query("members")
      .withIndex("by_company_user", (q) => q.eq("companyId", row.companyId).eq("userId", ctx.userId))
      .first();
    if (already) continue;
    await ctx.db.patch(row._id, { userId: ctx.userId, userIssuer: ctx.issuer });
    await recordEvent(ctx, { companyId: row.companyId, type: "member.reconnected", actor: { kind: "member", memberId: row._id }, subject: { table: "members", id: row._id }, data: { reason: "sign_in_service_changed" } });
    moved += 1;
  }
  return moved;
}
