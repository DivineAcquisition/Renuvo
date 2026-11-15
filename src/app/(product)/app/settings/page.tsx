import type { Metadata } from "next";

import { SettingsScreen } from "@/components/app/screens/misc";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return <SettingsScreen />;
}
