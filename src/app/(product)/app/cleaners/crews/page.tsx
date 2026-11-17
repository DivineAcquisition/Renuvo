import type { Metadata } from "next";

import { CrewsScreen } from "@/components/app/cleaners/crews";

export const metadata: Metadata = { title: "Crews" };

export default function Page() {
  return <CrewsScreen />;
}
