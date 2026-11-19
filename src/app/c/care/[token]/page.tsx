import type { Metadata } from "next";

import { CarePage } from "@/components/public/care-page";

export const metadata: Metadata = { title: "Your service", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CarePage token={token} />;
}
