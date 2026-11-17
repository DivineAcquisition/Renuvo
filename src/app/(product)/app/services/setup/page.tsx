import type { Metadata } from "next";

import { PricingSetup } from "@/components/app/services/setup";

export const metadata: Metadata = { title: "Pricing setup" };

export default function Page() {
  return <PricingSetup />;
}
