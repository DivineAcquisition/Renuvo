"use client";

import { useQuery } from "convex/react";

import { useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { DecisionCard, NoDecisions } from "@/components/app/overview/decision-card";
import { useApprove } from "@/components/app/screens/overview";
import { PageHeader } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../../convex/_generated/api";

/** The one queue of decisions, soonest deadline first. Informational notices do not appear here. */
export function DecisionsScreen({ department }: { department?: string }) {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const open = useDetail();
  const all = useQuery(api.overview.decisions, now ? { companyId, asOf: now } : "skip");
  const { approve, approving, error } = useApprove();
  const decisions = department && all ? all.filter((decision) => decision.department === department) : all;
  const list =
    decisions === undefined ? (
      <Skeleton className="h-48 rounded-2xl" />
    ) : decisions.length === 0 ? (
      <NoDecisions />
    ) : (
      <div className="grid gap-3 xl:grid-cols-2">
        {decisions.map((decision) => (
          <DecisionCard key={decision.ref.id} decision={decision} now={now} timezone={timezone} busy={approving === decision.ref.id} error={error?.id === decision.ref.id ? error.message : null} onApprove={(item) => void approve(item)} onOpen={open} />
        ))}
      </div>
    );
  if (department) return list;
  return (
    <>
      <PageHeader title="Needs your decision" lead="Each item says what the problem is, what the agent proposes, exactly what approving authorizes, and what happens if you wait." />
      {list}
    </>
  );
}
