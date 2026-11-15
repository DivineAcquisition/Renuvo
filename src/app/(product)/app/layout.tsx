import type { Metadata } from "next";

import { AppGate } from "@/components/app/gate";

export const metadata: Metadata = { title: { default: "Overview", template: "%s · Selestial" } };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppGate>{children}</AppGate>;
}
