import type { Metadata } from "next";
import { Suspense } from "react";

import { Library } from "@/components/app/agreements/library";

export const metadata: Metadata = { title: "Renewals & Changes" };

export default function Page() {
  return (
    <Suspense>
      <Library preset="renewals" />
    </Suspense>
  );
}
