/** The company's services as Finance sees them: for taxed services, invoice lines and expense links. */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { businessSettingsOf } from "../settings/business";

/**
 * The company's active services, by the id its visits carry (`serviceSnapshot.serviceId`): the Services &
 * Pricing catalog's key once the company moved to it (a moved service keeps its Settings id as its key),
 * otherwise Settings' own list. Taxed services are chosen from these.
 */
export async function companyServices(ctx: QueryCtx & { companyId: Id<"companies">; company: Doc<"companies"> }): Promise<{ id: string; name: string }[]> {
  if (ctx.company.servicesMigratedAt === undefined) return businessSettingsOf(ctx.company).services.filter((s) => s.status === "active").map((s) => ({ id: s.id, name: s.name }));
  const rows = await ctx.db
    .query("services")
    .withIndex("by_company_key", (q) => q.eq("companyId", ctx.companyId))
    .take(500);
  return rows.filter((s) => s.status === "active" && s.publishedVersion !== undefined).map((s) => ({ id: s.key, name: s.name }));
}

