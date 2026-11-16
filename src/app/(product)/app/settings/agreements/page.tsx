import type { Metadata } from "next";

import { AgreementsPanel } from "@/components/app/screens/compliance";
import { PageHeader } from "@/components/app/shell";

export const metadata: Metadata = { title: "Selestial Terms & Agreements" };

export default function Page() {
  return (
    <>
      <PageHeader title="Selestial Terms & Agreements" lead="What your company has agreed to with Selestial itself: which version of the Terms, who accepted it and when. Your own customer and workforce agreements are under Agreements in the main menu." />
      <AgreementsPanel />
    </>
  );
}
