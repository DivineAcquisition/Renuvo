/**
 * Reads the facts the Cleaners workspace needs from the shared record, in a few company-wide reads rather
 * than one per cleaner, so the directory stays fast and within a query's read limits. Nothing here decides
 * anything: readiness.ts and attention.ts do.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { readiness, type ReadinessFacts, type RequirementRow } from "./readiness";
import { cleanersSettings, definitionsOf, type Definition } from "./settings";

type Ctx = QueryCtx | MutationCtx;

/** The most cleaners one company's directory reads. A company beyond this is told the list is capped. */
export const DIRECTORY_CAP = 1000;

/** Agreement types that count as a worker's working agreement when a requirement names no type. */
export const WORKING_AGREEMENT_TYPES = ["contractor_agreement", "employee_offer", "employment_agreement", "subcontractor_agreement"];

export async function companyDefinitions(ctx: Ctx, company: Doc<"companies">): Promise<Definition[]> {
  const rows = await ctx.db
    .query("requirementDefinitions")
    .withIndex("by_company_key", (q) => q.eq("companyId", company._id))
    .take(200);
  return definitionsOf(company, rows);
}

/** Every cleaner in the company except the ended ones, unless asked. */
export async function companyCleaners(ctx: Ctx, companyId: Id<"companies">, includeEnded = false): Promise<Doc<"cleaners">[]> {
  const out: Doc<"cleaners">[] = [];
  const statuses = includeEnded ? (["onboarding", "ready", "paused", "suspended", "ended"] as const) : (["onboarding", "ready", "paused", "suspended"] as const);
  for (const status of statuses) {
    if (out.length >= DIRECTORY_CAP) break;
    out.push(
      ...(await ctx.db
        .query("cleaners")
        .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status))
        .take(DIRECTORY_CAP - out.length)),
    );
  }
  return out;
}

export function toRow(row: Doc<"workerRequirements">): RequirementRow {
  return { key: row.key, status: row.status, expiresAt: row.expiresAt, acceptedAt: row.acceptedAt, submittedAt: row.submittedAt, reviewNote: row.reviewNote, waiver: row.waiver ? { reason: row.waiver.reason, at: row.waiver.at } : undefined, acknowledged: row.acknowledged };
}

async function grouped<T extends { cleanerId: Id<"cleaners"> }>(rows: T[]): Promise<Map<string, T[]>> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.cleanerId) ?? [];
    list.push(row);
    map.set(row.cleanerId, list);
  }
  return map;
}

export type CompanyFacts = {
  definitions: Definition[];
  requirements: Map<string, Doc<"workerRequirements">[]>;
  windows: Map<string, Doc<"availabilityWindows">[]>;
  agreements: Map<string, ReadinessFacts["agreements"]>;
  /** Subcontractor companies whose working relationship has ended, by id, with their names. */
  endedSuppliers: Map<string, string>;
};

/** The names of the company's subcontractors whose working relationship has ended. */
async function endedSuppliersOf(ctx: Ctx, companyId: Id<"companies">): Promise<Map<string, string>> {
  const rows = await ctx.db
    .query("subcontractors")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "ended"))
    .take(500);
  return new Map(rows.map((row) => [row._id as string, row.name]));
}

/** The requirement rows, weekly windows and linked agreements of every cleaner in the company. */
export async function companyFacts(ctx: Ctx, company: Doc<"companies">): Promise<CompanyFacts> {
  const definitions = await companyDefinitions(ctx, company);
  const requirementRows = await ctx.db
    .query("workerRequirements")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", company._id))
    .take(DIRECTORY_CAP * 15);
  const windowRows = await ctx.db
    .query("availabilityWindows")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", company._id))
    .take(DIRECTORY_CAP * 14);
  const agreements = new Map<string, ReadinessFacts["agreements"]>();
  const links = await ctx.db
    .query("agreementLinks")
    .withIndex("by_company_record", (q) => q.eq("companyId", company._id).eq("table", "cleaners"))
    .take(DIRECTORY_CAP * 4);
  for (const link of links) {
    const agreement = await ctx.db.get(link.agreementId);
    if (!agreement || agreement.companyId !== company._id || agreement.category !== "workforce") continue;
    const state = agreement.workflow === "signed" ? "signed" : agreement.workflow === "sent" || agreement.workflow === "partially_signed" ? "sent" : "draft";
    // A signed agreement that has ended or been replaced no longer satisfies anything.
    if (state === "signed" && (agreement.lifecycle.terminatedOn || agreement.lifecycle.supersededBy)) continue;
    const list = agreements.get(link.recordId) ?? [];
    list.push({ docType: agreement.docType, state });
    agreements.set(link.recordId, list);
  }
  return { definitions, requirements: await grouped(requirementRows), windows: await grouped(windowRows), agreements, endedSuppliers: await endedSuppliersOf(ctx, company._id) };
}

/** The facts readiness needs about one cleaner. */
export function readinessFacts(cleaner: Doc<"cleaners">, facts: CompanyFacts): ReadinessFacts {
  const own = facts.agreements.get(cleaner._id) ?? [];
  return {
    status: cleaner.status,
    engagement: cleaner.engagement,
    weeklyWindows: facts.windows.get(cleaner._id)?.length ?? 0,
    serviceAreas: cleaner.serviceAreas.length,
    // A requirement with no document type is met by any working agreement.
    agreements: own.flatMap((row) => (WORKING_AGREEMENT_TYPES.includes(row.docType) ? [row, { ...row, docType: "*" }] : [row])),
    supplierEnded: cleaner.subcontractorId ? facts.endedSuppliers.get(cleaner.subcontractorId) : undefined,
  };
}

/** The definitions with no document type match any working agreement. */
function withWildcard(definitions: Definition[]): Definition[] {
  return definitions.map((def) => (def.kind === "agreement" && !def.agreementDocType ? { ...def, agreementDocType: "*" } : def));
}

export function readinessOf(cleaner: Doc<"cleaners">, facts: CompanyFacts, company: Doc<"companies">, now: number, service: { name: string; skills: string[] } | null = null) {
  return readiness({
    definitions: withWildcard(facts.definitions),
    rows: (facts.requirements.get(cleaner._id) ?? []).map(toRow),
    facts: readinessFacts(cleaner, facts),
    now,
    warningDays: cleanersSettings(company).expiryWarningDays,
    service,
  });
}

/** The same, for one cleaner, reading only that cleaner's rows. Used by Dispatch, the portal and mutations. */
export async function cleanerReadiness(ctx: Ctx, company: Doc<"companies">, cleaner: Doc<"cleaners">, now: number, service: { name: string; skills: string[] } | null = null) {
  const definitions = await companyDefinitions(ctx, company);
  const rows = await ctx.db
    .query("workerRequirements")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", company._id).eq("cleanerId", cleaner._id))
    .take(100);
  const windows = await ctx.db
    .query("availabilityWindows")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", company._id).eq("cleanerId", cleaner._id))
    .take(100);
  const agreements: ReadinessFacts["agreements"] = [];
  const links = await ctx.db
    .query("agreementLinks")
    .withIndex("by_company_record", (q) => q.eq("companyId", company._id).eq("table", "cleaners").eq("recordId", cleaner._id))
    .take(50);
  for (const link of links) {
    const agreement = await ctx.db.get(link.agreementId);
    if (!agreement || agreement.companyId !== company._id || agreement.category !== "workforce") continue;
    const state = agreement.workflow === "signed" ? "signed" : agreement.workflow === "sent" || agreement.workflow === "partially_signed" ? "sent" : "draft";
    if (state === "signed" && (agreement.lifecycle.terminatedOn || agreement.lifecycle.supersededBy)) continue;
    agreements.push({ docType: agreement.docType, state });
  }
  const facts: CompanyFacts = {
    definitions,
    requirements: new Map([[cleaner._id, rows]]),
    windows: new Map([[cleaner._id, windows]]),
    agreements: new Map([[cleaner._id, agreements]]),
    endedSuppliers: new Map(),
  };
  const supplier = cleaner.subcontractorId ? await ctx.db.get(cleaner.subcontractorId) : null;
  if (supplier && supplier.companyId === company._id && supplier.status === "ended") facts.endedSuppliers.set(supplier._id, supplier.name);
  return { readiness: readinessOf(cleaner, facts, company, now, service), rows, windows, definitions };
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}
