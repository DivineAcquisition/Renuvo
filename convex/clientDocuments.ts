/**
 * A client's documents, read from the records that own them: agreements and proposals (Company
 * Agreements), their versions and signing, supporting files, and the price each visit was booked at.
 * Nothing is copied; every row links to its authoritative record, and each record's own access rules
 * decide who sees it. A document is called signed only when its record says so.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { mayRead } from "./lib/agreements/access";
import { DOC_TYPE_BY_KEY } from "./lib/agreements/catalog";
import { lifecycleStatus } from "./lib/agreements/store";
import { companyQuery, type MemberAccess } from "./lib/builders";
import { propertiesOf } from "./lib/clients/directory";
import { dayOf } from "./lib/services/propertyPrices";

type Ctx = QueryCtx & MemberAccess;

const NEXT: Record<string, string> = {
  draft: "Being drafted. Nothing has been sent.",
  needs_review: "Waiting for review before it can be approved.",
  approved: "Approved, not sent yet.",
  sent: "Sent for signature. Waiting for the client.",
  partially_signed: "Some signers have signed. Waiting for the rest.",
  signed: "Signed.",
  declined: "The client declined it.",
  withdrawn: "Withdrawn.",
  expired: "The signing request expired before it was signed.",
  delivery_failed: "The signing request could not be delivered.",
};

const LIFECYCLE: Record<string, string> = { none: "", not_started: "Not in force yet", in_force: "In force", renewal_due: "Renewal due", expired: "Expired", terminated: "Ended", superseded: "Replaced by a newer version" };

/** The agreements linked to the client or any of its properties that this person may read. */
export async function linkedAgreements(ctx: Ctx, customerId: Id<"customers">, propertyIds: Id<"properties">[]) {
  const found = new Map<string, { agreement: Doc<"agreements">; properties: Set<string> }>();
  const records: { table: "customers" | "properties"; id: string }[] = [{ table: "customers", id: customerId }, ...propertyIds.map((id) => ({ table: "properties" as const, id }))];
  for (const record of records) {
    const links = await ctx.db
      .query("agreementLinks")
      .withIndex("by_company_record", (q) => q.eq("companyId", ctx.companyId).eq("table", record.table).eq("recordId", record.id))
      .take(100);
    for (const link of links) {
      if (!mayRead(ctx.role, link.access)) continue;
      const agreement = found.get(link.agreementId)?.agreement ?? (await ctx.db.get(link.agreementId));
      if (!agreement || agreement.companyId !== ctx.companyId || !mayRead(ctx.role, agreement.access)) continue;
      const entry = found.get(agreement._id) ?? { agreement, properties: new Set<string>() };
      if (record.table === "properties") entry.properties.add(record.id);
      found.set(agreement._id, entry);
    }
  }
  return [...found.values()];
}

async function describeAgreement(ctx: Ctx, agreement: Doc<"agreements">, properties: Set<string>, propertyName: (id: string) => string, plansLinked: number) {
  const today = dayOf(Date.now(), ctx.company.timezone);
  const request = await ctx.db
    .query("agreementSignatureRequests")
    .withIndex("by_company_agreement", (q) => q.eq("companyId", ctx.companyId).eq("agreementId", agreement._id))
    .order("desc")
    .first();
  const type = DOC_TYPE_BY_KEY.get(agreement.docType);
  const lifecycle = lifecycleStatus(agreement, today);
  const signed = agreement.workflow === "signed";
  return {
    id: agreement._id,
    title: agreement.title,
    type: type?.label ?? "Agreement",
    category: agreement.category,
    workflow: agreement.workflow,
    /** Who signed and how is the record's, not a guess: signed in Selestial, recorded as signed elsewhere and checked, or not signed. */
    provenance: agreement.provenance,
    lifecycle,
    lifecycleWords: LIFECYCLE[lifecycle] ?? "",
    version: agreement.currentVersion,
    signedVersion: agreement.signedVersion ?? null,
    sentVersion: agreement.sentVersion ?? null,
    expiresOn: agreement.lifecycle.expiresOn ?? null,
    renewalOn: agreement.lifecycle.renewalOn ?? null,
    effectiveOn: agreement.lifecycle.effectiveOn ?? null,
    signing: request ? { status: request.status, sentAt: request.sentAt ?? null, expiresAt: request.expiresAt, signers: request.signers.map((s) => ({ name: s.name, status: s.status })) } : null,
    next: signed && plansLinked === 0 && agreement.category === "customer" ? "Signed. No service is booked by signing: book a visit or set up a plan." : (NEXT[agreement.workflow] ?? ""),
    properties: [...properties].map(propertyName),
    archived: agreement.archivedAt !== undefined,
    supersededBy: agreement.lifecycle.supersededBy ?? null,
    updatedAt: agreement.updatedAt,
  };
}

/**
 * Quotes & Proposals: the client's customer agreements and proposals, current first, with their version,
 * signing state and what they need next; and the price each recent visit was booked at.
 */
export const proposals = companyQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const properties = await propertiesOf(ctx, ctx.companyId, customer._id, true);
    const propertyName = (id: string) => {
      const p = properties.find((row) => row._id === id);
      return p ? p.label?.trim() || p.address.line1 : "A property";
    };
    const plans = await ctx.db
      .query("servicePlans")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .take(100);
    const linked = (await linkedAgreements(ctx, customer._id, properties.map((p) => p._id))).filter((row) => row.agreement.category === "customer");
    const agreements = [];
    for (const row of linked) agreements.push(await describeAgreement(ctx, row.agreement, row.properties, propertyName, plans.filter((p) => p.agreementId === row.agreement._id && p.state !== "ended").length));
    agreements.sort((a, b) => Number(a.archived || a.lifecycle === "superseded") - Number(b.archived || b.lifecycle === "superseded") || b.updatedAt - a.updatedAt);
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_company_customer_start", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .order("desc")
      .take(30);
    const quotes = [];
    for (const job of jobs) {
      const quoteId = job.serviceSnapshot?.quoteId;
      const source = job.serviceSnapshot?.priceSource ?? null;
      const quote = quoteId ? await ctx.db.get(quoteId) : null;
      if (!quote && job.priceCents === undefined) continue;
      quotes.push({ jobId: job._id, startsAt: job.startsAt, service: job.serviceType, property: propertyName(job.propertyId), totalCents: quote?.totalCents ?? job.priceCents ?? null, outcome: quote?.outcome ?? null, version: quote?.version ?? job.serviceSnapshot?.version ?? null, source, status: job.status });
      if (quotes.length >= 15) break;
    }
    return { agreements, quotes };
  },
});

/** Everything filed for the client, by kind: agreements of every category this person may read, and supporting files. */
export const documents = companyQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const properties = await propertiesOf(ctx, ctx.companyId, customer._id, true);
    const propertyName = (id: string) => {
      const p = properties.find((row) => row._id === id);
      return p ? p.label?.trim() || p.address.line1 : "A property";
    };
    const plans = await ctx.db
      .query("servicePlans")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .take(100);
    const linked = await linkedAgreements(ctx, customer._id, properties.map((p) => p._id));
    const agreements = [];
    for (const row of linked) agreements.push(await describeAgreement(ctx, row.agreement, row.properties, propertyName, plans.filter((p) => p.agreementId === row.agreement._id && p.state !== "ended").length));
    agreements.sort((a, b) => Number(a.archived || a.lifecycle === "superseded") - Number(b.archived || b.lifecycle === "superseded") || b.updatedAt - a.updatedAt);
    const files: Doc<"agreementFiles">[] = [];
    for (const id of [customer._id as string, ...properties.map((p) => p._id as string)]) {
      const rows = await ctx.db
        .query("agreementFiles")
        .withIndex("by_company_linked", (q) => q.eq("companyId", ctx.companyId).eq("linked.id", id))
        .take(100);
      files.push(...rows.filter((file) => mayRead(ctx.role, file.access) && file.extraction.state !== "rejected" && file.classification !== "unclassified"));
    }
    return {
      agreements,
      files: files
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((file) => ({
          id: file._id,
          name: file.name,
          kind: file.classification,
          supportingKind: file.supportingKind ?? null,
          about: file.linked!.table === "properties" ? propertyName(file.linked!.id) : customer.name,
          contentType: file.contentType,
          size: file.size,
          expiresOn: file.expiresOn ?? null,
          agreementId: file.agreementId ?? null,
          uploadedAt: file.createdAt,
        })),
      today: dayOf(Date.now(), ctx.company.timezone),
    };
  },
});
