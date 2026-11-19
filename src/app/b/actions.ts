"use server";

import { createHmac } from "node:crypto";

import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { headers } from "next/headers";

import { api } from "../../../convex/_generated/api";

/**
 * The two booking steps that go through Selestial's own server: starting a session and signing the
 * agreement. The server adds a keyed hash of the visitor's network address (never the address) for rate
 * limits and signing evidence, and the secret it shares with Convex. Nothing else passes through here.
 */
function client(): { client: ConvexHttpClient; secret: string } | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  const secret = process.env.PUBLIC_FORM_SECRET?.trim();
  if (!url || !/^https:\/\//.test(url) || !secret) return null;
  return { client: new ConvexHttpClient(url), secret };
}

async function visitor(secret: string): Promise<{ key: string; userAgent: string }> {
  const list = await headers();
  const address = list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip")?.trim() || "unknown";
  return { key: createHmac("sha256", secret).update(`booking:${address}`).digest("hex").slice(0, 40), userAgent: (list.get("user-agent") ?? "").slice(0, 300) };
}

function why(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: unknown } | undefined;
    if (data && typeof data.message === "string") return data.message;
  }
  return "That didn't go through. Please try again.";
}

export type Attribution = { source: string; medium: string; campaign: string; referrer: string; landing: string };

export async function startBooking(input: { handle: string; slug: string; postalCode: string; attribution: Attribution }): Promise<{ ok: true; token: string } | { ok: false; why: string }> {
  const c = client();
  if (!c) return { ok: false, why: "Online booking isn't available right now. Please contact the company." };
  try {
    const { key } = await visitor(c.secret);
    const result = await c.client.mutation(api.bookingPublic.start, { secret: c.secret, handle: input.handle, slug: input.slug, postalCode: input.postalCode, attribution: input.attribution, visitorKey: key });
    if ("refused" in result) return { ok: false, why: result.refused as string };
    return { ok: true, token: result.token };
  } catch (error) {
    return { ok: false, why: why(error) };
  }
}

export async function signBookingAgreement(input: { token: string; signerName: string; drawn?: string; contentHash: string }): Promise<{ ok: true } | { ok: false; why: string }> {
  const c = client();
  if (!c) return { ok: false, why: "Signing isn't available right now. Please contact the company." };
  try {
    const { key, userAgent } = await visitor(c.secret);
    const result = await c.client.mutation(api.bookingPublic.sign, { secret: c.secret, token: input.token, signerName: input.signerName, drawn: input.drawn, contentHash: input.contentHash, visitorKey: key, userAgent });
    if ("refused" in result) return { ok: false, why: result.refused as string };
    return { ok: true };
  } catch (error) {
    return { ok: false, why: why(error) };
  }
}

export async function unsubscribeFromBookingEmail(input: { token: string }): Promise<{ ok: true } | { ok: false; why: string }> {
  const c = client();
  if (!c) return { ok: false, why: "This isn't available right now. Please contact the company directly." };
  try {
    await c.client.mutation(api.bookingPublic.unsubscribe, { secret: c.secret, token: input.token.slice(0, 200) });
    return { ok: true };
  } catch (error) {
    return { ok: false, why: why(error) };
  }
}

/**
 * Someone agrees to a company's texts on its sign-up page. The page version they saw is sent with it, so
 * the permission is recorded against exactly that wording.
 */
export async function signUpForTexts(input: { handle: string; version: number; name: string; phone: string; texts: boolean; marketing: boolean }): Promise<{ ok: true; words: string } | { ok: false; why: string }> {
  const c = client();
  if (!c) return { ok: false, why: "Sign-up isn't available right now. Please contact the business directly." };
  try {
    const { key } = await visitor(c.secret);
    const result = await c.client.mutation(api.textingPublic.signup, { secret: c.secret, handle: input.handle.slice(0, 60), version: input.version, name: input.name.slice(0, 120), phone: input.phone.slice(0, 40), texts: input.texts === true, marketing: input.marketing === true, visitorKey: key });
    if ("refused" in result) return { ok: false, why: result.refused };
    return { ok: true, words: result.words };
  } catch (error) {
    return { ok: false, why: why(error) };
  }
}
