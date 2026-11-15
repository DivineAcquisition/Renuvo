import type { UserIdentity } from "convex/server";

import type { Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { notFound } from "./errors";

type Ctx = QueryCtx | MutationCtx;

/** Identity always comes from the session token (ctx.auth). It is never accepted as an argument. */
export async function requireIdentity(ctx: Ctx): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) notFound();
  return identity;
}

/**
 * The caller's active membership in this company. Someone signed out, a company that does not exist and a
 * company the caller is not in all get the same "Not found.", so an id tells an outsider nothing.
 */
export async function requireMember(ctx: Ctx, companyId: Id<"companies">) {
  const identity = await requireIdentity(ctx);
  const company = await ctx.db.get(companyId);
  const member = await ctx.db
    .query("members")
    .withIndex("by_company_user", (q) => q.eq("companyId", companyId).eq("userId", identity.subject))
    .unique();
  if (!company || !member || member.status !== "active") notFound();
  return { identity, member, company, companyId };
}

type CompanyTables = {
  [T in TableNames]: Doc<T> extends { companyId: Id<"companies"> } ? T : never;
}[TableNames];

/**
 * Reads one record that must belong to this company. A record in another company is "Not found.", the
 * same as one that was never there. Every function that takes an id goes through this.
 */
export async function owned<T extends CompanyTables>(
  ctx: Ctx & { companyId: Id<"companies"> },
  id: Id<T>,
): Promise<Doc<T>> {
  const doc = (await ctx.db.get(id)) as (Doc<T> & { companyId: Id<"companies"> }) | null;
  if (!doc || doc.companyId !== ctx.companyId) notFound();
  return doc;
}
