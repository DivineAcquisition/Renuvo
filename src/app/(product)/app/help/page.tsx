import type { Metadata } from "next";

import { TutorialDirectory } from "@/components/app/tutorials/directory";

export const metadata: Metadata = { title: "Moving your records" };

export default function Page() {
  return <TutorialDirectory />;
}
