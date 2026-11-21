"use client";

/**
 * The company setup funnel, for Selestial staff: of setups started in the window, how many reached each
 * milestone, and the median time from starting. Counts only; no company is named here.
 */
import { useQuery } from "convex/react";
import { useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../convex/_generated/api";
import { SegmentedControl } from "@/components/ui/selection";

const WINDOWS = [7, 30, 90] as const;

function duration(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} days`;
}

export function SetupFunnel() {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const funnel = useQuery(api.setupProgress.funnel, { days });
  return (
    <section className="grid gap-4" aria-labelledby="funnel-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="funnel-heading" className="font-heading text-xl text-strong">
            Setup funnel
          </h1>
          <p className="text-sm text-muted-foreground">New companies that started setup in the window, and how far they got.</p>
        </div>
        <SegmentedControl label="Window" hideLabel density="compact" value={String(days)} options={WINDOWS.map((value) => ({ id: String(value), label: `${value} days` }))} onChange={(value) => setDays(Number(value))} />
      </div>
      {!funnel ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : (
        <>
          <table className="w-full text-sm">
            <caption className="sr-only">Setup milestones reached in the last {funnel.days} days</caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 font-medium">Milestone</th>
                <th scope="col" className="py-2 text-right font-medium">Reached</th>
                <th scope="col" className="py-2 text-right font-medium">Share</th>
                <th scope="col" className="py-2 text-right font-medium">Median from start</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {funnel.stages.map((stage) => (
                <tr key={stage.stage}>
                  <th scope="row" className="py-2 text-left font-medium text-strong">{stage.words}</th>
                  <td className="py-2 text-right tabular-nums">{stage.reached}</td>
                  <td className="py-2 text-right tabular-nums">{funnel.setups ? `${Math.round((stage.reached / funnel.setups) * 100)}%` : "—"}</td>
                  <td className="py-2 text-right tabular-nums">{stage.stage === "startedAt" ? "—" : duration(stage.medianMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">
            {funnel.optedInLater} {funnel.optedInLater === 1 ? "company" : "companies"} already using Selestial chose setup later and {funnel.optedInLater === 1 ? "is" : "are"} not counted above.
            {funnel.byPriority.length ? ` First priorities: ${funnel.byPriority.map((row) => `${row.priority} ${row.count}`).join(", ")}.` : ""}
          </p>
        </>
      )}
    </section>
  );
}
