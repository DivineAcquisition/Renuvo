import type { Metadata } from "next";

import { SignPage } from "@/components/public/sign-page";

export const metadata: Metadata = { title: "Review and sign", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SignPage token={token} />;
}
