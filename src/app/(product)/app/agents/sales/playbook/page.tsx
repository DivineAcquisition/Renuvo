import type { Metadata } from "next";

import { SalesPlaybookScreen } from "@/components/app/screens/sales-agent/playbook";

export const metadata: Metadata = { title: "Playbook" };

export default function Page() {
  return <SalesPlaybookScreen />;
}
