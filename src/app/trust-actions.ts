"use server";

import { createHash } from "node:crypto";

import { ConvexHttpClient } from "convex/browser";
import { headers } from "next/headers";

import { submitTrustRequest, type RequestKind, type RequestState, type SaveRequest } from "@/lib/trust/requests";

import { api } from "../../convex/_generated/api";

/** Saving needs the Convex address and the secret this server shares with it. The secret never leaves the server. */
function saver(): SaveRequest {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  const secret = process.env.PUBLIC_FORM_SECRET?.trim();
  if (!url || !/^https:\/\//.test(url) || !secret) return null;
  return async (input) => {
    const client = new ConvexHttpClient(url);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), 8000);
    });
    try {
      return await Promise.race([client.mutation(api.requests.submit, { ...input, secret }), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** The visitor's address is only ever kept as a hash, and only to slow down a flood of requests. */
async function visitorKey(): Promise<string> {
  const list = await headers();
  const address = list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip")?.trim() || "unknown";
  return createHash("sha256").update(`trust:${address}`).digest("hex").slice(0, 32);
}

async function send(kind: RequestKind, form: FormData): Promise<RequestState> {
  return submitTrustRequest(kind, form, await visitorKey(), saver());
}

export async function sendPrivacyRequest(_previous: RequestState, form: FormData): Promise<RequestState> {
  return send("privacy", form);
}

export async function sendVulnerabilityReport(_previous: RequestState, form: FormData): Promise<RequestState> {
  return send("vulnerability", form);
}

export async function sendSecurityReview(_previous: RequestState, form: FormData): Promise<RequestState> {
  return send("security_review", form);
}
