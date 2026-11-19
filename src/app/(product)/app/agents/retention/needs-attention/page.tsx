import type { Metadata } from "next";

import { RetentionAttentionScreen } from "@/components/app/screens/retention/attention";

export const metadata: Metadata = { title: "Needs Attention · Retention" };

export default function Page() {
  return <RetentionAttentionScreen />;
}
