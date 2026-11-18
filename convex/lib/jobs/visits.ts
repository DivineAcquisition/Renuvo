/**
 * Making and cancelling a visit, shared by the booking form (jobs.create), service plans and anything
 * else that books work, so every visit is priced, checked and staffed the same way. The caller has
 * already checked who may do it.
 */
import { v } from "convex/values";

import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { owned } from "../access";
import { refreshClient } from "../clients/directory";
import { endAssignment } from "../dispatch/assignmentState";
import { applyTemplate } from "../dispatch/templates";
import { coverJob } from "../dispatch/workflow";
import { userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import { businessSettingsOf, checkArea, checkHours, findService } from "../settings/business";
import type { Quote, QuoteInput } from "../services/engine";
import { quote as runQuote, saveQuote, visitInput, visitScope } from "../services/operations";
import { addPropertyTasks, dayOf, engineInput, priceInForce, withPropertyTasks } from "../services/propertyPrices";
import { quoteInputValidator } from "../services/schema";
import { publishedByKey } from "../services/store";
import { formatCents } from "../services/words";
import { ACTIVE_ASSIGNMENT, assertChange, JOB_CHANGES } from "../statuses";
import { cents, instant, tags, text } from "../text";

type Ctx = MutationCtx & { company: Doc<"companies">; companyId: Id<"companies"> };

export const createVisitArgs = {
    customerId: v.id("customers"),
    propertyId: v.id("properties"),
    /**
     * A service from Services & Pricing, by its key. Its published version's name, scope, skills and crew
     * fill whatever is not given, and its price comes from the pricing engine with `quoteInput`. Archived
     * services are refused.
     */
    serviceId: v.optional(v.string()),
    /** The answers the service's price needs (size, rooms, extras, frequency). */
    quoteInput: v.optional(quoteInputValidator),
    /** The total the person was shown. If the engine now gives a different one, the visit is refused, not silently repriced. */
    expectedTotalCents: v.optional(v.number()),
    serviceType: v.optional(v.string()),
    scope: v.optional(v.string()),
    requiredSkills: v.optional(v.array(v.string())),
    priceCents: v.optional(v.number()),
    startsAt: v.number(),
    endsAt: v.number(),
    requiredCrew: v.optional(v.number()),
    arrivalWindowMinutes: v.optional(v.number()),
    hardDeadlineAt: v.optional(v.number()),
    instructions: v.optional(v.string()),
  };

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- only its type is used
const createVisitArgsObject = v.object(createVisitArgs);
export type CreateVisitArgs = typeof createVisitArgsObject.type;

/** Where a visit came from, when not the booking form: a plan and the day of its series. */
export type VisitOrigin = { planId: Id<"servicePlans">; planDate: string; priceSource?: "plan" };

function span(startsAt: number, endsAt: number) {
  const start = instant(startsAt, "The start time");
  const end = instant(endsAt, "The end time");
  if (start >= end) throw userError("A job must start before it ends.");
  if (end - start > 24 * 60 * 60 * 1000) throw userError("A job cannot be longer than a day.");
  return { startsAt: start, endsAt: end };
}

function checkedCrew(crew: number): number {
  if (!Number.isInteger(crew) || crew < 1 || crew > 12) throw userError("A job needs a whole number of cleaners, from 1 to 12.");
  return crew;
}

function checkedArrival(minutes: number): number {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 12 * 60) throw userError("The arrival window must be a whole number of minutes, up to 12 hours.");
  return minutes;
}

function deadlineFor(at: number, endsAt: number): number {
  const deadline = instant(at, "The deadline");
  if (deadline < endsAt) throw userError("The service must be finished by a time at or after the visit's end.");
  return deadline;
}

/** Books one visit: priced by the engine (or a person's or plan's price), checked against the company's rules, and handed to Dispatch. */
export async function createVisit(ctx: Ctx, actor: Actor, args: CreateVisitArgs, origin?: VisitOrigin): Promise<Id<"jobs">> {
    const customer = await owned(ctx, args.customerId);
    const settings = businessSettingsOf(ctx.company);
    // The one catalog is Services & Pricing. Until a company's Settings services are copied there, the old list still serves.
    const catalog = args.serviceId === undefined ? null : await publishedByKey(ctx, ctx.companyId, args.serviceId);
    const legacy = args.serviceId === undefined || catalog || ctx.company.servicesMigratedAt !== undefined ? null : findService(settings, args.serviceId);
    if (args.serviceId !== undefined) {
      if (!catalog && !legacy) throw userError("That service is not in the company's catalog, or it has no published version.");
      const status = catalog?.service.status ?? legacy?.status;
      if (status === "archived") throw userError(`"${catalog?.service.name ?? legacy?.name}" is archived, so new visits cannot use it. Choose an active service.`);
    }
    const spec = catalog?.version.spec ?? null;
    const service = legacy ? { name: legacy.name, scope: legacy.scope, defaultCrew: legacy.defaultCrew, skills: legacy.skills, startingPriceCents: legacy.startingPriceCents } : spec ? { name: spec.name, scope: visitScope(spec), defaultCrew: spec.team.crewSize, skills: spec.team.skills, startingPriceCents: undefined } : null;
    const serviceType = args.serviceType ?? service?.name;
    const scope = args.scope ?? service?.scope;
    if (serviceType === undefined || scope === undefined) throw userError("Choose a service, or enter the service type and scope.");
    if (args.quoteInput && !spec) throw userError("Only a service from Services & Pricing can be priced from answers.");
    const crew = checkedCrew(args.requiredCrew ?? args.quoteInput?.crewSize ?? service?.defaultCrew ?? 1);
    const arrival = checkedArrival(args.arrivalWindowMinutes ?? spec?.team.arrivalWindowMinutes ?? 0);
    const property = await owned(ctx, args.propertyId);
    if (property.customerId !== customer._id) throw userError("That property belongs to a different customer.");
    const times = span(args.startsAt, args.endsAt);
    // The property's own price for this service, when the Owner approved one and it is in force on the visit's day.
    const own = catalog ? await priceInForce(ctx, ctx.companyId, property._id, catalog.service._id, dayOf(times.startsAt, ctx.company.timezone)) : null;
    // The company's own rules for where and when it works. Empty rules restrict nothing.
    checkArea(settings, property.address.postalCode);
    checkHours(settings, times, ctx.company.timezone);
    // The price: a person's typed price wins and is recorded as theirs; otherwise the engine prices the published version.
    let priced: { input: QuoteInput; result: Quote } | null = null;
    if (spec && args.priceCents === undefined) {
      const input = await visitInput(ctx, ctx.company, spec, (args.quoteInput ?? {}) as QuoteInput, times.startsAt, own ? engineInput(own) : null);
      const result = runQuote(spec, input);
      if (args.quoteInput || result.outcome === "firm" || result.outcome === "estimate") {
        if (result.outcome === "incomplete") throw userError(`This price needs: ${result.missing.join(", ")}. Answer them, or type a price.`);
        if (result.outcome === "walkthrough" || result.totalCents === null) throw userError(`${result.reasons.join(" ")} Type the price agreed after the walkthrough instead.`);
        if (args.expectedTotalCents !== undefined && args.expectedTotalCents !== result.totalCents) throw userError(`The price is now ${formatCents(result.totalCents)}, not the ${formatCents(args.expectedTotalCents)} you saw. Review it before booking.`);
        priced = { input, result };
      }
    }
    const price = args.priceCents ?? priced?.result.totalCents ?? service?.startingPriceCents;
    const priceSource = origin?.priceSource === "plan" && args.priceCents !== undefined ? ("plan" as const) : args.priceCents !== undefined ? ("manual" as const) : priced ? ("quote" as const) : ("none" as const);
    const jobId = await ctx.db.insert("jobs", {
      companyId: ctx.companyId,
      customerId: customer._id,
      propertyId: property._id,
      serviceType: text(serviceType, "Service type", 80),
      scope: text(withPropertyTasks(scope, own?.addedTasks ?? []), "Scope", 2000),
      requiredSkills: tags(args.requiredSkills ?? service?.skills ?? [], "Required skills"),
      // What the template said when this visit was made. Editing or archiving it later leaves this alone.
      ...(legacy
        ? { serviceSnapshot: { serviceId: legacy.id, name: legacy.name, scope: legacy.scope, durationMinutes: legacy.durationMinutes, defaultCrew: legacy.defaultCrew, skills: legacy.skills, ...(legacy.startingPriceCents !== undefined ? { startingPriceCents: legacy.startingPriceCents } : {}), capturedAt: Date.now() } }
        : catalog && spec
          ? {
              serviceSnapshot: {
                serviceId: catalog.service.key,
                name: spec.name,
                scope: visitScope(spec),
                durationMinutes: priced?.result.time.elapsedMinutes ?? Math.max(15, Math.round((times.endsAt - times.startsAt) / 60_000)),
                defaultCrew: spec.team.crewSize,
                skills: spec.team.skills,
                capturedAt: Date.now(),
                versionId: catalog.version._id,
                version: catalog.version.version,
                priceSource,
              },
            }
          : {}),
      priceCents: price === undefined ? undefined : cents(price, "The price"),
      ...times,
      status: "scheduled",
      ...(crew > 1 ? { requiredCrew: crew } : {}),
      ...(arrival > 0 ? { arrivalWindowMinutes: arrival } : {}),
      ...(args.hardDeadlineAt !== undefined ? { hardDeadlineAt: deadlineFor(args.hardDeadlineAt, args.endsAt) } : {}),
      ...(args.instructions?.trim() ? { instructions: text(args.instructions, "Instructions", 4000) } : {}),
      ...(origin ? { planId: origin.planId, planDate: origin.planDate } : {}),
      createdAt: Date.now(),
    });
    if (catalog && priced) {
      const quoteId = await saveQuote(ctx, { companyId: ctx.companyId, service: catalog.service, version: catalog.version, quoteInput: priced.input, result: priced.result, purpose: "visit", actor: actor, jobId });
      const job = (await ctx.db.get(jobId))!;
      await ctx.db.patch(jobId, { serviceSnapshot: { ...job.serviceSnapshot!, quoteId } });
    }
    const template = await applyTemplate(ctx, (await ctx.db.get(jobId))!);
    if (own?.addedTasks?.length) await addPropertyTasks(ctx, ctx.companyId, jobId, own.addedTasks);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "job.created", actor: actor, subject: { table: "jobs", id: jobId }, data: template ? { checklistVersion: template.version } : undefined });
    await coverJob(ctx, jobId);
    // Booking a visit makes a prospect a client, on the same record, with its history.
    if (customer.relationship === "prospect") {
      await ctx.db.patch(customer._id, { relationship: "active", relationshipAt: Date.now(), revision: (customer.revision ?? 0) + 1, updatedAt: Date.now() });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "customer.became_client", actor: actor, subject: { table: "customers", id: customer._id }, data: { reason: "first visit booked" } });
    }
    await refreshClient(ctx, customer._id);
    return jobId;
}

/** Cancels a visit and ends every offer and acceptance on it. A skipped plan visit is marked so, kept apart from a cancellation. */
export async function cancelVisit(ctx: MutationCtx & { companyId: Id<"companies"> }, job: Doc<"jobs">, reason: string, actor: Actor, skipped = false) {
  assertChange(JOB_CHANGES, job.status, "cancelled", "job");
  await ctx.db.patch(job._id, { status: "cancelled", cancelReason: reason, ...(skipped ? { skipped: true } : {}) });
  await recordEvent(ctx, { companyId: job.companyId, type: skipped ? "job.skipped" : "job.cancelled", actor, subject: { table: "jobs", id: job._id }, data: { from: job.status } });
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_company_job", (q) => q.eq("companyId", job.companyId).eq("jobId", job._id))
    .take(100);
  for (const assignment of assignments) {
    if (!ACTIVE_ASSIGNMENT.includes(assignment.status)) continue;
    await endAssignment(ctx, assignment, "cancelled", actor, { endReason: skipped ? "The visit was skipped." : "The job was cancelled.", endCause: "job_cancelled", data: { cause: "job_cancelled" } });
  }
  await coverJob(ctx, job._id);
  await refreshClient(ctx, job.customerId);
}
