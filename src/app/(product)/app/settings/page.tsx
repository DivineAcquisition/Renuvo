import type { Metadata } from "next";

import { SettingsOverview } from "@/components/app/settings/overview";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return <SettingsOverview />;
}
