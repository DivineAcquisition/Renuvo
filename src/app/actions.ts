"use server";

import { createHash } from "node:crypto";

import { ConvexHttpClient } from "convex/browser";
import { headers } from "next/headers";

import { submitEarlyAccess, type EarlyAccessState, type Save } from "@/lib/early-access";

import { api } from "../../convex/_generated/api";

/**
 * Saving needs the Convex address and the secret this server shares with it. Without both, the form says
 * requests are not open. The secret never leaves the server.
 */
function saver(): Save {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  const secret = process.env.PUBLIC_FORM_SECRET?.trim();
  if (!url || !/^https:\/\//.test(url) || !secret) return null;
  return async (entry) => {
    const client = new ConvexHttpClient(url);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), 8000);
    });
    try {
      return await Promise.race([client.mutation(api.earlyAccess.request, { ...entry, secret }), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** The visitor's address is only ever kept as a hash, and only to slow down a flood of requests. */
async function visitorKey(): Promise<string> {
  const list = await headers();
  const address = list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip")?.trim() || "unknown";
  return createHash("sha256").update(address).digest("hex").slice(0, 32);
}

/** Stores one early-access request in Convex. It never reports success for a request that was not saved. */
export async function requestEarlyAccess(_previous: EarlyAccessState, form: FormData): Promise<EarlyAccessState> {
  return submitEarlyAccess(form, await visitorKey(), saver());
}
