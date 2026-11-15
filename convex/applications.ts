/**
 * Applicants and Screening, as a person sees and works them. Reads are for any member of the company.
 * Changes that decide something about a person (the contact to use, the role, a decision, closing,
 * removing their data) are for Owners and Managers.
 */
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyMutation, companyQuery, managerMutation, managerQuery, type MemberAccess } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { askPerson, closeApplication, isActive, setNextAction, setStage, settleTask, withdrawApplication } from "./lib/recruiter/applications";
import { CONTACT_WORDS } from "./lib/recruiter/contact";
import { sendDecline } from "./lib/recruiter/decisions";
import { answerWords, completion, formFields } from "./lib/recruiter/form";
import { startInterview } from "./lib/recruiter/interviews";
import { routeApplication, sendInvitation } from "./lib/recruiter/invitations";
import { siteOrigin, tokenFor } from "./lib/dispatch/links";
import { applicantLinkPath, liveApplicantLink, revokeApplicationLinks } from "./lib/recruiter/links";
import { normalizePhone } from "./lib/recruiter/mail";
import { applicationMessages } from "./lib/recruiter/outbox";
import { redactApplicant } from "./lib/recruiter/retention";
import { closureReasonValidator, stageValidator, STAGES, type Stage } from "./lib/recruiter/schema";
import { latestScreening, requestInformation, runScreening } from "./lib/recruiter/screening";
import { DAY } from "./lib/recruiter/settings";
import { email, optionalText, text } from "./lib/text";

type Ctx = QueryCtx & MemberAccess;

async function row(ctx: Ctx, application: Doc<"applications">) {
  const applicant = await ctx.db.get(application.applicantId);
  const need = application.needId ? await ctx.db.get(application.needId) : null;
  return {
    applicationId: application._id,
    applicantId: application.applicantId,
    name: applicant?.name ?? null,
    role: need?.title ?? null,
    roleSeen: application.roleSeen ?? null,
    roleStatus: need?.status ?? null,
    source: application.source,
    stage: application.stage,
    appliedAt: application.appliedAt,
    contact: { status: application.contact.status, words: CONTACT_WORDS[application.contact.status], address: application.contact.address ?? null, bounced: application.contact.bouncedAt !== undefined },
    completion: { invitedAt: application.invitedAt ?? null, startedAt: application.formStartedAt ?? null, submittedAt: application.submittedAt ?? null },
    nextAction: application.nextAction ?? null,
    withPerson: application.withPersonSince !== undefined,
    waitingOnReply: application.questionSince !== undefined,
    closure: application.closure ?? null,
    detailsRemoved: application.redactedAt !== undefined,
  };
}

/** Applicants: every application, by stage, with who has the next action and when it is due. */
export const list = companyQuery({
  args: { stage: v.optional(stageValidator), needId: v.optional(v.id("hiringNeeds")) },
  handler: async (ctx, args) => {
    const out = [];
    for (const stage of args.stage ? [args.stage] : (STAGES as readonly Stage[])) {
      const rows = await ctx.db
        .query("applications")
        .withIndex("by_company_stage", (q) => q.eq("companyId", ctx.companyId).eq("stage", stage))
        .order("desc")
        .take(200);
      for (const application of rows) if (!args.needId || application.needId === args.needId) out.push(await row(ctx, application));
    }
    return out;
  },
});

/** One application with everything behind it: evidence, the form, the conversation, screening, and what is open. */
export const get = companyQuery({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const application = await owned(ctx, args.applicationId);
    const applicant = await ctx.db.get(application.applicantId);
    const need = application.needId ? await ctx.db.get(application.needId) : null;
    const session = await ctx.db.query("formSessions").withIndex("by_company_application", (q) => q.eq("companyId", ctx.companyId).eq("applicationId", application._id)).first();
    const fields = need ? formFields(need) : [];
    const inbound = await ctx.db.query("sourceMessages").withIndex("by_company_application", (q) => q.eq("companyId", ctx.companyId).eq("applicationId", application._id)).take(100);
    const outbound = await applicationMessages(ctx, application);
    const attachments = await ctx.db.query("applicantAttachments").withIndex("by_company_application", (q) => q.eq("companyId", ctx.companyId).eq("applicationId", application._id)).take(20);
    const screening = await latestScreening(ctx, application);
    const interviews = await ctx.db.query("interviews").withIndex("by_company_application", (q) => q.eq("companyId", ctx.companyId).eq("applicationId", application._id)).take(20);
    const offers = await ctx.db.query("hiringOffers").withIndex("by_company_application", (q) => q.eq("companyId", ctx.companyId).eq("applicationId", application._id)).take(20);
    const handoff = await ctx.db.query("onboardingHandoffs").withIndex("by_company_application", (q) => q.eq("companyId", ctx.companyId).eq("applicationId", application._id)).first();
    const decisions = await ctx.db.query("hiringDecisions").withIndex("by_company_application", (q) => q.eq("companyId", ctx.companyId).eq("applicationId", application._id)).take(50);
    const conversation = [
      // What is recorded about a sent message is what the provider reported. Nothing says an applicant opened or read anything.
      ...outbound.map((message) => ({ direction: "out" as const, at: message.queuedAt, purpose: message.purpose, channel: message.channel ?? "sms", subject: message.subject ?? null, status: message.status, sentAt: message.sentAt ?? null, deliveredAt: message.deliveredAt ?? null, bouncedAt: message.bouncedAt ?? null, problem: message.problem ?? null })),
      ...inbound.map((message) => ({ direction: "in" as const, at: message.receivedAt, classification: message.classification, classifiedBy: message.classifiedBy, source: message.source ?? null, subject: message.subject ?? null, excerpt: message.excerpt ?? null, flag: message.flag ?? null, attachments: message.attachments ?? [] })),
    ].sort((a, b) => a.at - b.at);
    return {
      ...(await row(ctx, application)),
      applicant: applicant ? { name: applicant.name ?? null, email: applicant.email ?? null, phone: applicant.phone ?? null, location: applicant.location ?? null, mayBeTexted: applicant.smsConsent !== undefined, doNotContact: applicant.doNotContact ?? null, possibleDuplicateOf: applicant.possibleDuplicateOf ?? null } : null,
      contactEvidence: application.contact.evidence,
      facts: application.facts,
      form: session ? { ...completion(fields, session.answers), savedAt: session.savedAt, submittedAt: session.submittedAt ?? null, answers: fields.map((field) => ({ key: field.key, label: field.label, answer: answerWords(session.answers[field.key]) })) } : null,
      attachments: attachments.map((file) => ({ attachmentId: file._id, kind: file.kind, fileName: file.fileName, size: file.size, uploadedAt: file.uploadedAt, verified: false as const })),
      conversation,
      remindersSent: application.followUpsSent,
      screening,
      interviews,
      offers,
      handoff,
      decisions,
    };
  },
});

/** A short-lived address for one of the applicant's files, for an Owner or Manager. */
export const attachmentUrl = managerQuery({
  args: { attachmentId: v.id("applicantAttachments") },
  handler: async (ctx, args) => ctx.storage.getUrl((await owned(ctx, args.attachmentId)).storageId),
});

/** Screening: submitted applications with their criteria, evidence, gaps and recommendation. */
export const screeningQueue = companyQuery({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const stage of ["application_submitted", "screening"] as const) {
      const rows = await ctx.db
        .query("applications")
        .withIndex("by_company_stage", (q) => q.eq("companyId", ctx.companyId).eq("stage", stage))
        .take(200);
      for (const application of rows) out.push({ ...(await row(ctx, application)), screening: await latestScreening(ctx, application) });
    }
    return out;
  },
});

// ── A person steps in ────────────────────────────────────────────────────────────────────────────

/** Records the address to use: one of those found, or one the person looked up on the job board. */
export const resolveContact = managerMutation({
  args: { applicationId: v.id("applications"), address: v.string() },
  handler: async (ctx, args) => {
    const application = await owned(ctx, args.applicationId);
    if (!isActive(application)) throw userError("This application has ended.");
    const address = email(args.address, "The address");
    const known = application.contact.evidence.some((entry) => entry.address === address);
    const evidence = known ? application.contact.evidence : [...application.contact.evidence, { address, kind: "direct" as const, where: `entered by ${ctx.member.name}` }];
    await ctx.db.patch(application._id, { contact: { status: "direct", address, evidence, resolvedBy: ctx.member._id } });
    const applicant = await ctx.db.get(application.applicantId);
    if (applicant && !applicant.email) await ctx.db.patch(applicant._id, { email: address });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "application.contact_resolved", actor: byMember(ctx), subject: { table: "applications", id: application._id }, data: { fromEvidence: known } });
    await settleTask(ctx, application, "contact", "A person recorded the address to use.", byMember(ctx));
    if (application.stage === "invited" || application.stage === "application_started") return null;
    await routeApplication(ctx, application._id);
    return null;
  },
});

/** Matches the application to a role when the notification's wording did not. */
export const assignRole = managerMutation({
  args: { applicationId: v.id("applications"), needId: v.id("hiringNeeds") },
  handler: async (ctx, args) => {
    const application = await owned(ctx, args.applicationId);
    const need = await owned(ctx, args.needId);
    if (!isActive(application) || application.submittedAt) throw userError("The role can be changed only before the application is submitted.");
    const theirs = await ctx.db
      .query("applications")
      .withIndex("by_company_applicant", (q) => q.eq("companyId", ctx.companyId).eq("applicantId", application.applicantId))
      .take(50);
    if (theirs.some((other) => other._id !== application._id && other.needId === need._id && isActive(other))) throw userError("This person already has an open application for that role.");
    await ctx.db.patch(application._id, { needId: need._id });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "application.role_assigned", actor: byMember(ctx), subject: { table: "applications", id: application._id } });
    await settleTask(ctx, application, "role", `Matched to ${need.title}.`, byMember(ctx));
    await routeApplication(ctx, application._id);
    return null;
  },
});

/** A person takes the application over. Recruiter sends nothing by itself until it is handed back. */
export const takeOver = managerMutation({
  args: { applicationId: v.id("applications"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const application = await owned(ctx, args.applicationId);
    if (!isActive(application)) throw userError("This application has ended.");
    await ctx.db.patch(application._id, { withPersonSince: Date.now(), nextAction: { what: optionalText(args.note, "The note", 300) ?? `${ctx.member.name} is handling this application.`, by: "owner", dueAt: Date.now() + 2 * DAY } });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "application.taken_over", actor: byMember(ctx), subject: { table: "applications", id: application._id } });
    return null;
  },
});

export const handBack = managerMutation({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const application = await owned(ctx, args.applicationId);
    if (!isActive(application)) throw userError("This application has ended.");
    await ctx.db.patch(application._id, { withPersonSince: undefined });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "application.handed_back", actor: byMember(ctx), subject: { table: "applications", id: application._id } });
    await routeApplication(ctx, application._id);
    return null;
  },
});

/**
 * A person adds an application themselves: someone who walked in, phoned, or applied on a job board whose
 * notification had no usable address. It then goes through the same steps as any other.
 */
export const addManually = managerMutation({
  args: { needId: v.id("hiringNeeds"), name: v.string(), email: v.string(), phone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const need = await owned(ctx, args.needId);
    const address = email(args.email, "The applicant's email");
    const name = text(args.name, "The applicant's name", 80);
    const phone = normalizePhone(args.phone) ?? undefined;
    const where = `entered by ${ctx.member.name}`;
    let applicant = await ctx.db
      .query("applicants")
      .withIndex("by_company_email", (q) => q.eq("companyId", ctx.companyId).eq("email", address))
      .first();
    if (applicant) {
      const theirs = await ctx.db
        .query("applications")
        .withIndex("by_company_applicant", (q) => q.eq("companyId", ctx.companyId).eq("applicantId", applicant!._id))
        .take(50);
      if (theirs.some((other) => other.needId === need._id && isActive(other))) throw userError("This person already has an open application for that role.");
    } else {
      const applicantId = await ctx.db.insert("applicants", { companyId: ctx.companyId, name, email: address, phone, createdAt: Date.now() });
      applicant = (await ctx.db.get(applicantId))!;
    }
    const applicationId = await ctx.db.insert("applications", {
      companyId: ctx.companyId,
      applicantId: applicant._id,
      needId: need._id,
      roleSeen: need.title,
      source: "manual",
      appliedAt: Date.now(),
      stage: "received",
      contact: { status: "direct", address, evidence: [{ address, kind: "direct", where }], resolvedBy: ctx.member._id },
      facts: [{ field: "name", value: name, from: "owner", where }, ...(phone ? [{ field: "phone", value: phone, from: "owner" as const, where }] : [])],
      followUpsSent: 0,
      createdAt: Date.now(),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "application.received", actor: byMember(ctx), subject: { table: "applications", id: applicationId }, data: { source: "manual", contact: "direct", matchedRole: true } });
    await routeApplication(ctx, applicationId);
    return applicationId;
  },
});

/**
 * Shows a live applicant link's address to a manager so they can pass it on by hand. The reveal is
 * recorded. The address is returned to this caller only and written nowhere.
 */
export const revealLink = managerMutation({
  args: { applicationId: v.id("applications"), purpose: v.union(v.literal("apply"), v.literal("interview"), v.literal("hiring-offer")) },
  handler: async (ctx, args) => {
    const application = await owned(ctx, args.applicationId);
    const link = await liveApplicantLink(ctx, application, args.purpose);
    const token = link ? await tokenFor(link) : null;
    if (!link || !token) throw userError("There is no active link of that kind for this application.");
    await recordEvent(ctx, { companyId: ctx.companyId, type: "applicant_link.revealed", actor: byMember(ctx), subject: { table: "applicantLinks", id: link._id }, data: { purpose: link.purpose, applicationId: application._id } });
    return { url: `${siteOrigin()}${applicantLinkPath(link.purpose, token)}`, expiresAt: link.expiresAt };
  },
});

/**
 * A person sends the invitation again with a fresh link: after a link expired, or when it is not known
 * whether the first one went. The old link stops working.
 */
export const inviteAgain = managerMutation({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const application = await owned(ctx, args.applicationId);
    if (!isActive(application) || application.submittedAt) throw userError("This application is not waiting on the form.");
    await revokeApplicationLinks(ctx, application, `${ctx.member.name} sent a new link.`, byMember(ctx), "apply");
    const sent = await sendInvitation(ctx, application._id, byMember(ctx), { again: true });
    if (!sent.ok) throw userError(sent.detail);
    await ctx.db.patch(application._id, { followUpsSent: 0, invitedAt: undefined });
    await settleTask(ctx, application, "decision", `${ctx.member.name} sent a new link.`, byMember(ctx));
    await settleTask(ctx, application, "delivery", `${ctx.member.name} sent the invitation again.`, byMember(ctx));
    return null;
  },
});

/** The applicant's message was answered. Reminders may start again. */
export const markReplyAnswered = companyMutation({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const application = await owned(ctx, args.applicationId);
    if (!application.questionSince) return null;
    await ctx.db.patch(application._id, { questionSince: undefined, nextAction: application.submittedAt ? application.nextAction : { what: "Complete the application form", by: "applicant" } });
    await settleTask(ctx, application, "reply", `${ctx.member.name} answered the applicant.`, byMember(ctx));
    await recordEvent(ctx, { companyId: ctx.companyId, type: "application.reply_answered", actor: byMember(ctx), subject: { table: "applications", id: application._id } });
    return null;
  },
});

/** Recruiter asks the applicant for something missing: sent, or put up for approval, as the permission says. */
export const askApplicant = managerMutation({
  args: { applicationId: v.id("applications"), question: v.string() },
  handler: async (ctx, args) => {
    const application = await owned(ctx, args.applicationId);
    if (!isActive(application)) throw userError("This application has ended.");
    return requestInformation(ctx, application, text(args.question, "The question", 1000));
  },
});

export const rescreen = managerMutation({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const application = await owned(ctx, args.applicationId);
    const screeningId = await runScreening(ctx, application._id);
    if (!screeningId) throw userError("Screening runs on a submitted application that is still being reviewed.");
    return screeningId;
  },
});

/**
 * A person's decision after reviewing an applicant. Interview: Recruiter starts coordinating one. Offer:
 * the application waits for an offer to be drafted and approved. Hold: it waits for you. Reject: it is
 * closed for the reason you give, and the applicant is told only if you say so.
 */
export const decide = managerMutation({
  args: {
    applicationId: v.id("applications"),
    decision: v.union(v.literal("interview"), v.literal("hold"), v.literal("offer"), v.literal("reject")),
    reason: v.optional(v.string()),
    rejectReason: v.optional(v.union(v.literal("requirement_not_met"), v.literal("not_selected"), v.literal("no_response"), v.literal("other"))),
    tellApplicant: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const application = await owned(ctx, args.applicationId);
    const reviewable: Stage[] = ["screening", "interview", "decision_pending"];
    if (!reviewable.includes(application.stage)) throw userError("A decision is made on an application that has been submitted and screened.");
    const reason = optionalText(args.reason, "The reason", 2000);
    if ((args.decision === "reject" || args.decision === "hold") && !reason) throw userError("Give the reason, so the record shows why.");
    const actor = byMember(ctx);
    const screening = await latestScreening(ctx, application);
    await ctx.db.insert("hiringDecisions", { companyId: ctx.companyId, applicationId: application._id, decision: args.decision, reason, screeningId: screening?._id, decidedBy: ctx.member._id, at: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: `application.decided_${args.decision}`, actor, subject: { table: "applications", id: application._id } });
    await settleTask(ctx, application, "review", `${ctx.member.name} decided: ${args.decision}.`, actor);
    await settleTask(ctx, application, "decision", `${ctx.member.name} decided: ${args.decision}.`, actor);

    if (args.decision === "reject") {
      await closeApplication(ctx, application, args.rejectReason ?? "not_selected", actor, { note: reason, by: ctx.member._id });
      if (args.tellApplicant) await sendDecline(ctx, application, actor);
      return null;
    }
    if (args.decision === "hold") {
      await setNextAction(ctx, application, { what: `On hold: ${reason}`, by: "owner", dueAt: Date.now() + 7 * DAY });
      return null;
    }
    if (args.decision === "interview") {
      const staged = application.stage === "interview" ? application : await setStage(ctx, application, "interview", actor, { nextAction: { what: "Arrange the interview", by: "recruiter", dueAt: Date.now() + 2 * DAY } });
      await startInterview(ctx, staged, actor);
      return null;
    }
    const dueAt = Date.now() + 2 * DAY;
    const staged = application.stage === "decision_pending" ? application : await setStage(ctx, application, "decision_pending", actor, { nextAction: undefined });
    await setNextAction(ctx, staged, { what: "Draft the offer from the role's approved terms, then approve sending it", by: "owner", dueAt });
    await askPerson(ctx, staged, { what: "decision", title: "Draft and approve the offer", question: "You decided to make an offer. Draft it from the role's approved terms; it is sent only after you approve it.", dueAt, completionCondition: "The offer was sent, or the decision was changed", actor });
    return null;
  },
});

/** Ends an application for a stated reason without contacting the applicant. */
export const close = managerMutation({
  args: { applicationId: v.id("applications"), reason: closureReasonValidator, note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const application = await owned(ctx, args.applicationId);
    if (args.reason === "hired") throw userError("An application is closed as hired by completing its onboarding handoff.");
    await closeApplication(ctx, application, args.reason, byMember(ctx), { note: optionalText(args.note, "The note", 2000), by: ctx.member._id });
    return null;
  },
});

/** The applicant told someone they are withdrawing. */
export const recordWithdrawal = managerMutation({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    await withdrawApplication(ctx, await owned(ctx, args.applicationId), byMember(ctx), `recorded by ${ctx.member.name}`);
    return null;
  },
});

/** The person asked not to be contacted, or changed their mind. */
export const setDoNotContact = managerMutation({
  args: { applicantId: v.id("applicants"), doNotContact: v.boolean(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const applicant = await owned(ctx, args.applicantId);
    await ctx.db.patch(applicant._id, { doNotContact: args.doNotContact ? { at: Date.now(), reason: optionalText(args.reason, "The reason", 300) ?? `Recorded by ${ctx.member.name}.` } : undefined });
    await recordEvent(ctx, { companyId: ctx.companyId, type: args.doNotContact ? "applicant.do_not_contact" : "applicant.contact_allowed", actor: byMember(ctx), subject: { table: "applicants", id: applicant._id } });
    return null;
  },
});

/** A deletion request: removes everything personal about this applicant now. */
export const removeApplicantData = managerMutation({
  args: { applicantId: v.id("applicants") },
  handler: async (ctx, args) => {
    const applicant = await owned(ctx, args.applicantId);
    const done = await redactApplicant(ctx, applicant._id, byMember(ctx));
    if (!done.ok) throw userError(done.why ?? "This applicant's details could not be removed.");
    return null;
  },
});
