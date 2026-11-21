import type { Metadata } from "next";

import { SelectionPreview } from "@/components/staff/selection-preview";

export const metadata: Metadata = { title: "Selection system" };

export default function Page() {
  return <SelectionPreview />;
}
