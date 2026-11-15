import type { Metadata } from "next";

import { CleanerProviders } from "@/components/cleaner/shell";

/**
 * The cleaner pages: reached from a text, used on a phone, with no sign-in. The link in the address is
 * the authorization, so these pages are never indexed and never pass their address on to another site.
 */
export const metadata: Metadata = {
  title: "Your job",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function CleanerLayout({ children }: { children: React.ReactNode }) {
  return <CleanerProviders>{children}</CleanerProviders>;
}
