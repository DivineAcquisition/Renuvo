import type { Metadata } from "next";

import { TextingQueue } from "@/components/staff/console";

export const metadata: Metadata = { title: "Texting" };

export default function Page() {
  return <TextingQueue />;
}
