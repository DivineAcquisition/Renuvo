/**
 * Every optional tool the public site can load, and the only place one is turned on. A tool is
 * "configured" when its setting exists; none is loaded unless it is configured AND its category is
 * allowed AND the page is one where tracking may run (pages.ts). Nothing here is loaded by a <script>
 * tag in the page source: the loader adds each script only after the choice allows it.
 *
 * Settings (Vercel, Production): NEXT_PUBLIC_VERCEL_ANALYTICS=1, NEXT_PUBLIC_GA4_ID, NEXT_PUBLIC_GOOGLE_ADS_ID,
 * NEXT_PUBLIC_META_PIXEL_ID. They are public by nature (they appear in the browser), not secrets.
 */
import type { OptionalCategory } from "./model";

export type TrackingTool = {
  key: "vercel-analytics" | "ga4" | "google-ads" | "meta-pixel";
  name: string;
  company: string;
  category: OptionalCategory;
  purpose: string;
  /** Cookies or browser storage it may set, as the provider documents them. */
  stores: string;
  /** Its own id, from settings. Null means the tool is not set up and never loads. */
  id: string | null;
  privacyUrl: string;
};

function setting(value: string | undefined, pattern: RegExp): string | null {
  const text = value?.trim();
  return text && pattern.test(text) ? text : null;
}

export function trackingTools(env: Record<string, string | undefined> = {
  NEXT_PUBLIC_VERCEL_ANALYTICS: process.env.NEXT_PUBLIC_VERCEL_ANALYTICS,
  NEXT_PUBLIC_GA4_ID: process.env.NEXT_PUBLIC_GA4_ID,
  NEXT_PUBLIC_GOOGLE_ADS_ID: process.env.NEXT_PUBLIC_GOOGLE_ADS_ID,
  NEXT_PUBLIC_META_PIXEL_ID: process.env.NEXT_PUBLIC_META_PIXEL_ID,
}): TrackingTool[] {
  return [
    {
      key: "vercel-analytics",
      name: "Vercel Web Analytics",
      company: "Vercel Inc.",
      category: "analytics",
      purpose: "Counts page views and where visitors come from, so we know which pages are read.",
      stores: "No cookies, according to Vercel's documentation.",
      id: env.NEXT_PUBLIC_VERCEL_ANALYTICS === "1" ? "on" : null,
      privacyUrl: "https://vercel.com/legal/privacy-policy",
    },
    {
      key: "ga4",
      name: "Google Analytics 4",
      company: "Google LLC",
      category: "analytics",
      purpose: "Measures how the public site is used: pages viewed, time on page and general location.",
      stores: "Cookies named _ga and _ga_<id>.",
      id: setting(env.NEXT_PUBLIC_GA4_ID, /^G-[A-Z0-9]{4,20}$/),
      privacyUrl: "https://policies.google.com/privacy",
    },
    {
      key: "google-ads",
      name: "Google Ads conversion tag",
      company: "Google LLC",
      category: "advertising",
      purpose: "Tells us when someone who clicked one of our ads goes on to start the assessment.",
      stores: "Cookies named _gcl_au and others Google uses for ad measurement.",
      id: setting(env.NEXT_PUBLIC_GOOGLE_ADS_ID, /^AW-[0-9]{6,15}$/),
      privacyUrl: "https://policies.google.com/technologies/ads",
    },
    {
      key: "meta-pixel",
      name: "Meta Pixel",
      company: "Meta Platforms, Inc.",
      category: "advertising",
      purpose: "Measures visits that come from our ads on Facebook and Instagram.",
      stores: "Cookies named _fbp and, after an ad click, _fbc.",
      id: setting(env.NEXT_PUBLIC_META_PIXEL_ID, /^[0-9]{10,20}$/),
      privacyUrl: "https://www.facebook.com/privacy/policy/",
    },
  ];
}

/** Cookies the optional tools may leave behind, cleared when a choice is withdrawn. */
export const OPTIONAL_COOKIE_PREFIXES = ["_ga", "_gid", "_gcl", "_fbp", "_fbc"] as const;
