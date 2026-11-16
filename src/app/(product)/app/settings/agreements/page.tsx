import type { Metadata } from "next";

import { AgreementsPanel } from "@/components/app/screens/compliance";
import { PageHeader } from "@/components/app/shell";

export const metadata: Metadata = { title: "Agreements" };

export default function Page() {
  return (
    <>
      <PageHeader title="Agreements" lead="What your company has agreed to with Selestial, which version, who accepted it and when." />
      <AgreementsPanel />
    </>
  );
}
