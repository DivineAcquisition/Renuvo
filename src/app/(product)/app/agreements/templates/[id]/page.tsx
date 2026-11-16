import type { Metadata } from "next";

import { AgreementGuard } from "@/components/app/agreements/guard";
import { TemplateEditor } from "@/components/app/agreements/templates";

export const metadata: Metadata = { title: "Template" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AgreementGuard>
      <TemplateEditor templateId={id} />
    </AgreementGuard>
  );
}
