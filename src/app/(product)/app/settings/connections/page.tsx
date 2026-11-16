import type { Metadata } from "next";

import { Connections } from "@/components/app/settings/connections";
import { SectionPage } from "@/components/app/settings/section-page";

export const metadata: Metadata = { title: "Connections" };

export default function Page() {
  return (
    <SectionPage id="connections">
      <Connections />
    </SectionPage>
  );
}
