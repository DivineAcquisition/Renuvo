import type { Metadata } from "next";

import { PayPage } from "@/components/pay/pay-page";

export const metadata: Metadata = { title: "Invoice", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PayPage token={token} />;
}
