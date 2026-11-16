import type { Metadata } from "next";

import { AiModels } from "@/components/staff/ai-models";

export const metadata: Metadata = { title: "AI models" };

export default function Page() {
  return <AiModels />;
}
