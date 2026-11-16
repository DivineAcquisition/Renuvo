/**
 * Hiring needs: the roles a company is hiring for. Only the Owner opens, changes, pauses or closes one,
 * and only the Owner sets its pay. Dispatch can ask for staffing help, but a request is a task for a
 * person: it opens no role and approves no pay.
 */
import { v } from "convex/values";

import { owned } from "./lib/access";
import { companyQuery, ownerMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { assertJobRelated } from "./lib/recruiter/fairness";
import { formFields, SCREENABLE } from "./lib/recruiter/form";
import { routeApplication } from "./lib/recruiter/invitations";
import { compensationValidator, criterionValidator, needStatusValidator, questionValidator, type Criterion, type Question } from "./lib/recruiter/schema";
import { cents, instant, optionalText, tags, text } from "./lib/text";

const needFields = {
  title: v.string(),
  titleAliases: v.optional(v.array(v.string())),
  responsibilities: v.string(),
  serviceTypes: v.optional(v.array(v.string())),
  location: v.string(),
  coverageAreas: v.optional(v.array(v.string())),
  requiredAvailability: v.string(),
  requiredSkills: v.optional(v.array(v.string())),
  experience: v.optional(v.string()),
  equipment: v.optional(v.string()),
  engagement: v.union(v.literal("contractor"), v.literal("employee")),
  openings: v.number(),
  targetStartAt: v.optional(v.number()),
  questions: v.optional(v.array(questionValidator)),
  criteria: v.optional(v.array(criterionValidator)),
  interviewProcess: v.optional(v.string()),
  fromTaskId: v.optional(v.id("tasks")),
};

const KEY = /^[a-z][a-z0-9_]{1,39}$/;

function checkedQuestions(questions: Question[]): Question[] {
  if (questions.length > 20) throw userError("An application can have at most 20 extra questions.");
  const keys = new Set<string>();
  return questions.map((question) => {
    if (!KEY.test(question.key) || keys.has(question.key)) throw userError("Each question needs its own short key of lower-case letters, digits and underscores.");
    keys.add(question.key);
    const label = text(question.label, "The question", 300);
    assertJobRelated(label, `The question "${label}"`);
    const options = question.kind === "choice" ? tagsKeepCase(question.options ?? []) : undefined;
    if (question.kind === "choice" && (!options || options.length < 2)) throw userError(`"${label}" needs at least two choices.`);
    for (const option of options ?? []) assertJobRelated(option, `The choice "${option}"`);
    return { key: question.key, label, kind: question.kind, options, required: question.required };
  });
}

function tagsKeepCase(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().slice(0, 80)).filter(Boolean))].slice(0, 20);
}

function checkedCriteria(criteria: Criterion[], questions: Question[], coverageAreas: string[]): Criterion[] {
  if (criteria.length > 20) throw userError("A role can have at most 20 screening criteria.");
  const fields = new Map(formFields({ coverageAreas, questions }).map((field) => [field.key, field]));
  const keys = new Set<string>();
  return criteria.map((criterion) => {
    if (!KEY.test(criterion.key) || keys.has(criterion.key)) throw userError("Each criterion needs its own short key of lower-case letters, digits and underscores.");
    keys.add(criterion.key);
    const label = text(criterion.label, "The criterion", 300);
    assertJobRelated(label, `The criterion "${label}"`);
    const field = fields.get(criterion.field);
    // Screening reads only what the applicant was asked for the job: never a name, an address or free text about themselves.
    if (!field || !((SCREENABLE as readonly string[]).includes(criterion.field) || criterion.field.startsWith("q."))) throw userError(`"${label}" does not read a question this role's application asks.`);
    const kind = criterion.test.kind;
    const fits = kind === "person_reviews" || (kind === "is_true" && field.kind === "yes_no") || (kind === "at_least" && field.kind === "number") || ((kind === "includes_any" || kind === "includes_all") && field.kind === "multi");
    if (!fits) throw userError(`"${label}" cannot be checked that way against the answer to "${field.label}".`);
    if ((kind === "includes_any" || kind === "includes_all") && criterion.test.values.some((value) => !field.options?.includes(value))) throw userError(`"${label}" names a choice the question does not offer.`);
    // Only a plain yes-or-no or a number can be a published fixed requirement.
    if (criterion.fixed && kind !== "is_true" && kind !== "at_least") throw userError(`"${label}" cannot be a fixed requirement. Only a yes-or-no or a minimum number can.`);
    return { ...criterion, label };
  });
}

function checked(args: { [K in keyof typeof needFields]?: unknown } & Record<string, unknown>) {
  const input = args as {
    title: string; titleAliases?: string[]; responsibilities: string; serviceTypes?: string[]; location: string; coverageAreas?: string[]; requiredAvailability: string; requiredSkills?: string[];
    experience?: string; equipment?: string; engagement: "contractor" | "employee"; openings: number; targetStartAt?: number; questions?: Question[]; criteria?: Criterion[]; interviewProcess?: string;
  };
  if (!Number.isInteger(input.openings) || input.openings < 1 || input.openings > 500) throw userError("The number of openings must be a whole number, one or more.");
  const coverageAreas = tags(input.coverageAreas ?? [], "Coverage areas", 200).map((code) => code.toUpperCase());
  const questions = checkedQuestions(input.questions ?? []);
  for (const value of [input.responsibilities, input.requiredAvailability, input.experience ?? "", input.equipment ?? ""]) assertJobRelated(value, "The role's description");
  return {
    title: text(input.title, "The role", 120),
    titleAliases: tagsKeepCase(input.titleAliases ?? []),
    responsibilities: text(input.responsibilities, "Responsibilities", 4000),
    serviceTypes: tags(input.serviceTypes ?? [], "Service types"),
    location: text(input.location, "Location", 200),
    coverageAreas,
    requiredAvailability: text(input.requiredAvailability, "Required availability", 1000),
    requiredSkills: tags(input.requiredSkills ?? [], "Skills"),
    experience: optionalText(input.experience, "Experience", 1000),
    equipment: optionalText(input.equipment, "Equipment or transportation", 1000),
    engagement: input.engagement,
    openings: input.openings,
    targetStartAt: input.targetStartAt === undefined ? undefined : instant(input.targetStartAt, "The target start date"),
    questions,
    criteria: checkedCriteria(input.criteria ?? [], questions, coverageAreas),
    interviewProcess: optionalText(input.interviewProcess, "The interview process", 2000),
  };
}

export const list = companyQuery({
  args: { status: v.optional(needStatusValidator) },
  handler: async (ctx, args) => {
    const out = [];
    for (const status of args.status ? [args.status] : (["open", "paused", "closed"] as const)) {
      const rows = await ctx.db
        .query("hiringNeeds")
        .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", status))
        .take(200);
      for (const need of rows) {
        const applications = await ctx.db
          .query("applications")
          .withIndex("by_company_need", (q) => q.eq("companyId", ctx.companyId).eq("needId", need._id))
          .take(1000);
        out.push({ ...need, applications: applications.length, active: applications.filter((row) => row.stage !== "closed" && row.stage !== "withdrawn").length, hired: applications.filter((row) => row.closure?.reason === "hired" || row.stage === "onboarding_handoff").length });
      }
    }
    return out;
  },
});

export const get = companyQuery({
  args: { needId: v.id("hiringNeeds") },
  handler: async (ctx, args) => {
    const need = await owned(ctx, args.needId);
    return { ...need, form: formFields(need) };
  },
});

export const create = ownerMutation({
  args: needFields,
  handler: async (ctx, args) => {
    if (args.fromTaskId) await owned(ctx, args.fromTaskId);
    const needId = await ctx.db.insert("hiringNeeds", { companyId: ctx.companyId, ...checked(args), status: "open", fromTaskId: args.fromTaskId, createdBy: ctx.member._id, createdAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "hiring_need.opened", actor: byMember(ctx), subject: { table: "hiringNeeds", id: needId }, data: { fromDispatchRequest: Boolean(args.fromTaskId) } });
    return needId;
  },
});

export const update = ownerMutation({
  args: { needId: v.id("hiringNeeds"), ...needFields },
  handler: async (ctx, args) => {
    const need = await owned(ctx, args.needId);
    await ctx.db.patch(need._id, checked(args));
    await recordEvent(ctx, { companyId: ctx.companyId, type: "hiring_need.changed", actor: byMember(ctx), subject: { table: "hiringNeeds", id: need._id } });
    return null;
  },
});

/** The pay the Owner approves for this role. It is the only pay an offer for the role can carry. */
export const setCompensation = ownerMutation({
  args: { needId: v.id("hiringNeeds"), pay: compensationValidator.fields.pay, note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const need = await owned(ctx, args.needId);
    if (args.pay.kind === "share" && (!Number.isInteger(args.pay.shareBps) || args.pay.shareBps <= 0 || args.pay.shareBps > 10_000)) throw userError("The share must be between 0 and 100 percent.");
    if (args.pay.kind === "hourly") cents(args.pay.hourlyCents, "The hourly rate");
    if ((args.pay.kind === "share") !== (need.engagement === "contractor")) throw userError(need.engagement === "contractor" ? "A contractor role is paid a share of the job." : "An employee role is paid by the hour.");
    await ctx.db.patch(need._id, { compensation: { pay: args.pay, note: optionalText(args.note, "The note", 500), approvedBy: ctx.member._id, approvedAt: Date.now() } });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "hiring_need.pay_approved", actor: byMember(ctx), subject: { table: "hiringNeeds", id: need._id } });
    return null;
  },
});

/** Opens, pauses or closes the role. Reopening lets Recruiter pick the waiting applications back up. */
export const setStatus = ownerMutation({
  args: { needId: v.id("hiringNeeds"), status: needStatusValidator },
  handler: async (ctx, args) => {
    const need = await owned(ctx, args.needId);
    if (need.status === args.status) return null;
    await ctx.db.patch(need._id, { status: args.status });
    await recordEvent(ctx, { companyId: ctx.companyId, type: `hiring_need.${args.status === "open" ? "opened" : args.status}`, actor: byMember(ctx), subject: { table: "hiringNeeds", id: need._id }, data: { from: need.status } });
    if (args.status === "open") {
      const waiting = await ctx.db
        .query("applications")
        .withIndex("by_company_need", (q) => q.eq("companyId", ctx.companyId).eq("needId", need._id))
        .take(500);
      for (const application of waiting) await routeApplication(ctx, application._id);
    }
    return null;
  },
});
