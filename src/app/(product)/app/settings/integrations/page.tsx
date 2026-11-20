import type { Metadata } from "next";
import { Suspense } from "react";

import { IssueCards } from "@/components/app/issues/issue-cards";
import { IntegrationsScreen } from "@/components/app/screens/integrations";
import { SectionPage } from "@/components/app/settings/section-page";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Integrations" };

export default function Page() {
  return (
    <SectionPage id="integrations">
      <IssueCards place="integrations" className="mb-5" />
      {/* Google sends the Owner back here with ?result=…, read on the client. */}
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <IntegrationsScreen embedded />
      </Suspense>
    </SectionPage>
  );
}
