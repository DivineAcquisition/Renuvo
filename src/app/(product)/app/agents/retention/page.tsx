import type { Metadata } from "next";

import { RetentionOverviewScreen } from "@/components/app/screens/retention/overview";

export const metadata: Metadata = { title: "Retention" };

export default function Page() {
  return <RetentionOverviewScreen />;
}
