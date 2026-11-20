import type { Metadata } from "next";

import { OperationsWorkspace } from "@/components/staff/operations";

export const metadata: Metadata = { title: "Operations" };

export default function Page() {
  return <OperationsWorkspace view="" />;
}
