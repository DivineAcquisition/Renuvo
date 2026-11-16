/**
 * Hiring offers. Recruiter drafts one from terms the Owner already approved for the role and can change
 * none of them. Sending needs a person's approval every time: the permission's ceiling is Propose, so no
 * setting sends an offer by itself. Accepting an offer is one fact. The agreement, documents, training,
 * equipment, payment setup and readiness for work are each their own, on the onboarding handoff.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { requestApproval } from "../approvalQueue";
import type { CarriedOut } from "../dispatch/workflow";
import { userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import { isActive, setNextAction, setStage, settleTask } from "./applications";
import { createHandoff } from "./handoff";
import { issueApplicantLink, revokeApplicationLinks } from "./links";
import { queueApplicantMessage } from "./outbox";
import { DAY, HOUR, recruiterSettings } from "./settings";
import { offerEmail, partsFor } from "./words";

export const SEND_OFFER = "recruiter.send_offer";

export function payWords(pay: Doc<"hiringOffers">["terms"]["pay"]): string {
  return pay.kind === "hourly" ? `$${(pay.hourlyCents / 100).toFixed(2)} an hour` : `${(pay.shareBps / 100).toFixed(pay.shareBps % 100 === 0 ? 0 : 2)}% of each job's price`;
}

export async function liveOffer(ctx: QueryCtx | MutationCtx, application: Pick<Doc<"applications">, "_id" | "companyId">): Promise<Doc<"hiringOffers"> | null> {
  const rows = await ctx.db
    .query("hiringOffers")
    .withIndex("by_company_application", (q) => q.eq("companyId", application.companyId).eq("applicationId", application._id))
    .order("desc")
    .take(20);
  return rows.find((row) => row.status !== "withdrawn" && row.status !== "declined" && row.status !== "expired") ?? null;
}

/** Drafts an offer. Refused unless a person decided to make one and the role has pay the Owner approved. */
export async function prepareOffer(ctx: MutationCtx, application: Doc<"applications">, input: { startConditions: string; expectations: string; agreementTemplate?: string }, actor: Actor): Promise<{ ok: true; offerId: Id<"hiringOffers"> } | { ok: false; why: string }> {
  if (!isActive(application) || application.stage !== "decision_pending") return { ok: false, why: "An offer is drafted once a person has reviewed the applicant and the application is awaiting a decision." };
  const decisions = await ctx.db
    .query("hiringDecisions")
    .withIndex("by_company_application", (q) => q.eq("companyId", application.companyId).eq("applicationId", application._id))
    .order("desc")
    .take(10);
  if (decisions[0]?.decision !== "offer" || !decisions[0].decidedBy) return { ok: false, why: "No person has decided to make this applicant an offer." };
  const need = application.needId ? await ctx.db.get(application.needId) : null;
  if (!need) return { ok: false, why: "The application is not matched to a role." };
  if (!need.compensation) return { ok: false, why: "The Owner has not approved pay for this role. Recruiter does not set or change pay." };
  const existing = await liveOffer(ctx, application);
  if (existing) return { ok: true, offerId: existing._id };
  const offerId = await ctx.db.insert("hiringOffers", {
    companyId: application.companyId,
    applicationId: application._id,
    needId: need._id,
    terms: { role: need.title, engagement: need.engagement, pay: need.compensation.pay, startConditions: input.startConditions.trim().slice(0, 2000), expectations: input.expectations.trim().slice(0, 2000), agreementTemplate: input.agreementTemplate?.trim().slice(0, 200) || undefined },
    status: "draft",
    agreement: { status: "not_started" },
    createdAt: Date.now(),
  });
  await recordEvent(ctx, { companyId: application.companyId, type: "offer.drafted", actor, subject: { table: "hiringOffers", id: offerId }, data: { applicationId: application._id } });
  return { ok: true, offerId };
}

/** Puts a drafted offer in the approval queue. This is the only road to sending one. */
export async function requestOfferApproval(ctx: MutationCtx, offer: Doc<"hiringOffers">): Promise<Id<"approvals">> {
  if (offer.status !== "draft") throw userError(`This offer is already ${offer.status.replace(/_/g, " ")}.`);
  const application = (await ctx.db.get(offer.applicationId))!;
  const applicant = await ctx.db.get(application.applicantId);
  const company = (await ctx.db.get(offer.companyId))!;
  const decideBy = Date.now() + recruiterSettings(company).decideWithinHours * HOUR;
  const approvalId = await requestApproval(ctx, {
    companyId: offer.companyId,
    action: SEND_OFFER,
    summary: `Send ${applicant?.name ?? "the applicant"} an offer for ${offer.terms.role}`,
    reason: `You decided to make an offer. Terms, from the role as you approved it: ${offer.terms.engagement}, ${payWords(offer.terms.pay)}. Start: ${offer.terms.startConditions || "not stated"}. Expectations: ${offer.terms.expectations || "not stated"}.`,
    authorizes: `One email to ${application.contact.address ?? "the applicant"} with a page showing exactly these terms, where they can accept or decline. It is not an agreement and promises no specific work.`,
    ifWaiting: "No offer is sent.",
    decideBy,
    proposal: { kind: "send_hiring_offer", offerId: offer._id },
    about: { table: "applications", id: application._id },
  });
  await ctx.db.patch(offer._id, { status: "awaiting_approval", approvalId });
  await setNextAction(ctx, application, { what: "Approve sending the offer", by: "owner", dueAt: decideBy });
  return approvalId;
}

/** Carried out only from an approval a person just gave. Everything is checked again first. */
async function sendOffer(ctx: MutationCtx, approval: Doc<"approvals">, offerId: Id<"hiringOffers">, actor: Actor): Promise<CarriedOut> {
  const offer = await ctx.db.get(offerId);
  if (!offer || offer.companyId !== approval.companyId) return { ok: false, detail: "The offer no longer exists." };
  if (approval.status !== "approved" || approval.proposal?.kind !== "send_hiring_offer" || approval.proposal.offerId !== offerId || offer.approvalId !== approval._id || actor.kind !== "member") return { ok: false, detail: "This offer has not been approved by a person." };
  if (offer.status !== "awaiting_approval") return { ok: false, detail: `The offer is already ${offer.status.replace(/_/g, " ")}.` };
  const application = await ctx.db.get(offer.applicationId);
  const applicant = application ? await ctx.db.get(application.applicantId) : null;
  const company = await ctx.db.get(offer.companyId);
  const need = await ctx.db.get(offer.needId);
  if (!application || !applicant || !company || !need || !isActive(application)) return { ok: false, detail: "The application has ended." };
  if (application.stage !== "decision_pending") return { ok: false, detail: `The application is ${application.stage.replace(/_/g, " ")}, not awaiting a decision.` };
  // The Owner may have changed the role's pay since the draft. An offer never goes out on old terms.
  const current = need.compensation?.pay;
  if (!current || JSON.stringify(current) !== JSON.stringify(offer.terms.pay) || need.engagement !== offer.terms.engagement) {
    await ctx.db.patch(offer._id, { status: "withdrawn" });
    return { ok: false, detail: "The role's approved pay or worker type changed after this offer was drafted. Draft it again." };
  }
  const settings = recruiterSettings(company);
  const expiresAt = Date.now() + settings.offerTtlDays * DAY;
  const link = await issueApplicantLink(ctx, { application, purpose: "hiring-offer", expiresAt, actor });
  const email = offerEmail(partsFor(company, settings.fromName, applicant, offer.terms.role));
  const message = await queueApplicantMessage(ctx, { company, application, applicant, purpose: "hiring_offer", channel: "email", subject: email.subject, body: email.body, link, dedupeKey: `offer:${offer._id}`, actor });
  if (message.status === "not_sent") {
    await ctx.db.patch(offer._id, { status: "draft", approvalId: undefined });
    return { ok: false, detail: message.problem ?? "The offer could not be sent." };
  }
  await ctx.db.patch(offer._id, { status: "sent", approvedBy: actor.memberId, sentAt: Date.now(), expiresAt });
  await recordEvent(ctx, { companyId: company._id, type: "offer.sent", actor, subject: { table: "hiringOffers", id: offer._id }, data: { applicationId: application._id } });
  await settleTask(ctx, application, "decision", "An offer was sent.");
  await setStage(ctx, application, "offer_sent", actor, { nextAction: { what: "Accept or decline the offer", by: "applicant", dueAt: expiresAt } });
  return { ok: true, detail: "The offer was handed to the email service." };
}

export async function afterOfferDecision(ctx: MutationCtx, approval: Doc<"approvals">, offerId: Id<"hiringOffers">, decision: "approved" | "changed" | "skipped", decidedBy: Actor): Promise<CarriedOut | null> {
  if (decision === "approved") return sendOffer(ctx, approval, offerId, decidedBy);
  const offer = await ctx.db.get(offerId);
  if (!offer || offer.status !== "awaiting_approval") return null;
  // Not sent as drafted. The draft is withdrawn so changed terms are drafted, and approved, afresh.
  await ctx.db.patch(offer._id, { status: "withdrawn" });
  const application = await ctx.db.get(offer.applicationId);
  if (application && isActive(application)) await setNextAction(ctx, application, { what: decision === "changed" ? "You changed the offer. Draft it again with the terms you want." : "You chose not to send the offer. Decide what happens to this applicant.", by: "owner", dueAt: Date.now() + 2 * DAY });
  return null;
}

/** The applicant answered the offer on its page. Acceptance creates the onboarding handoff and nothing more. */
export async function answerOffer(ctx: MutationCtx, application: Doc<"applications">, accept: boolean, actor: Actor): Promise<{ status: "accepted" | "declined" }> {
  const offer = await liveOffer(ctx, application);
  if (!offer || offer.status !== "sent" || application.stage !== "offer_sent") throw userError("This offer is no longer open.");
  if (offer.expiresAt && Date.now() >= offer.expiresAt) throw userError("This offer has expired.");
  await ctx.db.patch(offer._id, { status: accept ? "accepted" : "declined", respondedAt: Date.now() });
  await recordEvent(ctx, { companyId: application.companyId, type: accept ? "offer.accepted" : "offer.declined", actor, subject: { table: "hiringOffers", id: offer._id }, data: { applicationId: application._id } });
  await revokeApplicationLinks(ctx, application, accept ? "The offer was accepted." : "The offer was declined.", actor, "hiring-offer");
  if (!accept) {
    await setStage(ctx, application, "decision_pending", actor, { nextAction: { what: "The applicant declined the offer. Close the application, or talk to them.", by: "owner", dueAt: Date.now() + 2 * DAY } });
    return { status: "declined" };
  }
  const accepted = await setStage(ctx, application, "accepted", actor, { nextAction: { what: "Start onboarding", by: "recruiter", dueAt: Date.now() + DAY } });
  await createHandoff(ctx, accepted, (await ctx.db.get(offer._id))!, actor);
  return { status: "accepted" };
}
