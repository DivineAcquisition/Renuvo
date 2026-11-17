import type { Metadata } from "next";

import { FinanceScreen } from "@/components/app/finance/finance-screen";

export const metadata: Metadata = { title: "Finance" };

export default function Page() {
  return <FinanceScreen />;
}
