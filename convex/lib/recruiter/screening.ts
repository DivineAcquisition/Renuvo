/**
 * Screening: each of the role's criteria against what the applicant actually answered, with the answer
 * quoted as evidence. There is no score. The result is a recommendation a person can check line by
 * line, and only a person moves the applicant forward or turns them down, with one exception the Owner
 * has to switch on: a published fixed requirement (see decisions.ts).
 *
 * Nothing here reads a name, an address, a photo or free text to guess anything about a person.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { requestApproval } from "../approvalQueue";
import { authorityFor } from "../authority";
import type { CarriedOut } from "../dispatch/workflow";
import type { Actor } from "../events";
import { recordEvent } from "../events";
import { askPerson, RECRUITER, setNextAction, setStage } from "./applications";
import { proposeOrDecline } from "./decisions";
import { answerWords, formFields } from "./form";
import { normalizePhone } from "./mail";
import { queueApplicantMessage } from "./outbox";
import type { Answers, Criterion, CriterionOutcome, Fact } from "./schema";
import { DAY, HOUR, recruiterSettings } from "./settings";
import { informationEmail, partsFor } from "./words";

export const COLLECT = "recruiter.acknowledge_and_collect";

export type CriterionResult = { key: string; label: string; outcome: CriterionOutcome; evidence: string; source: string; fixed: boolean };
export type Evaluation = {
  results: CriterionResult[];
  contradictions: string[];
  missing: string[];
  summary: { experience: string; availability: string; met: string[]; concerns: string[]; suggestedNextStep: string };
  recommendation: "advance" | "clarify" | "review_requirement";
};

function judge(criterion: Criterion, answers: Answers, asked: Set<string>): { outcome: CriterionOutcome; evidence: string } {
  if (!asked.has(criterion.field)) return { outcome: "not_applicable", evidence: "This role's application does not ask this." };
  const value = answers[criterion.field];
  const said = `Answered "${answerWords(value)}".`;
  if (criterion.test.kind === "person_reviews") return value === undefined ? { outcome: "needs_clarification", evidence: "Not answered." } : { outcome: "not_applicable", evidence: `${said} This one is for a person to judge.` };
  if (value === undefined) return { outcome: "needs_clarification", evidence: "Not answered." };
  switch (criterion.test.kind) {
    case "is_true":
      return typeof value === "boolean" ? { outcome: value ? "meets" : "does_not_meet", evidence: said } : { outcome: "needs_clarification", evidence: said };
    case "at_least":
      return typeof value === "number" ? { outcome: value >= criterion.test.value ? "meets" : "does_not_meet", evidence: `${said} The requirement is at least ${criterion.test.value}.` } : { outcome: "needs_clarification", evidence: said };
    case "includes_any": {
      if (!Array.isArray(value)) return { outcome: "needs_clarification", evidence: said };
      const wanted = criterion.test.values;
      return { outcome: wanted.some((entry) => value.includes(entry)) ? "meets" : "does_not_meet", evidence: `${said} The requirement is at least one of: ${wanted.join(", ")}.` };
    }
    case "includes_all": {
      if (!Array.isArray(value)) return { outcome: "needs_clarification", evidence: said };
      const lacking = criterion.test.values.filter((entry) => !value.includes(entry));
      return { outcome: lacking.length === 0 ? "meets" : "does_not_meet", evidence: lacking.length === 0 ? said : `${said} Not included: ${lacking.join(", ")}.` };
    }
  }
}

/** Where what the applicant wrote differs from what the job board's notification said. Stated, not judged. */
function contradictionsIn(answers: Answers, facts: Fact[], contactAddress: string | undefined): string[] {
  const out: string[] = [];
  const fact = (field: string) => facts.find((row) => row.field === field && row.from !== "form")?.value;
  const phone = fact("phone");
  if (phone && typeof answers.phone === "string" && normalizePhone(phone) !== normalizePhone(answers.phone)) out.push("The phone number on the application is different from the one in the notification.");
  if (contactAddress && typeof answers.email === "string" && answers.email !== contactAddress && !/@(indeedemail|reply\.ziprecruiter)\./.test(contactAddress)) out.push("The email address on the application is different from the one the invitation went to.");
  const years = fact("experience")?.match(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)/i)?.[1];
  if (years !== undefined && typeof answers.experienceYears === "number" && Math.abs(Number(years) - answers.experienceYears) >= 2) out.push(`The notification said ${years} years of experience; the application says ${answers.experienceYears}.`);
  return out;
}

export function evaluate(need: Pick<Doc<"hiringNeeds">, "criteria" | "coverageAreas" | "questions">, answers: Answers, facts: Fact[], contactAddress?: string): Evaluation {
  const fields = formFields(need);
  const asked = new Set(fields.map((field) => field.key));
  const results = need.criteria.map((criterion) => ({ key: criterion.key, label: criterion.label, fixed: criterion.fixed, source: "The application form", ...judge(criterion, answers, asked) }));
  const contradictions = contradictionsIn(answers, facts, contactAddress);
  const unanswered = fields.filter((field) => !field.required && field.kind !== "yes_no" && answers[field.key] === undefined).map((field) => field.label);
  const missing = [...results.filter((row) => row.outcome === "needs_clarification").map((row) => row.label), ...unanswered];
  const notMet = results.filter((row) => row.outcome === "does_not_meet");
  const unclear = results.filter((row) => row.outcome === "needs_clarification");
  const recommendation = notMet.length > 0 ? "review_requirement" : unclear.length > 0 || contradictions.length > 0 ? "clarify" : "advance";
  const own = typeof answers.experienceSummary === "string" ? ` In their words: "${answers.experienceSummary.slice(0, 300)}"` : "";
  const areas = Array.isArray(answers.serviceAreas) && answers.serviceAreas.length > 0 ? ` Areas: ${answers.serviceAreas.join(", ")}.` : "";
  const start = typeof answers.earliestStart === "string" ? ` Could start: ${answers.earliestStart}.` : "";
  return {
    results,
    contradictions,
    missing,
    summary: {
      experience: `${answerWords(answers.experienceYears)} years of paid cleaning experience, as stated.${own}`,
      availability: `Days: ${answerWords(answers.availableDays)}. Hours wanted in a week: ${answerWords(answers.hoursPerWeek)}.${areas}${start}`,
      met: results.filter((row) => row.outcome === "meets").map((row) => row.label),
      concerns: [...notMet.map((row) => `${row.label}: ${row.evidence}`), ...contradictions],
      suggestedNextStep:
        recommendation === "advance"
          ? "Every requirement that code can check is met. Decide whether to interview."
          : recommendation === "clarify"
            ? `Ask the applicant about: ${[...unclear.map((row) => row.label), ...contradictions].join("; ")}. Then decide.`
            : `Review ${notMet.map((row) => `"${row.label}"`).join(", ")}: the answer does not meet it. Decide whether that rules this applicant out.`,
    },
    recommendation,
  };
}

export async function latestScreening(ctx: QueryCtx | MutationCtx, application: Pick<Doc<"applications">, "_id" | "companyId">): Promise<Doc<"screenings"> | null> {
  return ctx.db
    .query("screenings")
    .withIndex("by_company_application", (q) => q.eq("companyId", application.companyId).eq("applicationId", application._id))
    .order("desc")
    .first();
}

/** Evaluates a submitted application and puts the result in front of a person. */
export async function runScreening(ctx: MutationCtx, applicationId: Id<"applications">): Promise<Id<"screenings"> | null> {
  const application = await ctx.db.get(applicationId);
  if (!application || !application.needId || (application.stage !== "application_submitted" && application.stage !== "screening")) return null;
  const need = await ctx.db.get(application.needId);
  const applicant = await ctx.db.get(application.applicantId);
  const session = await ctx.db
    .query("formSessions")
    .withIndex("by_company_application", (q) => q.eq("companyId", application.companyId).eq("applicationId", application._id))
    .first();
  if (!need || !applicant || !session?.submittedAt) return null;
  const result = evaluate(need, session.answers, application.facts, application.contact.address);
  const screeningId = await ctx.db.insert("screenings", { companyId: application.companyId, applicationId, needId: need._id, ...result, createdAt: Date.now() });
  await recordEvent(ctx, { companyId: application.companyId, type: "application.screened", actor: RECRUITER, subject: { table: "screenings", id: screeningId }, data: { applicationId, recommendation: result.recommendation } });
  const who = applicant.name ?? "An applicant";
  const dueAt = Date.now() + 2 * DAY;
  const staged = await setStage(ctx, application, "screening", RECRUITER, { nextAction: { what: `Review ${who}'s screening summary and decide the next step`, by: "owner", dueAt } });
  await askPerson(ctx, staged, {
    what: "review",
    title: `Review ${who} for ${need.title}`,
    question: `${result.summary.suggestedNextStep} Experience: ${result.summary.experience} Availability: ${result.summary.availability} Met: ${result.summary.met.join("; ") || "none checked"}. Concerns: ${result.summary.concerns.join("; ") || "none found"}.`,
    dueAt,
    completionCondition: "A person decided to interview, hold, offer or turn down this applicant",
  });
  // A published fixed requirement that is plainly not met is raised by itself. Whether anything happens without a person is the Owner's setting.
  const fixed = result.results.find((row) => row.fixed && row.outcome === "does_not_meet");
  if (fixed) await proposeOrDecline(ctx, staged, need, fixed);
  return screeningId;
}

const hash = (value: string) => {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** Emails the applicant one question about their application. */
export async function sendInformationRequest(ctx: MutationCtx, applicationId: Id<"applications">, question: string, actor: Actor): Promise<CarriedOut> {
  const application = await ctx.db.get(applicationId);
  const applicant = application ? await ctx.db.get(application.applicantId) : null;
  const company = application ? await ctx.db.get(application.companyId) : null;
  const need = application?.needId ? await ctx.db.get(application.needId) : null;
  if (!application || !applicant || !company || !need) return { ok: false, detail: "The application no longer exists." };
  const settings = recruiterSettings(company);
  const email = informationEmail({ ...partsFor(company, settings.fromName, applicant, need.title), question: question.trim().slice(0, 1000) });
  const message = await queueApplicantMessage(ctx, { company, application, applicant, purpose: "information_request", channel: "email", subject: email.subject, body: email.body, dedupeKey: `info:${application._id}:${hash(question)}`, actor });
  if (message.status === "not_sent") return { ok: false, detail: message.problem ?? "The question could not be sent." };
  await setNextAction(ctx, application, { what: "Answer the question we emailed", by: "applicant", dueAt: Date.now() + 3 * DAY });
  return { ok: true, detail: "The question was handed to the email service." };
}

/** Asks the applicant for something missing: sent, or proposed, as the Owner's permission says. */
export async function requestInformation(ctx: MutationCtx, application: Doc<"applications">, question: string): Promise<{ outcome: "sent" | "proposed" | "refused"; detail: string }> {
  const company = await ctx.db.get(application.companyId);
  const applicant = await ctx.db.get(application.applicantId);
  if (!company || !applicant) return { outcome: "refused", detail: "The application no longer exists." };
  const authority = await authorityFor(ctx, company._id, COLLECT);
  if (authority.kind !== "level" || authority.level === "off") return { outcome: "refused", detail: "Recruiter may not write to applicants." };
  if (authority.level !== "propose") {
    const sent = await sendInformationRequest(ctx, application._id, question, RECRUITER);
    return { outcome: sent.ok ? "sent" : "refused", detail: sent.detail };
  }
  const decideBy = Date.now() + recruiterSettings(company).decideWithinHours * HOUR;
  await requestApproval(ctx, {
    companyId: company._id,
    action: COLLECT,
    summary: `Ask ${applicant.name ?? "an applicant"} a question about their application`,
    reason: `Something needed to review this application is missing or unclear. The question: "${question.slice(0, 500)}"`,
    authorizes: `One email to ${application.contact.address ?? "the applicant"} with this question. Nothing else.`,
    ifWaiting: "Nothing is sent.",
    decideBy,
    proposal: { kind: "request_information", applicationId: application._id, question: question.slice(0, 1000) },
    about: { table: "applications", id: application._id },
  });
  return { outcome: "proposed", detail: "The question is waiting for a person's approval." };
}
