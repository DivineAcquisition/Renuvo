import type { Metadata } from "next";

import { AgreementsOverview } from "@/components/app/agreements/overview";

export const metadata: Metadata = { title: "Agreements" };

export default function Page() {
  return <AgreementsOverview />;
}
