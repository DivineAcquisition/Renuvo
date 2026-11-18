/**
 * The agreement a customer signs while booking. Its words come from an approved customer template in
 * Company Agreements (the clause library, never a model), filled with the company's standing answers
 * from the booking rules and with this booking's facts. What the customer saw is kept word for word with
 * its hash, the template version, the typed name, an optional drawn signature and the evidence.
 *
 * An agreement that would still say [[TO CONFIRM: …]] after filling can't be signed: the experience
 * can't be published with it (readiness.ts), and a session is never shown one.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { DOC_TYPE_BY_KEY } from "../agreements/catalog";
import { contentHash, render, type Kit } from "../agreements/compose";
import type { Terms } from "../agreements/variables";
import type { Spec } from "../services/spec";
import { localParts } from "../availability";
import type { BookingAgreementRule } from "./schema";

export type BookingFacts = {
  companyName: string;
  customerName?: string;
  address?: string;
  spec?: Spec;
  priceCents?: number | null;
  depositCents?: number;
  startsAt?: number;
  windowMinutes?: number;
  elapsedMinutes?: number;
  timezone: string;
  accessNotes?: string;
  schedule?: string;
};

const FREQUENCY: Record<string, string> = { every_7_days: "Weekly", every_14_days: "Every two weeks", twice_per_month: "Twice a month", once_per_month: "Monthly" };

/** What a booking knows, as agreement answers. Only facts the customer gave or the service states. */
export function bookingTerms(facts: BookingFacts): Terms {
  const terms: Terms = { companyName: facts.companyName };
  if (facts.customerName) {
    terms.counterpartyName = facts.customerName;
    terms.counterpartySigner = facts.customerName;
  }
  if (facts.address) terms.serviceAddress = facts.address;
  if (facts.spec) {
    terms.serviceName = facts.spec.name;
    terms.scopeSummary = facts.spec.summary || facts.spec.name;
    if (facts.spec.excluded.length) terms.exclusions = facts.spec.excluded.join("; ");
    const areas = [...new Set(facts.spec.included.map((item) => item.section).filter((s): s is string => Boolean(s)))];
    if (areas.length) terms.areasIncluded = areas;
  }
  terms.frequency = facts.schedule ? (FREQUENCY[facts.schedule] ?? "One time") : "One time";
  if (facts.priceCents !== undefined && facts.priceCents !== null) terms.pricePerVisitCents = facts.priceCents;
  if (facts.depositCents !== undefined) terms.depositCents = facts.depositCents;
  if (facts.startsAt !== undefined) {
    terms.startDate = localParts(facts.startsAt, facts.timezone).day;
    if (facts.windowMinutes !== undefined) {
      const fmt = (at: number) => new Intl.DateTimeFormat("en-US", { timeZone: facts.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(at));
      terms.serviceWindow = facts.windowMinutes > 0 ? `Arrival between ${fmt(facts.startsAt)} and ${fmt(facts.startsAt + facts.windowMinutes * 60_000)}` : `Starting at ${fmt(facts.startsAt)}`;
    }
  }
  if (facts.elapsedMinutes) terms.visitDurationHours = Math.max(1, Math.round(facts.elapsedMinutes / 60));
  if (facts.accessNotes) terms.accessMethod = "As given by the customer when booking.";
  return terms;
}

export type Prepared = { ok: true; title: string; markdown: string; hash: string; templateId: Id<"agreementTemplates">; templateVersion: number } | { ok: false; why: string; unresolved: string[] };

/** The template's approved clauses, or why it can't be used. */
export async function approvedKit(ctx: QueryCtx, companyId: Id<"companies">, templateId: Id<"agreementTemplates">): Promise<{ template: Doc<"agreementTemplates">; kit: Kit; version: number } | { why: string }> {
  const template = await ctx.db.get(templateId);
  if (!template || template.companyId !== companyId) return { why: "The agreement template no longer exists." };
  if (template.status !== "approved" || template.approvedVersion === undefined) return { why: `"${template.title}" isn't approved in Company Agreements.` };
  const type = DOC_TYPE_BY_KEY.get(template.docType);
  if (!type || type.category !== "customer") return { why: `"${template.title}" isn't a customer agreement.` };
  const row = await ctx.db
    .query("agreementTemplateVersions")
    .withIndex("by_company_template_version", (q) => q.eq("companyId", companyId).eq("templateId", templateId).eq("version", template.approvedVersion!))
    .unique();
  if (!row) return { why: `The approved version of "${template.title}" is missing.` };
  return { template, kit: { clauses: row.clauses.map((c) => ({ ...c, flags: (c.flags ?? []) as never })), extra: row.extra as never }, version: row.version };
}

/** The exact words for this booking, or why they can't be shown yet. */
export async function prepareAgreement(ctx: QueryCtx, companyId: Id<"companies">, rule: BookingAgreementRule, facts: BookingFacts): Promise<Prepared> {
  const found = await approvedKit(ctx, companyId, rule.templateId);
  if ("why" in found) return { ok: false, why: found.why, unresolved: [] };
  const type = DOC_TYPE_BY_KEY.get(found.template.docType)!;
  const terms: Terms = { ...rule.standing, ...bookingTerms(facts) };
  const rendered = render(type, terms, { kit: found.kit, titleOverride: found.template.title });
  if (rendered.unresolved.length) return { ok: false, why: "Some answers the agreement needs aren't set.", unresolved: rendered.unresolved };
  return { ok: true, title: rendered.title, markdown: rendered.markdown, hash: contentHash(rendered.markdown), templateId: rule.templateId, templateVersion: found.version };
}

/** A sample booking, to check before publishing that the agreement will fill completely. */
export function sampleFacts(companyName: string, spec: Spec | undefined, timezone: string): BookingFacts {
  return { companyName, customerName: "Sample Customer", address: "1 Sample St, Sample City", spec, priceCents: 10000, depositCents: 5000, startsAt: Date.UTC(2030, 0, 15, 15), windowMinutes: 60, elapsedMinutes: 120, timezone, accessNotes: "Sample" };
}
