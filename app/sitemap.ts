import type { MetadataRoute } from "next";

import { SITE_ORIGIN } from "@/lib/constants";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/login", "/signup", "/privacy", "/terms"].map((path) => ({
    url: `${SITE_ORIGIN}${path}`,
    lastModified: new Date("2026-09-03"),
  }));
}
