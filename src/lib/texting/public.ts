import "server-only";

import { ConvexHttpClient } from "convex/browser";
import { connection } from "next/server";
import type { FunctionReturnType } from "convex/server";

import { convexUrl } from "@/lib/app/config";

import { api } from "../../../convex/_generated/api";

/**
 * A company's published texting page, read on the server so the full text is in the page's HTML: carriers'
 * reviewers and Selestial's own link check read it without running any script. Null when the page doesn't
 * exist or the backend can't be reached in time.
 */
export type TextingPage = NonNullable<FunctionReturnType<typeof api.textingPublic.page>>;

export async function loadTextingPage(handle: string, kind: "privacy" | "terms" | "signup"): Promise<TextingPage | null> {
  // Always read at request time: a republished page must show its new words at once.
  await connection();
  const url = convexUrl();
  if (!url || !/^[a-z0-9-]{1,60}$/i.test(handle)) return null;
  try {
    const client = new ConvexHttpClient(url);
    const page = await Promise.race([client.query(api.textingPublic.page, { handle, kind }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), 5000))]);
    return page;
  } catch {
    return null;
  }
}
