/**
 * Making the visit a confirmed booking or a recurring plan promised. The job has the same shape a person
 * gets from jobs.create: the published service's snapshot, its saved quote, the checklist, and Dispatch
 * looking at it in the same step. The price was settled when the booking was confirmed; nothing here
 * reprices it.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { applyTemplate } from "../dispatch/templates";
import { coverJob } from "../dispatch/workflow";
import { recordEvent, type Actor } from "../events";
import { visitScope } from "../services/operations";
import { cents, optionalText } from "../text";

export type VisitInput = {
  company: Doc<"companies">;
  customerId: Id<"customers">;
  propertyId: Id<"properties">;
  versionId: Id<"serviceVersions">;
  serviceKey: string;
  serviceQuoteId?: Id<"serviceQuotes">;
  priceCents: number;
  startsAt: number;
  endsAt: number;
  crew: number;
  arrivalWindowMinutes: number;
  instructions?: string;
  actor: Actor;
  /** Words for the event: where the visit came from. */
  from: "booking" | "plan";
};

export async function createVisit(ctx: MutationCtx, input: VisitInput): Promise<Id<"jobs">> {
  const version = await ctx.db.get(input.versionId);
  if (!version || version.companyId !== input.company._id) throw new Error("The service version is missing.");
  const spec = version.spec;
  const jobId = await ctx.db.insert("jobs", {
    companyId: input.company._id,
    customerId: input.customerId,
    propertyId: input.propertyId,
    serviceType: spec.name.slice(0, 80),
    scope: visitScope(spec).slice(0, 2000),
    requiredSkills: spec.team.skills,
    serviceSnapshot: {
      serviceId: input.serviceKey,
      name: spec.name,
      scope: visitScope(spec),
      durationMinutes: Math.max(15, Math.round((input.endsAt - input.startsAt) / 60_000)),
      defaultCrew: spec.team.crewSize,
      skills: spec.team.skills,
      capturedAt: Date.now(),
      versionId: version._id,
      version: version.version,
      priceSource: "quote",
      ...(input.serviceQuoteId ? { quoteId: input.serviceQuoteId } : {}),
    },
    priceCents: cents(input.priceCents, "The price"),
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    status: "scheduled",
    ...(input.crew > 1 ? { requiredCrew: input.crew } : {}),
    ...(input.arrivalWindowMinutes > 0 ? { arrivalWindowMinutes: input.arrivalWindowMinutes } : {}),
    ...(input.instructions?.trim() ? { instructions: optionalText(input.instructions, "Instructions", 4000) } : {}),
    createdAt: Date.now(),
  });
  const template = await applyTemplate(ctx, (await ctx.db.get(jobId))!);
  await recordEvent(ctx, { companyId: input.company._id, type: "job.created", actor: input.actor, subject: { table: "jobs", id: jobId }, data: { from: input.from, ...(template ? { checklistVersion: template.version } : {}) } });
  await coverJob(ctx, jobId);
  return jobId;
}
