"use client";

import { MigrationBanner } from "@/components/app/migration/entry";
import { SetupChecklist } from "@/components/app/setup/checklist";
import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";

import { useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { messageOf } from "@/components/app/form";
import { AgentsWorking } from "@/components/app/activation/home";
import { OverviewView } from "@/components/app/overview/overview-view";
import type { ScheduleView } from "@/components/app/overview/schedule-table";
import { useNow } from "@/components/app/use-now";
import { linkTo } from "@/lib/app/navigation-helpers";

import { api } from "../../../../convex/_generated/api";
import type { Decision, Link } from "../../../../convex/overview";

/** Approving from a card: one held press, and the words if it is refused. */
export function useApprove() {
  const { companyId } = useCompany();
  const decide = useMutation(api.approvals.decide);
  const [approving, setApproving] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  async function approve(decision: Decision) {
    if (decision.ref.kind !== "approval") return;
    setApproving(decision.ref.id);
    setError(null);
    try {
      await decide({ companyId, approvalId: decision.ref.id, decision: "approved" });
    } catch (caught) {
      setError({ id: decision.ref.id, message: messageOf(caught) });
    } finally {
      setApproving(null);
    }
  }
  return { approve, approving, error };
}

export function OverviewScreen() {
  const { companyId, timezone } = useCompany();
  const { user } = useUser();
  const now = useNow();
  const open = useDetail();
  const router = useRouter();
  const [view, setView] = useState<ScheduleView>("today");
  const at = now ? { companyId, asOf: now } : "skip";
  const today = useQuery(api.overview.today, at);
  const decisions = useQuery(api.overview.decisions, at);
  const schedule = useQuery(api.overview.schedule, now ? { companyId, asOf: now, view } : "skip");
  const team = useQuery(api.overview.team, { companyId });
  const activity = useQuery(api.details.activity, now ? { companyId, asOf: now, limit: 12 } : "skip");
  const week = useQuery(api.overview.week, at);
  const { approve, approving, error } = useApprove();

  function follow(link: Link) {
    if (link.kind !== "view") return open(link);
    if (link.view === "decisions") return router.push(linkTo("approvals") ?? "/app");
    setView(link.view === "schedule_tomorrow" ? "tomorrow" : "today");
    document.getElementById("schedule")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <OverviewView
      agentsWorking={
        <Suspense fallback={null}>
          <AgentsWorking />
        </Suspense>
      }
      data={{ firstName: user?.firstName ?? null, now, timezone, today, decisions, schedule, team: team?.departments, activity, week: week?.measures }}
      view={view}
      onView={setView}
      onOpen={open}
      onLink={follow}
      onApprove={(decision) => void approve(decision)}
      approving={approving}
      approveError={error}
      checklist={
        <>
          <MigrationBanner />
          <SetupChecklist />
        </>
      }
    />
  );
}
