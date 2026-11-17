import type { Metadata } from "next";

import { CleanersScreen } from "@/components/app/cleaners/directory";

export const metadata: Metadata = { title: "Cleaners" };

export default function Page() {
  return <CleanersScreen />;
}
