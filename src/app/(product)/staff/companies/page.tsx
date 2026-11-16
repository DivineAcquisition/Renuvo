import type { Metadata } from "next";

import { Companies } from "@/components/staff/console";

export const metadata: Metadata = { title: "Companies" };

export default function Page() {
  return <Companies />;
}
