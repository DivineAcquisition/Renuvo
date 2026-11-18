import type { Metadata } from "next";

import { SalesWorkspace } from "@/components/app/sales/workspace";

import type { Id } from "../../../../../../../../convex/_generated/dataModel";

export const metadata: Metadata = { title: "Booking workspace" };

export default async function Page({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  return <SalesWorkspace draftId={draftId as Id<"salesDrafts">} />;
}
