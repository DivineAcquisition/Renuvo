import type { Metadata } from "next";

import { RecordsScreen } from "@/components/app/screens/records";

export const metadata: Metadata = { title: "Records" };

export default function Page() {
  return <RecordsScreen />;
}
