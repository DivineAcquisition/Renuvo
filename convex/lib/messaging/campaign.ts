/**
 * The carrier filing for a cleaning company's work texts, written from what Selestial actually sends
 * (convex/lib/dispatch/sms.ts) under the company's own name. Nothing here is a promise the product does
 * not keep: no marketing, consent is recorded before any text, and STOP, HELP and START are honoured.
 */
import type { CampaignInput } from "./telnyxAccount";

export const PLATFORM_PRIVACY = "https://www.selestial.io/privacy";
export const PLATFORM_TERMS = "https://www.selestial.io/terms";

/** The wording a cleaner agrees to, offered as the starting point. The Owner may change it within the rules below. */
export function defaultConsentWording(company: string): string {
  return `I agree to receive work texts from ${company} about job offers, confirmations, reminders and check-ins at the number I provided. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out. Consent is not a condition of working with us.`;
}

/** What carriers require any opt-in wording to say. Answers with what is missing, or an empty list. */
export function consentGaps(wording: string, company: string): string[] {
  const text = wording.toLowerCase();
  const gaps: string[] = [];
  if (!text.includes(company.toLowerCase())) gaps.push(`name the business (${company})`);
  if (!/stop/.test(text)) gaps.push("say how to opt out (STOP)");
  if (!/help/.test(text)) gaps.push("say how to get help (HELP)");
  if (!/rates may apply/.test(text)) gaps.push('say "Msg & data rates may apply"');
  if (!/frequency/.test(text)) gaps.push("say how often texts come (for example \"Msg frequency varies\")");
  return gaps;
}

export function campaignFor(input: { brandId: string; company: string; supportEmail: string; consentWording: string; webhookURL: string | null }): Omit<CampaignInput, "brandId"> & { brandId: string } {
  const name = input.company;
  const link = "https://www.selestial.io/c/job/abc123";
  return {
    brandId: input.brandId,
    usecase: "ACCOUNT_NOTIFICATION",
    description: `${name} sends work texts to cleaners on its team who have agreed to receive them: an offer of a cleaning job with its date, area, length and estimated pay, a confirmation when they accept, a reminder before the job, and a request to check in or send an ETA if they have not arrived. No marketing or promotional texts are sent.`,
    messageFlow: `Cleaners agree to work texts when they join the ${name} team, during onboarding, in person or on ${name}'s onboarding form. The consent wording shown to them is kept on file and reads: "${input.consentWording}" Each consent is recorded with the date, the source and the wording shown, and no text is sent to a cleaner without one. Privacy policy: ${PLATFORM_PRIVACY} Terms: ${PLATFORM_TERMS}`,
    sample1: `${name}: job offer. Standard clean, Tue, Mar 2, arrive 10:00 AM to 10:30 AM, about 3 hours. Austin 78701. Solo job. Est. pay $90.00. Answer by 12:00 PM Mon, Mar 1: https://www.selestial.io/c/offer/abc123`,
    sample2: `${name}: you're confirmed for Tue, Mar 2, arrive 10:00 AM to 10:30 AM. Address, instructions, checklist and check-in are here: ${link}`,
    sample3: `${name} reminder: your job is Tue, Mar 2 at 10:00 AM. Open it to check in when you arrive, or to tell us if you're running late: ${link}`,
    sample4: `${name}: we don't have a check-in for your 10:00 AM job yet. Check in, send an ETA, or tell us you can't make it: ${link}/delay`,
    helpMessage: `${name}: work texts about cleaning jobs. For help email ${input.supportEmail}. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.`,
    optinMessage: `${name}: you will receive work texts about job offers, confirmations, reminders and check-ins. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`,
    optoutMessage: `${name}: you will no longer receive texts from ${name}. Reply START to resubscribe.`,
    helpKeywords: "HELP,INFO",
    optinKeywords: "START,UNSTOP,YES",
    optoutKeywords: "STOP,STOPALL,UNSUBSCRIBE,CANCEL,END,QUIT",
    subscriberOptin: true,
    subscriberOptout: true,
    subscriberHelp: true,
    embeddedLink: true,
    embeddedPhone: false,
    numberPool: false,
    ageGated: false,
    directLending: false,
    termsAndConditions: true,
    privacyPolicyLink: PLATFORM_PRIVACY,
    termsAndConditionsLink: PLATFORM_TERMS,
    ...(input.webhookURL ? { webhookURL: input.webhookURL } : {}),
  };
}
