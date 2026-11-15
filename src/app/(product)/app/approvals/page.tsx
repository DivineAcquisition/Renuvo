import type { Metadata } from "next";

import { DecisionsScreen } from "@/components/app/screens/decisions";

export const metadata: Metadata = { title: "Approvals" };

export default function Page() {
  return <DecisionsScreen />;
}
