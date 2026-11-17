import type { Metadata } from "next";

import { BusinessSection } from "@/components/app/settings/business-sections";
import { SectionPage } from "@/components/app/settings/section-page";

export const metadata: Metadata = { title: "Business details" };

export default function Page() {
  return (
    <SectionPage id="business">
      <BusinessSection />
    </SectionPage>
  );
}
