"use client";

import { usePaginatedQuery } from "convex/react";

import { AgentAvatar } from "@/components/app/agent";
import { useCompany } from "@/components/app/company";
import { Guard } from "@/components/app/settings/guard";
import { OwnerOnly } from "@/components/app/settings/billing";
import { Panel } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { activityTitle, AREA_LABEL } from "@/lib/app/activity";

import { api } from "../../../../convex/_generated/api";

const when = (at: number, timezone: string) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(at));

/** Agents are shown with their face; their recorded name is the agent id in lower case. */
const AGENT_IDS = new Set(["sales", "recruiter", "dispatch", "retention"]);

function ActivityLogInner() {
  const { companyId, role, timezone } = useCompany();
  const events = usePaginatedQuery(api.settings.activity, role === "owner" ? { companyId } : "skip", { initialNumItems: 25 });
  if (role !== "owner") return <OwnerOnly what="Activity" />;
  return (
    <div className="grid gap-4">
      <p className="max-w-2xl text-sm text-muted-foreground">Newest first. Times are in your company&apos;s time zone. Activity records what was done, not the content of messages.</p>
      <Panel flush>
        {events.status === "LoadingFirstPage" ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : events.results.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">No activity yet. Changes you and your agents make will appear here.</p>
        ) : (
          <ul className="divide-y divide-border">
            {events.results.map((row) => {
              const shown = activityTitle(row.type);
              // A sentence from the server adds names and specifics. It's shown only when the server had real words for it.
              const described = (row as typeof row & { described?: boolean }).described ?? shown.known;
              const agent = row.actorKind === "agent" ? row.actor.toLowerCase() : null;
              return (
                <li key={row.id} className="flex gap-3 px-4 py-3 sm:px-5">
                  <div className="pt-0.5">{agent && AGENT_IDS.has(agent) ? <AgentAvatar agent={agent as "sales"} size="sm" /> : <span aria-hidden className="mt-1.5 block size-2 rounded-full bg-brand-500/60" />}</div>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-medium text-strong">{shown.title}</span>
                      <span className="text-xs text-muted-foreground">{AREA_LABEL[shown.area]}</span>
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {described ? (
                        <>
                          <span className="text-strong">{row.actor}</span> {row.text}
                        </>
                      ) : (
                        <>By {row.actor}</>
                      )}
                    </p>
                  </div>
                  <time dateTime={new Date(row.at).toISOString()} className="shrink-0 pt-0.5 text-right text-xs text-muted-foreground">
                    {when(row.at, timezone)}
                  </time>
                </li>
              );
            })}
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
