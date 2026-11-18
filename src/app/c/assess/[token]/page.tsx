import type { Metadata } from "next";

import { AssessPage } from "@/components/public/assess-page";

export const metadata: Metadata = { title: "Walkthrough", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AssessPage token={token} />;
}
