import type { Metadata } from "next";

import { ActionLinksScreen } from "@/components/app/screens/dispatch/action-links";

export const metadata: Metadata = { title: "Action Links" };

export default function Page() {
  return <ActionLinksScreen />;
}
