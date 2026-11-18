import type { Metadata } from "next";

import { QuotesProposalsScreen } from "@/components/app/sales/quotes-screen";

export const metadata: Metadata = { title: "Quotes & Proposals" };

export default function Page() {
  return <QuotesProposalsScreen />;
}
