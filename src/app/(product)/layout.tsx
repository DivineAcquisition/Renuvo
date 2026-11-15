import type { Metadata } from "next";

import { AppProviders } from "@/components/app/providers";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
