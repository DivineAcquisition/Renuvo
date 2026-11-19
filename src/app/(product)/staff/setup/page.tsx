import type { Metadata } from "next";

import { SetupFunnel } from "@/components/staff/setup-funnel";

export const metadata: Metadata = { title: "Setup funnel" };

export default function Page() {
  return <SetupFunnel />;
}
