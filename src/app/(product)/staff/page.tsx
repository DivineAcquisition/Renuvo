import type { Metadata } from "next";

import { RequestQueue } from "@/components/staff/console";

export const metadata: Metadata = { title: "Requests" };

export default function Page() {
  return <RequestQueue />;
}
