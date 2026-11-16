import type { Metadata } from "next";

import { PeopleAccess } from "@/components/app/settings/people";
import { SectionPage } from "@/components/app/settings/section-page";

export const metadata: Metadata = { title: "People & access" };

export default function Page() {
  return (
    <SectionPage id="people">
      <PeopleAccess />
    </SectionPage>
  );
}
