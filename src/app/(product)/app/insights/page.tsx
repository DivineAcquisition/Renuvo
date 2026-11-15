import type { Metadata } from "next";

import { InsightsScreen } from "@/components/app/screens/misc";

export const metadata: Metadata = { title: "Insights" };

export default function Page() {
  return <InsightsScreen />;
}
