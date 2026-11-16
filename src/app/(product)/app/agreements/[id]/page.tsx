import type { Metadata } from "next";

import { AgreementDetail } from "@/components/app/agreements/detail";
import { AgreementGuard } from "@/components/app/agreements/guard";

export const metadata: Metadata = { title: "Agreement" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AgreementGuard>
      <AgreementDetail agreementId={id} />
    </AgreementGuard>
  );
}
