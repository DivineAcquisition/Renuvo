import type { Metadata } from "next";

import { BriefView } from "@/components/app/services/research";

export const metadata: Metadata = { title: "Research brief" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BriefView briefId={id} />;
}
