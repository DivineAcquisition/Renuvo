import type { Metadata } from "next";
import { Suspense } from "react";

import { Library } from "@/components/app/agreements/library";

export const metadata: Metadata = { title: "Awaiting Signatures" };

export default function Page() {
  return (
    <Suspense>
      <Library preset="signatures" />
    </Suspense>
  );
}
