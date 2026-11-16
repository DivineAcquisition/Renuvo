import type { Metadata } from "next";

import { OffersCoverageScreen } from "@/components/app/screens/dispatch/offers-coverage";

export const metadata: Metadata = { title: "Offers & Coverage" };

export default function Page() {
  return <OffersCoverageScreen />;
}
