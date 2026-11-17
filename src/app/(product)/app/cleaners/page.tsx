import type { Metadata } from "next";

import { CleanersWorkspace } from "@/components/app/cleaners/workspace";

export const metadata: Metadata = { title: "Cleaners" };

export default function Page() {
  return <CleanersWorkspace />;
}
