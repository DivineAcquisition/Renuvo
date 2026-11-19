import type { Metadata } from "next";

import { MessagingAttention } from "@/components/staff/console";

export const metadata: Metadata = { title: "Messaging money" };

export default function Page() {
  return <MessagingAttention />;
}
