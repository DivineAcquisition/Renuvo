import type { Metadata } from "next";

import { DispatchRules } from "@/components/app/settings/dispatch";
import { SectionPage } from "@/components/app/settings/section-page";

export const metadata: Metadata = { title: "Dispatch rules" };

export default function Page() {
  return (
    <SectionPage id="dispatch">
      <DispatchRules />
    </SectionPage>
  );
}
