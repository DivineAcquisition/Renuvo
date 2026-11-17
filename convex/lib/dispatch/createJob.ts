/**
 * Making a job: the one path for a person scheduling a visit (convex/jobs.ts) and for Sales booking an
 * accepted quote (convex/lib/sales/booking.ts). The same checks run for both: the service must be in the
 * catalog and active, the property the customer's, the place and time inside the company's own rules.
 * Dispatch looks at the new job in the same step.
 *
 * A job made from an accepted quote keeps that quote's price and service version. It is not priced
 * again: what the customer accepted is what was promised.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { notFound, userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import type { Quote, QuoteInput } from "../services/engine";
import { quote as runQuote, saveQuote, visitInput, visitScope } from "../services/operations";
import { publishedByKey } from "../services/store";
import { formatCents } from "../services/words";
import { businessSettingsOf, checkArea, checkHours, findService } from "../settings/business";
import { cents, instant, tags, text } from "../text";
import { applyTemplate } from "./templates";
import { coverJob } from "./workflow";

export function span(startsAt: number, endsAt: number) {
  const start = instant(startsAt, "The start time");
  const end = instant(endsAt, "The end time");
  if (start >= end) throw userError("A job must start before it ends.");
  if (end - start > 24 * 60 * 60 * 1000) throw userError("A job cannot be longer than a day.");
  return { startsAt: start, endsAt: end };
}

export function checkedCrew(crew: number): number {
  if (!Number.isInteger(crew) || crew < 1 || crew > 12) throw userError("A job needs a whole number of cleaners, from 1 to 12.");
  return crew;
}

export function checkedArrival(minutes: number): number {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 12 * 60) throw userError("The arrival window must be a whole number of minutes, up to 12 hours.");
  return minutes;
}

export function deadlineFor(at: number, endsAt: number): number {
  const deadline = instant(at, "The deadline");
  if (deadline < endsAt) throw userError("The service must be finished by a time at or after the visit's end.");
  return deadline;
}

export type NewJob = {
  customerId: Id<"customers">;
  propertyId: Id<"properties">;
  serviceId?: string;
  quoteInput?: QuoteInput;
  expectedTotalCents?: number;
  serviceType?: string;
  scope?: string;
  requiredSkills?: string[];
  priceCents?: number;
  startsAt: number;
  endsAt: number;
  requiredCrew?: number;
  arrivalWindowMinutes?: number;
  hardDeadlineAt?: number;
  instructions?: string;
  /** Set only by Sales: the accepted quote this job fulfils. Its price and service version stand as accepted. */
  sales?: { opportunityId: Id<"salesOpportunities">; quoteId: Id<"salesQuotes">; quoteVersion: number; pricingQuoteId: Id<"serviceQuotes">; serviceVersionId: Id<"serviceVersions">; serviceVersion: number; priceCents: number; durationMinutes: number };
};

async function inCompany<T extends "customers" | "properties">(ctx: MutationCtx, company: Doc<"companies">, id: Id<T>): Promise<Doc<T>> {
  const doc = (await ctx.db.get(id)) as (Doc<T> & { companyId: Id<"companies"> }) | null;
  if (!doc || doc.companyId !== company._id) notFound();
  return doc;
}

export async function createJob(ctx: MutationCtx, company: Doc<"companies">, actor: Actor, args: NewJob): Promise<Id<"jobs">> {
  const customer = await inCompany(ctx, company, args.customerId);
  const settings = businessSettingsOf(company);
  // The one catalog is Services & Pricing. Until a company's Settings services are copied there, the old list still serves.
  const catalog = args.serviceId === undefined ? null : await publishedByKey(ctx, company._id, args.serviceId);
  const legacy = args.serviceId === undefined || catalog || company.servicesMigratedAt !== undefined ? null : findService(settings, args.serviceId);
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
  const property = await inCompany(ctx, company, args.propertyId);
  if (property.customerId !== customer._id) throw userError("That property belongs to a different customer.");
  const times = span(args.startsAt, args.endsAt);
  // The company's own rules for where and when it works. Empty rules restrict nothing.
  checkArea(settings, property.address.postalCode);
  checkHours(settings, times, company.timezone);
  // The price: a person's typed price wins and is recorded as theirs; otherwise the engine prices the published version.
  let priced: { input: QuoteInput; result: Quote } | null = null;
  if (spec && args.priceCents === undefined && !args.sales) {
    const input = await visitInput(ctx, company, spec, (args.quoteInput ?? {}) as QuoteInput, times.startsAt);
    const result = runQuote(spec, input);
    if (args.quoteInput || result.outcome === "firm" || result.outcome === "estimate") {
      if (result.outcome === "incomplete") throw userError(`This price needs: ${result.missing.join(", ")}. Answer them, or type a price.`);
      if (result.outcome === "walkthrough" || result.totalCents === null) throw userError(`${result.reasons.join(" ")} Type the price agreed after the walkthrough instead.`);
      if (args.expectedTotalCents !== undefined && args.expectedTotalCents !== result.totalCents) throw userError(`The price is now ${formatCents(result.totalCents)}, not the ${formatCents(args.expectedTotalCents)} you saw. Review it before booking.`);
      priced = { input, result };
    }
  }
  const price = args.sales?.priceCents ?? args.priceCents ?? priced?.result.totalCents ?? service?.startingPriceCents;
  const priceSource = args.sales ? ("quote" as const) : args.priceCents !== undefined ? ("manual" as const) : priced ? ("quote" as const) : ("none" as const);
  const jobId = await ctx.db.insert("jobs", {
    companyId: company._id,
    customerId: customer._id,
    propertyId: property._id,
    serviceType: text(serviceType, "Service type", 80),
    scope: text(scope, "Scope", 2000),
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
              durationMinutes: args.sales?.durationMinutes ?? priced?.result.time.elapsedMinutes ?? Math.max(15, Math.round((times.endsAt - times.startsAt) / 60_000)),
              defaultCrew: spec.team.crewSize,
              skills: spec.team.skills,
              capturedAt: Date.now(),
              versionId: args.sales?.serviceVersionId ?? catalog.version._id,
              version: args.sales?.serviceVersion ?? catalog.version.version,
              priceSource,
              ...(args.sales ? { quoteId: args.sales.pricingQuoteId } : {}),
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
    ...(args.sales ? { sales: { opportunityId: args.sales.opportunityId, quoteId: args.sales.quoteId, quoteVersion: args.sales.quoteVersion } } : {}),
    createdAt: Date.now(),
  });
  if (catalog && priced) {
    const quoteId = await saveQuote(ctx, { companyId: company._id, service: catalog.service, version: catalog.version, quoteInput: priced.input, result: priced.result, purpose: "visit", actor: actor, jobId });
    const job = (await ctx.db.get(jobId))!;
    await ctx.db.patch(jobId, { serviceSnapshot: { ...job.serviceSnapshot!, quoteId } });
  }
  const template = await applyTemplate(ctx, (await ctx.db.get(jobId))!);
  await recordEvent(ctx, { companyId: company._id, type: "job.created", actor: actor, subject: { table: "jobs", id: jobId }, data: template ? { checklistVersion: template.version } : undefined });
  await coverJob(ctx, jobId);
  return jobId;
}
