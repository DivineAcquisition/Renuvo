import type { Metadata } from "next";

import { PortalPage } from "@/components/cleaner/portal-page";

export const metadata: Metadata = { title: "Your portal" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PortalPage token={token} />;
}
