/**
 * The operations-assessment form's server side, apart from Next.js so it can be tested. A request is
 * reported as received only when Convex answers that it was saved. Anything else is an error the visitor sees.
 */
import { EARLY_ACCESS } from "@/lib/marketing/content";

import { ASSESSMENT_QUESTIONS, checkedAnswers, phoneOk, websiteOk, type AssessmentAnswers, type AssessmentQuestion } from "../../convex/lib/assessment";

export type EarlyAccessState = { status: "idle" } | { status: "done" } | { status: "error"; message: string };

export type EarlyAccessEntry = AssessmentAnswers & { name: string; email: string; company: string; phone: string; website: string; smsConsent: boolean };
export type SaveResult = { status: "saved" } | { status: "invalid" } | { status: "limited" };
/** Saves one request. Null when saving is not set up in this environment. Throws when the save fails. */
export type Save = ((entry: EarlyAccessEntry & { visitorKey: string }) => Promise<SaveResult>) | null;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The name of the field people never see. The real website field is "businessPage". */
export const TRAP_FIELD = "fax";

function text(form: FormData, key: string, max: number) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const error = (message: string): EarlyAccessState => ({ status: "error", message });

export async function submitEarlyAccess(form: FormData, visitorKey: string, save: Save): Promise<EarlyAccessState> {
  // A field people never see. Only an automated form filler completes it, and it is told nothing useful.
  if (text(form, TRAP_FIELD, 200)) return { status: "done" };

  const name = text(form, "name", 120);
  const email = text(form, "email", 200).toLowerCase();
  const company = text(form, "company", 160);
  const phone = text(form, "phone", 41);
  const website = text(form, "businessPage", 201);
  const raw = {} as Record<AssessmentQuestion, string>;
  for (const question of ASSESSMENT_QUESTIONS) raw[question] = text(form, question, 40);
  const answers = checkedAnswers(raw);
  if (!name || !company || !EMAIL.test(email) || !answers || !phoneOk(phone) || !websiteOk(website)) return error(EARLY_ACCESS.errors.invalid);

  if (!save) return error(EARLY_ACCESS.errors.closed);
  try {
    const result = await save({
      ...answers,
      name,
      email,
      company,
      phone,
      website,
      // Consent to texts counts only when the box was ticked. It is never needed to submit.
      smsConsent: form.get("smsConsent") === "yes",
      visitorKey,
    });
    if (result.status === "saved") return { status: "done" };
    if (result.status === "limited") return error(EARLY_ACCESS.errors.limited);
    if (result.status === "invalid") return error(EARLY_ACCESS.errors.invalid);
    return error(EARLY_ACCESS.errors.failed);
  } catch {
    return error(EARLY_ACCESS.errors.failed);
  }
}
