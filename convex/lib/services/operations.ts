/**
 * Where a published service meets the rest of the operation: a visit's price and scope, the day's
 * fullness for demand pricing, and the quote record a visit points at.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { localParts } from "../availability";
import type { Actor } from "../events";
import { addLocalDays, startOfLocalDay } from "../time";
import { ENGINE_VERSION, quote, type PropertyPrice, type Quote, type QuoteInput } from "./engine";
import { canonical, inputHash } from "./store";
import type { Spec } from "./spec";

/**
 * How full a day already is, 0 to 100: crew-minutes booked against the minutes ready cleaners said they
 * can work that weekday. Undefined when nobody has said they can work, so nothing is guessed.
 */
export async function dayFullness(ctx: QueryCtx, company: Doc<"companies">, at: number): Promise<number | undefined> {
  const tz = company.timezone;
  const start = startOfLocalDay(at, tz);
  const end = addLocalDays(start, 1, tz);
  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_company_start", (q) => q.eq("companyId", company._id).gte("startsAt", start).lt("startsAt", end))
    .take(300);
  const booked = jobs.filter((job) => job.status === "scheduled" || job.status === "in_progress").reduce((sum, job) => sum + ((job.endsAt - job.startsAt) / 60_000) * (job.requiredCrew ?? 1), 0);
  const weekday = localParts(at, tz).weekday;
  const ready = await ctx.db
    .query("cleaners")
    .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "ready"))
    .take(300);
  let available = 0;
  for (const cleaner of ready) {
    const windows = await ctx.db
      .query("availabilityWindows")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", company._id).eq("cleanerId", cleaner._id))
      .take(28);
    available += windows.filter((w) => w.weekday === weekday).reduce((sum, w) => sum + (w.endMinute - w.startMinute), 0);
  }
  if (available <= 0) return undefined;
  return Math.min(100, Math.round((booked / available) * 1000) / 10);
}

/**
 * The inputs a visit's quote uses: what the person entered, plus the visit's own date, the day's fullness
 * when demand pricing needs it, and the property's own price when the Owner approved one for this service
 * and it is in force on the visit's day (looked up by the caller with priceInForce). Those three come
 * from the records, never from what was typed.
 */
export async function visitInput(ctx: QueryCtx, company: Doc<"companies">, spec: Spec, input: QuoteInput, startsAt: number, own: PropertyPrice | null = null): Promise<QuoteInput> {
  const full: QuoteInput = { ...input, date: localParts(startsAt, company.timezone).day };
  delete full.dayFullnessPercent;
  delete full.propertyPrice;
  if (own) full.propertyPrice = own;
  if (spec.modifiers.demand.enabled && spec.modifiers.demand.busyDay.enabled) {
    const fullness = await dayFullness(ctx, company, startsAt);
    if (fullness !== undefined) full.dayFullnessPercent = fullness;
  }
  return full;
}

/** Saves a quote with the exact version and inputs it was given for. The same inputs and version always give the same price. */
export async function saveQuote(ctx: MutationCtx, input: { companyId: Id<"companies">; service: Doc<"services">; version: Doc<"serviceVersions">; quoteInput: QuoteInput; result: Quote; purpose: "visit" | "chat" | "studio"; actor: Actor; jobId?: Id<"jobs"> }): Promise<Id<"serviceQuotes">> {
  return ctx.db.insert("serviceQuotes", {
    companyId: input.companyId,
    serviceId: input.service._id,
    versionId: input.version._id,
    version: input.version.version,
    engineVersion: ENGINE_VERSION,
    input: canonical(input.quoteInput),
    inputHash: inputHash(input.quoteInput),
    outcome: input.result.outcome,
    totalCents: input.result.totalCents,
    per: input.result.per,
    lines: input.result.lines.map((line) => ({ key: line.key, kind: line.kind, label: line.label.slice(0, 200), detail: line.detail.slice(0, 400), amountCents: line.amountCents })),
    purpose: input.purpose,
    ...(input.jobId ? { jobId: input.jobId } : {}),
    createdBy: input.actor,
    createdAt: Date.now(),
  });
}

/** The scope a visit carries from its service: the description and every included task, in words the crew reads. */
export function visitScope(spec: Spec): string {
  const tasks = spec.included.map((item) => `- ${item.section ? `${item.section}: ` : ""}${item.label}`);
  const excluded = spec.excluded.length ? `\nNot included: ${spec.excluded.join("; ")}.` : "";
  return `${spec.summary || spec.name}${tasks.length ? `\n${tasks.join("\n")}` : ""}${excluded}`.slice(0, 2000);
}

export { quote };
