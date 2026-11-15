"use server";

import { EARLY_ACCESS } from "@/lib/marketing/content";

export type EarlyAccessState = { status: "idle" } | { status: "done" } | { status: "error"; message: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function text(form: FormData, key: string, max: number) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Sends one early-access request to EARLY_ACCESS_WEBHOOK_URL. Nothing is stored in this app yet.
 * If the address is not set, the visitor is told requests are not open. It never reports success
 * for a request that went nowhere.
 */
export async function requestEarlyAccess(_previous: EarlyAccessState, form: FormData): Promise<EarlyAccessState> {
  // A field people never see. Only an automated form filler completes it.
  if (text(form, "website", 200)) return { status: "done" };

  const entry = {
    name: text(form, "name", 120),
    email: text(form, "email", 200).toLowerCase(),
    company: text(form, "company", 160),
    focus: text(form, "focus", 40),
  };
  const focusOk = (EARLY_ACCESS.focusOptions as readonly string[]).includes(entry.focus);
  if (!entry.name || !entry.company || !EMAIL.test(entry.email) || !focusOk) {
    return { status: "error", message: EARLY_ACCESS.errors.invalid };
  }

  const url = process.env.EARLY_ACCESS_WEBHOOK_URL?.trim();
  if (!url || !/^https:\/\//.test(url)) return { status: "error", message: EARLY_ACCESS.errors.closed };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...entry, source: "selestial-landing", at: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!response.ok) return { status: "error", message: EARLY_ACCESS.errors.failed };
  } catch {
    return { status: "error", message: EARLY_ACCESS.errors.failed };
  }
  return { status: "done" };
}
