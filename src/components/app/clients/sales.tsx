"use client";

/**
 * The client's Sales work, shown on their profile: deals, quotes, proposals, bookings and Sales recurring
 * plans. Read from Sales and changed there: every row opens its Sales page. Each state is its own word:
 * a proposal accepted is not a booking, and a booking confirmed says nothing about who is cleaning.
 */
import { useQuery } from "convex/react";
import Link from "next/link";

import { useCompany } from "@/components/app/company";
import { ArrowUpRight } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import { Card, day, money, when } from "./bits";
import { OpenDetail } from "./parts";
import type { Profile } from "./profile";

type Sales = NonNullable<ReturnType<typeof useQuery<typeof api.clientSales.forClient>>>;

const TONE: Record<string, "success" | "warning" | "error" | "outline" | "info"> = {
  won: "success",
  lost: "outline",
  accepted: "success",
  confirmed: "success",
  active: "success",
  sent: "info",
  requested: "warning",
  awaiting: "warning",
  changes_requested: "warning",
  paused: "warning",
  pending: "info",
  declined: "error",
  expired: "outline",
  cancelled: "outline",
  ended: "outline",
};

export function useClientSales(profile: Profile) {
  const { companyId } = useCompany();
  return useQuery(api.clientSales.forClient, { companyId, customerId: profile.id });
}

function Open({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-1 font-medium text-strong underline-offset-4 hover:underline", className)}>
      {children}
    </Link>
  );
}

/** Sales recurring plans, beside the Clients plans. Changed in Sales. */
export function SalesPlans({ sales }: { sales: Sales }) {
  if (!sales.plans.length) return null;
  return (
    <section aria-label="Plans from Sales" className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-strong">From Sales</h3>
        <p className="text-xs text-muted-foreground">Made by a Sales booking or proposal. Paused, skipped and changed in Sales.</p>
      </div>
      {sales.plans.map((plan) => (
        <article key={plan.id} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <Open href={plan.href}>
                  {plan.service} <ArrowUpRight className="size-3.5" aria-hidden />
                </Open>
                <Badge variant={TONE[plan.status] ?? "outline"} size="sm">
                  {plan.statusWords}
                </Badge>
                {plan.pendingChange ? (
                  <Badge variant="warning" size="sm">
                    Change waiting for the Owner
                  </Badge>
                ) : null}
              </p>
              <p className="text-sm text-muted-foreground">
                {plan.property}
                {plan.cadence ? ` · ${plan.cadence}` : ""}
              </p>
            </div>
            <p className="text-sm text-strong">{plan.visitCents !== null ? `${money(plan.visitCents)} a visit` : "No price yet"}</p>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Starts {plan.startDate}
            {plan.bookedThrough ? ` · visits made through ${plan.bookedThrough}` : ""}
            {plan.pause ? ` · paused from ${plan.pause.from}${plan.pause.until ? ` until ${plan.pause.until}` : ""}` : ""}
            {plan.endDate ? ` · last date ${plan.endDate}` : ""} · {plan.billing}
          </p>
        </article>
      ))}
      <p className="text-xs text-muted-foreground">Their visits are in Upcoming and History like any other, staffed by Dispatch.</p>
    </section>
  );
}

/** Deals, quotes, proposals and bookings from Sales, for Quotes &amp; Proposals. */
export function SalesWork({ sales }: { sales: Sales }) {
  const { timezone } = useCompany();
  const empty = !sales.deals.length && !sales.quotes.length && !sales.proposals.length && !sales.bookings.length;
  return (
    <Card
      title="In Sales"
      action={
        <span className="flex flex-wrap gap-3">
          <Link href={sales.newBooking} className="text-sm font-medium text-brand-300 underline-offset-4 hover:underline">
            New booking
          </Link>
          <Link href={sales.newProposal} className="text-sm font-medium text-brand-300 underline-offset-4 hover:underline">
            New proposal
          </Link>
        </span>
      }
    >
      {empty ? <p className="text-sm text-muted-foreground">No deals, quotes, proposals or bookings in Sales for this client yet.</p> : null}
      <div className="grid gap-5">
        {sales.deals.length ? (
          <Group title="Deals in the pipeline">
            {sales.deals.map((d) => (
              <Row key={d.id}>
                <div className="min-w-0">
                  <Open href={d.href}>{d.title}</Open>
                  <p className="text-xs text-muted-foreground">
                    {d.milestoneWords ?? d.stageWords}
                    {d.owner ? ` · ${d.owner}` : " · nobody responsible yet"}
                    {d.estimateCents !== null ? ` · about ${money(d.estimateCents)}` : ""}
                  </p>
                  {d.open && d.nextAction ? (
                    <p className={cn("text-xs", d.overdue ? "font-medium text-warning-foreground" : "text-muted-foreground")}>
                      Next: {d.nextAction}
                      {d.nextActionAt ? ` · ${d.overdue ? "was due" : "due"} ${when(d.nextActionAt, timezone)}` : ""}
                      {d.followUps === "paused" ? " · follow-ups paused" : ""}
                    </p>
                  ) : null}
                  {!d.open && d.closedReason ? <p className="text-xs text-muted-foreground">{d.closedReason}</p> : null}
                </div>
                <Badge variant={TONE[d.stage] ?? "outline"} size="sm">
                  {d.stageWords}
                </Badge>
              </Row>
            ))}
          </Group>
        ) : null}
        {sales.proposals.length ? (
          <Group title="Proposals">
            {sales.proposals.map((p) => (
              <Row key={p.id}>
                <div className="min-w-0">
                  <Open href={p.href}>{p.title}</Open>
                  <p className="text-xs text-muted-foreground">
                    Version {p.latestVersion}
                    {p.sentVersion ? ` · version ${p.sentVersion} sent` : " · not sent"}
                    {p.viewCount ? ` · opened ${p.viewCount} ${p.viewCount === 1 ? "time" : "times"}` : ""}
                    {p.expiresAt ? ` · expires ${day(p.expiresAt, timezone)}` : ""}
                  </p>
                  {p.next ? <p className="text-xs text-strong">{p.next}</p> : null}
                </div>
                <Badge variant={TONE[p.status] ?? "outline"} size="sm">
                  {p.statusWords}
                </Badge>
              </Row>
            ))}
          </Group>
        ) : null}
        {sales.bookings.length ? (
          <Group title="Bookings">
            {sales.bookings.map((b) => (
              <Row key={b.id}>
                <div className="min-w-0">
                  <Open href={b.href}>
                    {b.kind === "recurring" ? "Recurring booking" : "One-time booking"} · {when(b.startsAt, timezone)}
                  </Open>
                  <p className="text-xs text-muted-foreground">
                    {b.property} · {money(b.priceCents)} · {b.payment} · {b.agreement} · {b.schedule}
                  </p>
                  {b.problem ? <p className="text-xs text-warning-foreground">{b.problem}</p> : null}
                  {b.jobId ? (
                    <OpenDetail kind="job" id={b.jobId} className="text-xs font-medium text-brand-300 underline-offset-4 hover:underline">
                      Open the visit
                    </OpenDetail>
                  ) : null}
                </div>
                <Badge variant={TONE[b.status] ?? "outline"} size="sm">
                  {b.statusWords}
                </Badge>
              </Row>
            ))}
          </Group>
        ) : null}
        {sales.quotes.length ? (
          <Group title="Quotes">
            {sales.quotes.map((q) => (
              <Row key={q.id}>
                <div className="min-w-0">
                  <Open href={q.href}>
                    {money(q.visitCents)} {q.kind === "recurring" ? `a visit${q.cadence ? `, ${q.cadence.toLowerCase()}` : ""}` : "one time"}
                  </Open>
                  <p className="text-xs text-muted-foreground">
                    {q.property}
                    {q.firstCents !== null ? ` · first visit ${money(q.firstCents)}` : ""} · saved {day(q.createdAt, timezone)}
                  </p>
                </div>
                <Badge variant={TONE[q.status] ?? "outline"} size="sm">
                  {q.statusWords}
                </Badge>
              </Row>
            ))}
          </Group>
        ) : null}
      </div>
    </Card>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ul className="grid gap-2">{children}</ul>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <li className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-border px-3 py-2.5 text-sm">{children}</li>;
}

/** The open deal, if any, on the Overview. */
export function SalesCard({ profile }: { profile: Profile }) {
  const sales = useClientSales(profile);
  const { timezone } = useCompany();
  if (sales === undefined) return <Skeleton className="h-24 rounded-2xl" />;
  const open = sales.deals.filter((d) => d.open);
  const waiting = sales.proposals.filter((p) => p.status === "sent" || p.status === "changes_requested");
  const pending = sales.bookings.filter((b) => b.status === "requested" || b.status === "awaiting");
  if (!open.length && !waiting.length && !pending.length) return null;
  return (
    <Card title="Sales">
      <ul className="grid gap-2 text-sm">
        {open.slice(0, 3).map((d) => (
          <li key={d.id}>
            <Open href={d.href}>{d.title}</Open>
            <p className="text-xs text-muted-foreground">
              {d.milestoneWords ?? d.stageWords}
              {d.nextActionAt ? ` · next ${d.overdue ? "was due" : "due"} ${when(d.nextActionAt, timezone)}` : ""}
            </p>
          </li>
        ))}
        {waiting.slice(0, 2).map((p) => (
          <li key={p.id}>
            <Open href={p.href}>{p.title}</Open>
            <p className="text-xs text-muted-foreground">Proposal {p.statusWords.toLowerCase()}</p>
          </li>
        ))}
        {pending.slice(0, 2).map((b) => (
          <li key={b.id}>
            <Open href={b.href}>Booking for {day(b.startsAt, timezone)}</Open>
            <p className="text-xs text-muted-foreground">
              {b.statusWords} · {b.payment} · {b.agreement}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
