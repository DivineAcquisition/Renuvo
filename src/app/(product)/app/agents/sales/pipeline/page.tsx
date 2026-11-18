import type { Metadata } from "next";

import { PipelineScreen } from "@/components/app/sales/pipeline-screen";

export const metadata: Metadata = { title: "Pipeline" };

export default function Page() {
  return <PipelineScreen />;
}
