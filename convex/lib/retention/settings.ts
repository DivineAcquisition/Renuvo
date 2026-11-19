/**
 * How Retention works for one company. Every value is the Owner's, with a default here. A policy the
 * company has not written (its guarantee, its public review page) stays "not set": Retention never
 * invents a guarantee or a cancellation rule. What Retention may do without asking is not in this file:
 * it is the shared permission catalog, like every other agent's.
 */
import type { Doc } from "../../_generated/dataModel";
import { userError } from "../errors";
import { optionalText } from "../text";
import { PLAN_CHANGES, type PlanChange, type RetentionSettingsInput } from "./schema";

export type RetentionSettings = {
  feedbackAfterFirstService: boolean;
  linkDays: number;
  guarantee: { days: number; text: string } | null;
  reviewUrl: string | null;
  renewalLeadDays: number;
  selfService: PlanChange[];
  recoveryDueHours: number;
  quietDays: number;
};

/** What a customer may do from their plan link unless the Owner says otherwise. Cancelling is always offered. */
export const SELF_SERVICE_DEFAULT: PlanChange[] = ["skip_visit", "reschedule_visit", "change_cadence", "pause_service", "resume", "end_service"];

export const RETENTION_DEFAULTS: RetentionSettings = {
  feedbackAfterFirstService: true,
  linkDays: 14,
  guarantee: null,
  reviewUrl: null,
  renewalLeadDays: 60,
  selfService: SELF_SERVICE_DEFAULT,
  recoveryDueHours: 48,
  quietDays: 7,
};

export function retentionSettings(company: Pick<Doc<"companies">, "retention">): RetentionSettings {
  const stored = company.retention ?? {};
  const offered = stored.selfService ?? SELF_SERVICE_DEFAULT;
  return {
    feedbackAfterFirstService: stored.feedbackAfterFirstService ?? RETENTION_DEFAULTS.feedbackAfterFirstService,
    linkDays: stored.linkDays ?? RETENTION_DEFAULTS.linkDays,
    guarantee: stored.guarantee ?? null,
    reviewUrl: stored.reviewUrl ?? null,
    renewalLeadDays: stored.renewalLeadDays ?? RETENTION_DEFAULTS.renewalLeadDays,
    // Ending service is never switched off: cancelling stays as reachable as every other choice.
    selfService: offered.includes("end_service") ? offered : [...offered, "end_service"],
    recoveryDueHours: stored.recoveryDueHours ?? RETENTION_DEFAULTS.recoveryDueHours,
    quietDays: stored.quietDays ?? RETENTION_DEFAULTS.quietDays,
  };
}

const whole = (value: number, low: number, high: number, label: string) => {
  if (!Number.isInteger(value) || value < low || value > high) throw userError(`${label} must be a whole number from ${low} to ${high}.`);
  return value;
};

/** Checks what the Owner entered. Nothing here can change a price, a pay rate or a permission. */
export function checkedSettings(input: RetentionSettingsInput): RetentionSettingsInput {
  const out: RetentionSettingsInput = {};
  if (input.feedbackAfterFirstService !== undefined) out.feedbackAfterFirstService = input.feedbackAfterFirstService;
  if (input.linkDays !== undefined) out.linkDays = whole(input.linkDays, 1, 60, "Days a customer link stays open");
  if (input.guarantee !== undefined) {
    const text = optionalText(input.guarantee.text, "The guarantee", 600);
    if (!text) throw userError("Write the guarantee in the company's own words, or remove it.");
    out.guarantee = { days: whole(input.guarantee.days, 1, 90, "Days the guarantee covers"), text };
  }
  if (input.reviewUrl !== undefined) {
    const url = input.reviewUrl.trim();
    if (!/^https:\/\/[^\s]{4,300}$/.test(url)) throw userError("The review page must be a full https:// address.");
    out.reviewUrl = url;
  }
  if (input.renewalLeadDays !== undefined) out.renewalLeadDays = whole(input.renewalLeadDays, 7, 180, "Days before a renewal");
  if (input.selfService !== undefined) out.selfService = PLAN_CHANGES.filter((change) => input.selfService!.includes(change) || change === "end_service");
  if (input.recoveryDueHours !== undefined) out.recoveryDueHours = whole(input.recoveryDueHours, 1, 24 * 14, "Hours to act on a service concern");
  if (input.quietDays !== undefined) out.quietDays = whole(input.quietDays, 1, 60, "Days to wait for a customer");
  return out;
}
