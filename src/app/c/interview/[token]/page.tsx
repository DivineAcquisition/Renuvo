import type { Metadata } from "next";

import { InterviewPage } from "@/components/applicant/interview-page";

export const metadata: Metadata = { title: "Your interview" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InterviewPage token={token} />;
}
