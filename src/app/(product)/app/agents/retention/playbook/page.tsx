import type { Metadata } from "next";

import { RetentionPlaybookScreen } from "@/components/app/screens/retention/playbook";

export const metadata: Metadata = { title: "Playbook · Retention" };

export default function Page() {
  return <RetentionPlaybookScreen />;
}
