import type { Metadata } from "next";

import { AgentRequests } from "@/components/staff/console";

export const metadata: Metadata = { title: "Agent requests" };

export default function Page() {
  return <AgentRequests />;
}
