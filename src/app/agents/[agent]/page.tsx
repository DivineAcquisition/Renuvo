import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AgentPageView } from "@/components/marketing/agent-page";
import { PublicPage } from "@/components/trust/public-page";
import { AGENT_PAGE_IDS, agentPage, agentPagePath } from "@/lib/marketing/agent-pages";
import { loadPublicTrust } from "@/lib/trust/public";

type Props = { params: Promise<{ agent: string }> };

export const revalidate = 300;
export const dynamicParams = false;

export function generateStaticParams() {
  return AGENT_PAGE_IDS.map((agent) => ({ agent }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = agentPage((await params).agent);
  if (!page) return {};
  return {
    title: `${page.name}${page.status === "coming_soon" ? " (coming soon)" : ""} · AI agent for cleaning companies`,
    description: page.pitch,
    alternates: { canonical: agentPagePath(page.id) },
  };
}

export default async function AgentPublicPage({ params }: Props) {
  const page = agentPage((await params).agent);
  if (!page) notFound();
  const trust = await loadPublicTrust();
  return (
    <PublicPage trust={trust}>
      <AgentPageView agent={page} />
    </PublicPage>
  );
}
