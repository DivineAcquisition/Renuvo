import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { hostMap, indexable, publicOrigin } from "@/lib/hosts";

/** Crawler rules for the host being asked. Only the public site is indexed (src/lib/hosts.ts). */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const map = hostMap(process.env);
  const host = (await headers()).get("host") ?? "";
  if (!indexable(host, map)) return { rules: { userAgent: "*", disallow: "/" } };
  const origin = publicOrigin(map);
  return { rules: { userAgent: "*", allow: "/", disallow: ["/app", "/staff", "/login", "/signup", "/auth", "/forgot-password", "/reset-password", "/invite", "/c"] }, ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}) };
}
