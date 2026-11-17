import type { Metadata } from "next";

import { TemplateScreen } from "@/components/app/cleaners/template";

export const metadata: Metadata = { title: "Onboarding checklist" };

export default function Page() {
  return <TemplateScreen />;
}
