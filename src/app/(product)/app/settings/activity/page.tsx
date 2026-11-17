import type { Metadata } from "next";

import { ActivityLog } from "@/components/app/settings/activity";
import { SectionPage } from "@/components/app/settings/section-page";

export const metadata: Metadata = { title: "Activity" };

export default function Page() {
  return (
    <SectionPage id="activity">
      <ActivityLog />
    </SectionPage>
  );
}
