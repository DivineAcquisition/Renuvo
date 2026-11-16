import type { Metadata } from "next";

import { AgentSettings } from "@/components/app/settings/agents";
import { SectionPage } from "@/components/app/settings/section-page";

export const metadata: Metadata = { title: "Agent controls" };

export default function Page() {
  return (
    <SectionPage id="agents">
      <AgentSettings />
    </SectionPage>
  );
}
