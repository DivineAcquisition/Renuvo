import type { Metadata } from "next";

import { AgreementsPanel } from "@/components/app/screens/compliance";
import { SectionPage } from "@/components/app/settings/section-page";

export const metadata: Metadata = { title: "Selestial terms" };

export default function Page() {
  return (
    <SectionPage id="agreements">
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">Agreements with your own customers and cleaners are kept in Agreements in the main menu.</p>
      <AgreementsPanel />
    </SectionPage>
  );
}
