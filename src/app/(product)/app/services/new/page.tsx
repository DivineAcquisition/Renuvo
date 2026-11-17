import type { Metadata } from "next";
import { Suspense } from "react";

import { NewService } from "@/components/app/services/new";

export const metadata: Metadata = { title: "New service" };

export default function Page() {
  return (
    <Suspense>
      <NewService />
    </Suspense>
  );
}
