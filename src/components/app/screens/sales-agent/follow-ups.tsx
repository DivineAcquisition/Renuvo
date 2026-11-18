"use client";

/**
 * What Sales plans to send and when, and what recently went or was stopped. Every reminder says why it
 * exists, which one it is in a sequence that ends, what it will say, and what stops it first. A reminder
 * coming due sends nothing by itself: Sales looks at the conversation as it is at that moment.
 */
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";

import { useCompany } from "@/components/app/company";
import { FormError, useRun } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { until, whenLabel } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import { OpportunityDrawer } from "./drawer";
import { ChannelIcon, Empty, FOLLOW_UP_STATUS, SALES_PATH, useOpportunityParam } from "./shared";

type Row = FunctionReturnType<typeof api.salesFollowUps.list>["scheduled"][number];
const DAY = 24 * 60 * 60_000;

function Planned({ row, now, onOpen, canCancel }: { row: Row; now: number; onOpen: (id: string) => void; canCancel: boolean }) {
  const { companyId, timezone } = useCompany();
  const cancel = useMutation(api.salesFollowUps.cancel);
  const { busy, error, run } = useRun();
  const due = until(row.dueAt, now);
  return (
    <li className="grid gap-2.5 rounded-xl border border-border bg-background p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <button type="button" onClick={() => onOpen(row.opportunityId)} className="text-sm font-semibold text-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
            {row.customer}
          </button>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <ChannelIcon channel={row.channel} />
            {row.purposeWords} · reminder {row.attempt} of {row.maxAttempts}
          </p>
        </div>
        <div className="text-right">
          <p className={cn("text-sm font-medium", due.late ? "text-warning-foreground" : "text-strong")}>{whenLabel(row.dueAt, now, timezone)}</p>
          <p className="text-xs text-muted-foreground">{due.late ? "Coming due now" : due.text}</p>
        </div>
      </div>
      <p className="text-sm text-strong">{row.reason}</p>
      <blockquote className="rounded-lg border-l-2 border-brand-500/50 bg-muted/40 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{row.preview.replaceAll("{link}", "[quote link]")}</blockquote>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-brand-300 underline-offset-4 select-none hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">What stops this reminder</summary>
        <ul className="mt-1.5 grid gap-0.5">
          {row.stopsWhen.map((condition) => (
            <li key={condition}>· {condition}</li>
          ))}
          <li>· Quiet hours: it waits for the morning rather than go at night</li>
        </ul>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        {row.by === "held" ? (
          <Badge variant="secondary" size="sm">
            Held: a person has this conversation
          </Badge>
        ) : (
          <Badge variant="outline" size="sm">
            Sales sends it under your permissions
          </Badge>
        )}
        {canCancel ? (
          <Button size="xs" variant="ghost" loading={busy} onClick={() => void run(() => cancel({ companyId, followUpId: row.followUpId }))}>
            Cancel this reminder
          </Button>
        ) : null}
      </div>
      <FormError message={error} />
    </li>
  );
}

export function SalesFollowUpsScreen() {
  const { companyId, timezone, role } = useCompany();
  const now = useNow();
  const { openId, open, close } = useOpportunityParam();
  const data = useQuery(api.salesFollowUps.list, now ? { companyId, asOf: now } : "skip");
  const playbook = useQuery(api.salesInquiries.playbook, { companyId });

  const soon = (data?.scheduled ?? []).filter((row) => row.dueAt <= now + DAY);
  const later = (data?.scheduled ?? []).filter((row) => row.dueAt > now + DAY);
  const hours = playbook?.settings.followUp;
  const words = (list: number[]) => (list.length === 0 ? "none" : list.map((value) => (value % 24 === 0 ? `${value / 24} d` : `${value} h`)).join(", then "));

  return (
    <>
      <PageHeader
        title="Follow-ups"
        lead="Reminders Sales has planned, each with its reason and its stop conditions. A sequence ends: when the last reminder goes unanswered, the opportunity comes to you."
        actions={
          <Link href={`${SALES_PATH}/playbook`} className="text-sm font-medium text-brand-300 underline-offset-4 hover:underline">
            Change the timing
          </Link>
        }
      />
      {data === undefined ? (
        <div className="grid gap-3" aria-busy="true" aria-label="Loading follow-ups">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : (
        <div className="grid gap-5">
          {hours ? (
            <p className="rounded-xl border border-border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              <span className="font-semibold text-strong">Your timing:</span> missing details after {words(hours.missingInfoHours)} · a quote after {words(hours.quoteHours)} · agreement or deposit after {words(hours.bookingHours)}. One channel per opportunity, the one the customer used.
            </p>
          ) : null}
          {data.scheduled.length === 0 && data.recent.length === 0 ? (
            <Empty title="No follow-up is planned" body="Sales plans a reminder only when it is waiting on a customer: for missing details, for an answer to a quote, or for a booking step. It never restarts a sequence by itself." />
          ) : (
            <>
              <Panel title={`Due in the next day · ${soon.length}`}>
                {soon.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing is due in the next 24 hours.</p>
                ) : (
                  <ul className="grid gap-2.5 lg:grid-cols-2">
                    {soon.map((row) => (
                      <Planned key={row.followUpId} row={row} now={now} onOpen={open} canCancel={role !== "office"} />
                    ))}
                  </ul>
                )}
              </Panel>
              {later.length > 0 ? (
                <Panel title={`Later · ${later.length}`}>
                  <ul className="grid gap-2.5 lg:grid-cols-2">
                    {later.map((row) => (
                      <Planned key={row.followUpId} row={row} now={now} onOpen={open} canCancel={role !== "office"} />
                    ))}
                  </ul>
                </Panel>
              ) : null}
              <Panel title="The last two weeks">
                {data.recent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No reminder was sent or stopped in the last two weeks.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.recent.map((row) => (
                      <li key={row.followUpId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5 text-sm first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          <button type="button" onClick={() => open(row.opportunityId)} className="font-medium text-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
                            {row.customer}
                          </button>
                          <span className="text-muted-foreground">
                            {" "}
                            · {row.purposeWords} · {row.attempt} of {row.maxAttempts}
                          </span>
                          <p className="text-xs text-muted-foreground">{row.stopReason ?? row.reason}</p>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant={row.status === "sent" ? "success" : row.status === "failed" ? "error" : "outline"} size="sm">
                            {FOLLOW_UP_STATUS[row.status].label}
                          </Badge>
                          {whenLabel(row.doneAt ?? row.dueAt, now, timezone)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </>
          )}
        </div>
      )}
      <OpportunityDrawer opportunityId={openId} now={now} onClose={close} tab="activity" />
    </>
  );
}
