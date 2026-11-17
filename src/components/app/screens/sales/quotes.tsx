"use client";

/**
 * Every quote Sales or a person prepared: which need approval, which are with customers, which were
 * accepted, and which ended. A quote's total is what was offered, not money earned. Opening a quote
 * opens its opportunity, where it is previewed as the customer sees it, approved, sent or revised.
 */
import { useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { PageHeader } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { usd } from "@/lib/app/finance";
import { ago, until } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import { OpportunityDrawer } from "./drawer";
import { Empty, QUOTE_STATE, Stat, useOpportunityParam } from "./shared";

const GROUPS = [
  { id: "review", label: "Needs approval", states: ["awaiting_approval", "draft", "approved"] },
  { id: "out", label: "With customers", states: ["open"] },
  { id: "accepted", label: "Accepted", states: ["accepted"] },
  { id: "ended", label: "Ended", states: ["declined", "expired", "revoked", "superseded"] },
] as const;
type GroupId = (typeof GROUPS)[number]["id"] | "all";

export function SalesQuotesScreen() {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const { openId, open, close } = useOpportunityParam();
  const quotes = useQuery(api.salesQuotes.list, { companyId });
  const [group, setGroup] = useState<GroupId>("all");

  const inGroup = (id: GroupId) => (quotes ?? []).filter((quote) => id === "all" || (GROUPS.find((row) => row.id === id)!.states as readonly string[]).includes(quote.state));
  const shown = inGroup(group);
  const sum = (id: GroupId) => inGroup(id).reduce((total, quote) => total + quote.totalCents, 0);

  return (
    <>
      <PageHeader title="Quotes & Proposals" lead="Priced from your published services. A version that was sent is never edited: a change makes a new version, and the customer’s link shows the current one." />
      {quotes === undefined ? (
        <div className="grid gap-3" aria-busy="true" aria-label="Loading quotes">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : quotes.length === 0 ? (
        <Empty title="No quote yet" body="Sales prepares a quote as soon as it knows everything the price depends on. You can also prepare one yourself from an opportunity in the pipeline. Quotes are priced only from services you have published." />
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="Needs approval" value={String(inGroup("review").length)} hint="Not sent until someone approves" />
            <Stat label="With customers" value={String(inGroup("out").length)} hint={`${usd(sum("out"))} quoted and waiting`} />
            <Stat label="Accepted" value={String(inGroup("accepted").length)} hint={`${usd(sum("accepted"))} accepted. Booked only once the job exists.`} />
            <Stat label="Ended" value={String(inGroup("ended").length)} hint="Declined, expired or withdrawn" />
          </div>
          <div className="inline-flex w-fit flex-wrap rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Show">
            {[{ id: "all" as const, label: "All" }, ...GROUPS].map((row) => (
              <button key={row.id} type="button" aria-pressed={group === row.id} onClick={() => setGroup(row.id)} className={cn("min-h-8 rounded-md px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500", group === row.id ? "bg-brand-500/10 text-strong" : "text-muted-foreground hover:text-strong")}>
                {row.label}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">No quote is in this group.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-4 py-2.5 font-medium">Quote</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Total</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Valid</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shown.map((quote) => {
                    const state = QUOTE_STATE[quote.state] ?? QUOTE_STATE.draft;
                    const left = quote.validUntil && quote.state === "open" ? until(quote.validUntil, now) : null;
                    return (
                      <tr key={quote.quoteId} className="hover:bg-muted/40">
                        <th scope="row" className="px-4 py-2.5 text-left font-normal">
                          <button type="button" onClick={() => open(quote.opportunityId)} className="text-left font-semibold text-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
                            Q-{quote.number} · {quote.customer}
                          </button>
                          <span className="block text-xs text-muted-foreground">
                            {quote.service} · version {quote.version}
                            {quote.versions > quote.version ? ` (a newer version ${quote.versions} is not sent yet)` : ""}
                          </span>
                        </th>
                        <td className="px-3 py-2.5 align-top">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge variant={state.badge} size="sm">
                              {state.label}
                            </Badge>
                            {quote.hasQuestion ? (
                              <Badge variant="info" size="sm">
                                Customer asked a question
                              </Badge>
                            ) : null}
                            {quote.state === "accepted" ? (
                              <Badge variant={quote.booked ? "success" : "warning"} size="sm">
                                {quote.booked ? "Booked" : "Not booked yet"}
                              </Badge>
                            ) : null}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right align-top">
                          <span className="font-medium text-strong tabular-nums">{usd(quote.totalCents)}</span>
                          <span className="block text-xs text-muted-foreground">{quote.per}</span>
                        </td>
                        <td className="px-3 py-2.5 align-top text-xs text-muted-foreground">{left ? <span className={left.soon ? "font-medium text-warning-foreground" : ""}>Expires {left.text}</span> : quote.sentAt ? `Sent ${ago(quote.sentAt, now, timezone)}` : "Not sent"}</td>
                        <td className="px-4 py-2.5 text-right align-top text-xs whitespace-nowrap text-muted-foreground">{ago(quote.updatedAt, now, timezone)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <OpportunityDrawer opportunityId={openId} now={now} onClose={close} tab="quote" />
    </>
  );
}
