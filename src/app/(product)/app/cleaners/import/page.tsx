import type { Metadata } from "next";

import { ImportScreen } from "@/components/app/cleaners/import";

export const metadata: Metadata = { title: "Import cleaners" };

export default function Page() {
  return <ImportScreen />;
}
