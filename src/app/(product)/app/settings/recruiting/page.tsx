import type { Metadata } from "next";

import { RecruitingRules } from "@/components/app/settings/recruiting";
import { SectionPage } from "@/components/app/settings/section-page";

export const metadata: Metadata = { title: "Recruiting rules" };

export default function Page() {
  return (
    <SectionPage id="recruiting">
      <RecruitingRules />
    </SectionPage>
  );
}
