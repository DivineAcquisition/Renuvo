import type { Metadata } from "next";

import { ProposalPage } from "@/components/public/proposal-page";

export const metadata: Metadata = { title: "Proposal", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ProposalPage token={token} />;
}
