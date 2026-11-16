import type { Metadata } from "next";

import { TrustRecords } from "@/components/staff/console";

export const metadata: Metadata = { title: "Trust records" };

export default function Page() {
  return <TrustRecords />;
}
