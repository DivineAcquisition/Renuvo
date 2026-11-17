import type { Metadata } from "next";

import { SalesConversationsScreen } from "@/components/app/screens/sales/conversations";

export const metadata: Metadata = { title: "Conversations" };

export default function Page() {
  return <SalesConversationsScreen />;
}
