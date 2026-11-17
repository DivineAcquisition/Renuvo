import type { Metadata } from "next";

import { ChangeReview } from "@/components/app/services/changes";

export const metadata: Metadata = { title: "Change" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChangeReview changeId={id} />;
}
