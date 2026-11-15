/**
 * Offers & Agreements. A person decides to make an offer; Recruiter drafts it from the role's approved
 * terms; a person approves sending it. The agreement is tracked separately from the offer and is
 * complete only when a signing provider reports it or a person records it.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { owned } from "./lib/access";
import { companyQuery, managerMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { isActive, setNextAction } from "./lib/recruiter/applications";
import { payWords, prepareOffer, requestOfferApproval } from "./lib/recruiter/offers";
import { signatureProvider } from "./lib/recruiter/signature";
import { DAY } from "./lib/recruiter/settings";
import { optionalText } from "./lib/text";

export const board = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = [];
    for (const stage of ["decision_pending", "offer_sent", "accepted", "onboarding_handoff"] as const) {
      const applications = await ctx.db
        .query("applications")
        .withIndex("by_company_stage", (q) => q.eq("companyId", ctx.companyId).eq("stage", stage))
        .take(200);
      for (const application of applications) {
        const applicant = await ctx.db.get(application.applicantId);
        const need = application.needId ? await ctx.db.get(application.needId) : null;
        const offers = await ctx.db
          .query("hiringOffers")
          .withIndex("by_company_application", (q) => q.eq("companyId", ctx.companyId).eq("applicationId", application._id))
          .order("desc")
          .take(5);
        const handoff = await ctx.db
          .query("onboardingHandoffs")
          .withIndex("by_company_application", (q) => q.eq("companyId", ctx.companyId).eq("applicationId", application._id))
          .first();
        rows.push({
          applicationId: application._id,
          applicant: applicant?.name ?? null,
          role: need?.title ?? null,
          stage,
          approvedTerms: need?.compensation ? { engagement: need.engagement, pay: payWords(need.compensation.pay), approvedAt: need.compensation.approvedAt } : null,
          offers: offers.map((offer) => ({ offerId: offer._id, status: offer.status, pay: payWords(offer.terms.pay), terms: offer.terms, approvalId: offer.approvalId ?? null, sentAt: offer.sentAt ?? null, expiresAt: offer.expiresAt ?? null, respondedAt: offer.respondedAt ?? null, agreement: offer.agreement })),
          handoff: handoff ? { handoffId: handoff._id, status: handoff.status, outstanding: handoff.requirements.filter((row) => row.status === "outstanding").map((row) => row.label), dueAt: handoff.dueAt } : null,
          nextAction: application.nextAction ?? null,
        });
      }
    }
    return { rows, signing: signatureProvider()?.name ?? null };
  },
});

/** Drafts the offer from the role's approved pay. Refused if no person decided to offer, or no pay is approved. */
export const draft = managerMutation({
  args: { applicationId: v.id("applications"), startConditions: v.string(), expectations: v.string(), agreementTemplate: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const application = await owned(ctx, args.applicationId);
    const drafted = await prepareOffer(ctx, application, { startConditions: args.startConditions, expectations: args.expectations, agreementTemplate: args.agreementTemplate }, byMember(ctx));
    if (!drafted.ok) throw userError(drafted.why);
    return drafted.offerId;
  },
});

/** Puts the draft in the approval queue. Approving there is what sends it. */
export const requestSend = managerMutation({
  args: { offerId: v.id("hiringOffers") },
  handler: async (ctx, args) => requestOfferApproval(ctx, await owned(ctx, args.offerId)),
});

export const withdraw = managerMutation({
  args: { offerId: v.id("hiringOffers"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const offer = await owned(ctx, args.offerId);
    if (offer.status === "accepted" || offer.status === "declined" || offer.status === "withdrawn") throw userError(`This offer is already ${offer.status}.`);
    await ctx.db.patch(offer._id, { status: "withdrawn" });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "offer.withdrawn", actor: byMember(ctx), subject: { table: "hiringOffers", id: offer._id } });
    const application = await ctx.db.get(offer.applicationId);
    if (application && isActive(application)) {
      if (application.stage === "offer_sent") await ctx.db.patch(application._id, { stage: "decision_pending" });
      await setNextAction(ctx, application, { what: `The offer was withdrawn${optionalText(args.reason, "The reason", 300) ? `: ${args.reason!.trim()}` : ""}. Decide what happens to this applicant.`, by: "owner", dueAt: Date.now() + 2 * DAY });
    }
    return null;
  },
});

// ── The agreement ────────────────────────────────────────────────────────────────────────────────

/** Sends the company's own agreement template for signing, when a signing provider is connected. */
export const sendAgreement = managerMutation({
  args: { offerId: v.id("hiringOffers") },
  handler: async (ctx, args) => {
    const offer = await owned(ctx, args.offerId);
    if (offer.status !== "accepted") throw userError("The agreement is sent after the applicant accepts the offer.");
    if (offer.agreement.status !== "not_started") throw userError(`The agreement is already ${offer.agreement.status}.`);
    if (!signatureProvider()) throw userError("No signing service is connected. Have the agreement signed your usual way, then record it here.");
    if (!offer.terms.agreementTemplate) throw userError("This offer names no agreement template.");
    await ctx.scheduler.runAfter(0, internal.hiringOffers.sendEnvelope, { offerId: offer._id });
    return null;
  },
});

/** A person records that the agreement was completed outside Selestial. */
export const recordAgreement = managerMutation({
  args: { offerId: v.id("hiringOffers") },
  handler: async (ctx, args) => {
    const offer = await owned(ctx, args.offerId);
    if (offer.status !== "accepted") throw userError("The agreement is recorded after the applicant accepts the offer.");
    await ctx.db.patch(offer._id, { agreement: { ...offer.agreement, status: "completed", completedAt: Date.now(), recordedBy: ctx.member._id } });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "agreement.recorded", actor: byMember(ctx), subject: { table: "hiringOffers", id: offer._id } });
    return null;
  },
});

export const envelopeFor = internalQuery({
  args: { offerId: v.id("hiringOffers") },
  handler: async (ctx, args) => {
    const offer = await ctx.db.get(args.offerId);
    const application = offer ? await ctx.db.get(offer.applicationId) : null;
    const applicant = application ? await ctx.db.get(application.applicantId) : null;
    if (!offer || !application || !applicant || offer.status !== "accepted" || offer.agreement.status !== "not_started" || !offer.terms.agreementTemplate || !application.contact.address) return null;
    return { template: offer.terms.agreementTemplate, signerName: applicant.name ?? "", signerEmail: application.contact.address };
  },
});

export const envelopeSent = internalMutation({
  args: { offerId: v.id("hiringOffers"), provider: v.string(), envelopeId: v.string() },
  handler: async (ctx, args) => {
    const offer = await ctx.db.get(args.offerId);
    if (!offer || offer.agreement.status !== "not_started") return null;
    await ctx.db.patch(offer._id, { agreement: { status: "sent", provider: args.provider, envelopeId: args.envelopeId } });
    await recordEvent(ctx, { companyId: offer.companyId, type: "agreement.sent", actor: { kind: "system" }, subject: { table: "hiringOffers", id: offer._id } });
    return null;
  },
});

export const sendEnvelope = internalAction({
  args: { offerId: v.id("hiringOffers") },
  handler: async (ctx, args) => {
    const envelope = await ctx.runQuery(internal.hiringOffers.envelopeFor, args);
    const provider = signatureProvider();
    if (!envelope || !provider) return null;
    const sent = await provider.send({ ...envelope, idempotencyKey: args.offerId });
    if (sent.ok) await ctx.runMutation(internal.hiringOffers.envelopeSent, { offerId: args.offerId, provider: provider.name, envelopeId: sent.envelopeId });
    return null;
  },
});

/** What a signing provider's webhook will call when the agreement is signed by everyone. */
export const agreementCompleted = internalMutation({
  args: { provider: v.string(), envelopeId: v.string() },
  handler: async (ctx, args) => {
    for await (const offer of ctx.db.query("hiringOffers")) {
      if (offer.agreement.provider !== args.provider || offer.agreement.envelopeId !== args.envelopeId || offer.agreement.status !== "sent") continue;
      await ctx.db.patch(offer._id, { agreement: { ...offer.agreement, status: "completed", completedAt: Date.now() } });
      await recordEvent(ctx, { companyId: offer.companyId, type: "agreement.completed", actor: { kind: "system" }, subject: { table: "hiringOffers", id: offer._id } });
      return "completed" as const;
    }
    return "ignored" as const;
  },
});
