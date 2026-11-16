/**
 * Who may do what with agreements. One table, used by every server function, every Chat tool, search,
 * export and preview, so a restriction cannot be met in one place and missed in another.
 *
 * Seeing a cleaner's schedule never grants their employment agreement: workforce documents are their own
 * class, checked on their own. Capabilities are checked against the member's role as it is now.
 */
import { featureVerdict, verifiedPlan } from "../billing/access";
import type { PlanFeature } from "../billing/catalog";
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

/**
 * Plans (convex/lib/billing/catalog.ts). Both include the core library, standard templates, guided
 * drafting, versions, basic approval and signing as implemented. Advanced approval routing and template
 * governance are Expand's; the customer portal is Expand's but not built.
 */
export const EXPAND_FEATURES = ["advanced_approval", "template_governance", "customer_portal"] as const;
export type ExpandFeature = (typeof EXPAND_FEATURES)[number];
const PLAN_FEATURE: Record<ExpandFeature, PlanFeature> = { advanced_approval: "advanced_approvals", template_governance: "template_governance", customer_portal: "customer_portal" };

export function entitlements(company: Pick<Doc<"companies">, "plan">) {
  const plan = verifiedPlan(company);
  return {
    plan,
    /** Autumn's verified plan, as billing sync last copied it. */
    source: "verified subscription",
    core: { library: true, standardTemplates: true, guidedDrafting: true, versionHistory: true, basicApproval: true, signing: "as the connected provider allows" },
    expand: { advanced_approval: featureVerdict(company, "advanced_approvals").ok, template_governance: featureVerdict(company, "template_governance").ok, customer_portal: false },
    notes: ["The customer portal belongs to Expand but is not built yet, so it is unavailable on every plan.", "AI-guided drafting uses Selestial Credits, as Chat answers. Signatures have no separate charge defined."],
  };
}

export function requireExpand(company: Pick<Doc<"companies">, "plan">, feature: ExpandFeature): void {
  const verdict = featureVerdict(company, PLAN_FEATURE[feature]);
  if (!verdict.ok) throw userError(verdict.block === "plan" ? `${verdict.message} Core agreements, templates, approvals and signing are in every plan.` : verdict.message, "limit");
}
