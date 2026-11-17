import type { Metadata } from "next";

import { SalesQuotesScreen } from "@/components/app/screens/sales/quotes";

export const metadata: Metadata = { title: "Quotes & Proposals" };

export default function Page() {
  return <SalesQuotesScreen />;
}
