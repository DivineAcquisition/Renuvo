import type { Metadata } from "next";

import { MigrationWorkspace } from "@/components/app/migration/workspace";

export const metadata: Metadata = { title: "Bring your business to Selestial" };

export default function Page() {
  return <MigrationWorkspace />;
}
