import type { Metadata } from "next";
import { Suspense } from "react";

import { NewAgreement } from "@/components/app/agreements/new";

export const metadata: Metadata = { title: "New agreement" };

export default function Page() {
  return (
    <Suspense>
      <NewAgreement />
    </Suspense>
  );
}
