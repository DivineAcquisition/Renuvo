import type { Metadata } from "next";

import { RequestDetail } from "@/components/staff/console";

export const metadata: Metadata = { title: "Request" };

export default function Page() {
  return <RequestDetail />;
}
