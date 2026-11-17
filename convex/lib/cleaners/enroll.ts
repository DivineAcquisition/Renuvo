/**
 * Making a worker record, the one way: a person adds them, an import adds them, or Recruiter hands over a
 * hire. Each path gives the new worker the company's onboarding template for their relationship type, so
 * "what is still needed" is the same list whoever started it.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import { optionalEmail, optionalText, tags, text } from "../text";
import { companyDefinitions } from "./records";
import type { Engagement } from "./schema";

export type NewWorker = {
  name: string;
  engagement: Engagement;
  email?: string;
  phone?: string;
  skills?: string[];
  serviceAreas?: string[];
  subcontractorId?: Id<"subcontractors">;
  hiredFrom?: Id<"applications">;
};

/** Gives a worker every requirement in the template that applies to them and that they do not have yet. */
export async function applyTemplate(ctx: MutationCtx, company: Doc<"companies">, cleaner: Doc<"cleaners">, actor: Actor, only?: string[]): Promise<number> {
  const definitions = await companyDefinitions(ctx, company);
  const existing = await ctx.db
    .query("workerRequirements")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", company._id).eq("cleanerId", cleaner._id))
    .take(100);
  const have = new Set(existing.map((row) => row.key));
  let added = 0;
  for (const def of definitions) {
    if (!def.appliesTo.includes(cleaner.engagement) || have.has(def.key)) continue;
    if (only && !only.includes(def.key)) continue;
    await ctx.db.insert("workerRequirements", { companyId: company._id, cleanerId: cleaner._id, key: def.key, status: "not_started", updatedAt: Date.now() });
    added += 1;
  }
  if (added > 0) await recordEvent(ctx, { companyId: company._id, type: "cleaner.requirements_assigned", actor, subject: { table: "cleaners", id: cleaner._id }, data: { count: added } });
  return added;
}

export async function createWorker(ctx: MutationCtx, company: Doc<"companies">, input: NewWorker, actor: Actor, options: { template: boolean; source: "added" | "imported" | "hiring" }): Promise<Id<"cleaners">> {
  if (input.engagement === "subcontractor") {
    if (!input.subcontractorId) throw userError("A subcontractor worker needs the subcontractor company they work through.");
    const sub = await ctx.db.get(input.subcontractorId);
    if (!sub || sub.companyId !== company._id) throw userError("That subcontractor company is not in this business.");
    if (sub.status === "ended") throw userError(`${sub.name} is no longer a subcontractor. Reopen it before adding workers.`);
  } else if (input.subcontractorId) {
    throw userError("Only a subcontractor worker works through a subcontractor company.");
  }
  const now = Date.now();
  const cleanerId = await ctx.db.insert("cleaners", {
    companyId: company._id,
    name: text(input.name, "Name", 160),
    engagement: input.engagement,
    email: optionalEmail(input.email),
    phone: optionalText(input.phone, "Phone", 40),
    // A new worker is not offered work until a person makes the engagement active and every requirement is met.
    status: "onboarding",
    skills: tags(input.skills ?? [], "Skills"),
    serviceAreas: tags(input.serviceAreas ?? [], "Service areas", 200).map((code) => code.toUpperCase()),
    subcontractorId: input.subcontractorId,
    hiredFrom: input.hiredFrom,
    createdAt: now,
    statusChangedAt: now,
    updatedAt: now,
  });
  if (input.subcontractorId) await ctx.db.insert("workerAffiliations", { companyId: company._id, cleanerId, subcontractorId: input.subcontractorId, from: now });
  await recordEvent(ctx, {
    companyId: company._id,
    type: "cleaner.created",
    actor,
    subject: { table: "cleaners", id: cleanerId },
    data: { from: options.source, engagement: input.engagement, ...(input.hiredFrom ? { applicationId: input.hiredFrom } : {}) },
  });
  if (options.template) await applyTemplate(ctx, company, (await ctx.db.get(cleanerId))!, actor);
  return cleanerId;
}

export const ENGAGEMENT_WORDS: Record<Engagement, string> = { employee: "Employee", contractor: "Independent contractor", subcontractor: "Subcontractor worker" };
export const STATUS_WORDS: Record<Doc<"cleaners">["status"], string> = { onboarding: "Onboarding", ready: "Active", paused: "Paused", suspended: "Suspended", ended: "Ended" };
