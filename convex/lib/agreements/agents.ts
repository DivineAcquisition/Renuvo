/**
 * What the agents (and Chat acting for them) may read from signed agreements. Each is a read of a
 * specific, bounded fact, through the same access classes as everything else; none of them applies a
 * clause as an operating rule. A clause that says "weekdays 9 to 1" informs a person or an agent's
 * proposal; changing a live schedule, price or onboarding setting is its own validated action.
 *
 * Only what exists is exposed: Marketing and Team Coordinator are not built, so their reads are used by
 * people and by Chat today, and by the agents when they ship.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import type { Role } from "../roles";
import { mayRead } from "./access";
import { lifecycleStatus } from "./store";
import { localParts } from "../availability";

type Ctx = QueryCtx & { company: Doc<"companies">; role: Role };

/** Signed, in force, not archived, not ended, not replaced. Whether a document governs now. */
export function governs(agreement: Doc<"agreements">, today: string): boolean {
  if (agreement.archivedAt || agreement.workflow !== "signed") return false;
  const status = lifecycleStatus(agreement, today);
  return status === "in_force" || status === "renewal_due";
}

async function linkedTo(ctx: Ctx, table: "customers" | "properties" | "cleaners" | "jobs" | "applications", id: string) {
  const links = await ctx.db.query("agreementLinks").withIndex("by_company_record", (q) => q.eq("companyId", ctx.company._id).eq("table", table).eq("recordId", id)).take(100);
  const out: Doc<"agreements">[] = [];
  for (const link of links) {
    const row = await ctx.db.get(link.agreementId);
    if (row && row.companyId === ctx.company._id && mayRead(ctx.role, row.access)) out.push(row);
  }
  return out;
}

/**
 * Photo permissions, kept as two separate answers because they are two separate permissions: photos to
 * document the service, and photos or testimonials for advertising. Neither implies the other.
 */
export async function photoPermissions(ctx: Ctx, customerId: Id<"customers">) {
  const today = localParts(Date.now(), ctx.company.timezone).day;
  const docs = (await linkedTo(ctx, "customers", customerId)).filter((a) => governs(a, today));
  const find = (type: string) => docs.filter((a) => a.docType === type);
  const documentation = find("photo_authorization");
  const marketing = find("marketing_release").filter((a) => !(typeof a.terms.authorizationEnds === "string" && a.terms.authorizationEnds < today));
  return {
    documentation: { permitted: documentation.length > 0, agreementIds: documentation.map((a) => a._id), use: documentation[0]?.terms.photoUse ?? null },
    marketing: { permitted: marketing.length > 0, agreementIds: marketing.map((a) => a._id), use: marketing[0]?.terms.marketingUse ?? null, endsOn: marketing[0]?.terms.authorizationEnds ?? null },
    note: "Permission to photograph for documentation is not permission to advertise. Withdrawal of either is recorded by ending its agreement.",
  };
}

const PICK = ["serviceName", "scopeSummary", "exclusions", "serviceStandard", "frequency", "serviceWindow", "visitDurationHours", "accessMethod", "alarmPets", "suppliesBy", "specialProducts", "customerPrepares", "rescheduleNoticeHours", "lockoutFeeCents", "concernWindowHours", "correctiveRemedy", "additionalWorkApproval", "sensitiveSurfaces", "propertyList", "turnoverDeadline", "bookingChangeNoticeHours", "linenBy", "restockItems", "emergencyAuthCents", "afterHoursAccess", "authorizedContacts"] as const;

/** The scope, access and scheduling obligations of the agreements that govern a customer's service now. Dispatch and Quality read these. */
export async function serviceTerms(ctx: Ctx, input: { customerId: Id<"customers">; propertyId?: Id<"properties"> }) {
  const today = localParts(Date.now(), ctx.company.timezone).day;
  const rows = [...(await linkedTo(ctx, "customers", input.customerId)), ...(input.propertyId ? await linkedTo(ctx, "properties", input.propertyId) : [])];
  const seen = new Set<string>();
  const out = [];
  for (const row of rows) {
    if (seen.has(row._id) || row.category !== "customer" || !governs(row, today)) continue;
    seen.add(row._id);
    out.push({ agreementId: row._id, title: row.title, docType: row.docType, effectiveOn: row.lifecycle.effectiveOn ?? null, terms: Object.fromEntries(PICK.filter((key) => row.terms[key] !== undefined).map((key) => [key, row.terms[key]])) });
  }
  // Supporting documents (scope schedules, corrective arrangements) are listed beside them.
  const supporting = rows.filter((a) => a.category === "supporting" && governs(a, today) && !seen.has(a._id)).map((a) => ({ agreementId: a._id, title: a.title, docType: a.docType }));
  return { agreements: out, supporting, note: "These are what the signed documents say. They do not change any live setting." };
}

/** Which workforce documents a worker has, in what state: what Team Coordinator will track. Restricted documents appear only to the Owner. */
export async function workerDocuments(ctx: Ctx, cleanerId: Id<"cleaners">) {
  const rows = await linkedTo(ctx, "cleaners", cleanerId);
  return rows
    .filter((a) => a.category === "workforce" && !a.archivedAt)
    .map((a) => ({ agreementId: a._id, title: a.title, docType: a.docType, workflow: a.workflow, provenance: a.provenance, signedVersion: a.signedVersion ?? null }));
}
