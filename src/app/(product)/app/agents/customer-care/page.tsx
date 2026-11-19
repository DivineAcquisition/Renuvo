import type { Metadata } from "next";

import { ComingSoonAgentPage } from "@/components/app/coming-soon/agent-page";
import { COMING_SOON } from "@/lib/app/coming-soon";

export const metadata: Metadata = { title: "Customer Care · Coming soon" };

export default function Page() {
  return <ComingSoonAgentPage agent={COMING_SOON["customer-care"]} />;
}
