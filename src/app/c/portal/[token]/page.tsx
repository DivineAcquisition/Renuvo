import type { Metadata } from "next";

import { PortalPage } from "@/components/cleaner/portal-page";

export const metadata: Metadata = { title: "Your portal" };

/** A cleaner's own portal, from the link the company sent them. The link is the only key. */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PortalPage token={token} />;
}
