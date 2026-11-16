import type { Metadata } from "next";

import { PlaybookScreen } from "@/components/app/screens/dispatch/playbook";

export const metadata: Metadata = { title: "Playbook" };

export default function Page() {
  return <PlaybookScreen />;
}
