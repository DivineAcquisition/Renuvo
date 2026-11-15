import type { Metadata } from "next";

import { SiteFooter, SiteHeader, SkipToContent } from "@/components/marketing/chrome";
import { LandingPage } from "@/components/marketing/landing";

/** The one address search engines should use for this page: the public site's (see src/lib/hosts.ts). */
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function Home() {
  return (
    <>
      <SkipToContent />
      <SiteHeader />
      <main id="content">
        <LandingPage />
      </main>
      <SiteFooter />
    </>
  );
}
