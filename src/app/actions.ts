"use server";

import { WAITLIST } from "@/lib/marketing/content";

export type WaitlistState = { status: "idle" } | { status: "done" } | { status: "error"; message: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function text(form: FormData, key: string, max: number) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Sends one waitlist entry to WAITLIST_WEBHOOK_URL. Nothing is stored in this app yet.
 * If the address is not set, the visitor is told the waitlist is not open. It never reports
 * success for an entry that went nowhere.
 */
export async function joinWaitlist(_previous: WaitlistState, form: FormData): Promise<WaitlistState> {
  // A field people never see. Only an automated form filler completes it.
  if (text(form, "website", 200)) return { status: "done" };

  const entry = {
    name: text(form, "name", 120),
    company: text(form, "company", 160),
    email: text(form, "email", 200).toLowerCase(),
    size: text(form, "size", 40),
  };
  const sizeOk = (WAITLIST.sizes as readonly string[]).includes(entry.size);
  if (!entry.name || !entry.company || !EMAIL.test(entry.email) || !sizeOk) {
    return { status: "error", message: WAITLIST.errors.invalid };
  }

  const url = process.env.WAITLIST_WEBHOOK_URL?.trim();
  if (!url || !/^https:\/\//.test(url)) return { status: "error", message: WAITLIST.errors.closed };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...entry, source: "renuvo-landing", at: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!response.ok) return { status: "error", message: WAITLIST.errors.failed };
  } catch {
    return { status: "error", message: WAITLIST.errors.failed };
  }
  return { status: "done" };
}
