import type { Metadata } from "next";

import { CreativeStudio } from "@/components/app/creative/studio";

export const metadata: Metadata = { title: "Creative Studio" };

export default function Page() {
  return <CreativeStudio />;
}
