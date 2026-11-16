import type { Metadata } from "next";

import { Templates } from "@/components/app/agreements/templates";

export const metadata: Metadata = { title: "Templates" };

export default function Page() {
  return <Templates />;
}
