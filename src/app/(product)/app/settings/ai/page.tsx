import type { Metadata } from "next";

import { AiSettings } from "@/components/app/settings/ai";
import { SectionPage } from "@/components/app/settings/section-page";

export const metadata: Metadata = { title: "AI & usage" };

export default function Page() {
  return (
    <SectionPage id="ai">
      <AiSettings />
    </SectionPage>
  );
}
