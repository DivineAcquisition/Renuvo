/** The Cleaners workspace's rules for a company: the Owner's values over the defaults here. */
import type { Doc } from "../../_generated/dataModel";
import type { Engagement, RequirementEffect, RequirementKind } from "./schema";

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

export type CleanersSettings = {
  availabilityConfirmDays: number;
  idleAfterDays: number;
  reminderEveryHours: number;
  maxReminders: number;
  followUpChannels: ("sms" | "email")[];
  expiryWarningDays: number;
  portalLinkDays: number;
  personnelDecider: "owner" | "owner_or_manager";
  endedAccess: "revoke" | "history_only";
};

export function cleanersSettings(company: Pick<Doc<"companies">, "cleaners">): CleanersSettings {
  const own = company.cleaners ?? {};
  const whole = (value: number | undefined, fallback: number, min: number, max: number) => (value !== undefined && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback);
  return {
    availabilityConfirmDays: whole(own.availabilityConfirmDays, 30, 7, 365),
    idleAfterDays: whole(own.idleAfterDays, 21, 7, 180),
    reminderEveryHours: whole(own.reminderEveryHours, 48, 12, 24 * 14),
    maxReminders: whole(own.maxReminders, 3, 0, 10),
    followUpChannels: own.followUpChannels?.length ? own.followUpChannels : ["sms", "email"],
    expiryWarningDays: whole(own.expiryWarningDays, 30, 1, 120),
    portalLinkDays: whole(own.portalLinkDays, 30, 1, 90),
    personnelDecider: own.personnelDecider ?? "owner",
    endedAccess: own.endedAccess ?? "revoke",
  };
}

export type Definition = {
  key: string;
  label: string;
  description?: string;
  kind: RequirementKind;
  effect: RequirementEffect;
  appliesTo: Engagement[];
  reviewer: "manager" | "owner";
  validForDays?: number;
  providedBy?: "company" | "cleaner" | "crew";
  forServices: string[];
  cleanerCompletes: boolean;
  agreementDocType?: string;
  /** For an acknowledgment: when its words last changed. */
  wordsChangedAt?: number;
  order: number;
  /** True when this is the code's default, not a row the Owner saved. */
  isDefault: boolean;
};

const ALL: Engagement[] = ["employee", "contractor", "subcontractor"];
const DIRECT: Engagement[] = ["employee", "contractor"];

/**
 * Selestial's starting template. It is a starting point the Owner changes, not a policy: nothing here is
 * taken from another company's rules. Subcontractor workers are paid and contracted through their own
 * company, so pay, tax and the working agreement are that company's, not each worker's.
 */
export const DEFAULT_DEFINITIONS: Definition[] = [
  { key: "contact", label: "Contact details", description: "Confirm the phone number and email we use to reach you.", kind: "contact", effect: "blocks_assignments", appliesTo: ALL, reviewer: "manager", forServices: [], cleanerCompletes: true, order: 10, isDefault: true },
  { key: "agreement", label: "Working agreement", description: "Your agreement with the company, signed.", kind: "agreement", effect: "blocks_assignments", appliesTo: DIRECT, reviewer: "owner", forServices: [], cleanerCompletes: false, order: 20, isDefault: true },
  { key: "documents", label: "Identity documents", description: "Upload the documents the company asked for. A person checks them.", kind: "document", effect: "blocks_assignments", appliesTo: ALL, reviewer: "manager", forServices: [], cleanerCompletes: true, order: 30, isDefault: true },
  { key: "availability", label: "Weekly availability", description: "The days and hours you can work.", kind: "availability", effect: "blocks_assignments", appliesTo: ALL, reviewer: "manager", forServices: [], cleanerCompletes: true, order: 40, isDefault: true },
  { key: "service_areas", label: "Service areas", description: "The areas you will travel to for work.", kind: "service_areas", effect: "blocks_assignments", appliesTo: ALL, reviewer: "manager", forServices: [], cleanerCompletes: true, order: 50, isDefault: true },
  { key: "policies", label: "Company policies", description: "Read and acknowledge how the company works.", kind: "acknowledgment", effect: "blocks_assignments", appliesTo: ALL, reviewer: "manager", forServices: [], cleanerCompletes: true, order: 60, isDefault: true },
  { key: "training", label: "Training", description: "The company's training before your first job.", kind: "training", effect: "informational", appliesTo: DIRECT, reviewer: "manager", forServices: [], cleanerCompletes: false, order: 70, isDefault: true },
  { key: "equipment", label: "Own cleaning kit", description: "Tell us the equipment and supplies you bring.", kind: "equipment", effect: "informational", appliesTo: ["contractor"], reviewer: "manager", providedBy: "cleaner", forServices: [], cleanerCompletes: true, order: 80, isDefault: true },
  { key: "tax_form", label: "Tax form", description: "The tax form the company needs to pay you.", kind: "document", effect: "blocks_payment", appliesTo: DIRECT, reviewer: "owner", forServices: [], cleanerCompletes: true, order: 90, isDefault: true },
  { key: "payment_setup", label: "Payment details", description: "How you get paid. Starting setup is not finishing it: the office confirms it is complete.", kind: "payment", effect: "blocks_payment", appliesTo: DIRECT, reviewer: "owner", forServices: [], cleanerCompletes: true, order: 100, isDefault: true },
];

/** Keys Recruiter's Playbook used before this workspace existed, mapped onto the template's kinds. */
const RECRUITER_KINDS: Record<string, RequirementKind> = { agreement: "agreement", documents: "document", training: "training", equipment: "equipment", payment_setup: "payment" };

/**
 * The company's template: its saved rows, or the default. A company that set its own onboarding list in
 * Recruiter's Playbook keeps it: those items become the template, each blocking assignments, with the
 * default's other items added so contact, availability and areas are still asked for.
 */
export function definitionsOf(company: Pick<Doc<"companies">, "name" | "recruiter">, rows: Doc<"requirementDefinitions">[]): Definition[] {
  if (rows.length > 0) {
    return rows
      .filter((row) => row.status === "active")
      .map((row) => ({
        key: row.key,
        label: row.label,
        description: row.description,
        kind: row.kind,
        effect: row.effect,
        appliesTo: row.appliesTo,
        reviewer: row.reviewer,
        validForDays: row.validForDays,
        providedBy: row.providedBy,
        forServices: row.forServices,
        cleanerCompletes: row.cleanerCompletes,
        agreementDocType: row.agreementDocType,
        wordsChangedAt: row.wordsChangedAt,
        order: row.order,
        isDefault: false,
      }))
      .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  }
  const custom = company.recruiter?.onboardingRequirements;
  if (!custom?.length) return DEFAULT_DEFINITIONS;
  const fromRecruiter: Definition[] = custom.map((item, index) => {
    const known = DEFAULT_DEFINITIONS.find((def) => def.key === item.key);
    return known ? { ...known, label: item.label } : { key: item.key, label: item.label, kind: RECRUITER_KINDS[item.key] ?? "custom", effect: "blocks_assignments", appliesTo: DIRECT, reviewer: "manager", forServices: [], cleanerCompletes: false, order: 100 + index, isDefault: true };
  });
  const keys = new Set(fromRecruiter.map((def) => def.key));
  return [...DEFAULT_DEFINITIONS.filter((def) => !keys.has(def.key) && ["contact", "availability", "service_areas"].includes(def.key)), ...fromRecruiter].sort((a, b) => a.order - b.order);
}
