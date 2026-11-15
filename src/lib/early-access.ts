/**
 * The early-access form's server side, apart from Next.js so it can be tested. A request is reported as
 * received only when Convex answers that it was saved. Anything else is an error the visitor sees.
 */
import { EARLY_ACCESS } from "@/lib/marketing/content";

export type EarlyAccessState = { status: "idle" } | { status: "done" } | { status: "error"; message: string };

export type EarlyAccessEntry = { name: string; email: string; company: string; focus: string };
export type SaveResult = { status: "saved" } | { status: "invalid" } | { status: "limited" };
/** Saves one request. Null when saving is not set up in this environment. Throws when the save fails. */
export type Save = ((entry: EarlyAccessEntry & { visitorKey: string }) => Promise<SaveResult>) | null;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function text(form: FormData, key: string, max: number) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const error = (message: string): EarlyAccessState => ({ status: "error", message });

export async function submitEarlyAccess(form: FormData, visitorKey: string, save: Save): Promise<EarlyAccessState> {
  // A field people never see. Only an automated form filler completes it, and it is told nothing useful.
  if (text(form, "website", 200)) return { status: "done" };

  const entry = {
    name: text(form, "name", 120),
    email: text(form, "email", 200).toLowerCase(),
    company: text(form, "company", 160),
    focus: text(form, "focus", 40),
  };
  const focusOk = (EARLY_ACCESS.focusOptions as readonly string[]).includes(entry.focus);
  if (!entry.name || !entry.company || !EMAIL.test(entry.email) || !focusOk) return error(EARLY_ACCESS.errors.invalid);

  if (!save) return error(EARLY_ACCESS.errors.closed);
  try {
    const result = await save({ ...entry, visitorKey });
    if (result.status === "saved") return { status: "done" };
    if (result.status === "limited") return error(EARLY_ACCESS.errors.limited);
    if (result.status === "invalid") return error(EARLY_ACCESS.errors.invalid);
    return error(EARLY_ACCESS.errors.failed);
  } catch {
    return error(EARLY_ACCESS.errors.failed);
  }
}
