/**
 * What an applicant can see and do through an applicant link, with no sign-in: fill in and submit the
 * application, choose an interview time, answer an offer. Every function goes through `applicantQuery`
 * or `applicantMutation`, so the token is the only way in and the link's own application is the only
 * record reached. No argument names an application, an applicant or a company.
 *
 * Reads change nothing: opening a link submits nothing and accepts nothing. A page for a link that has
 * expired or been revoked says so and shows none of the applicant's answers.
 */
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { applicantMutation, applicantQuery, type ApplicantAccess } from "./lib/builders";
import { notFound, userError } from "./lib/errors";
import { recordEvent, type Actor } from "./lib/events";
import { recordTextConsent } from "./lib/recruiter/consent";
import { firstName, isActive, setStage, settleTask, withdrawApplication } from "./lib/recruiter/applications";
import { assertSubmittable, ATTEST_WORDING, cleanAnswers, completion, formFields, SMS_CONSENT_WORDING } from "./lib/recruiter/form";
import { bookSlot, cancelInterviewTime, liveInterview, openSlots } from "./lib/recruiter/interviews";
import { answerOffer, liveOffer, payWords } from "./lib/recruiter/offers";
import { answersValidator, type Answers, type Fact } from "./lib/recruiter/schema";
import { runScreening } from "./lib/recruiter/screening";
import { DAY } from "./lib/recruiter/settings";
import { clock, dayName } from "./lib/time";

const MAX_FILES = 3;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_TYPES = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "image/jpeg", "image/png"];

const asApplicant = (ctx: ApplicantAccess): Actor => ({ kind: "applicant", applicantId: ctx.applicant._id, linkId: ctx.link._id });

async function needOf(ctx: (QueryCtx | MutationCtx) & ApplicantAccess): Promise<Doc<"hiringNeeds">> {
  const need = ctx.application.needId ? await ctx.db.get(ctx.application.needId) : null;
  if (!need || need.companyId !== ctx.companyId) notFound();
  return need;
}

async function sessionOf(ctx: (QueryCtx | MutationCtx) & ApplicantAccess) {
  return ctx.db
    .query("formSessions")
    .withIndex("by_company_application", (q) => q.eq("companyId", ctx.companyId).eq("applicationId", ctx.application._id))
    .first();
}

async function filesOf(ctx: (QueryCtx | MutationCtx) & ApplicantAccess) {
  return ctx.db
    .query("applicantAttachments")
    .withIndex("by_company_application", (q) => q.eq("companyId", ctx.companyId).eq("applicationId", ctx.application._id))
    .take(20);
}

export type ApplyState = "open" | "submitted" | "withdrawn" | "closed" | "role_closed" | "expired" | "revoked";

function applyState(ctx: ApplicantAccess, need: Doc<"hiringNeeds">): ApplyState {
  if (ctx.application.submittedAt) return "submitted";
  if (ctx.application.stage === "withdrawn") return "withdrawn";
  if (!isActive(ctx.application)) return "closed";
  if (ctx.linkState !== "active") return ctx.linkState;
  return need.status === "open" ? "open" : "role_closed";
}

/** What we already know and are confident of, offered for the applicant to correct. A job board's forwarding address is not shown as theirs. */
function prefill(ctx: ApplicantAccess): Answers {
  const out: Answers = {};
  if (ctx.applicant.name) out.fullName = ctx.applicant.name;
  if (ctx.application.contact.status === "direct" && ctx.application.contact.address) out.email = ctx.application.contact.address;
  return out;
}

// ── The application ──────────────────────────────────────────────────────────────────────────────

/** The application page. Opening it changes nothing. */
export const application = applicantQuery({
  purpose: "apply",
  args: {},
  handler: async (ctx) => {
    const need = await needOf(ctx);
    const state = applyState(ctx, need);
    const base = { company: ctx.company.name, role: need.title, state, firstName: firstName(ctx.applicant.name) };
    // Once the page is not open, it says why and shows nothing the applicant entered.
    if (state !== "open") return { ...base, form: null };
    const fields = formFields(need);
    const session = await sessionOf(ctx);
    const answers = { ...prefill(ctx), ...(session?.answers ?? {}) };
    return {
      ...base,
      form: {
        about: { responsibilities: need.responsibilities, location: need.location, availability: need.requiredAvailability },
        fields,
        answers,
        files: (await filesOf(ctx)).map((file) => ({ attachmentId: file._id, kind: file.kind, fileName: file.fileName })),
        maxFiles: MAX_FILES,
        savedAt: session?.savedAt ?? null,
        progress: completion(fields, answers),
        attestation: ATTEST_WORDING,
        linkExpiresAt: ctx.link.expiresAt,
      },
    };
  },
});

async function openForm(ctx: MutationCtx & ApplicantAccess) {
  const need = await needOf(ctx);
  const state = applyState(ctx, need);
  if (state === "submitted") throw userError("This application has already been submitted.");
  if (state !== "open") throw userError("This application is no longer open.", "not_allowed");
  return need;
}

/** Saves what the applicant has entered so far. They can leave and come back to it with the same link. */
export const saveDraft = applicantMutation({
  purpose: "apply",
  action: "save",
  args: { answers: answersValidator },
  handler: async (ctx, args) => {
    const need = await openForm(ctx);
    const now = Date.now();
    const session = await sessionOf(ctx);
    const answers = cleanAnswers(formFields(need), { ...(session?.answers ?? prefill(ctx)), ...args.answers });
    if (session) await ctx.db.patch(session._id, { answers, savedAt: now });
    else await ctx.db.insert("formSessions", { companyId: ctx.companyId, applicationId: ctx.application._id, answers, startedAt: now, savedAt: now });
    if (ctx.application.stage === "invited") {
      await setStage(ctx, ctx.application, "application_started", asApplicant(ctx), { formStartedAt: now, nextAction: { what: "Finish and submit the application form", by: "applicant", dueAt: ctx.link.expiresAt } });
    }
    // Permission to text is the applicant's own tick against the exact wording, with the number they gave. Unticking removes it.
    const consent = answers.smsConsent === true && typeof answers.phone === "string" ? { at: ctx.applicant.smsConsent?.phone === answers.phone ? ctx.applicant.smsConsent.at : now, wording: SMS_CONSENT_WORDING, phone: answers.phone } : undefined;
    if (JSON.stringify(consent) !== JSON.stringify(ctx.applicant.smsConsent)) await ctx.db.patch(ctx.applicant._id, { smsConsent: consent });
    await recordTextConsent(ctx, ctx.applicant, consent !== undefined, asApplicant(ctx));
    return { savedAt: now };
  },
});

/** A one-time address to upload one file to. The file counts only once `attachFile` records it. */
export const fileUploadUrl = applicantMutation({
  purpose: "apply",
  action: "upload",
  args: {},
  handler: async (ctx) => {
    await openForm(ctx);
    if ((await filesOf(ctx)).length >= MAX_FILES) throw userError(`You can add up to ${MAX_FILES} files.`);
    return ctx.storage.generateUploadUrl();
  },
});

export const attachFile = applicantMutation({
  purpose: "apply",
  action: "upload",
  args: { storageId: v.id("_storage"), kind: v.union(v.literal("resume"), v.literal("supporting")), fileName: v.string(), clientKey: v.string() },
  handler: async (ctx, args) => {
    await openForm(ctx);
    const clientKey = args.clientKey.trim().slice(0, 80);
    if (clientKey.length < 8) throw userError("This file could not be recorded. Try again.");
    const files = await filesOf(ctx);
    const existing = files.find((file) => file.clientKey === clientKey);
    if (existing) {
      if (existing.storageId !== args.storageId) await ctx.storage.delete(args.storageId);
      return { attachmentId: existing._id, duplicate: true };
    }
    const file = await ctx.db.system.get(args.storageId);
    if (!file) throw userError("That upload was not found. Try again.");
    // The type and size are checked on what was stored, not on what the browser said. The file is kept as data and never opened or run.
    if (!file.contentType || !FILE_TYPES.includes(file.contentType) || file.size > MAX_FILE_BYTES || files.length >= MAX_FILES) {
      await ctx.storage.delete(args.storageId);
      throw userError(`Files must be PDF, Word, plain text, JPG or PNG, 10 MB or smaller, and at most ${MAX_FILES}.`);
    }
    const everyone = await ctx.db
      .query("applicantAttachments")
      .withIndex("by_company_application", (q) => q.eq("companyId", ctx.companyId))
      .take(5000);
    if (everyone.some((row) => row.storageId === args.storageId)) throw userError("This file is already recorded.");
    const fileName = args.fileName.replace(/[^\w .()-]+/g, "_").trim().slice(0, 120) || "file";
    const attachmentId = await ctx.db.insert("applicantAttachments", { companyId: ctx.companyId, applicationId: ctx.application._id, kind: args.kind, storageId: args.storageId, fileName, contentType: file.contentType, size: file.size, clientKey, uploadedAt: Date.now() });
    return { attachmentId, duplicate: false };
  },
});

export const removeFile = applicantMutation({
  purpose: "apply",
  action: "upload",
  args: { attachmentId: v.id("applicantAttachments") },
  handler: async (ctx, args) => {
    await openForm(ctx);
    const file = await ctx.db.get(args.attachmentId);
    if (!file || file.companyId !== ctx.companyId || file.applicationId !== ctx.application._id) notFound();
    await ctx.db.delete(file._id);
    await ctx.storage.delete(file.storageId);
    return null;
  },
});

/** Submits the application. It is its own request: nothing is submitted by opening or saving. */
export const submit = applicantMutation({
  purpose: "apply",
  action: "submit",
  args: { answers: answersValidator, attested: v.boolean() },
  handler: async (ctx, args) => {
    const need = await openForm(ctx);
    if (!args.attested) throw userError("Please confirm that what you entered is true and complete.");
    const fields = formFields(need);
    const session = await sessionOf(ctx);
    const answers = cleanAnswers(fields, { ...(session?.answers ?? prefill(ctx)), ...args.answers });
    assertSubmittable(fields, answers);
    const now = Date.now();
    if (session) await ctx.db.patch(session._id, { answers, savedAt: now, submittedAt: now });
    else await ctx.db.insert("formSessions", { companyId: ctx.companyId, applicationId: ctx.application._id, answers, startedAt: now, savedAt: now, submittedAt: now });

    const where = "the application form, as the applicant wrote it";
    const said = (field: string, key: string): Fact[] => (typeof answers[key] === "string" || typeof answers[key] === "number" ? [{ field, value: String(answers[key]), from: "form", where }] : []);
    const facts = [...ctx.application.facts.filter((fact) => fact.from !== "form"), ...said("name", "fullName"), ...said("email", "email"), ...said("phone", "phone"), ...said("location", "city"), ...said("experience_years", "experienceYears")];
    const email = typeof answers.email === "string" ? answers.email : undefined;
    const phone = typeof answers.phone === "string" ? answers.phone : undefined;
    // The address they typed on their own application is theirs. It is added to the evidence; the address the invitation reached stays on the record beside it.
    const contact = email
      ? { ...ctx.application.contact, status: "direct" as const, address: email, bouncedAt: email === ctx.application.contact.address ? ctx.application.contact.bouncedAt : undefined, evidence: [...ctx.application.contact.evidence.filter((entry) => !(entry.address === email && entry.where === where)), { address: email, kind: "direct" as const, where }].slice(-30) }
      : ctx.application.contact;
    await ctx.db.patch(ctx.applicant._id, { name: typeof answers.fullName === "string" ? answers.fullName : ctx.applicant.name, email: email ?? ctx.applicant.email, phone: phone ?? ctx.applicant.phone, location: typeof answers.city === "string" ? answers.city : ctx.applicant.location, smsConsent: answers.smsConsent === true && phone ? (ctx.applicant.smsConsent?.phone === phone ? ctx.applicant.smsConsent : { at: now, wording: SMS_CONSENT_WORDING, phone }) : undefined });
    await recordTextConsent(ctx, ctx.applicant, answers.smsConsent === true && Boolean(phone), asApplicant(ctx));
    const fresh = (await ctx.db.get(ctx.application._id))!;
    await setStage(ctx, fresh, "application_submitted", asApplicant(ctx), { facts, contact, formStartedAt: fresh.formStartedAt ?? now, submittedAt: now, questionSince: undefined, nextAction: { what: "Screen the application", by: "recruiter", dueAt: now + DAY } });
    await settleTask(ctx, fresh, "decision", "The applicant submitted the application.");
    await recordEvent(ctx, { companyId: ctx.companyId, type: "application.form_submitted", actor: asApplicant(ctx), subject: { table: "applications", id: fresh._id } });
    await runScreening(ctx, fresh._id);
    return { submittedAt: now };
  },
});

/** The applicant takes themselves out. */
export const withdraw = applicantMutation({
  purpose: "apply",
  action: "withdraw",
  args: {},
  handler: async (ctx) => {
    await withdrawApplication(ctx, ctx.application, asApplicant(ctx), "on the application page");
    return null;
  },
});

// ── The interview ────────────────────────────────────────────────────────────────────────────────

const slotWords = (slot: { startsAt: number; endsAt: number }, timezone: string) => `${dayName(slot.startsAt, timezone)}, ${clock(slot.startsAt, timezone)} to ${clock(slot.endsAt, timezone)}`;

export const interview = applicantQuery({
  purpose: "interview",
  args: {},
  handler: async (ctx) => {
    const need = ctx.application.needId ? await ctx.db.get(ctx.application.needId) : null;
    const base = { company: ctx.company.name, role: need?.title ?? "your application", firstName: firstName(ctx.applicant.name), timezone: ctx.company.timezone };
    const current = await liveInterview(ctx, ctx.application);
    if (ctx.linkState !== "active" || !isActive(ctx.application) || !current || current.status === "awaiting_slots") return { ...base, state: (ctx.linkState !== "active" ? ctx.linkState : "closed") as "expired" | "revoked" | "closed", booked: null, slots: [] };
    const booked = current.startsAt && current.endsAt ? { when: slotWords({ startsAt: current.startsAt, endsAt: current.endsAt }, ctx.company.timezone), how: current.how ?? null, startsAt: current.startsAt } : null;
    const slots = (await openSlots(ctx, ctx.companyId, Date.now())).map((slot) => ({ slotId: slot._id, startsAt: slot.startsAt, when: slotWords(slot, ctx.company.timezone) }));
    // "confirmed" is said only when the time is really reserved. While a calendar is still being asked, the page says so.
    return { ...base, state: current.status as "proposed" | "reserving" | "confirmed", booked: current.status === "proposed" ? null : booked, slots };
  },
});

export const pickTime = applicantMutation({
  purpose: "interview",
  action: "pick_time",
  args: { slotId: v.id("interviewSlots") },
  handler: async (ctx, args) => {
    const current = await liveInterview(ctx, ctx.application);
    if (!current || current.status === "awaiting_slots") throw userError("There is no interview to schedule right now.");
    return bookSlot(ctx, current._id, args.slotId, asApplicant(ctx));
  },
});

export const cancelTime = applicantMutation({
  purpose: "interview",
  action: "cancel_time",
  args: {},
  handler: async (ctx) => {
    const current = await liveInterview(ctx, ctx.application);
    if (!current) throw userError("There is no scheduled interview to cancel.");
    await cancelInterviewTime(ctx, current._id, asApplicant(ctx), "Cancelled by the applicant on the interview page.");
    return null;
  },
});

// ── The offer ────────────────────────────────────────────────────────────────────────────────────

export const hiringOffer = applicantQuery({
  purpose: "hiring-offer",
  args: {},
  handler: async (ctx) => {
    const offers = await ctx.db
      .query("hiringOffers")
      .withIndex("by_company_application", (q) => q.eq("companyId", ctx.companyId).eq("applicationId", ctx.application._id))
      .order("desc")
      .take(5);
    const offer = offers.find((row) => row.status === "sent" || row.status === "accepted" || row.status === "declined") ?? null;
    const base = { company: ctx.company.name, firstName: firstName(ctx.applicant.name) };
    if (!offer) return { ...base, state: "closed" as const, terms: null };
    const state = offer.status === "accepted" ? ("accepted" as const) : offer.status === "declined" ? ("declined" as const) : ctx.linkState !== "active" || (offer.expiresAt !== undefined && Date.now() >= offer.expiresAt) ? ("expired" as const) : ("open" as const);
    // The terms are shown only while the offer can be answered, or after it was accepted.
    const terms = state === "open" || state === "accepted" ? { role: offer.terms.role, workerType: offer.terms.engagement === "contractor" ? "Independent contractor" : "Employee", pay: payWords(offer.terms.pay), startConditions: offer.terms.startConditions, expectations: offer.terms.expectations, respondBy: offer.expiresAt ?? null } : null;
    return { ...base, state, terms };
  },
});

export const acceptOffer = applicantMutation({
  purpose: "hiring-offer",
  action: "accept_offer",
  args: {},
  handler: async (ctx) => {
    if (!(await liveOffer(ctx, ctx.application))) throw userError("This offer is no longer open.");
    return answerOffer(ctx, ctx.application, true, asApplicant(ctx));
  },
});

export const declineOffer = applicantMutation({
  purpose: "hiring-offer",
  action: "decline_offer",
  args: {},
  handler: async (ctx) => {
    if (!(await liveOffer(ctx, ctx.application))) throw userError("This offer is no longer open.");
    return answerOffer(ctx, ctx.application, false, asApplicant(ctx));
  },
});
