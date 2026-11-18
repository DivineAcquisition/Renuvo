import type { Metadata } from "next";

import { NoticeUnsubscribe } from "@/components/notify/unsubscribe";

export const metadata: Metadata = { title: "Email notifications", robots: { index: false, follow: false } };

/** The unsubscribe link in a Selestial notice. The token is in the address's fragment and never reaches the server. */
export default function Page() {
  return <NoticeUnsubscribe />;
}
