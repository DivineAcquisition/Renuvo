/**
 * Who may do what with agreements. One table, used by every server function, every Chat tool, search,
 * export and preview, so a restriction cannot be met in one place and missed in another.
 *
 * Seeing a cleaner's schedule never grants their employment agreement: workforce documents are their own
 * class, checked on their own. Capabilities are checked against the member's role as it is now.
 */
import type { Doc } from "../../_generated/dataModel";
import { notFound, userError } from "../errors";
import type { Role } from "../roles";
import { docType, type AccessClass } from "./catalog";

export const CAPABILITIES = ["view", "draft", "editTemplates", "approve", "send", "viewWorkforce", "viewRestricted", "manageRenewals", "archiveExport"] as const;
export type Capability = (typeof CAPABILITIES)[number];

const GRANTS: Record<Role, readonly Capability[]> = {
  owner: CAPABILITIES,
  manager: ["view", "draft", "editTemplates", "approve", "send", "viewWorkforce", "manageRenewals", "archiveExport"],
  office: ["view", "draft"],
};

export const can = (role: Role, capability: Capability) => GRANTS[role].includes(capability);

export function capabilitiesOf(role: Role): Capability[] {
  return [...GRANTS[role]];
}

/** The access classes a role may read. */
export function readableClasses(role: Role): AccessClass[] {
  return ["company", ...(can(role, "viewWorkforce") ? (["workforce"] as const) : []), ...(can(role, "viewRestricted") ? (["restricted"] as const) : [])];
}

export function mayRead(role: Role, access: AccessClass): boolean {
  return readableClasses(role).includes(access);
}

/** What a role needs to change a document of this class: drafting a restricted document is the Owner's. */
export function mayDraft(role: Role, access: AccessClass): boolean {
  return can(role, "draft") && mayRead(role, access);
}

/** The class a document type has, read from the catalog. */
export function classOf(typeKey: string): AccessClass {
  return docType(typeKey).access;
}

/** An agreement the member may read, or "Not found.": a document they may not see looks like one that is not there. */
export function readable(role: Role, agreement: Doc<"agreements"> | null, companyId: string): Doc<"agreements"> {
  if (!agreement || agreement.companyId !== companyId || !mayRead(role, agreement.access)) notFound();
  return agreement;
}

export function requireCapability(role: Role, capability: Capability, what: string): void {
  if (!can(role, capability)) throw userError(`Your role cannot ${what}.`, "not_allowed");
}

/** Plans. Both include the core library, standard templates, guided drafting, versions, basic approval and signing as implemented. */
export type Plan = "growth" | "scale";
export const SCALE_FEATURES = ["advanced_approval", "template_governance", "customer_portal"] as const;
export type ScaleFeature = (typeof SCALE_FEATURES)[number];

export function planOf(company: Pick<Doc<"companies">, "plan">): Plan {
  return company.plan ?? "growth";
}

export function entitlements(company: Pick<Doc<"companies">, "plan">) {
  const plan = planOf(company);
  return {
    plan,
    /** Read from the company's plan record, set by Selestial staff. There is no subscription or metering system behind it yet. */
    source: "company plan record",
    core: { library: true, standardTemplates: true, guidedDrafting: true, versionHistory: true, basicApproval: true, signing: "as the connected provider allows" },
    scale: { advanced_approval: plan === "scale", template_governance: plan === "scale", customer_portal: false },
    notes: ["Customer portal access belongs to Scale but is not built yet, so it is unavailable on every plan.", "No usage limits or signature charges are defined or enforced."],
  };
}

export function requireScale(company: Pick<Doc<"companies">, "plan">, feature: ScaleFeature): void {
  if (feature === "customer_portal") throw userError("The customer portal is not built yet.", "limit");
  if (planOf(company) !== "scale") throw userError("This is part of the Scale plan. Core agreements, templates, approvals and signing are in every plan.", "limit");
}
