/**
 * Planning a message to an applicant. It goes into the same `messages` table and through the same
 * claim, send and settle steps as every other message (convex/messaging.ts); nothing here sends.
 *
 * One gate decides whether a message may go, and it is asked twice: when the message is planned and
 * again at the moment it is claimed for sending, because an applicant can submit, withdraw or ask a
 * question in between.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { localParts } from "../availability";
import { recordEvent, type Actor } from "../events";
import { emailProvider } from "../messaging/email";
import { messageByKey } from "../messaging/outbox";
import { messagingProvider } from "../messaging/provider";
import { isEmail } from "../text";
import { AWAITING_FORM, USABLE_CONTACT } from "./schema";
import { recruiterSettings, type RecruiterSettings } from "./settings";

export type ApplicantPurpose = Extract<
  Doc<"messages">["purpose"],
  "application_invitation" | "application_follow_up" | "information_request" | "interview_invitation" | "interview_confirmation" | "interview_reminder" | "hiring_offer" | "application_decline" | "urgent_outreach"
>;

const MINUTE = 60_000;

/** The next moment a message may go out: now if inside the company's sending hours, otherwise when they next open. */
export function nextSendTime(now: number, timezone: string, settings: Pick<RecruiterSettings, "sendFromMinute" | "sendUntilMinute" | "sendDays">): number {
  if (settings.sendDays.length === 0 || settings.sendFromMinute >= settings.sendUntilMinute) return now;
  let at = now;
  // Step to each next opening until one is on an allowed day. Eight tries covers a week.
  for (let i = 0; i < 16; i += 1) {
    const local = localParts(at, timezone);
    const allowedDay = settings.sendDays.includes(local.weekday);
    if (allowedDay && local.minute >= settings.sendFromMinute && local.minute < settings.sendUntilMinute) return at;
    if (allowedDay && local.minute < settings.sendFromMinute) at += (settings.sendFromMinute - local.minute) * MINUTE;
    else at += (24 * 60 - local.minute + settings.sendFromMinute) * MINUTE;
  }
  return at;
}

/**
 * Why this message may not go to this applicant now, or null. Deterministic, and the only place that
 * decides it.
 */
export async function sendProblem(ctx: QueryCtx | MutationCtx, application: Doc<"applications">, applicant: Doc<"applicants">, purpose: ApplicantPurpose, settings: RecruiterSettings): Promise<string | null> {
  if (applicant.doNotContact) return "The applicant asked not to be contacted.";
  if (applicant.redactedAt || application.redactedAt) return "This applicant's details were removed.";
  if (application.stage === "withdrawn") return "The applicant withdrew.";
  if (application.stage === "closed" && purpose !== "application_decline") return "The application is closed.";
  if (purpose === "application_invitation" || purpose === "application_follow_up") {
    if (application.submittedAt) return "The application was already submitted.";
    const need = application.needId ? await ctx.db.get(application.needId) : null;
    if (!need) return "The application is not matched to a role.";
    if (need.status !== "open") return `The role is ${need.status}.`;
  }
  if (purpose === "application_follow_up") {
    if (!AWAITING_FORM.includes(application.stage)) return "The applicant is not waiting on the application form.";
    if (application.withPersonSince) return "A person has taken this application over.";
    if (application.questionSince) return "The applicant asked something that has not been answered yet.";
    if (application.followUpsSent >= settings.maxFollowUps) return "The most reminders allowed have been sent.";
  }
  return null;
}

function emailProblem(application: Doc<"applications">, settings: RecruiterSettings): string | null {
  const contact = application.contact;
  if (!USABLE_CONTACT.includes(contact.status) || !contact.address || !isEmail(contact.address)) return "There is no address this applicant can be written to.";
  if (contact.bouncedAt) return "The last email to this address bounced.";
  if (!settings.replyTo) return "No reply address is set, so an applicant's reply would reach nobody. Set the hiring inbox in the Playbook.";
  return null;
}

export type PlannedApplicantMessage = {
  company: Doc<"companies">;
  application: Doc<"applications">;
  applicant: Doc<"applicants">;
  purpose: ApplicantPurpose;
  channel: "email" | "sms";
  subject?: string;
  /** With "{link}" where the link goes. */
  body: string;
  /** `undefined`: the message has no link. `null`: it needs one and none could be issued. */
  link?: Doc<"applicantLinks"> | null;
  dedupeKey: string;
  actor: Actor;
  /** Sent at once instead of waiting for sending hours: for an answer to something the applicant just did. */
  immediate?: boolean;
};

/** Plans one message and hands it to the sender. Asked twice for the same message, it answers with the first. */
export async function queueApplicantMessage(ctx: MutationCtx, planned: PlannedApplicantMessage): Promise<Doc<"messages">> {
  const existing = await messageByKey(ctx, planned.company._id, planned.dedupeKey);
  if (existing) return existing;
  const { application, applicant, company } = planned;
  const settings = recruiterSettings(company);
  const email = planned.channel === "email";
  const provider = email ? emailProvider() : messagingProvider();
  const to = email ? application.contact.address : applicant.smsConsent ? `+${applicant.smsConsent.phone}` : undefined;

  let problem = await sendProblem(ctx, application, applicant, planned.purpose, settings);
  if (!problem && email) problem = emailProblem(application, settings);
  if (!problem && !email && !applicant.smsConsent) problem = "The applicant has not given permission to be texted.";
  if (!problem && planned.link === null) problem = "Applicant links are not set up, so there was no link to send.";
  if (!problem && !provider) problem = email ? "Email is not connected." : "Text messaging is not connected.";

  const now = Date.now();
  const messageId: Id<"messages"> = await ctx.db.insert("messages", {
    companyId: company._id,
    purpose: planned.purpose,
    channel: planned.channel,
    subject: planned.subject,
    replyTo: email ? (settings.replyTo ?? undefined) : undefined,
    applicationId: application._id,
    applicantId: applicant._id,
    applicantLinkId: planned.link?._id,
    to: problem ? undefined : to,
    body: planned.body,
    dedupeKey: planned.dedupeKey,
    status: problem ? "not_sent" : "queued",
    attempts: 0,
    provider: provider?.name,
    problem: problem ?? undefined,
    queuedAt: now,
  });
  await recordEvent(ctx, {
    companyId: company._id,
    type: problem ? "message.not_sent" : "message.queued",
    actor: planned.actor,
    subject: { table: "messages", id: messageId },
    data: { purpose: planned.purpose, channel: planned.channel, applicationId: application._id },
  });
  if (!problem) {
    const at = planned.immediate ? now : nextSendTime(now, company.timezone, settings);
    await ctx.scheduler.runAt(at, internal.messaging.deliver, { messageId });
  }
  return (await ctx.db.get(messageId))!;
}

export async function applicationMessages(ctx: QueryCtx | MutationCtx, application: Pick<Doc<"applications">, "_id" | "companyId">): Promise<Doc<"messages">[]> {
  return ctx.db
    .query("messages")
    .withIndex("by_company_application", (q) => q.eq("companyId", application.companyId).eq("applicationId", application._id))
    .take(200);
}
