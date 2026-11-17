import type { Metadata } from "next";

import { PricingStudio } from "@/components/app/services/studio";

export const metadata: Metadata = { title: "Pricing Studio" };

export default function Page() {
  return <PricingStudio />;
}
