import type { MetadataRoute } from "next";

import { SITE_ORIGIN } from "@/lib/constants";
import { hostMap, publicOrigin } from "@/lib/hosts";
import { ASSESSMENT_PATH } from "@/lib/marketing/content";

/** The public pages, always at the public site's address. The workspace and link pages are never listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = publicOrigin(hostMap(process.env)) ?? SITE_ORIGIN;
  return [
    { url: `${origin}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}${ASSESSMENT_PATH}`, changeFrequency: "monthly", priority: 0.8 },
    ...["/security", "/security/subprocessors", "/security/report", "/security/review", "/privacy", "/privacy/requests", "/terms", "/cookies", "/messaging"].map((path) => ({ url: `${origin}${path}`, changeFrequency: "monthly" as const, priority: 0.4 })),
  ];
}
