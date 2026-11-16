import type { Metadata } from "next";

import { LiveJobsScreen } from "@/components/app/screens/dispatch/live-jobs";

export const metadata: Metadata = { title: "Live Jobs" };

export default function Page() {
  return <LiveJobsScreen />;
}
