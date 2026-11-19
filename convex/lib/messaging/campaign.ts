/**
 * The carrier campaign for a cleaning company's texts, built only from what the company submitted through
 * "Set up business texting": its chosen activities, its own samples, its own HELP, STOP and START replies,
 * its own opt-in description, and its own privacy policy and texting terms. Selestial's own privacy policy
 * and terms are never filed for a company: carriers require the policy of the business being registered.
 */
import type { Doc } from "../../_generated/dataModel";
import { describe } from "../texting/plan";
import type { CampaignInput } from "./telnyxAccount";

const LINK = /https?:\/\/\S+/;

/** What the campaign was filed with, as one string, to tell whether a correction needs a new campaign or an update. */
export function campaignShape(row: Pick<Doc<"textingRequests">, "usecase" | "subUsecases" | "activities" | "privacyLink" | "termsLink" | "drafts">): string {
  return JSON.stringify([row.usecase, row.subUsecases ?? [], [...(row.activities ?? [])].sort(), row.privacyLink, row.termsLink, row.drafts?.start_reply, row.drafts?.stop_reply]);
}

export function campaignFor(row: Doc<"textingRequests">, input: { brandId: string; reference: string; webhookURL: string | null }): CampaignInput {
  const name = row.brand.displayName;
  const drafts = row.drafts ?? {};
  const samples = (row.samples ?? []).filter(Boolean).slice(0, 5);
  const linkSample = samples.map((sample) => LINK.exec(sample)?.[0]).find(Boolean);
  return {
    brandId: input.brandId,
    usecase: row.usecase ?? "ACCOUNT_NOTIFICATION",
    ...(row.subUsecases?.length ? { subUsecases: row.subUsecases } : {}),
    description: describe(name, row.activities ?? []),
    messageFlow: drafts.opt_in_flow ?? "",
    sample1: samples[0] ?? "",
    ...(samples[1] ? { sample2: samples[1] } : {}),
    ...(samples[2] ? { sample3: samples[2] } : {}),
    ...(samples[3] ? { sample4: samples[3] } : {}),
    ...(samples[4] ? { sample5: samples[4] } : {}),
    helpMessage: drafts.help_reply ?? "",
    optinMessage: drafts.start_reply ?? "",
    optoutMessage: drafts.stop_reply ?? "",
    helpKeywords: "HELP,INFO",
    optinKeywords: "START,UNSTOP,YES",
    optoutKeywords: "STOP,STOPALL,UNSUBSCRIBE,CANCEL,END,QUIT",
    subscriberOptin: true,
    subscriberOptout: true,
    subscriberHelp: true,
    embeddedLink: !!linkSample,
    ...(linkSample ? { embeddedLinkSample: linkSample } : {}),
    embeddedPhone: false,
    numberPool: false,
    ageGated: false,
    directLending: false,
    termsAndConditions: true,
    privacyPolicyLink: row.privacyLink ?? "",
    termsAndConditionsLink: row.termsLink ?? "",
    referenceId: input.reference,
    ...(input.webhookURL ? { webhookURL: input.webhookURL } : {}),
  };
}

/** What a filed campaign may be corrected with, without filing a new one. */
export function campaignCorrection(row: Doc<"textingRequests">, webhookURL: string | null) {
  const full = campaignFor(row, { brandId: "", reference: "", webhookURL });
  return { sample1: full.sample1, sample2: full.sample2, sample3: full.sample3, sample4: full.sample4, sample5: full.sample5, messageFlow: full.messageFlow, helpMessage: full.helpMessage, ...(webhookURL ? { webhookURL } : {}) };
}
