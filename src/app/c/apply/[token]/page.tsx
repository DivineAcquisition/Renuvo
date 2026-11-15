import type { Metadata } from "next";

import { ApplyPage } from "@/components/applicant/apply-page";

export const metadata: Metadata = { title: "Your application" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ApplyPage token={token} />;
}
