import type { Metadata } from "next";

import { AgentsIndex } from "@/components/marketing/agent-page";
import { PublicPage } from "@/components/trust/public-page";
import { loadPublicTrust } from "@/lib/trust/public";

export const metadata: Metadata = {
  title: "The agents",
  description: "Selestial's AI team for cleaning companies: Sales, Recruiter, Dispatch and Retention work today; Marketing, Quality, Customer Care and Team Coordinator are coming.",
  alternates: { canonical: "/agents" },
};

export const revalidate = 300;

export default async function AgentsPage() {
  const trust = await loadPublicTrust();
  return (
    <PublicPage trust={trust}>
      <AgentsIndex />
    </PublicPage>
  );
}
