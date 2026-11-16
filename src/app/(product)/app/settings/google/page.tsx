import type { Metadata } from "next";
import { Suspense } from "react";

import { GoogleSettings } from "@/components/app/settings/google";
import { SectionPage } from "@/components/app/settings/section-page";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Google" };

export default function Page() {
  return (
    <SectionPage id="google">
      {/* Google sends the Owner back here with ?result=…, read on the client. */}
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <GoogleSettings />
      </Suspense>
    </SectionPage>
  );
}
