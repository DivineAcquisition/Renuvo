import type { Metadata } from "next";

import { PlanBilling } from "@/components/app/settings/billing";
import { SectionPage } from "@/components/app/settings/section-page";

export const metadata: Metadata = { title: "Plan & Usage" };

export default function Page() {
  return (
    <SectionPage id="billing">
      <PlanBilling />
    </SectionPage>
  );
}
