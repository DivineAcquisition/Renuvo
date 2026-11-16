import type { Metadata } from "next";
import { Suspense } from "react";

import { IntegrationsScreen } from "@/components/app/screens/integrations";
import { SectionPage } from "@/components/app/settings/section-page";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Integrations" };

export default function Page() {
  return (
    <SectionPage id="integrations">
      {/* Google sends the Owner back here with ?result=…, read on the client. */}
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <IntegrationsScreen embedded />
      </Suspense>
    </SectionPage>
  );
}
