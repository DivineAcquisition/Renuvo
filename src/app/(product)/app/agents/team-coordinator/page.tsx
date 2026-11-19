import type { Metadata } from "next";

import { ComingSoonAgentPage } from "@/components/app/coming-soon/agent-page";
import { COMING_SOON } from "@/lib/app/coming-soon";

export const metadata: Metadata = { title: "Team Coordinator · Coming soon" };

export default function Page() {
  return <ComingSoonAgentPage agent={COMING_SOON["team-coordinator"]} />;
}
