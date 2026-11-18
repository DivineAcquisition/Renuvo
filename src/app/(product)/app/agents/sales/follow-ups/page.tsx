import type { Metadata } from "next";

import { SalesFollowUpsScreen } from "@/components/app/screens/sales-agent/follow-ups";

export const metadata: Metadata = { title: "Follow-ups" };

export default function Page() {
  return <SalesFollowUpsScreen />;
}
