import type { Metadata } from "next";

import { PlanDetail } from "@/components/app/sales/plan-detail";

import type { Id } from "../../../../../../../../convex/_generated/dataModel";

export const metadata: Metadata = { title: "Recurring plan" };

export default async function Page({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  return <PlanDetail planId={planId as Id<"recurringPlans">} />;
}
