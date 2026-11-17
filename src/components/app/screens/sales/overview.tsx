"use client";

/**
 * Sales's landing page: whether it is working, what is waiting on a person, where the open
 * opportunities stand, what Sales did, and what came of it over the last 30 days. Every number is
 * counted from the records and says what it counts. Quoted value, booked value and money received are
 * three different numbers and are never added together or called revenue.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";

import { useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { FormError, useRun } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { PauseCircleIcon, Play } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usd } from "@/lib/app/finance";
import { ago, money, whenLabel } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import { OpportunityDrawer } from "./drawer";
import { NewInquiryButton } from "./new-inquiry";
import { ReviewQueue } from "./review";
import { ActionCard, LOST_WORDS, OpportunityCard, plural, ReadinessPanel, SALES_PATH, SalesStatusHeader, Stat, useOpportunityParam, type Overview } from "./shared";

const LEAD = "Turns inquiries into confirmed bookings.";

function share(part: number, whole: number): string {
  return whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;
}

function Measures({ measures }: { measures: Overview["measures"] }) {
  const n = measures.inquiries;
  const funnel = [
    { label: "Inquiries received", value: n, of: null as number | null },
    { label: "Got a first reply", value: measures.responded, of: n },
    { label: "Qualified", value: measures.qualified, of: n },
    { label: "Quote sent", value: measures.quotesSent, of: n },
    { label: "Quote accepted", value: measures.quotesAccepted, of: n },
    { label: "Booked", value: measures.bookings, of: n },
  ];
  return (
    <Panel title={`Last ${measures.days} days`} action={<span className="text-xs text-muted-foreground">Of the {plural(n, "inquiry", "inquiries")} received in this period</span>}>
      {n === 0 ? (
        <p className="text-sm text-muted-foreground">No inquiry arrived in the last {measures.days} days, so there is nothing to measure yet.</p>
      ) : (
        <div className="grid gap-5">
          <ol className="grid gap-2">
            {funnel.map((row) => (
              <li key={row.label} className="grid grid-cols-[9.5rem_1fr_auto] items-center gap-3 text-sm">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="block h-full rounded-full bg-brand-500" style={{ width: `${n === 0 ? 0 : Math.max(2, Math.round((row.value / n) * 100))}%` }} />
                </span>
                <span className="min-w-20 text-right font-medium text-strong tabular-nums">
                  {row.value}
                  {row.of !== null ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">{share(row.value, row.of)}</span> : null}
                </span>
              </li>
            ))}
          </ol>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Median time to first reply" value={measures.medianResponseMinutes === null ? "—" : measures.medianResponseMinutes < 1 ? "< 1 min" : `${measures.medianResponseMinutes} min`} hint={`Across the ${measures.responded} that got a reply`} />
            <Stat label="Quoted value" value={usd(measures.quotedValueCents)} hint="The total of quotes sent. Not booked, and not money." />
            <Stat label="Booked value" value={usd(measures.bookedValueCents)} hint="Accepted quotes that became confirmed jobs. Not yet paid." />
            <Stat label="Deposits received" value={measures.collectedDepositsCents === null ? "Owner only" : usd(measures.collectedDepositsCents)} hint="Money Finance’s ledger shows as paid on these bookings’ deposit invoices." />
          </div>
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Closed without a booking, by reason</p>
              {measures.lost.length === 0 ? (
                <p className="text-muted-foreground">None in this period.</p>
              ) : (
                <ul className="grid gap-1">
                  {measures.lost.map((row) => (
                    <li key={row.reason} className="flex justify-between gap-3">
                      <span className="text-strong">{LOST_WORDS[row.reason] ?? row.reason}</span>
                      <span className="text-muted-foreground tabular-nums">{row.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground">How the work was done</p>
              <ul className="grid gap-1 text-muted-foreground">
                <li>
                  <span className="font-medium text-strong tabular-nums">{measures.withPersonInvolved}</span> of {n} had a person step in at least once
                </li>
                <li>
                  <span className="font-medium text-strong tabular-nums">{measures.messagesSent}</span> {measures.messagesSent === 1 ? "message" : "messages"} sent to prospects
                </li>
                <li className={measures.deliveryFailures > 0 ? "text-destructive-foreground" : ""}>
                  <span className="font-medium tabular-nums">{measures.deliveryFailures}</span> did not go through or could not be confirmed
                </li>
              </ul>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">These are counts of what happened. They do not say what Sales caused: there is no comparison group.</p>
        </div>
      )}
    </Panel>
  );
}

export function SalesOverviewScreen() {
  const { companyId, timezone, role } = useCompany();
  const now = useNow();
  const openDetail = useDetail();
  const { openId, open, close } = useOpportunityParam();
  const overview = useQuery(api.sales.overview, now ? { companyId, asOf: now } : "skip");
  const readiness = useQuery(api.sales.readiness, { companyId });
  const permissions = useQuery(api.permissions.list, { companyId });
  const setPaused = useMutation(api.companies.setPausedAgents);
  const { busy, error, run } = useRun();

  if (!overview) {
    return (
      <>
        <PageHeader title="Sales" lead={LEAD} />
        <div className="grid gap-5" aria-busy="true" aria-label="Loading Sales">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </>
    );
  }

  const counts = overview.counts;
  const pausedAgents = permissions?.pausedAgents ?? [];
  const gaps = (readiness ?? []).filter((row) => !row.ok);
  const blockers = gaps.filter((row) => row.key === "services" || row.key === "texting" || row.key === "email");
  const first = overview.attention[0] ?? null;
  const batchWaiting = !overview.firstBatch.decided ? overview.firstBatch.waiting : 0;

  const briefing = [
    counts.open === 0 ? "No inquiry is open." : `${plural(counts.open, "open opportunity", "open opportunities")}: ${counts.newInquiries} new, ${counts.awaitingDetails} waiting on details, ${counts.quotesWithCustomer} with a quote in hand, ${counts.bookingPending} booking.`,
    counts.followUpsDue > 0 ? `${plural(counts.followUpsDue, "follow-up")} due in the next day.` : null,
    overview.reader === "rules" ? null : "An AI reader reads customer messages; your rules decide everything that is sent, priced or booked.",
  ].filter((line): line is string => Boolean(line));

  const next = overview.paused
    ? "Sales is paused. Inquiries are still filed, and they are yours to answer until you resume it."
    : batchWaiting > 0
      ? `Sales prepared its first ${plural(batchWaiting, "message")} and is holding ${batchWaiting === 1 ? "it" : "them"} for your review. Nothing has been sent.`
      : blockers.length > 0 && counts.open === 0
        ? `${blockers[0].label}: ${blockers[0].detail}`
        : first
          ? `${first.customer}: ${first.nextAction?.what ?? first.attentionWords}.`
          : counts.open === 0
            ? "Nothing is open. Publish a booking form or add an inquiry, and Sales takes it from there."
            : "Nothing is waiting on you. Sales is waiting on customers or on a reminder’s time.";

  return (
    <>
      <PageHeader
        title="Sales"
        lead={LEAD}
        actions={
          <>
            {role === "owner" && permissions ? (
              <Button variant="outline" size="sm" loading={busy} onClick={() => void run(() => setPaused({ companyId, agents: overview.paused ? pausedAgents.filter((agent) => agent !== "sales") : [...pausedAgents, "sales"] }))}>
                {overview.paused ? <Play aria-hidden /> : <PauseCircleIcon aria-hidden />}
                {overview.paused ? "Resume Sales" : "Pause Sales"}
              </Button>
            ) : null}
            <NewInquiryButton onCreated={open} />
          </>
        }
      />
      <FormError message={error} />

      <div className="grid gap-5">
        <SalesStatusHeader
          overview={overview}
          readiness={readiness}
          briefing={briefing}
          next={next}
          action={
            first && batchWaiting === 0 && !overview.paused ? (
              <Button variant="outline" size="xs" onClick={() => open(first.opportunityId)}>
                Open {first.customer}
              </Button>
            ) : counts.open === 0 && !overview.paused ? (
              <Button variant="outline" size="xs" render={<Link href={`${SALES_PATH}/booking-forms`} />}>
                Set up a booking form
              </Button>
            ) : null
          }
        />

        {gaps.length > 0 && readiness ? (
          <Panel title="Before Sales can do all of its work">
            <ReadinessPanel rows={readiness} onlyGaps />
          </Panel>
        ) : null}

        <ReviewQueue onOpen={open} />

        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="New inquiries" value={String(counts.newInquiries)} href={`${SALES_PATH}/pipeline?stage=new`} />
          <Stat label="Awaiting details" value={String(counts.awaitingDetails)} hint="Waiting on the customer" href={`${SALES_PATH}/pipeline?stage=qualifying`} />
          <Stat label="Quotes to review" value={String(counts.quotesForReview)} hint="Yours to approve" href={`${SALES_PATH}/quotes-proposals`} />
          <Stat label="Quotes with customers" value={String(counts.quotesWithCustomer)} href={`${SALES_PATH}/pipeline?stage=quote_sent`} />
          <Stat label="Booking pending" value={String(counts.bookingPending)} hint="Accepted, not yet booked" href={`${SALES_PATH}/pipeline?stage=booking_pending`} />
          <Stat label="Follow-ups due" value={String(counts.followUpsDue)} hint="In the next 24 hours" href={`${SALES_PATH}/follow-ups`} />
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-2">
          <Panel title={`Needs you · ${overview.attention.length}`} action={<Link href={`${SALES_PATH}/pipeline`} className="text-xs font-medium text-brand-300 underline-offset-4 hover:underline">Open the pipeline</Link>}>
            {overview.attention.length === 0 ? (
              <p className="text-sm text-muted-foreground">No opportunity is waiting on a person.</p>
            ) : (
              <ul className="grid gap-2">
                {overview.attention.map((card) => (
                  <li key={card.opportunityId}>
                    <OpportunityCard card={card} now={now} timezone={timezone} onOpen={open} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Recent bookings">
            {overview.recentBookings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No booking has come from Sales yet. A booking appears here when a job is created, not when a quote is accepted.</p>
            ) : (
              <ul className="grid gap-2">
                {overview.recentBookings.map((booking) => (
                  <li key={booking.opportunityId} className="grid gap-1 rounded-xl border border-border bg-background px-3.5 py-3 text-sm">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <button type="button" onClick={() => open(booking.opportunityId)} className="font-semibold text-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
                        {booking.customer}
                      </button>
                      {booking.priceCents !== null ? <span className="font-semibold text-strong tabular-nums">{money(booking.priceCents)}</span> : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {booking.service ?? "Service"} · {booking.startsAt ? whenLabel(booking.startsAt, now, timezone) : "time not set"} · booked {ago(booking.wonAt, now, timezone)}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="success" size="sm">
                        Booked
                      </Badge>
                      <Badge variant={booking.crew === "accepted" ? "success" : "outline"} size="sm">
                        {booking.crew === "accepted" ? "Crew confirmed" : booking.crew === "offered" ? "Crew offered, not confirmed" : "No crew yet · with Dispatch"}
                      </Badge>
                      {!booking.capacityVerified ? (
                        <Badge variant="warning" size="sm">
                          Confirmed without verified capacity
                        </Badge>
                      ) : null}
                      {booking.jobId ? (
                        <button type="button" onClick={() => openDetail({ kind: "job", id: booking.jobId! })} className={cn("ml-auto text-xs font-medium text-brand-300 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500")}>
                          Open the job
                        </button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel title="What Sales did">
          {overview.recentActions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sales has not prepared or sent anything yet.</p>
          ) : (
            <div className="grid gap-2.5 lg:grid-cols-2">
              {overview.recentActions.slice(0, 8).map((action) => (
                <ActionCard key={action.actionId} action={action} now={now} timezone={timezone} onOpen={open} />
              ))}
            </div>
          )}
        </Panel>

        <Measures measures={overview.measures} />
      </div>
      <OpportunityDrawer opportunityId={openId} now={now} onClose={close} />
    </>
  );
}
