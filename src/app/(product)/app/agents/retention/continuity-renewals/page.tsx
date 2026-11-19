import type { Metadata } from "next";

import { RetentionContinuityScreen } from "@/components/app/screens/retention/continuity";

export const metadata: Metadata = { title: "Continuity & Renewals · Retention" };

export default function Page() {
  return <RetentionContinuityScreen />;
}
