import type { Metadata } from "next";

import { IntegrationsScreen } from "@/components/app/screens/integrations";

export const metadata: Metadata = { title: "Integrations" };

export default function Page() {
  return <IntegrationsScreen />;
}
