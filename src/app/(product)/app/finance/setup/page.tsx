import type { Metadata } from "next";

import { PaymentsSetup } from "@/components/app/finance/setup";

export const metadata: Metadata = { title: "Payments setup" };

export default function Page() {
  return <PaymentsSetup />;
}
