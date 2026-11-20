import type { Metadata } from "next";

import { SectionPage } from "@/components/app/settings/section-page";
import { SupportAccessScreen } from "@/components/app/settings/support-access";

export const metadata: Metadata = { title: "Support access" };

export default function Page() {
  return (
    <SectionPage id="support-access">
      <SupportAccessScreen />
    </SectionPage>
  );
}
