import type { Metadata } from "next";

import { BookingProviders } from "@/components/booking/live";

/**
 * Customer booking pages, on the link host. No sign-in: a published page anyone may open, and a private
 * link per booking. Never indexed, never passing their address on.
 */
export const metadata: Metadata = {
  title: "Book online",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function BookingLayout({ children }: { children: React.ReactNode }) {
  return <BookingProviders>{children}</BookingProviders>;
}
