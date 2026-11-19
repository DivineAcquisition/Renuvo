import type { Metadata } from "next";

import { RetentionReengagementScreen } from "@/components/app/screens/retention/reengagement";

export const metadata: Metadata = { title: "Re-engagement · Retention" };

export default function Page() {
  return <RetentionReengagementScreen />;
}
