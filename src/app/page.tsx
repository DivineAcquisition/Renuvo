import type { Metadata } from "next";

import { LandingPage } from "@/components/marketing/landing";
import { TrustSection } from "@/components/trust/landing-trust";
import { PublicPage } from "@/components/trust/public-page";
import { loadPublicTrust } from "@/lib/trust/public";

/** The one address search engines should use for this page: the public site's (see src/lib/hosts.ts). */
export const metadata: Metadata = { alternates: { canonical: "/" } };

/** Trust claims and the operator's details are re-read from the record every five minutes. */
export const revalidate = 300;

export default async function Home() {
  const trust = await loadPublicTrust();
  return (
    <PublicPage trust={trust} onHome>
      <LandingPage trustSection={<TrustSection trust={trust} />} />
    </PublicPage>
  );
}
