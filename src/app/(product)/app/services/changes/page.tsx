import type { Metadata } from "next";

import { ChangesList } from "@/components/app/services/changes";

export const metadata: Metadata = { title: "Changes" };

export default function Page() {
  return <ChangesList />;
}
