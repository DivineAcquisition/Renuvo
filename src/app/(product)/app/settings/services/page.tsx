import type { Metadata } from "next";

import { ServicesSection } from "@/components/app/settings/business-sections";
import { SectionPage } from "@/components/app/settings/section-page";

export const metadata: Metadata = { title: "Services & pricing" };

export default function Page() {
  return (
    <SectionPage id="services">
      <ServicesSection />
    </SectionPage>
  );
}
