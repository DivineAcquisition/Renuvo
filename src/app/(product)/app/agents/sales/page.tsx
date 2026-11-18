import type { Metadata } from "next";

import { SalesOverviewScreen } from "@/components/app/screens/sales-agent/overview";

export const metadata: Metadata = { title: "Sales" };

export default function Page() {
  return <SalesOverviewScreen />;
}
