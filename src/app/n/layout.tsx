import type { Metadata } from "next";

import { BookingProviders } from "@/components/booking/live";

/**
 * Pages reached from a link in a Selestial notice, on the link host. No sign-in: the link is the
 * authorization, so these pages are never indexed and never pass their address on.
 */
export const metadata: Metadata = {
  title: "Email notifications",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function NoticeLayout({ children }: { children: React.ReactNode }) {
  // The same plain Convex connection the booking pages use: nothing here is signed in.
  return <BookingProviders>{children}</BookingProviders>;
}
