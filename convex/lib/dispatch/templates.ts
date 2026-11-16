/**
 * Checklist templates per service. A visit's checklist is a copy taken when the visit is created, so a
 * template change never alters a checklist a cleaner was already given.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

export const serviceKey = (serviceType: string) => serviceType.trim().toLowerCase().replace(/\s+/g, " ");

/** The newest version for a service, if it is still in use. */
export async function currentTemplate(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, serviceType: string): Promise<Doc<"checklistTemplates"> | null> {
  const latest = await ctx.db
    .query("checklistTemplates")
    .withIndex("by_company_service_version", (q) => q.eq("companyId", companyId).eq("serviceKey", serviceKey(serviceType)))
    .order("desc")
    .first();
  return latest && latest.retiredAt === undefined ? latest : null;
}

/** Copies the service's current template onto a new visit. Answers with the version used, or null. */
export async function applyTemplate(ctx: MutationCtx, job: Doc<"jobs">): Promise<{ templateId: Id<"checklistTemplates">; version: number } | null> {
  const template = await currentTemplate(ctx, job.companyId, job.serviceType);
  if (!template || template.items.length === 0) return null;
  let order = 0;
  for (const item of template.items) {
    await ctx.db.insert("checklistItems", { companyId: job.companyId, jobId: job._id, order: order++, section: item.section, label: item.label, requiresPhoto: item.requiresPhoto, state: "pending" });
  }
  const used = { templateId: template._id, version: template.version };
  await ctx.db.patch(job._id, { checklistTemplate: used });
  return used;
}
