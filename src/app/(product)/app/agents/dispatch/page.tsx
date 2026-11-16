import type { Metadata } from "next";

import { DispatchOverviewScreen } from "@/components/app/screens/dispatch/overview";

export const metadata: Metadata = { title: "Dispatch" };

export default function Page() {
  return <DispatchOverviewScreen />;
}
