import type { Metadata } from "next";

import { SetupScreen } from "@/components/app/setup/flow";

export const metadata: Metadata = { title: "Set up your company" };

export default function Page() {
  return <SetupScreen />;
}
