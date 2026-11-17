import type { Metadata } from "next";

import { SubcontractorsScreen } from "@/components/app/cleaners/subcontractors";

export const metadata: Metadata = { title: "Subcontractor companies" };

export default function Page() {
  return <SubcontractorsScreen />;
}
