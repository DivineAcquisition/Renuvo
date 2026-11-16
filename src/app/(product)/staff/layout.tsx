import type { Metadata } from "next";

import { StaffGate } from "@/components/staff/console";

export const metadata: Metadata = { title: { default: "Staff", template: "%s · Selestial staff" } };

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <StaffGate>{children}</StaffGate>;
}
