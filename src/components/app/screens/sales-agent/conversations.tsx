"use client";

/**
 * Conversations with people who asked about service, by text and by email, newest activity first. Each
 * row says who spoke last, whether the last message reached the customer, and who has the conversation:
 * Sales, or a person who took it over. Voice calls are not part of Sales, and nothing here suggests they are.
 */
import { useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { TextInput } from "@/components/app/form";
import { PageHeader } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Hand, Search } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ago } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import { OpportunityDrawer } from "./drawer";
import { AttentionBadge, ChannelIcon, Empty, StageBadge, useOpportunityParam } from "./shared";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unanswered", label: "Customer spoke last" },
  { id: "yours", label: "You are handling" },
  { id: "problem", label: "Not delivered" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

const WHO: Record<string, string> = { customer: "Customer", agent: "Sales", member: "Your team", system: "Selestial" };

export function SalesConversationsScreen() {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const { openId, open, close } = useOpportunityParam();
  const rows = useQuery(api.salesConversations.list, { companyId });
  const [filter, setFilter] = useState<FilterId>("all");
  const [search, setSearch] = useState("");

  const term = search.trim().toLowerCase();
  const shown = (rows ?? []).filter(
    (row) =>
      (filter === "all" ? true : filter === "unanswered" ? row.unanswered : filter === "yours" ? row.takenOver : row.last.delivery === "failed" || row.last.delivery === "unknown" || row.last.delivery === "not_sent") &&
      (term === "" || row.customer.toLowerCase().includes(term) || row.last.body.toLowerCase().includes(term)),
  );
  const count = (id: FilterId) => (rows ?? []).filter((row) => (id === "all" ? true : id === "unanswered" ? row.unanswered : id === "yours" ? row.takenOver : row.last.delivery === "failed" || row.last.delivery === "unknown" || row.last.delivery === "not_sent")).length;

  return (
    <>
      <PageHeader title="Conversations" lead="Texts and emails with people who asked about service. Open one to read it, reply, or take it over from Sales." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or words" aria-label="Search conversations" className="pl-9" />
        </div>
        <div className="inline-flex flex-wrap rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Show">
          {FILTERS.map((row) => (
            <button key={row.id} type="button" aria-pressed={filter === row.id} onClick={() => setFilter(row.id)} className={cn("min-h-8 rounded-md px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500", filter === row.id ? "bg-brand-500/10 text-strong" : "text-muted-foreground hover:text-strong")}>
              {row.label}
              {rows && row.id !== "all" ? <span className="ml-1 tabular-nums opacity-70">{count(row.id)}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {rows === undefined ? (
        <div className="grid gap-2" aria-busy="true" aria-label="Loading conversations">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty title="No conversation yet" body="A conversation starts when someone texts your business number, submits a booking form, or is added by hand. A reply to one of Sales’s emails comes back here. An email a customer sends to your own address does not." />
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">Nothing matches.</p>
      ) : (
        <ul className="grid gap-2">
          {shown.map((row) => (
            <li key={row.opportunityId}>
              <button
                type="button"
                onClick={() => open(row.opportunityId)}
                className={cn("grid w-full gap-1.5 rounded-xl border bg-card px-4 py-3 text-left hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500", row.unanswered ? "border-brand-500/40" : "border-border")}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {row.unanswered ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-brand-500" /> : null}
                    <span className="truncate text-sm font-semibold text-strong">{row.customer}</span>
                    <span className="hidden truncate text-xs text-muted-foreground sm:inline">{row.service ?? ""}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{ago(row.at, now, timezone)}</span>
                </span>
                <span className="flex items-start gap-2 text-sm text-muted-foreground">
                  <ChannelIcon channel={row.channel} className="mt-0.5 shrink-0" />
                  <span className="line-clamp-2">
                    <span className="font-medium text-strong">{row.last.direction === "note" ? "Team note" : (WHO[row.last.author] ?? "Customer")}:</span> {row.last.body}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <StageBadge stage={row.stage} words={row.stageWords} />
                  {row.takenOver ? (
                    <Badge variant="secondary" size="sm">
                      <Hand aria-hidden />
                      You are handling it
                    </Badge>
                  ) : (
                    <AttentionBadge attention={row.attention} words={row.attentionWords} />
                  )}
                  {row.unanswered ? (
                    <Badge variant="info" size="sm">
                      Customer spoke last
                    </Badge>
                  ) : null}
                  {row.last.delivery === "failed" || row.last.delivery === "not_sent" ? (
                    <Badge variant="error" size="sm">
                      Last message not delivered
                    </Badge>
                  ) : row.last.delivery === "unknown" ? (
                    <Badge variant="warning" size="sm">
                      Delivery not confirmed
                    </Badge>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <OpportunityDrawer opportunityId={openId} now={now} onClose={close} tab="conversation" />
    </>
  );
}
