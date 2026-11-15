/**
 * From a recorded application to one invitation, and the reminders after it.
 *
 * `routeApplication` is the whole decision, in code, and can be run any number of times: it looks at
 * the record as it is now and does the one next thing. It is what runs after intake, after a person
 * corrects a contact or a role, after a role reopens, and after a retry.
 *
 * Review first. An invitation goes out without a person only when the Owner chose automatic
 * invitations AND raised the permission above Propose AND every item in `autoEligible` holds.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { requestApproval } from "../approvalQueue";
import { authorityFor } from "../authority";
import type { CarriedOut } from "../dispatch/workflow";
import type { Actor } from "../events";
import { messageByKey } from "../messaging/outbox";
import { when } from "../time";
import { askPerson, firstName, isActive, RECRUITER, setNextAction, setStage, settleTask, SYSTEM } from "./applications";
import { CONTACT_WORDS, contactNextStep } from "./contact";
import { applicantLinkState, issueApplicantLink, liveApplicantLink } from "./links";
import { applicationMessages, queueApplicantMessage, sendProblem } from "./outbox";
import { AWAITING_FORM, USABLE_CONTACT, type Stage } from "./schema";
import { DAY, HOUR, recruiterSettings } from "./settings";
import { followUpEmail, followUpText, invitationEmail, partsFor } from "./words";

export const SEND_INVITATION = "recruiter.send_invitation";
export const FOLLOW_UP = "recruiter.follow_up";

const BEFORE_INVITE: readonly Stage[] = ["received", "contact_needed", "invitation_awaiting_approval"];
export const inviteKey = (applicationId: Id<"applications">) => `invite:${applicationId}`;

async function load(ctx: QueryCtx | MutationCtx, applicationId: Id<"applications">) {
  const application = await ctx.db.get(applicationId);
  const applicant = application ? await ctx.db.get(application.applicantId) : null;
  const company = application ? await ctx.db.get(application.companyId) : null;
  if (!application || !applicant || !company) return null;
  const need = application.needId ? await ctx.db.get(application.needId) : null;
  return { application, applicant, company, need: need && need.companyId === company._id ? need : null };
}

/**
 * The invitation emails planned for an application, oldest first, and whether one of them still stands.
 * One that failed, bounced or could not be planned never reached anyone, so it does not stand. One whose
 * fate is unknown does: it is not sent again without a person.
 */
export async function invitationState(ctx: QueryCtx | MutationCtx, application: Pick<Doc<"applications">, "_id" | "companyId">): Promise<{ all: Doc<"messages">[]; standing: Doc<"messages"> | null; last: Doc<"messages"> | null }> {
  const all = (await applicationMessages(ctx, application)).filter((message) => message.purpose === "application_invitation" && message.channel === "email").sort((a, b) => a.queuedAt - b.queuedAt);
  const standing = all.find((message) => message.status !== "failed" && message.status !== "not_sent") ?? null;
  return { all, standing, last: all.at(-1) ?? null };
}

/** Whether a message about this application was flagged for a person, for example because it was forwarded. */
async function flagged(ctx: QueryCtx | MutationCtx, application: Doc<"applications">): Promise<boolean> {
  const messages = await ctx.db
    .query("sourceMessages")
    .withIndex("by_company_application", (q) => q.eq("companyId", application.companyId).eq("applicationId", application._id))
    .take(50);
  return messages.some((message) => message.flag !== undefined);
}

/** Everything that must hold for an invitation to go without a person looking first. */
export async function autoEligible(ctx: QueryCtx | MutationCtx, application: Doc<"applications">, applicant: Doc<"applicants">): Promise<{ ok: boolean; why: string }> {
  if (application.source !== "indeed" && application.source !== "ziprecruiter") return { ok: false, why: "The application did not come as a job board's own notification." };
  if (!USABLE_CONTACT.includes(application.contact.status)) return { ok: false, why: "The applicant's address is not settled." };
  if (application.contact.resolvedBy === undefined && application.contact.evidence.filter((entry) => entry.kind === "direct" || entry.kind === "relay").length !== 1) return { ok: false, why: "More than one address was found." };
  if (applicant.possibleDuplicateOf) return { ok: false, why: "This may be a person already on file." };
  if (!firstName(applicant.name)) return { ok: false, why: "The applicant's name is not clear." };
  if (await flagged(ctx, application)) return { ok: false, why: "A message about this application was flagged for review." };
  return { ok: true, why: "A job board's notification, one clear address, a clear name, and an open role." };
}

/** Sends the invitation: one link, one email, once. The same call again returns the same message. */
export async function sendInvitation(ctx: MutationCtx, applicationId: Id<"applications">, actor: Actor, options: { /** A person asked for it to be sent again. */ again?: boolean } = {}): Promise<CarriedOut> {
  const found = await load(ctx, applicationId);
  if (!found) return { ok: false, detail: "The application no longer exists." };
  const { application, applicant, company, need } = found;
  const invitations = await invitationState(ctx, application);
  if (invitations.standing && !options.again) return { ok: true, detail: invitations.standing.status === "unconfirmed" ? "An invitation was started and never confirmed. It is not sent again without a person." : "The invitation was already sent." };
  const settings = recruiterSettings(company);
  const stages = options.again ? [...BEFORE_INVITE, ...AWAITING_FORM] : BEFORE_INVITE;
  if (!stages.includes(application.stage)) return { ok: false, detail: `The application is already ${application.stage.replace(/_/g, " ")}.` };
  const gate = await sendProblem(ctx, application, applicant, "application_invitation", settings);
  if (gate || !need) return { ok: false, detail: gate ?? "The application is not matched to a role." };
  if (!USABLE_CONTACT.includes(application.contact.status)) return { ok: false, detail: CONTACT_WORDS[application.contact.status] };

  const link = await issueApplicantLink(ctx, { application, purpose: "apply", expiresAt: Date.now() + settings.linkTtlDays * DAY, actor });
  const email = invitationEmail({ ...partsFor(company, settings.fromName, applicant, need.title), source: application.source });
  // Every earlier attempt stays on the record. The next one is planned under its own key, so asking twice for the same attempt is still one email.
  const dedupeKey = invitations.last ? `${inviteKey(application._id)}:after:${invitations.last._id}` : inviteKey(application._id);
  const message = await queueApplicantMessage(ctx, { company, application, applicant, purpose: "application_invitation", channel: "email", subject: email.subject, body: email.body, link, dedupeKey, actor });
  if (message.status === "not_sent") {
    await setNextAction(ctx, application, { what: `The invitation could not be sent. ${message.problem ?? ""}`.trim(), by: "owner", dueAt: Date.now() + DAY });
    await askPerson(ctx, application, { what: "invitation", title: `Invitation not sent to ${applicant.name ?? "an applicant"}`, question: `${message.problem ?? "The invitation could not be sent."} Fix it, then send the invitation again.`, dueAt: Date.now() + DAY, completionCondition: "The invitation was sent, or the application was closed" });
    return { ok: false, detail: message.problem ?? "The invitation could not be sent." };
  }
  await settleTask(ctx, application, "invitation", "The invitation was sent.");
  await setNextAction(ctx, application, { what: "Send the application invitation", by: "recruiter", dueAt: Date.now() + DAY });
  return { ok: true, detail: `The invitation to ${applicant.name ?? "the applicant"} was handed to the email service.` };
}

/** Does the one next thing for an application that has not been invited yet. Safe to run again at any time. */
export async function routeApplication(ctx: MutationCtx, applicationId: Id<"applications">): Promise<void> {
  const found = await load(ctx, applicationId);
  if (!found) return;
  const { applicant, company, need } = found;
  let application = found.application;
  if (!isActive(application) || !BEFORE_INVITE.includes(application.stage) || application.withPersonSince) return;
  if ((await invitationState(ctx, application)).standing) return;
  const soon = Date.now() + DAY;
  const who = applicant.name ?? "An applicant";

  if (!need) {
    await setNextAction(ctx, application, { what: `Match this application to a role. The notification said "${application.roleSeen ?? "no role"}".`, by: "owner", dueAt: soon });
    await askPerson(ctx, application, { what: "role", title: `Which role did ${who} apply for?`, question: `The notification named "${application.roleSeen ?? "no role"}", which matches no hiring need, or more than one. Choose the role, or close the application.`, dueAt: soon, completionCondition: "The application is matched to a role or closed" });
    return;
  }
  if (need.status !== "open") {
    await setNextAction(ctx, application, { what: `${need.title} is ${need.status}. No invitation is sent while it is.`, by: "owner", dueAt: soon });
    await askPerson(ctx, application, { what: "role", title: `${who} applied for ${need.title}, which is ${need.status}`, question: `No invitation goes out for a role that is ${need.status}. Reopen the role, move the application to another role, or close it.`, dueAt: soon, completionCondition: "The role is open again, or the application was moved or closed" });
    return;
  }
  await settleTask(ctx, application, "role", "The application is matched to an open role.");

  if (!USABLE_CONTACT.includes(application.contact.status) || application.contact.bouncedAt) {
    const words = application.contact.bouncedAt ? "The last email to this address bounced." : CONTACT_WORDS[application.contact.status];
    application = await setStage(ctx, application, "contact_needed", RECRUITER, { nextAction: { what: `${words} ${contactNextStep(application.contact.status)}`, by: "owner", dueAt: soon } });
    await askPerson(ctx, application, { what: "contact", title: `Contact needed for ${who} (${need.title})`, question: `${words} ${contactNextStep(application.contact.status)}`, dueAt: soon, completionCondition: "A usable address is recorded, or the application was closed" });
    return;
  }
  await settleTask(ctx, application, "contact", "A usable address is recorded.");
  if (applicant.doNotContact) {
    await setNextAction(ctx, application, { what: "The applicant asked not to be contacted. Close the application, or record that they changed their mind.", by: "owner", dueAt: soon });
    return;
  }

  const authority = await authorityFor(ctx, company._id, SEND_INVITATION);
  if (authority.kind !== "level" || authority.level === "off") {
    await setNextAction(ctx, application, { what: authority.kind === "paused" ? "Recruiter is paused. Send the invitation yourself, or resume Recruiter." : "Recruiter may not send invitations. Send it yourself, or change the permission.", by: "owner", dueAt: soon });
    return;
  }
  const settings = recruiterSettings(company);
  const eligible = await autoEligible(ctx, application, applicant);
  if (settings.invitationMode === "auto" && authority.level !== "propose" && eligible.ok) {
    if (application.stage !== "received") application = await setStage(ctx, application, "received", RECRUITER, { nextAction: application.nextAction });
    await sendInvitation(ctx, application._id, RECRUITER);
    return;
  }

  // One pending approval per application, however often this runs.
  const pending = application.invitationApprovalId ? await ctx.db.get(application.invitationApprovalId) : null;
  if (pending?.status === "pending") return;
  if (pending && pending.status !== "expired" && application.stage === "invitation_awaiting_approval") return;
  const decideBy = Date.now() + settings.decideWithinHours * HOUR;
  const address = application.contact.address!;
  const approvalId = await requestApproval(ctx, {
    companyId: company._id,
    action: SEND_INVITATION,
    summary: `Email ${who} the application link for ${need.title}`,
    reason: `${who} applied for ${need.title}${application.source === "indeed" || application.source === "ziprecruiter" ? ` through ${application.source === "indeed" ? "Indeed" : "ZipRecruiter"}` : ""}. ${CONTACT_WORDS[application.contact.status]} ${settings.invitationMode === "auto" && !eligible.ok ? `Not sent automatically: ${eligible.why}` : "Invitations are reviewed before they go."}`,
    authorizes: `One email to ${address} with a link to ${company.name}'s application for ${need.title}, and the reminders your Playbook allows. Nothing else.`,
    ifWaiting: `Nothing is sent. If nobody decides by ${when(decideBy, Date.now(), company.timezone)}, the application stays open and comes back to you.`,
    decideBy,
    proposal: { kind: "send_invitation", applicationId: application._id },
    about: { table: "applications", id: application._id },
  });
  await setStage(ctx, application, "invitation_awaiting_approval", RECRUITER, { invitationApprovalId: approvalId, nextAction: { what: "Approve, change or skip the invitation", by: "owner", dueAt: decideBy } });
}

/** A person decided an invitation proposal. */
export async function afterInvitationDecision(ctx: MutationCtx, approval: Doc<"approvals">, applicationId: Id<"applications">, decision: "approved" | "changed" | "skipped", decidedBy: Actor): Promise<CarriedOut | null> {
  const application = await ctx.db.get(applicationId);
  if (!application || application.companyId !== approval.companyId) return decision === "approved" ? { ok: false, detail: "The application no longer exists." } : null;
  if (decision === "approved") return sendInvitation(ctx, applicationId, decidedBy);
  if (!isActive(application) || application.stage !== "invitation_awaiting_approval") return null;
  if (decision === "changed") {
    await setStage(ctx, application, "received", decidedBy, { withPersonSince: Date.now(), nextAction: { what: "You changed Recruiter's invitation. Invite the applicant your way, or hand the application back to Recruiter.", by: "owner", dueAt: Date.now() + DAY } });
  } else {
    await setStage(ctx, application, "received", decidedBy, { withPersonSince: Date.now(), nextAction: { what: "You skipped the invitation. Close the application, or hand it back to Recruiter to invite later.", by: "owner", dueAt: Date.now() + DAY } });
  }
  return null;
}

/** Nobody decided in time. Nothing was sent, and the application goes back to be proposed again. */
export async function afterInvitationExpiry(ctx: MutationCtx, applicationId: Id<"applications">): Promise<void> {
  const application = await ctx.db.get(applicationId);
  if (!application || application.stage !== "invitation_awaiting_approval") return;
  await setStage(ctx, application, "received", SYSTEM, { nextAction: { what: "The invitation was not decided in time. Recruiter will ask again.", by: "owner", dueAt: Date.now() + DAY } });
  await routeApplication(ctx, applicationId);
}

// ── Reminders ────────────────────────────────────────────────────────────────────────────────────

export const followUpKey = (applicationId: Id<"applications">, attempt: number) => `followup:${applicationId}:${attempt}`;

/** Queues reminder number `attempt` if every rule still allows it. Returns why not, otherwise. */
export async function sendFollowUp(ctx: MutationCtx, applicationId: Id<"applications">, attempt: number, actor: Actor): Promise<CarriedOut> {
  const found = await load(ctx, applicationId);
  if (!found || !found.need) return { ok: false, detail: "The application no longer exists." };
  const { application, applicant, company, need } = found;
  const settings = recruiterSettings(company);
  if (attempt !== application.followUpsSent + 1) return { ok: false, detail: "This reminder was already sent, or is out of turn." };
  const gate = await sendProblem(ctx, application, applicant, "application_follow_up", settings);
  if (gate) return { ok: false, detail: gate };
  const link = await liveApplicantLink(ctx, application, "apply");
  if (!link) return { ok: false, detail: "The application link has expired or was revoked." };
  const parts = partsFor(company, settings.fromName, applicant, need.title);
  const email = followUpEmail(parts);
  const message = await queueApplicantMessage(ctx, { company, application, applicant, purpose: "application_follow_up", channel: "email", subject: email.subject, body: email.body, link, dedupeKey: followUpKey(application._id, attempt), actor });
  // A text goes too only where the applicant gave permission to be texted. A phone number alone is not permission.
  if (applicant.smsConsent && message.status !== "not_sent") {
    await queueApplicantMessage(ctx, { company, application, applicant, purpose: "application_follow_up", channel: "sms", body: followUpText(parts), link, dedupeKey: `${followUpKey(application._id, attempt)}:sms`, actor });
  }
  return message.status === "not_sent" ? { ok: false, detail: message.problem ?? "The reminder could not be sent." } : { ok: true, detail: `Reminder ${attempt} was handed to the email service.` };
}

/** Run on a schedule: looks at applicants who still owe the form and does what the reminder rules say. */
export async function followUpSweep(ctx: MutationCtx, now: number): Promise<number> {
  let acted = 0;
  for (const stage of AWAITING_FORM) {
    const rows = await ctx.db
      .query("applications")
      .withIndex("by_stage_invited", (q) => q.eq("stage", stage).gt("invitedAt", 0))
      .take(500);
    for (const application of rows) {
      const found = await load(ctx, application._id);
      if (!found || !found.need || !application.invitedAt) continue;
      const { applicant, company } = found;
      const settings = recruiterSettings(company);
      const attempt = application.followUpsSent + 1;
      const gap = settings.followUpHours[attempt - 1];
      const link = await liveApplicantLink(ctx, application, "apply");
      const linkOpen = link !== null && applicantLinkState(link, now) === "active";

      if (attempt > settings.maxFollowUps || gap === undefined || !linkOpen) {
        // Silence is not a rejection. When reminders run out, or the link closes, a person decides what happens.
        const lastAt = application.invitedAt + (settings.followUpHours[settings.maxFollowUps - 1] ?? 0) * HOUR;
        if ((!linkOpen || now >= lastAt + 2 * DAY) && !application.withPersonSince && !application.questionSince && application.nextAction?.by !== "owner") {
          const what = linkOpen ? `No finished application after ${application.followUpsSent} reminder${application.followUpsSent === 1 ? "" : "s"}.` : "The application link has closed and the form was not finished.";
          await setNextAction(ctx, application, { what: `${what} Decide: send a new link, reach them another way, or close the application.`, by: "owner", dueAt: now + 3 * DAY });
          await askPerson(ctx, application, { what: "decision", title: `${applicant.name ?? "An applicant"} has not finished the application`, question: `${what} Not answering is not a no. Send a new link, reach them another way, or close the application.`, dueAt: now + 3 * DAY, completionCondition: "A person decided what happens to this application" });
          acted += 1;
        }
        continue;
      }
      if (now < application.invitedAt + gap * HOUR) continue;
      if (await sendProblem(ctx, application, applicant, "application_follow_up", settings)) continue;
      if (await messageByKey(ctx, company._id, followUpKey(application._id, attempt))) continue;

      const authority = await authorityFor(ctx, company._id, FOLLOW_UP);
      if (authority.kind !== "level" || authority.level === "off") continue;
      if (authority.level !== "propose") {
        await sendFollowUp(ctx, application._id, attempt, RECRUITER);
        acted += 1;
        continue;
      }
      const open = await ctx.db
        .query("approvals")
        .withIndex("by_company_status_decideBy", (q) => q.eq("companyId", company._id).eq("status", "pending"))
        .take(500);
      if (open.some((row) => row.proposal?.kind === "send_follow_up" && row.proposal.applicationId === application._id)) continue;
      const decideBy = now + settings.decideWithinHours * HOUR;
      await requestApproval(ctx, {
        companyId: company._id,
        action: FOLLOW_UP,
        summary: `Remind ${applicant.name ?? "an applicant"} to finish the ${found.need.title} application (reminder ${attempt} of ${settings.maxFollowUps})`,
        reason: `The invitation was delivered ${when(application.invitedAt, now, company.timezone)} and the application has not been submitted.`,
        authorizes: `One reminder email to ${application.contact.address ?? "the applicant"}${applicant.smsConsent ? ", and one text" : ""}. Nothing else.`,
        ifWaiting: "No reminder is sent.",
        decideBy,
        proposal: { kind: "send_follow_up", applicationId: application._id, attempt },
        about: { table: "applications", id: application._id },
      });
      acted += 1;
    }
  }
  return acted;
}
