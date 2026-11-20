import type { Metadata } from "next";

import { TutorialsAdmin } from "@/components/staff/tutorials";

export const metadata: Metadata = { title: "Tutorials" };

export default function Page() {
  return <TutorialsAdmin />;
}
