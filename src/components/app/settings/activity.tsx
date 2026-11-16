"use client";

import { usePaginatedQuery } from "convex/react";

import { useCompany } from "@/components/app/company";
import { Guard } from "@/components/app/settings/guard";
import { OwnerOnly } from "@/components/app/settings/billing";
import { Panel } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../../convex/_generated/api";

const when = (at: number, timezone: string) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(at));

function ActivityLogInner() {
  const { companyId, role, timezone } = useCompany();
  const events = usePaginatedQuery(api.settings.activity, role === "owner" ? { companyId } : "skip", { initialNumItems: 25 });
  if (role !== "owner") return <OwnerOnly what="The activity log" />;
  return (
    <div className="grid gap-4">
      <p className="max-w-2xl text-sm text-muted-foreground">What changed in the company, newest first, and who changed it. Times are on the company clock ({timezone}). It records actions, not the text of messages.</p>
      <Panel flush>
        {events.status === "LoadingFirstPage" ? (
          <Skeleton className="m-4 h-40" />
        ) : events.results.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nothing has happened yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {events.results.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm sm:px-5">
                <span className="min-w-0 text-strong">
                  <span className="font-medium">{row.actor}</span> {row.text}
                </span>
                <time dateTime={new Date(row.at).toISOString()} className="shrink-0 text-xs text-muted-foreground">
                  {when(row.at, timezone)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {events.status === "CanLoadMore" || events.status === "LoadingMore" ? (
        <div>
          <Button variant="secondary" size="sm" loading={events.status === "LoadingMore"} onClick={() => events.loadMore(25)}>
            Show older activity
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ActivityLog() {
  return (
    <Guard>
      <ActivityLogInner />
    </Guard>
  );
}
