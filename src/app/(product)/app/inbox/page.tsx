import type { Metadata } from "next";

import { InboxScreen } from "@/components/app/screens/misc";

export const metadata: Metadata = { title: "Inbox" };

export default function Page() {
  return <InboxScreen />;
}
