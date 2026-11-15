import type { Metadata } from "next";

import { TeamScreen } from "@/components/app/screens/team";

export const metadata: Metadata = { title: "AI Team" };

export default function Page() {
  return <TeamScreen />;
}
