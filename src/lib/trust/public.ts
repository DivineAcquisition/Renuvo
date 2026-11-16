import "server-only";

import { ConvexHttpClient } from "convex/browser";

import { convexUrl } from "@/lib/app/config";

import { api } from "../../../convex/_generated/api";
import { SEED_PUBLIC_SNAPSHOT, type PublicSnapshot } from "../../../convex/lib/trust/seed";

/**
 * What the public pages may show about Selestial's operator, providers, claims and documents: only
 * what staff have marked verified and public in the trust records (convex/trust.ts). If the record
 * cannot be reached, the pages fall back to the same seed the record started from, which holds the
 * owner-confirmed facts only.
 */
export type PublicTrust = PublicSnapshot;

export async function loadPublicTrust(): Promise<PublicTrust> {
  const url = convexUrl();
  if (!url) return SEED_PUBLIC_SNAPSHOT;
  try {
    const client = new ConvexHttpClient(url);
    const snapshot = await Promise.race([client.query(api.trust.publicSnapshot, {}), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), 4000))]);
    return snapshot;
  } catch {
    return SEED_PUBLIC_SNAPSHOT;
  }
}

/** "2026-11-16" as "November 16, 2026", in UTC so the date never shifts by a day. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}
