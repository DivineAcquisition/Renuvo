"use client";

/**
 * The pieces every Sales screen is built from. Each one shows a record as it is: who acts next, what
 * Sales prepared and on what evidence, what a quote says, what a booking still needs. Nothing here
 * animates unless a run is really in progress, and nothing shows a prompt, an id or a model's reasoning.
 */
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { AgentAvatar, eyebrow } from "@/components/app/agent";
import { AlertTriangle, ArrowUpRight, CheckCircle2, CircleDashed, Clock, Hand, Loader2, Mail, MessageSquareText, MinusCircle, NotebookPenIcon, XCircle } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ago, money, until, whenLabel } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import type { api } from "../../../../../convex/_generated/api";

export type Overview = FunctionReturnType<typeof api.sales.overview>;
export type Card = FunctionReturnType<typeof api.sales.pipeline>["cards"][number];
export type Stage = Card["stage"];
export type Attention = Card["attention"];
export type Detail = FunctionReturnType<typeof api.sales.opportunity>;
export type ActionRow = Overview["recentActions"][number];
export type Version = NonNullable<Detail["quote"]>["versions"][number];
export type ChecklistRow = Detail["checklist"][number];
export type FollowUpRow = Detail["followUps"][number];
export type BookingItem = NonNullable<Detail["booking"]>["items"][number];
export type ThreadRow = Detail["thread"][number];
export type RunRow = Detail["runs"][number];
export type ReadinessRow = FunctionReturnType<typeof api.sales.readiness>[number];

export const SALES_PATH = "/app/agents/sales";
export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The board's columns, in order. Deferred and Closed lost sit beside the board, not on it. */
export const BOARD: Stage[] = ["new", "qualifying", "quote_ready", "quote_sent", "booking_pending", "won"];

export const STAGE_LOOK: Record<Stage, { dot: string; badge: "info" | "warning" | "success" | "outline" | "secondary" }> = {
  new: { dot: "bg-info", badge: "info" },
  qualifying: { dot: "bg-info", badge: "info" },
  quote_ready: { dot: "bg-brand-500", badge: "secondary" },
  quote_sent: { dot: "bg-brand-500", badge: "secondary" },
  booking_pending: { dot: "bg-warning", badge: "warning" },
  won: { dot: "bg-success", badge: "success" },
  deferred: { dot: "bg-muted-foreground/50", badge: "outline" },
  closed_lost: { dot: "bg-muted-foreground/50", badge: "outline" },
};

export const LOST_WORDS: Record<string, string> = {
  price: "Price",
  timing: "Timing",
  no_response: "No response",
  out_of_area: "Outside the service area",
  unsupported_service: "A service we don't offer",
  chose_another: "Chose another company",
  duplicate: "Duplicate",
  spam: "Spam",
  opted_out: "Asked not to be contacted",
  other: "Other",
};

export const QUOTE_STATE: Record<string, { label: string; badge: "info" | "warning" | "success" | "outline" | "secondary" | "error" }> = {
  draft: { label: "Draft", badge: "outline" },
  awaiting_approval: { label: "Needs your approval", badge: "warning" },
  approved: { label: "Approved, not sent", badge: "secondary" },
  sent: { label: "With the customer", badge: "info" },
  open: { label: "With the customer", badge: "info" },
  accepted: { label: "Accepted", badge: "success" },
  declined: { label: "Declined", badge: "outline" },
  expired: { label: "Expired", badge: "outline" },
  revoked: { label: "Withdrawn", badge: "outline" },
  superseded: { label: "Replaced", badge: "outline" },
};

export function StageBadge({ stage, words }: { stage: Stage; words: string }) {
  return (
    <Badge variant={STAGE_LOOK[stage].badge} size="sm">
      {words}
    </Badge>
  );
}

/** What is going on with an opportunity right now, separate from its stage. "Working" spins only while a run is running. */
export function AttentionBadge({ attention, words }: { attention: Attention; words: string }) {
  if (attention === "none") return null;
  if (attention === "working") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-300">
        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        <span className="agent-shimmer">{words}</span>
      </span>
    );
  }
  const look = attention === "needs_review" ? "warning" : attention === "blocked" ? "error" : attention === "taken_over" ? "secondary" : "outline";
  const Icon = attention === "needs_review" ? AlertTriangle : attention === "blocked" ? XCircle : attention === "taken_over" ? Hand : Clock;
  return (
    <Badge variant={look} size="sm">
      <Icon aria-hidden />
      {words}
    </Badge>
  );
}

const WHO: Record<"sales" | "owner" | "customer", string> = { sales: "Sales", owner: "You", customer: "Customer" };

/** The next step, who owns it and when. Every open opportunity has one. */
export function NextStep({ next, now, compact }: { next: Card["nextAction"]; now: number; compact?: boolean }) {
  if (!next) return null;
  const due = until(next.dueAt, now);
  return (
    <p className={cn("text-xs text-muted-foreground", compact ? "line-clamp-2" : "")}>
      <span className={cn("font-semibold", next.by === "owner" ? "text-warning-foreground" : next.by === "sales" ? "text-brand-300" : "text-strong")}>{WHO[next.by]}</span>
      <span aria-hidden> · </span>
      {next.what}
      {next.by !== "customer" || due.late ? (
        <>
          <span aria-hidden> · </span>
          <span className={due.late && next.by !== "customer" ? "font-medium text-destructive-foreground" : ""}>{due.text}</span>
        </>
      ) : null}
    </p>
  );
}

/** Opens one opportunity in the drawer over whatever Sales page the person is on, and keeps it in the address. */
export function useOpportunityParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get("opp");
  const set = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set("opp", id);
      else next.delete("opp");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return { openId, open: (id: string) => set(id), close: () => set(null) };
}

/** One opportunity, as a card: who, what they want, where it stands, and the next step with its owner. */
export function OpportunityCard({ card, now, onOpen, timezone, dense }: { card: Card; now: number; timezone: string; onOpen: (id: string) => void; dense?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(card.opportunityId)}
      className={cn(
        "group grid w-full gap-1.5 rounded-xl border bg-background text-left transition-colors hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500",
        dense ? "px-3 py-2.5" : "px-3.5 py-3",
        card.attention === "needs_review" || card.attention === "blocked" ? "border-warning/40" : "border-border",
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-strong">{card.customer}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {card.service ?? card.kindWords} · {card.sourceWords}
          </span>
        </span>
        {card.quote ? <span className="shrink-0 text-sm font-semibold text-strong tabular-nums">{money(card.quote.totalCents)}</span> : null}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {dense ? null : <StageBadge stage={card.stage} words={card.stageWords} />}
        <AttentionBadge attention={card.attention} words={card.attentionWords} />
      </span>
      <NextStep next={card.nextAction} now={now} compact />
      <span className="text-[11px] text-muted-foreground">
        {card.lastInboundAt && card.lastInboundAt >= (card.lastOutboundAt ?? 0) ? `Customer wrote ${ago(card.lastInboundAt, now, timezone)}` : card.lastOutboundAt ? `Last message ${ago(card.lastOutboundAt, now, timezone)}` : `Received ${ago(card.receivedAt, now, timezone)}`}
      </span>
    </button>
  );
}

// ── The Sales status header ─────────────────────────────────────────────────────────────────────────

const STATE_WORDS: Record<Overview["state"], string> = { paused: "Paused", working: "Working", needs_you: "Waiting on you", waiting: "Waiting on customers", clear: "Up to date" };

export function SalesStatusHeader({ overview, readiness, briefing, next, action }: { overview: Overview; readiness: ReadinessRow[] | undefined; briefing: string[]; next: string; action?: React.ReactNode }) {
  const busy = overview.state === "working";
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(120%_140%_at_0%_0%,color-mix(in_oklab,var(--color-brand-500)_14%,transparent),transparent_70%)]" />
      <div className="relative flex items-start gap-3 p-4 sm:gap-4 sm:p-5">
        <AgentAvatar agent="sales" size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={overview.paused ? "warning" : overview.state === "needs_you" ? "warning" : "success"} size="sm">
              {STATE_WORDS[overview.state]}
            </Badge>
            {(readiness ?? []).map((row) => (
              <Badge key={row.key} variant={row.ok ? "outline" : "warning"} size="sm" title={row.detail}>
                <span aria-hidden className={cn("size-1.5 rounded-full", row.ok ? "bg-success" : "bg-warning")} />
                {row.label}
                {row.ok ? "" : ": not ready"}
              </Badge>
            ))}
          </div>
          <p className="mt-3 flex items-center gap-2 text-sm">
            {busy ? <Loader2 className="size-4 animate-spin text-brand-300 motion-reduce:animate-none" aria-hidden /> : <span aria-hidden className={cn("size-2 rounded-full", overview.paused ? "bg-warning" : "bg-success")} />}
            <span className={cn(busy ? "agent-shimmer font-medium text-strong" : "text-muted-foreground")}>
              {overview.paused ? "Paused. Nothing is read or sent until Sales is resumed." : busy ? `Working on ${plural(overview.working, "opportunity", "opportunities")} right now` : overview.counts.open === 0 ? "No open opportunities. Sales starts when an inquiry arrives." : `Watching ${plural(overview.counts.open, "open opportunity", "open opportunities")}`}
            </span>
          </p>
          <div className="mt-3 grid gap-1 text-sm leading-relaxed text-strong">
            {briefing.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-brand-500/30 bg-brand-500/5 px-3 py-2.5">
            <p className={eyebrow}>Next</p>
            <p className="mt-1 text-sm font-medium text-strong">{next}</p>
            {action ? <div className="mt-2 flex flex-wrap gap-2">{action}</div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/** What Sales needs connected, and whether each piece is in place. A missing piece says what it stops and where to fix it. */
export function ReadinessPanel({ rows, onlyGaps }: { rows: ReadinessRow[]; onlyGaps?: boolean }) {
  const shown = onlyGaps ? rows.filter((row) => !row.ok) : rows;
  if (shown.length === 0) return null;
  return (
    <ul className="grid gap-2">
      {shown.map((row) => (
        <li key={row.key} className="flex items-start gap-3 rounded-xl border border-border bg-background px-3 py-2.5">
          {row.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-strong">
              {row.label} <span className="sr-only">{row.ok ? "ready" : "not ready"}</span>
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">{row.detail}</p>
          </div>
          {!row.ok && row.href && row.action ? (
            <Button variant="outline" size="xs" render={<Link href={row.href} />}>
              {row.action}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ── Agent action cards ──────────────────────────────────────────────────────────────────────────────

const ACTION_STATUS: Record<ActionRow["status"], { label: string; badge: "info" | "warning" | "success" | "outline" | "error" | "secondary" }> = {
  prepared: { label: "Waiting for your first review", badge: "warning" },
  awaiting_approval: { label: "Needs your approval", badge: "warning" },
  sent: { label: "Sent", badge: "success" },
  done: { label: "Done", badge: "success" },
  failed: { label: "Did not go through", badge: "error" },
  discarded: { label: "Set aside", badge: "outline" },
  stale: { label: "No longer applies", badge: "outline" },
};

export function ChannelIcon({ channel, className }: { channel: string | null; className?: string }) {
  const Icon = channel === "email" ? Mail : channel === "internal" ? NotebookPenIcon : MessageSquareText;
  return <Icon className={cn("size-3.5", className)} aria-hidden />;
}

/**
 * One thing Sales prepared or did: for whom, what it says, why, on what evidence, how it ended and what
 * comes next. The evidence is what Sales read from the record, in plain words.
 */
export function ActionCard({ action, now, timezone, onOpen, children }: { action: ActionRow; now: number; timezone: string; onOpen?: (id: string) => void; children?: React.ReactNode }) {
  const status = ACTION_STATUS[action.status];
  return (
    <article className="live-enter grid gap-2.5 rounded-xl border border-border bg-background p-3.5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ChannelIcon channel={action.channel} />
            {action.kindWords}
            <span aria-hidden>·</span>
            {ago(action.updatedAt, now, timezone)}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-strong">
            {onOpen ? (
              <button type="button" onClick={() => onOpen(action.opportunityId)} className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
                {action.customer}
              </button>
            ) : (
              action.customer
            )}
          </p>
        </div>
        <Badge variant={status.badge} size="sm">
          {status.label}
        </Badge>
      </header>
      <p className="text-sm text-strong">{action.summary}</p>
      {action.body ? (
        <blockquote className="rounded-lg border-l-2 border-brand-500/50 bg-muted/40 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-strong">
          {action.subject ? <span className="mb-1 block text-xs font-semibold text-muted-foreground">{action.subject}</span> : null}
          {action.body}
        </blockquote>
      ) : null}
      <details className="group text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-brand-300 underline-offset-4 select-none hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">Why Sales did this</summary>
        <div className="mt-2 grid gap-2">
          <p className="leading-relaxed">{action.reason}</p>
          {action.evidence.length > 0 ? (
            <dl className="grid gap-1 rounded-lg border border-border bg-card px-3 py-2">
              {action.evidence.map((row, index) => (
                <div key={`${row.label}-${index}`} className="grid grid-cols-[7.5rem_1fr] gap-2">
                  <dt className="font-medium text-strong">{row.label}</dt>
                  <dd>{row.detail}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <p>
            Wording: {action.writtenBy}
            {action.edited ? ", edited by a person" : ""}.
          </p>
        </div>
      </details>
      {action.result ? <p className={cn("text-xs", action.status === "failed" ? "font-medium text-destructive-foreground" : "text-muted-foreground")}>{action.result}</p> : null}
      {action.nextStep ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-strong">Then:</span> {action.nextStep}
        </p>
      ) : null}
      {children}
    </article>
  );
}

// ── Qualification ───────────────────────────────────────────────────────────────────────────────────

const FACT_SOURCE: Record<string, string> = { customer: "The customer said", form: "From the form", member: "Recorded by a person", agent: "Read by Sales", import: "Imported", record: "From their record" };
const WHY: Record<ChecklistRow["why"], string> = { price: "Price", area: "Service area", scope: "Scope", schedule: "Schedule" };

/** What this service needs before a price or a time can be given: what is known, where it came from, and what is still open. */
export function QualificationChecklist({ rows }: { rows: ChecklistRow[] }) {
  const quote = rows.filter((row) => row.phase === "quote");
  const booking = rows.filter((row) => row.phase === "booking");
  const group = (title: string, items: ChecklistRow[]) =>
    items.length === 0 ? null : (
      <div>
        <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
          {title} · {items.filter((row) => row.state === "known").length} of {items.length}
        </p>
        <ul className="grid gap-1.5">
          {items.map((row) => (
            <li key={row.key} className="flex items-start gap-2.5 rounded-lg border border-border bg-background px-3 py-2">
              {row.state === "known" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : row.state === "unverified" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span className="font-medium text-strong">{row.label}</span>
                  <span className={cn("text-sm", row.state === "known" ? "text-strong" : "text-muted-foreground")}>{row.value ?? (row.asked ? `Asked ${row.asked.times === 1 ? "once" : `${row.asked.times} times`}` : "Not known yet")}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {WHY[row.why]}
                  {row.source ? ` · ${FACT_SOURCE[row.source.kind] ?? "On record"}${row.source.excerpt ? `: “${row.source.excerpt}”` : ""}` : ""}
                  {row.state === "unverified" ? " · Not confirmed, so it is not relied on" : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="grid gap-4">
      {group("For the price", quote)}
      {group("For the booking", booking)}
    </div>
  );
}

// ── Quotes ──────────────────────────────────────────────────────────────────────────────────────────

export { QuotePreview } from "@/components/sales/quote-preview";

// ── Follow-ups ──────────────────────────────────────────────────────────────────────────────────────

export const FOLLOW_UP_STATUS: Record<FollowUpRow["status"], { label: string; tone: string }> = {
  scheduled: { label: "Planned", tone: "border-brand-500/50 bg-brand-500 text-white" },
  sent: { label: "Sent", tone: "border-success/50 bg-success text-white" },
  proposed: { label: "Waiting for approval", tone: "border-warning/50 bg-warning text-white" },
  skipped: { label: "Skipped", tone: "border-border bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelled", tone: "border-border bg-muted text-muted-foreground" },
  stopped: { label: "Stopped", tone: "border-border bg-muted text-muted-foreground" },
  failed: { label: "Did not go through", tone: "border-destructive/50 bg-destructive text-white" },
};

/** The reminders for one opportunity, newest first: which one in its sequence, when, why it exists, and why it ended. */
export function FollowUpTimeline({ rows, now, timezone, action }: { rows: FollowUpRow[]; now: number; timezone: string; action?: (row: FollowUpRow) => React.ReactNode }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No reminder is planned. Sales plans one only when it is waiting on the customer.</p>;
  return (
    <ol className="relative grid gap-3 pl-5 before:absolute before:top-1 before:bottom-1 before:left-[5px] before:w-px before:bg-border">
      {rows.map((row) => (
        <li key={row.followUpId} className="relative">
          <span aria-hidden className={cn("absolute top-1 -left-5 size-[11px] rounded-full border", FOLLOW_UP_STATUS[row.status].tone)} />
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="font-medium text-strong">
              {row.purposeWords} · {row.attempt} of {row.maxAttempts}
            </span>
            <span className="text-xs text-muted-foreground">
              {FOLLOW_UP_STATUS[row.status].label} · {row.status === "scheduled" ? whenLabel(row.dueAt, now, timezone) : whenLabel(row.dueAt, now, timezone)}
            </span>
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">{row.stopReason ?? row.reason}</p>
          {row.status === "scheduled" && action ? <div className="mt-1.5">{action(row)}</div> : null}
        </li>
      ))}
    </ol>
  );
}

// ── Booking ─────────────────────────────────────────────────────────────────────────────────────────

const BY_WORDS: Record<NonNullable<BookingItem["by"]>, string> = { customer: "Waiting on the customer", owner: "Yours to do", sales: "Sales is on it" };

/** What a confirmed booking needs, item by item, each read from its own record: the quote, the agreement, Finance, the schedule. */
export function BookingChecklist({ items }: { items: BookingItem[] }) {
  return (
    <ul className="grid gap-1.5">
      {items.map((item) => (
        <li key={item.key} className={cn("flex items-start gap-2.5 rounded-lg border bg-background px-3 py-2", item.state === "blocked" ? "border-destructive/40" : "border-border")}>
          {item.state === "done" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          ) : item.state === "blocked" ? (
            <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          ) : item.state === "not_required" ? (
            <MinusCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <CircleDashed className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-medium text-strong">
              {item.label}
              <span className="text-xs font-normal text-muted-foreground">{item.state === "done" ? "Done" : item.state === "not_required" ? "Not required" : item.by ? BY_WORDS[item.by] : "Open"}</span>
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Conversation and activity ───────────────────────────────────────────────────────────────────────

const DELIVERY_TONE: Record<string, string> = { pending: "text-muted-foreground", sent: "text-muted-foreground", delivered: "text-success-foreground", failed: "text-destructive-foreground", unknown: "text-warning-foreground", not_sent: "text-destructive-foreground" };

/** The conversation, oldest first. Each sent message says what the provider reported for it; a note is marked as never sent. */
export function Thread({ rows, now, timezone }: { rows: ThreadRow[]; now: number; timezone: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing has been said yet.</p>;
  return (
    <ol className="grid gap-2.5">
      {rows.map((row) => {
        const mine = row.direction === "out";
        const note = row.direction === "note";
        return (
          <li key={row.messageId} className={cn("flex", mine ? "justify-end" : note ? "justify-center" : "justify-start")}>
            <div className={cn("max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm", note ? "w-full max-w-full border border-dashed border-border bg-muted/40" : mine ? "rounded-br-md bg-brand-500/10 text-strong" : "rounded-bl-md border border-border bg-card text-strong")}>
              <p className="mb-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <ChannelIcon channel={row.channel} className="size-3" />
                {note ? `Note from ${row.author} · not sent to the customer` : row.author}
                <span aria-hidden>·</span>
                <time dateTime={new Date(row.at).toISOString()}>{whenLabel(row.at, now, timezone)}</time>
              </p>
              {row.subject ? <p className="text-xs font-semibold text-strong">{row.subject}</p> : null}
              <p className="leading-relaxed whitespace-pre-wrap">{row.body}</p>
              {row.delivery ? <p className={cn("mt-1 text-[11px]", DELIVERY_TONE[row.delivery.state] ?? "text-muted-foreground")}>{row.delivery.words}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const TRIGGER_WORDS: Record<RunRow["trigger"], string> = {
  inquiry: "A new inquiry arrived",
  reply: "The customer replied",
  quote_approved: "A quote was approved",
  quote_accepted: "The customer accepted the quote",
  quote_declined: "The customer declined the quote",
  follow_up_due: "A reminder came due",
  booking_change: "A booking step changed",
  resume: "The conversation was handed back",
  manual: "A person asked Sales to look",
};

/** What Sales did each time something happened: what set it off, each step in plain words, and how it ended. */
export function RunTimeline({ runs, now, timezone }: { runs: RunRow[]; now: number; timezone: string }) {
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">Sales has not worked on this yet.</p>;
  return (
    <ol className="grid gap-3">
      {runs.map((run) => (
        <li key={run.runId} className="rounded-xl border border-border bg-background p-3">
          <p className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium text-strong">
            <span className="flex items-center gap-2">
              {run.status === "running" ? <Loader2 className="size-3.5 animate-spin text-brand-300 motion-reduce:animate-none" aria-hidden /> : run.status === "failed" ? <XCircle className="size-3.5 text-destructive" aria-hidden /> : run.status === "queued" ? <Clock className="size-3.5 text-muted-foreground" aria-hidden /> : <CheckCircle2 className="size-3.5 text-success" aria-hidden />}
              {TRIGGER_WORDS[run.trigger]}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {run.status === "running" ? "In progress" : run.status === "queued" ? "Queued" : ago(run.at, now, timezone)}
              {run.reader ? ` · read by ${run.reader === "rules" ? "your rules" : "AI"}` : ""}
            </span>
          </p>
          {run.steps.length > 0 ? (
            <ol className="mt-2 grid gap-1 border-l border-border pl-3 text-xs text-muted-foreground">
              {run.steps.map((step, index) => (
                <li key={`${step.at}-${index}`} className="flex gap-2">
                  <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", step.outcome === "refused" ? "bg-warning" : step.outcome === "proposed" ? "bg-brand-500" : step.outcome === "done" ? "bg-success" : "bg-muted-foreground/50")} aria-hidden />
                  <span>
                    {step.summary}
                    {step.outcome === "refused" ? <span className="sr-only"> (stopped by a rule)</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          {run.result ? <p className={cn("mt-2 text-xs", run.status === "failed" ? "font-medium text-destructive-foreground" : "text-strong")}>{run.result}</p> : null}
        </li>
      ))}
    </ol>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: string; hint?: string; href?: string }) {
  const body = (
    <>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="font-heading text-2xl leading-none tracking-tight text-strong tabular-nums">{value}</span>
      {hint ? <span className="text-[11px] leading-snug text-muted-foreground">{hint}</span> : null}
    </>
  );
  const shell = "grid content-start gap-1.5 rounded-xl border border-border bg-background px-3.5 py-3";
  return href ? (
    <Link href={href} className={cn(shell, "hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500")}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
      <p className="text-base font-semibold text-strong">{title}</p>
      <p className="mx-auto mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action ? <div className="mt-4 flex justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function OpenLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-brand-300 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden />
    </Link>
  );
}
