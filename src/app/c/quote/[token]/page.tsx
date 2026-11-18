import type { Metadata } from "next";

import { QuotePage } from "@/components/sales/quote-page";

export const metadata: Metadata = { title: "Your quote", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <QuotePage token={token} />;
}
