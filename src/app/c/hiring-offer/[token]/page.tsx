import type { Metadata } from "next";

import { HiringOfferPage } from "@/components/applicant/hiring-offer-page";

export const metadata: Metadata = { title: "Your offer" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <HiringOfferPage token={token} />;
}
