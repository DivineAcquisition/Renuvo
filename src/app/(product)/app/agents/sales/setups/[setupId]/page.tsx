import type { Metadata } from "next";

import { SetupDetail } from "@/components/app/sales/setup-detail";

import type { Id } from "../../../../../../../../convex/_generated/dataModel";

export const metadata: Metadata = { title: "Service setup" };

export default async function Page({ params }: { params: Promise<{ setupId: string }> }) {
  const { setupId } = await params;
  return <SetupDetail setupId={setupId as Id<"serviceSetups">} />;
}
