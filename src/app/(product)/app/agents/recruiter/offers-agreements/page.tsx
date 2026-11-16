import type { Metadata } from "next";

import { OffersScreen } from "@/components/app/screens/recruiter/offers";

export const metadata: Metadata = { title: "Offers & Agreements" };

export default function Page() {
  return <OffersScreen />;
}
