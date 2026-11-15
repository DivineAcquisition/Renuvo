import type { Metadata } from "next";

import { DecisionsScreen } from "@/components/app/screens/decisions";

export const metadata: Metadata = { title: "Needs your decision" };

export default function Page() {
  return <DecisionsScreen />;
}
