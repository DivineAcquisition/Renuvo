import type { Metadata } from "next";

import { TextingWorkspace } from "@/components/app/texting/workspace";

export const metadata: Metadata = { title: "Set up business texting" };

export default function Page() {
  return <TextingWorkspace />;
}
