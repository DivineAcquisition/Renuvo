import type { Metadata } from "next";

import { ComplianceScreen } from "@/components/app/screens/compliance";

export const metadata: Metadata = { title: "Trust & Compliance" };

export default function Page() {
  return <ComplianceScreen />;
}
