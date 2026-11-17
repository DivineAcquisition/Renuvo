/**
 * The rest of how Dispatch works for a company: messaging, the day of service and recovery. These are
 * the Owner's values. The defaults are Selestial's starting point, not any one company's policy.
 */
import type { Doc } from "../../_generated/dataModel";
import { userError } from "../errors";
import type { CrewPay } from "./pay";

export type DispatchPolicy = {
  broadcastEnabled: boolean;
  broadcastSize: number;
  backupOfferWindowMinutes: number;
  reminderLeadMinutes: number;
  contactAfterMinutes: number;
  alertAfterMinutes: number;
  noShowAfterMinutes: number;
  jobAccessGraceHours: number;
  beforePhotosRequired: number;
  afterPhotosRequired: number;
  sendBeforePhotoLink: boolean;
  /** How a cleaner on a share is paid on a job that needs more than one cleaner. */
  crewPayMode: "share_of_whole" | "split_by_crew";
  /** Extra pay for the lead of a crew, as a percentage of what they would otherwise get. */
  leadPremiumPercent: number;
};

export const POLICY_DEFAULTS: DispatchPolicy = {
  broadcastEnabled: false,
  broadcastSize: 3,
  backupOfferWindowMinutes: 20,
  reminderLeadMinutes: 120,
  contactAfterMinutes: 10,
  alertAfterMinutes: 20,
  noShowAfterMinutes: 40,
  jobAccessGraceHours: 24,
  beforePhotosRequired: 0,
  afterPhotosRequired: 0,
  sendBeforePhotoLink: false,
  crewPayMode: "share_of_whole",
  leadPremiumPercent: 0,
};

export const POLICY_LIMITS: Record<Exclude<keyof DispatchPolicy, "broadcastEnabled" | "sendBeforePhotoLink" | "crewPayMode">, { min: number; max: number; label: string }> = {
  broadcastSize: { min: 2, max: 10, label: "How many cleaners are asked at once" },
  backupOfferWindowMinutes: { min: 5, max: 240, label: "The time a cleaner has to answer a backup offer" },
  reminderLeadMinutes: { min: 15, max: 48 * 60, label: "How long before the start the reminder goes out" },
  contactAfterMinutes: { min: 0, max: 240, label: "The wait before asking a cleaner who has not checked in" },
  alertAfterMinutes: { min: 0, max: 240, label: "The wait before alerting the operator" },
  noShowAfterMinutes: { min: 5, max: 480, label: "The wait before a no-show can be declared" },
  jobAccessGraceHours: { min: 1, max: 168, label: "How long the job link works after the job ends" },
  beforePhotosRequired: { min: 0, max: 20, label: "Before photos required" },
  afterPhotosRequired: { min: 0, max: 20, label: "After photos required" },
  leadPremiumPercent: { min: 0, max: 100, label: "The lead's extra pay" },
};

/** The crew pay rule in the shape the pay calculation takes. */
export function crewPayOf(company: Pick<Doc<"companies">, "dispatchPolicy"> & Partial<Pick<Doc<"companies">, "payTiers">>): CrewPay {
  const policy = dispatchPolicy(company);
  return { mode: policy.crewPayMode, leadPremiumPercent: policy.leadPremiumPercent, tiers: company.payTiers ?? [] };
}

export function dispatchPolicy(company: Pick<Doc<"companies">, "dispatchPolicy">): DispatchPolicy {
  return { ...POLICY_DEFAULTS, ...(company.dispatchPolicy ?? {}) };
}

/** Checks the values the Owner changed and returns them merged over what the company already has. */
export function checkedPolicy(current: Doc<"companies">["dispatchPolicy"], input: Partial<DispatchPolicy>): NonNullable<Doc<"companies">["dispatchPolicy"]> {
  const next: Partial<DispatchPolicy> = { ...(current ?? {}) };
  for (const key of Object.keys(input) as (keyof DispatchPolicy)[]) {
    const value = input[key];
    if (value === undefined) continue;
    if (key === "broadcastEnabled" || key === "sendBeforePhotoLink") {
      next[key] = value === true;
      continue;
    }
    if (key === "crewPayMode") {
      if (value !== "share_of_whole" && value !== "split_by_crew") throw userError("Choose how a crew is paid.");
      next.crewPayMode = value;
      continue;
    }
    const limit = POLICY_LIMITS[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < limit.min || value > limit.max) {
      throw userError(`${limit.label} must be a whole number from ${limit.min} to ${limit.max}.`);
    }
    next[key] = value;
  }
  const merged = { ...POLICY_DEFAULTS, ...next };
  if (!(merged.contactAfterMinutes <= merged.alertAfterMinutes && merged.alertAfterMinutes <= merged.noShowAfterMinutes)) {
    throw userError("The steps run in order: ask the cleaner, then alert the operator, then a no-show. Each wait must be at least as long as the one before.");
  }
  return next;
}
