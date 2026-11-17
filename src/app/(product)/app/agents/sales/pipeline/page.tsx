import type { Metadata } from "next";

import { SalesPipelineScreen } from "@/components/app/screens/sales/pipeline";

export const metadata: Metadata = { title: "Pipeline" };

export default function Page() {
  return <SalesPipelineScreen />;
}
