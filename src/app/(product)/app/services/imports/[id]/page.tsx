import type { Metadata } from "next";

import { ImportReview } from "@/components/app/services/imports";

export const metadata: Metadata = { title: "Import review" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ImportReview importId={id} />;
}
