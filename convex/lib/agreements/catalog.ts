/**
 * The agreement catalog: every document type Selestial can build, what kind of document it is, who may
 * see it, how ready its starting text is, and which shared clauses it is made of.
 *
 * Readiness is honest. "template" is a configurable starting text for common work. "starting_draft" is a
 * configurable skeleton the owner must review closely. "specialist_review" needs a lawyer or specialist
 * before use. No entry is "legally reviewed": that word is shown only when a company records evidence
 * of a review against its own template version (agreementTemplates.review).
 */
import { CLAUSE_BY_KEY, variablesOf } from "./clauses";
import { VARIABLE_BY_KEY } from "./variables";

export type Category = "customer" | "workforce" | "supporting" | "business";
export type DocKind = "base" | "scope" | "schedule" | "addendum" | "authorization" | "acknowledgment" | "notice";
export type Readiness = "template" | "starting_draft" | "specialist_review";
/** Who may read it. company: any member who works customers. workforce: Owner and Managers. restricted: the Owner only. */
export type AccessClass = "company" | "workforce" | "restricted";

export type DocType = {
  key: string;
  label: string;
  category: Category;
  kind: DocKind;
  family: string;
  access: AccessClass;
  readiness: Readiness;
  /** The shared clauses it is built from, in order. */
  clauses: readonly string[];
  /** Intake groups to ask about, in order, in addition to the ones its clauses imply. */
  groups?: readonly string[];
  /** Who signs: the counterparty's role word. */
  counterparty: "customer" | "worker" | "vendor" | "partner";
  /** Variable keys never required (optional detail). */
  optional?: readonly string[];
  /** Fields that tie the agreement to a record. */
  links?: readonly ("customers" | "properties" | "cleaners" | "jobs" | "applications")[];
  /** A short note shown beside the type. */
  note?: string;
};

const CUSTOMER_BASE = ["parties", "services_scope", "exclusions_standards", "schedule_frequency", "pricing_payment", "deposit", "supplies_equipment", "access_property", "rescheduling_cancellation", "lockout_no_access", "concerns_corrective", "additional_work", "damage_reporting", "insurance_liability", "governing_law", "amendments_notices", "signatures"] as const;

const t = (key: string, label: string, category: Category, kind: DocKind, family: string, access: AccessClass, readiness: Readiness, clauses: readonly string[], extra: Partial<DocType> = {}): DocType => ({
  key,
  label,
  category,
  kind,
  family,
  access,
  readiness,
  clauses,
  counterparty: category === "workforce" ? "worker" : "customer",
  ...extra,
});

const recurring = [...CUSTOMER_BASE.slice(0, 5), "monthly_billing", "late_fee", "price_changes", ...CUSTOMER_BASE.slice(5, 14), "term_renewal", "auto_renewal", "manual_renewal", "termination", ...CUSTOMER_BASE.slice(14)];
const oneTime = [...CUSTOMER_BASE.slice(0, 14), "one_time_term", ...CUSTOMER_BASE.slice(14)];

export const DOC_TYPES: readonly DocType[] = [
  // ── Customer and service families ──
  t("one_time_residential", "One-Time Residential Cleaning", "customer", "base", "Customer service", "company", "template", oneTime, { links: ["customers", "properties"] }),
  t("recurring_residential", "Recurring Residential Cleaning", "customer", "base", "Customer service", "company", "template", recurring, { links: ["customers", "properties"] }),
  t("deep_cleaning", "Deep Cleaning", "customer", "base", "Customer service", "company", "template", ["parties", "services_scope", "exclusions_standards", "sensitive_surfaces", ...oneTime.slice(3)], { links: ["customers", "properties"] }),
  t("move_in_out", "Move-In / Move-Out Cleaning", "customer", "base", "Customer service", "company", "template", ["parties", "services_scope", "exclusions_standards", "sensitive_surfaces", ...oneTime.slice(3)], { links: ["customers", "properties"] }),
  t("commercial_msa", "Commercial Master Service Agreement", "customer", "base", "Commercial", "company", "starting_draft", ["parties", "commercial_sites", "exclusions_standards", "schedule_frequency", "commercial_after_hours", "commercial_consumables", "commercial_inspections", "commercial_contacts", "commercial_po", "pricing_payment", "monthly_billing", "late_fee", "price_changes", "access_property", "rescheduling_cancellation", "concerns_corrective", "additional_work", "damage_reporting", "insurance_liability", "term_renewal", "auto_renewal", "manual_renewal", "termination", "governing_law", "amendments_notices", "signatures"], { links: ["customers", "properties"] }),
  t("office_janitorial", "Office / Janitorial Cleaning", "customer", "base", "Commercial", "company", "starting_draft", ["parties", "commercial_sites", "exclusions_standards", "schedule_frequency", "commercial_after_hours", "commercial_consumables", "commercial_inspections", "commercial_contacts", "commercial_po", "pricing_payment", "monthly_billing", "late_fee", "access_property", "rescheduling_cancellation", "concerns_corrective", "damage_reporting", "insurance_liability", "term_renewal", "auto_renewal", "manual_renewal", "termination", "governing_law", "amendments_notices", "signatures"], { links: ["customers", "properties"] }),
  t("str_turnover", "Short-Term Rental / Vacation Rental Turnover", "customer", "base", "Short-term rental", "company", "starting_draft", ["parties", "str_properties", "services_scope", "exclusions_standards", "str_turnover", "str_linen", "str_restock", "str_emergency", "pricing_payment", "monthly_billing", "access_property", "rescheduling_cancellation", "concerns_corrective", "additional_work", "damage_reporting", "insurance_liability", "term_renewal", "auto_renewal", "manual_renewal", "termination", "governing_law", "amendments_notices", "signatures"], { links: ["customers", "properties"] }),
  t("property_management", "Property Management / Multi-Property Cleaning", "customer", "base", "Short-term rental", "company", "starting_draft", ["parties", "str_properties", "services_scope", "exclusions_standards", "schedule_frequency", "pricing_payment", "monthly_billing", "access_property", "rescheduling_cancellation", "concerns_corrective", "additional_work", "damage_reporting", "insurance_liability", "term_renewal", "auto_renewal", "manual_renewal", "termination", "governing_law", "amendments_notices", "signatures"], { groups: ["str"], links: ["customers", "properties"] }),
  t("post_construction", "Post-Construction Cleaning", "customer", "base", "Specialty", "company", "specialist_review", [...oneTime.slice(0, 3), "sensitive_surfaces", ...oneTime.slice(3)], { note: "Construction debris, hazardous materials and site safety need a specialist's review.", links: ["customers", "properties"] }),
  t("specialty_cleaning", "Specialty Cleaning (carpet, upholstery, windows, floors)", "customer", "base", "Specialty", "company", "starting_draft", [...oneTime.slice(0, 3), "sensitive_surfaces", ...oneTime.slice(3)], { links: ["customers", "properties"] }),
  t("event_emergency", "Event, Emergency, and After-Hours Cleaning", "customer", "base", "Specialty", "company", "starting_draft", oneTime, { links: ["customers", "properties"] }),
  t("specialized_facility", "Specialized Facility Cleaning", "customer", "base", "Specialty", "company", "specialist_review", [...recurring.slice(0, 3), "sensitive_surfaces", ...recurring.slice(3)], { note: "Medical, food, cleanroom and similar facilities have their own rules; use a specialist-reviewed template.", links: ["customers", "properties"] }),

  // ── Workforce ──
  t("contractor_agreement", "Independent Contractor Agreement", "workforce", "base", "Workforce", "restricted", "specialist_review", ["worker_parties", "contractor_relationship", "contractor_work_terms", "worker_pay", "confidentiality", "customer_privacy", "equipment_issuance", "governing_law", "amendments_notices", "signatures"], { counterparty: "worker", links: ["cleaners", "applications"], note: "Worker classification depends on the facts and the state. It is never decided by this document's title." }),
  t("subcontractor_agreement", "Subcontractor Company Agreement", "workforce", "base", "Workforce", "restricted", "specialist_review", ["worker_parties", "contractor_relationship", "contractor_work_terms", "worker_pay", "confidentiality", "customer_privacy", "insurance_liability", "governing_law", "amendments_notices", "signatures"], { counterparty: "vendor", links: ["cleaners"] }),
  t("employee_offer", "Employee Offer Letter", "workforce", "base", "Workforce", "restricted", "specialist_review", ["worker_parties", "employee_position", "worker_pay", "equipment_issuance", "governing_law", "signatures"], { counterparty: "worker", links: ["cleaners", "applications"] }),
  t("employment_agreement", "Employment Terms / Employment Agreement", "workforce", "base", "Workforce", "restricted", "specialist_review", ["worker_parties", "employee_position", "worker_pay", "employment_terms", "confidentiality", "customer_privacy", "equipment_issuance", "governing_law", "amendments_notices", "signatures"], { counterparty: "worker", links: ["cleaners"] }),
  t("confidentiality_privacy", "Confidentiality & Customer Privacy Agreement", "workforce", "base", "Workforce", "workforce", "starting_draft", ["worker_parties", "confidentiality", "customer_privacy", "governing_law", "signatures"], { counterparty: "worker", links: ["cleaners"] }),
  t("handbook_ack", "Employee Handbook / Policy Acknowledgment", "workforce", "acknowledgment", "Workforce", "workforce", "template", ["worker_parties", "handbook_ack", "signatures"], { counterparty: "worker", links: ["cleaners"] }),
  t("equipment_issuance", "Equipment and Uniform Issuance / Return", "workforce", "acknowledgment", "Workforce", "workforce", "template", ["worker_parties", "equipment_issuance", "signatures"], { counterparty: "worker", links: ["cleaners"] }),
  t("keys_access_ack", "Keys, Alarm Codes, and Property Access Acknowledgment", "workforce", "acknowledgment", "Workforce", "workforce", "template", ["worker_parties", "access_items", "signatures"], { counterparty: "worker", links: ["cleaners"] }),
  t("safety_training_ack", "Safety and Training Acknowledgment", "workforce", "acknowledgment", "Workforce", "workforce", "template", ["worker_parties", "safety_training", "signatures"], { counterparty: "worker", links: ["cleaners"] }),
  t("compensation_change", "Compensation Change Addendum", "workforce", "addendum", "Workforce", "restricted", "specialist_review", ["worker_parties", "compensation_change", "amendments_notices", "signatures"], { counterparty: "worker", links: ["cleaners"] }),
  t("background_disclosure", "Background-Check Disclosure and Authorization", "workforce", "authorization", "Workforce", "restricted", "specialist_review", ["worker_parties", "background_disclosure", "signatures"], { counterparty: "worker", links: ["cleaners", "applications"], note: "Must be a standalone document. The disclosure text itself comes from your screening provider or counsel." }),
  t("separation_offboarding", "Separation and Offboarding Documents", "workforce", "notice", "Workforce", "restricted", "specialist_review", ["worker_parties", "separation", "signatures"], { counterparty: "worker", links: ["cleaners"] }),

  // ── Reusable supporting documents ──
  t("scope_of_work", "Scope of Work / Cleaning Schedule", "supporting", "scope", "Supporting", "company", "template", ["parties", "services_scope", "exclusions_standards", "schedule_frequency", "sensitive_surfaces", "signatures"], { links: ["customers", "properties"] }),
  t("property_schedule", "Property / Location Schedule", "supporting", "schedule", "Supporting", "company", "template", ["parties", "str_properties", "access_property", "signatures"], { links: ["customers", "properties"] }),
  t("pricing_schedule", "Pricing and Payment Schedule", "supporting", "schedule", "Supporting", "company", "template", ["parties", "pricing_payment", "monthly_billing", "deposit", "late_fee", "price_changes", "signatures"], { links: ["customers"] }),
  t("change_order", "Change Order / Additional Work Authorization", "supporting", "addendum", "Supporting", "company", "template", ["parties", "change_order", "signatures"], { links: ["customers", "jobs"] }),
  t("recurring_payment_auth", "Recurring Payment Authorization", "supporting", "authorization", "Supporting", "company", "starting_draft", ["parties", "recurring_payment_auth", "signatures"], { links: ["customers"], note: "References the payment provider. Card and bank numbers are never written here." }),
  t("access_authorization", "Property Access / Key-Holding Authorization", "supporting", "authorization", "Supporting", "company", "template", ["parties", "key_holding", "access_property", "signatures"], { links: ["customers", "properties"] }),
  t("str_laundry_addendum", "STR Laundry, Linen, and Restocking Addendum", "supporting", "addendum", "Supporting", "company", "template", ["parties", "str_linen", "str_restock", "signatures"], { links: ["customers", "properties"] }),
  t("sensitive_surface_ack", "Property Condition / Sensitive Surface Acknowledgment", "supporting", "acknowledgment", "Supporting", "company", "template", ["parties", "sensitive_surfaces", "signatures"], { links: ["customers", "properties"] }),
  t("photo_authorization", "Service Documentation Photo Authorization", "supporting", "authorization", "Supporting", "company", "template", ["parties", "photo_documentation", "signatures"], { links: ["customers", "properties"], note: "Separate from advertising permission." }),
  t("marketing_release", "Marketing Photo / Testimonial Release", "supporting", "authorization", "Supporting", "company", "template", ["parties", "marketing_release", "signatures"], { links: ["customers"], note: "Separate from service-documentation permission." }),
  t("renewal_amendment", "Renewal / Extension / Price Amendment", "supporting", "addendum", "Supporting", "company", "template", ["parties", "renewal_extension", "change_order", "signatures"], { links: ["customers"] }),
  t("termination_notice", "Service Pause / Cancellation / Termination Notice", "supporting", "notice", "Supporting", "company", "template", ["parties", "notice_change", "signatures"], { links: ["customers"] }),
  t("corrective_service", "Corrective Service / Re-clean Arrangement", "supporting", "addendum", "Supporting", "company", "template", ["parties", "corrective_arrangement", "signatures"], { links: ["customers", "jobs"] }),

  // ── Business relationships ──
  t("vendor_agreement", "Vendor / Supplier Service Agreement", "business", "base", "Business relationships", "workforce", "starting_draft", ["business_relationship", "pricing_payment", "term_renewal", "auto_renewal", "manual_renewal", "termination", "governing_law", "amendments_notices", "signatures"], { counterparty: "vendor" }),
  t("equipment_rental", "Equipment Rental Agreement", "business", "base", "Business relationships", "workforce", "starting_draft", ["business_relationship", "pricing_payment", "damage_reporting", "term_renewal", "auto_renewal", "manual_renewal", "termination", "governing_law", "signatures"], { counterparty: "vendor" }),
  t("referral_partnership", "Referral / Partnership Agreement", "business", "base", "Business relationships", "workforce", "specialist_review", ["business_relationship", "pricing_payment", "term_renewal", "auto_renewal", "manual_renewal", "termination", "governing_law", "signatures"], { counterparty: "partner" }),
  t("commercial_confidentiality", "Commercial Confidentiality Agreement", "business", "base", "Business relationships", "workforce", "starting_draft", ["parties", "commercial_confidentiality", "governing_law", "signatures"], { counterparty: "partner" }),
  t("data_processing_addendum", "Customer-required Data Processing Addendum", "business", "addendum", "Business relationships", "workforce", "specialist_review", ["parties", "data_processing", "signatures"], { links: ["customers"] }),
];

export const DOC_TYPE_BY_KEY: ReadonlyMap<string, DocType> = new Map(DOC_TYPES.map((type) => [type.key, type]));

export function docType(key: string): DocType {
  const found = DOC_TYPE_BY_KEY.get(key);
  if (!found) throw new Error(`Unknown agreement type ${key}`);
  return found;
}

export const DOC_TYPE_KEYS = DOC_TYPES.map((type) => type.key);

/**
 * Official forms and records that belong beside agreements but are not agreements, and are never
 * generated here: a person uploads the real thing.
 */
export const SUPPORTING_KINDS = [
  { key: "insurance_certificate", label: "Insurance certificate" },
  { key: "license", label: "License or registration" },
  { key: "tax_form", label: "Official tax form (for example W-9 or W-4)" },
  { key: "employment_form", label: "Official employment form (for example I-9)" },
  { key: "bond", label: "Bond" },
  { key: "other_record", label: "Other supporting record" },
] as const;

export type SupportingKind = (typeof SUPPORTING_KINDS)[number]["key"];

/** The variables a document type needs answered, in clause order. Clauses gated by `when` ask only if relevant. */
export function variablesFor(type: DocType): string[] {
  const keys: string[] = [];
  for (const clauseKey of type.clauses) {
    const found = CLAUSE_BY_KEY.get(clauseKey);
    if (!found) throw new Error(`${type.key} names a missing clause ${clauseKey}`);
    for (const key of variablesOf(found.body)) if (!keys.includes(key)) keys.push(key);
    for (const gate of [found.when, found.unless]) if (gate && !keys.includes(gate)) keys.push(gate);
  }
  for (const key of keys) if (!VARIABLE_BY_KEY.has(key)) throw new Error(`${type.key} uses an unknown variable ${key}`);
  return keys;
}
