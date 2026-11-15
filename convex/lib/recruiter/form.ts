/**
 * The application form: a fixed set of standard questions, plus the questions the Owner added for the
 * role. It asks what is needed to assess an applicant and nothing kept for onboarding: no tax
 * identifier, no bank details, no identity documents.
 */
import type { Doc } from "../../_generated/dataModel";
import { userError } from "../errors";
import { isEmail } from "../text";
import { normalizePhone, oneLine } from "./mail";
import type { Answer, Answers, Question } from "./schema";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export const SMS_CONSENT_WORDING = "You may text me at this number about this application. Message and data rates may apply. I can reply STOP at any time. This is optional.";
export const ATTEST_WORDING = "The information I have given is true and complete to the best of my knowledge.";

export type FieldKind = "text" | "long_text" | "email" | "phone" | "number" | "yes_no" | "choice" | "multi";
export type Field = { key: string; label: string; kind: FieldKind; required: boolean; options?: string[]; help?: string; section: "you" | "experience" | "availability" | "role" };

/** The fields a criterion may read. Anything else is refused when the role is saved. */
export const SCREENABLE = ["experienceYears", "availableDays", "hoursPerWeek", "serviceAreas"] as const;

export function questionField(question: Question): Field {
  return { key: `q.${question.key}`, label: question.label, kind: question.kind === "yes_no" ? "yes_no" : question.kind === "number" ? "number" : question.kind === "choice" ? "choice" : "long_text", required: question.required, options: question.options, section: "role" };
}

export function formFields(need: Pick<Doc<"hiringNeeds">, "coverageAreas" | "questions">): Field[] {
  const fields: Field[] = [
    { key: "fullName", label: "Full name", kind: "text", required: true, section: "you" },
    { key: "email", label: "Email address", kind: "email", required: true, section: "you" },
    { key: "phone", label: "Phone number", kind: "phone", required: false, section: "you" },
    { key: "smsConsent", label: SMS_CONSENT_WORDING, kind: "yes_no", required: false, section: "you" },
    { key: "city", label: "City or area you live in", kind: "text", required: false, help: "A general area is enough. We do not need your street address.", section: "you" },
    { key: "experienceYears", label: "Years of paid cleaning experience", kind: "number", required: true, section: "experience" },
    { key: "experienceSummary", label: "Tell us about your relevant experience", kind: "long_text", required: false, section: "experience" },
    { key: "availableDays", label: "Days you can usually work", kind: "multi", required: true, options: [...WEEKDAYS], section: "availability" },
    { key: "hoursPerWeek", label: "Hours you want to work in a week", kind: "number", required: true, section: "availability" },
    { key: "earliestStart", label: "When could you start?", kind: "text", required: false, section: "availability" },
  ];
  if (need.coverageAreas.length > 0) fields.push({ key: "serviceAreas", label: "Areas you can work in", kind: "multi", required: true, options: need.coverageAreas, section: "availability" });
  return [...fields, ...need.questions.map(questionField)];
}

function clean(field: Field, value: Answer): Answer | undefined {
  switch (field.kind) {
    case "yes_no":
      return typeof value === "boolean" ? value : undefined;
    case "number":
      return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10_000 ? value : undefined;
    case "multi":
      return Array.isArray(value) ? [...new Set(value.filter((entry) => field.options?.includes(entry)))] : undefined;
    case "choice":
      return typeof value === "string" && field.options?.includes(value) ? value : undefined;
    case "email": {
      const email = typeof value === "string" ? value.trim().toLowerCase() : "";
      return isEmail(email) ? email : undefined;
    }
    case "phone": {
      const phone = typeof value === "string" ? normalizePhone(value) : null;
      return phone ?? undefined;
    }
    default: {
      if (typeof value !== "string") return undefined;
      const text = field.kind === "long_text" ? value.replace(/\r/g, "").trim().slice(0, 2000) : oneLine(value, 160);
      return text || undefined;
    }
  }
}

/** Keeps only answers to this form's own questions, each in its proper shape. Anything else is dropped. */
export function cleanAnswers(fields: Field[], answers: Answers): Answers {
  const out: Answers = {};
  for (const field of fields) {
    const value = answers[field.key];
    if (value === undefined) continue;
    const cleaned = clean(field, value);
    if (cleaned !== undefined) out[field.key] = cleaned;
  }
  return out;
}

/** The questions still unanswered that must be answered before submitting. */
export function missingRequired(fields: Field[], answers: Answers): Field[] {
  return fields.filter((field) => {
    if (!field.required) return false;
    const value = answers[field.key];
    return value === undefined || (Array.isArray(value) && value.length === 0) || value === "";
  });
}

export function assertSubmittable(fields: Field[], answers: Answers): void {
  const missing = missingRequired(fields, answers);
  if (missing.length > 0) throw userError(`Please answer: ${missing.map((field) => field.label).join("; ")}.`);
  if (answers.smsConsent === true && !answers.phone) throw userError("Add a phone number, or untick the permission to text.");
}

/** How much of the required part is done, as counts. Not a percentage of anything else. */
export function completion(fields: Field[], answers: Answers): { answered: number; required: number } {
  const required = fields.filter((field) => field.required);
  return { answered: required.length - missingRequired(fields, answers).length, required: required.length };
}

export function answerWords(value: Answer | undefined): string {
  if (value === undefined) return "not answered";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "none";
  return String(value);
}
