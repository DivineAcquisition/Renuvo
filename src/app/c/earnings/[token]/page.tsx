import type { Metadata } from "next";

import { EarningsStatement } from "@/components/pay/earnings-statement";

export const metadata: Metadata = { title: "Your earnings", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <EarningsStatement token={token} />;
}
