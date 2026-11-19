"use client";

/**
 * The pieces every Retention screen is built from. A case is always shown the same way: what happened,
 * what Selestial is doing, and what needs a person, in that order. A status is words with a mark, never a
 * colour alone, and nothing here is a score: "No known open issues" is a statement about the record.
 * Nothing animates unless work is really under way.
 */
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { AgentAvatar, eyebrow } from "@/components/app/agent";
import { AlertTriangle, ArrowUpRight, CheckCircle2, CircleDashed, Clock, Eye, Hand, Hourglass, LightningIcon, ShieldCheck } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { until, whenLabel } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import type { api } from "../../../../../convex/_generated/api";

export type Overview = FunctionReturnType<typeof api.retentionAgent.overview>;
export type CaseCard = Overview["needsOwner"][number];
export type Status = CaseCard["status"];
export type Detail = FunctionReturnType<typeof api.retentionAgent.caseDetail>;
export type Signal = FunctionReturnType<typeof api.retentionAgent.signals>[number];
export type ActionRow = Detail["actions"][number];
export type Entry = Detail["timeline"][number];
export type Measure = FunctionReturnType<typeof api.retentionAgent.outcomes>["measures"][number];

export const RETENTION_PATH = "/app/agents/retention";
export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const STATUS_LOOK: Record<Status, { icon: typeof Hand; tone: string; dot: string }> = {
  needs_attention: { icon: Hand, tone: "border-warning/40 bg-warning/10 text-warning-foreground", dot: "bg-warning" },
  needs_context: { icon: CircleDashed, tone: "border-border bg-muted text-strong", dot: "bg-muted-foreground" },
  action_underway: { icon: LightningIcon, tone: "border-brand-500/30 bg-brand-500/10 text-brand-300", dot: "bg-brand-500" },
  waiting_on_customer: { icon: Hourglass, tone: "border-border bg-background text-muted-foreground", dot: "bg-info" },
  monitoring: { icon: Eye, tone: "border-border bg-background text-muted-foreground", dot: "bg-info" },
  closed: { icon: CheckCircle2, tone: "border-border bg-background text-muted-foreground", dot: "bg-muted-foreground/50" },
};

/** A status as words with a mark. The words carry the meaning; the mark and tint only help the eye find it. */
export function StatusPill({ status, words, className }: { status: Status; words: string; className?: string }) {
  const look = STATUS_LOOK[status];
  const Icon = look.icon;
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap", look.tone, className)}>
      <Icon className="size-3.5" aria-hidden />
      {words}
    </span>
  );
}

const BASIS: Record<"fact" | "customer_stated" | "hypothesis", { label: string; tone: string }> = {
  fact: { label: "Fact", tone: "border-success/30 bg-success/10 text-success-foreground" },
  customer_stated: { label: "Customer said", tone: "border-brand-500/30 bg-brand-500/10 text-brand-300" },
  hypothesis: { label: "Hypothesis", tone: "border-dashed border-border bg-background text-muted-foreground" },
};

/** What a statement rests on. A hypothesis is drawn differently on purpose: it is never read as a fact. */
export function BasisTag({ basis }: { basis: "fact" | "customer_stated" | "hypothesis" }) {
  const look = BASIS[basis];
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-[11px] font-medium", look.tone)}>{look.label}</span>;
}

export function Flag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warn" | "danger" }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium", tone === "danger" ? "border-destructive/30 bg-destructive/10 text-destructive-foreground" : tone === "warn" ? "border-warning/40 bg-warning/10 text-warning-foreground" : "border-border bg-muted text-muted-foreground")}>
      {children}
    </span>
  );
}

/** Opens one case in the panel over whatever Retention page the person is on, and keeps it in the address. */
export function useCaseParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get("case");
  const set = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set("case", id);
      else next.delete("case");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return { openId, open: (id: string) => set(id), close: () => set(null) };
}

function Line({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <span className="grid gap-0.5 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase sm:pt-0.5">{label}</span>
      <span className={cn("text-sm leading-snug", strong ? "font-medium text-strong" : "text-foreground")}>{children}</span>
    </span>
  );
}

/**
 * One case, answering at a glance: what happened, what Selestial is doing, and what needs you. The
 * deadline is words; a late one says so.
 */
export function CaseCardView({ card, now, timezone, onOpen, checkInAt }: { card: CaseCard; now: number; timezone: string; onOpen: (id: string) => void; checkInAt?: number | null }) {
  const due = until(card.dueAt, now);
  const urgent = card.status === "needs_attention" || card.serious;
  return (
    <button
      type="button"
      onClick={() => onOpen(card.caseId)}
      className={cn(
        "group relative grid w-full gap-3 overflow-hidden rounded-2xl border bg-card p-4 text-left transition-colors hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500 sm:p-5",
        urgent ? "border-warning/40" : "border-border",
      )}
    >
      {urgent ? <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-warning" /> : null}
      <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-strong">{card.customer}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {card.kindWords} · {card.segmentWords}
            {card.property ? ` · ${card.property}` : ""}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {card.serious ? (
            <Flag tone="danger">
              <ShieldCheck className="size-3" aria-hidden />
              Handled by a person
            </Flag>
          ) : null}
          {card.held ? (
            <Flag>
              <Hand className="size-3" aria-hidden />A person has this
            </Flag>
          ) : null}
          <StatusPill status={card.status} words={card.statusWords} />
        </span>
      </span>
      <span className="grid gap-2">
        <Line label="What happened">{card.happened}</Line>
        <Line label="Selestial is">{card.doing}</Line>
        {card.needs ? (
          <Line label="Needs you" strong>
            {card.needs}
          </Line>
        ) : card.outcome ? (
          <Line label="Outcome" strong>
            {card.outcome.words}
          </Line>
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
        {card.nextAction ? <span className="font-medium text-strong">Next action: {card.nextAction}</span> : null}
        {card.waitingOn ? <span>Waiting on: {card.waitingOn}</span> : null}
        {checkInAt ? (
          <span className="inline-flex items-center gap-1 font-medium text-warning-foreground">
            <Clock className="size-3.5" aria-hidden />
            Guest arrives {whenLabel(checkInAt, now, timezone)}
          </span>
        ) : null}
        {card.status !== "closed" ? (
          <span className={cn("ml-auto inline-flex items-center gap-1", card.overdue ? "font-semibold text-destructive-foreground" : "")}>
            {card.overdue ? <AlertTriangle className="size-3.5" aria-hidden /> : null}
            {card.overdue ? `Overdue: ${due.text}` : `Due ${due.text}`}
          </span>
        ) : card.closedAt ? (
          <span className="ml-auto">Closed {whenLabel(card.closedAt, now, timezone)}</span>
        ) : null}
      </span>
    </button>
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

const STATE_WORDS: Record<Overview["state"], string> = { paused: "Paused", working: "Working", needs_you: "Waiting on you", waiting: "Waiting on customers", clear: "No open cases" };

/** Retention's header: its state in words, what it can and cannot do right now, and the one thing to look at next. */
export function RetentionStatusHeader({ overview, briefing, next, action }: { overview: Overview; briefing: string[]; next: string; action?: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(120%_140%_at_0%_0%,color-mix(in_oklab,var(--color-brand-500)_12%,transparent),transparent_70%)]" />
      <div className="relative flex items-start gap-3 p-4 sm:gap-4 sm:p-5">
        <AgentAvatar agent="retention" size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={overview.paused || overview.state === "needs_you" ? "warning" : overview.state === "clear" ? "outline" : "success"} size="sm">
              {STATE_WORDS[overview.state]}
            </Badge>
            {overview.readiness.map((row) => (
              <Badge key={row.key} variant="outline" size="sm" title={row.detail}>
                <span aria-hidden className={cn("size-1.5 rounded-full", row.ok ? "bg-success" : "bg-muted-foreground/50")} />
                {row.label}
                <span className="sr-only">: {row.detail}</span>
              </Badge>
            ))}
          </div>
          <p className={cn(eyebrow, "mt-3")}>Earn the next service by protecting the promise of the last one</p>
          <div className="mt-1.5 grid gap-1">
            {briefing.map((line) => (
              <p key={line} className="text-sm leading-relaxed text-foreground">
                {line}
              </p>
            ))}
          </div>
        </div>
      </div>
      <div className="relative flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/60 px-4 py-3 sm:px-5">
        <p className="min-w-0 text-sm text-strong">
          <span className="font-semibold">Next: </span>
          {next}
        </p>
        {action}
      </div>
    </section>
  );
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: string; hint?: string; href?: string; tone?: "warn" }) {
  const body = (
    <>
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className={cn("font-heading text-2xl leading-none tracking-tight tabular-nums", tone === "warn" ? "text-warning-foreground" : "text-strong")}>{value}</span>
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

/** What Selestial does not hold, said plainly where a number would otherwise be expected. */
export function NotConnected({ items }: { items: { key: string; title: string; words: string }[] }) {
  if (!items.length) return null;
  return (
    <ul className="grid gap-2">
      {items.map((item) => (
        <li key={item.key} className="rounded-xl border border-dashed border-border bg-background px-3.5 py-3">
          <p className="text-sm font-medium text-strong">
            {item.title} <span className="font-normal text-muted-foreground">· not connected</span>
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.words}</p>
        </li>
      ))}
    </ul>
  );
}
