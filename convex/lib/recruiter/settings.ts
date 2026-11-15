/** Recruiter's settings for a company: the Owner's values over the defaults here. */
import type { Doc } from "../../_generated/dataModel";
import type { Source } from "./schema";

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

export type RecruiterSettings = {
  invitationMode: "review" | "auto";
  followUpHours: number[];
  maxFollowUps: number;
  sendFromMinute: number;
  sendUntilMinute: number;
  sendDays: number[];
  fromName: string;
  replyTo: string | null;
  verifiedRelays: Source[];
  linkTtlDays: number;
  offerTtlDays: number;
  retentionDays: number;
  interviewMinutes: number;
  interviewReminderHours: number;
  decideWithinHours: number;
  onboardingRequirements: { key: string; label: string }[];
  recruitingRules: string | null;
  communicationPolicy: string | null;
  escalationRules: string | null;
};

/** What a new worker needs before a person may mark them ready, unless the Owner sets their own list. */
export const DEFAULT_REQUIREMENTS = [
  { key: "agreement", label: "Agreement completed" },
  { key: "documents", label: "Required documents checked by a person" },
  { key: "training", label: "Training completed" },
  { key: "equipment", label: "Equipment and supplies ready" },
  { key: "payment_setup", label: "Payment details set up" },
];

export function recruiterSettings(company: Pick<Doc<"companies">, "name" | "recruiter">): RecruiterSettings {
  const own = company.recruiter ?? {};
  const followUpHours = (own.followUpHours ?? [48, 120]).filter((hours) => Number.isFinite(hours) && hours > 0).sort((a, b) => a - b);
  return {
    invitationMode: own.invitationMode ?? "review",
    followUpHours,
    maxFollowUps: Math.max(0, Math.min(own.maxFollowUps ?? followUpHours.length, followUpHours.length)),
    sendFromMinute: own.sendFromMinute ?? 9 * 60,
    sendUntilMinute: own.sendUntilMinute ?? 18 * 60,
    sendDays: own.sendDays ?? [1, 2, 3, 4, 5],
    fromName: own.fromName?.trim() || `${company.name} Hiring Team`,
    replyTo: own.replyTo?.trim().toLowerCase() || null,
    verifiedRelays: own.verifiedRelays ?? [],
    linkTtlDays: own.linkTtlDays ?? 14,
    offerTtlDays: own.offerTtlDays ?? 7,
    retentionDays: own.retentionDays ?? 365,
    interviewMinutes: own.interviewMinutes ?? 30,
    interviewReminderHours: own.interviewReminderHours ?? 24,
    decideWithinHours: own.decideWithinHours ?? 48,
    onboardingRequirements: own.onboardingRequirements?.length ? own.onboardingRequirements : DEFAULT_REQUIREMENTS,
    recruitingRules: own.recruitingRules ?? null,
    communicationPolicy: own.communicationPolicy ?? null,
    escalationRules: own.escalationRules ?? null,
  };
}
