import type { Metadata } from "next";

import { StaffPeople } from "@/components/staff/console";

export const metadata: Metadata = { title: "Staff" };

export default function Page() {
  return <StaffPeople />;
}
