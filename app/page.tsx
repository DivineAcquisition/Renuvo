import type { Metadata } from "next";

import { MarketingShell } from "@/components/marketing/chrome";
import { LandingPage } from "@/components/marketing/landing";
import { APP_NAME, SITE_DESCRIPTION, SITE_ORIGIN } from "@/lib/constants";
import { HERO } from "@/lib/marketing/copy";

export const metadata: Metadata = {
  title: {
    absolute: `${HERO.headline} · ${APP_NAME}`,
  },
  description: SITE_DESCRIPTION,
  alternates: { canonical: SITE_ORIGIN },
};

export default function Home() {
  return (
    <MarketingShell>
      <LandingPage />
    </MarketingShell>
  );
}
