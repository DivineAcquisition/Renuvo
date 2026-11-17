"use server";

import { createHash } from "node:crypto";

import { ConvexHttpClient } from "convex/browser";
import { headers } from "next/headers";

import { api } from "../../../../convex/_generated/api";

export type BookingFormInput = {
  publicId: string;
  name: string;
  email: string;
  phone: string;
  serviceKey: string;
  answers: Record<string, string | number | boolean>;
  smsConsent: boolean;
  website: string;
  elapsedMs: number;
  clientKey: string;
  campaign?: string;
  medium?: string;
  referrer?: string;
};

export type BookingFormResult = { status: "saved"; title: string; body: string } | { status: "invalid"; problems: Record<string, string> } | { status: "limited" } | { status: "closed" } | { status: "unavailable" };

const str = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");

/** The visitor's address is only ever kept as a hash, and only to slow down a flood of submissions. */
async function visitorKey(): Promise<string> {
  const list = await headers();
  const address = list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip")?.trim() || "unknown";
  return createHash("sha256").update(`sales-form:${address}`).digest("hex").slice(0, 32);
}

/**
 * Takes one booking-form submission from the public page and hands it to Convex with the secret only
 * this server holds. Nothing from the browser is trusted for shape or size: it is cut to what a form can
 * carry here, and checked against the published form there. It never reports success for a submission
 * that was not saved.
 */
export async function submitBookingForm(input: BookingFormInput): Promise<BookingFormResult> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  const secret = process.env.PUBLIC_FORM_SECRET?.trim();
  // A local backend on this machine is allowed over http, for development and the browser tests only.
  if (!url || !secret || !(/^https:\/\//.test(url) || /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url))) return { status: "unavailable" };

  const answers: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input?.answers ?? {}).slice(0, 40)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) continue;
    if (typeof value === "string") answers[key] = value.slice(0, 1200);
    else if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) answers[key] = value;
  }
  const client = new ConvexHttpClient(url);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), 8000);
  });
  try {
    return await Promise.race([
      client.mutation(api.salesFormPages.submit, {
        secret,
        publicId: str(input?.publicId, 64),
        name: str(input?.name, 200),
        email: str(input?.email, 320),
        phone: str(input?.phone, 40),
        message: "",
        serviceKey: str(input?.serviceKey, 80),
        answers,
        smsConsent: input?.smsConsent === true,
        website: str(input?.website, 200),
        elapsedMs: typeof input?.elapsedMs === "number" && Number.isFinite(input.elapsedMs) ? Math.max(0, Math.min(input.elapsedMs, 86_400_000)) : 0,
        clientKey: str(input?.clientKey, 80),
        visitorKey: await visitorKey(),
        ...(str(input?.campaign, 120) ? { campaign: str(input?.campaign, 120) } : {}),
        ...(str(input?.medium, 60) ? { medium: str(input?.medium, 60) } : {}),
        ...(str(input?.referrer, 200) ? { referrer: str(input?.referrer, 200) } : {}),
      }),
      timeout,
    ]);
  } catch {
    return { status: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
