import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OPERATIONS_VIEWS, OperationsWorkspace, type OperationsView } from "@/components/staff/operations";

export const metadata: Metadata = { title: "Operations" };

/** One Operations view at its own address: /staff/operations/<view>. */
export default async function Page({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  const found = OPERATIONS_VIEWS.find((item) => item.slug === view && item.slug !== "");
  if (!found) notFound();
  return <OperationsWorkspace view={found.slug as OperationsView} />;
}
