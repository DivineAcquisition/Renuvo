import type { Metadata } from "next";

import { RetentionRecoveryScreen } from "@/components/app/screens/retention/recovery";

export const metadata: Metadata = { title: "Recovery · Retention" };

export default function Page() {
  return <RetentionRecoveryScreen />;
}
