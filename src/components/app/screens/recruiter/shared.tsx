"use client";

/**
 * Recruiter's visual vocabulary: the hiring pipeline as a flow of steps, who acts next, an applicant's
 * journey, and how Recruiter read an application (each fact with where it came from). Every number and
 * state comes from the records; nothing here reassures or guesses.
 */
import { useState } from "react";

import { Check, ChevronDown, CircleDashed, Clock, Hand, Loader2, Sparkles, TriangleAlert, X } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../../convex/_generated/api";

export type ApplicationRow = FunctionReturnType<typeof api.applications.list>[number];
export type Stage = ApplicationRow["stage"];
export type ApplicationDetail = NonNullable<FunctionReturnType<typeof api.applications.get>>;
export type Screening = NonNullable<ApplicationDetail["screening"]>;

export const STAGE_WORDS: Record<Stage, string> = {
  received: "Received",
  contact_needed: "Needs contact details",
  invitation_awaiting_approval: "Invitation awaiting approval",
  invited: "Invited",
  application_started: "Application started",
  application_submitted: "Application submitted",
  screening: "Screened",
  interview: "Interview",
  decision_pending: "Decision pending",
  offer_sent: "Offer sent",
  accepted: "Offer accepted",
  onboarding_handoff: "Onboarding",
  withdrawn: "Withdrawn",
  closed: "Closed",
};

/** The pipeline's steps, in order, and which stages each one holds. */
export const STEPS: { id: string; label: string; stages: Stage[] }[] = [
  { id: "inbox", label: "Inbox", stages: ["received", "contact_needed"] },
  { id: "invite", label: "Invite", stages: ["invitation_awaiting_approval", "invited"] },
  { id: "apply", label: "Applying", stages: ["application_started"] },
  { id: "screen", label: "Screening", stages: ["application_submitted", "screening"] },
  { id: "interview", label: "Interview", stages: ["interview"] },
  { id: "decide", label: "Decision", stages: ["decision_pending"] },
  { id: "offer", label: "Offer", stages: ["offer_sent", "accepted"] },
  { id: "onboard", label: "Onboarding", stages: ["onboarding_handoff"] },
];

export function stepOf(stage: Stage): number {
  return STEPS.findIndex((step) => step.stages.includes(stage));
}

const n = (value: number) => value.toLocaleString("en-US");

/**
 * The hiring pipeline as connected steps. A step with people in it is lit; a dot moves along the
 * connector into it while someone is there, so the eye sees where work is flowing. Each step opens the
 * applicants behind its count.
 */
export function PipelineFlow({ counts, attention, selected, onSelect }: { counts: number[]; attention?: number[]; selected?: number | null; onSelect?: (index: number) => void }) {
  return (
    <ol className="flex w-full items-stretch overflow-x-auto pb-1" aria-label="Hiring pipeline">
      {STEPS.map((step, index) => {
        const count = counts[index] ?? 0;
        const needs = attention?.[index] ?? 0;
        const on = selected === index;
        return (
          <li key={step.id} className="flex min-w-[6.5rem] flex-1 items-center">
            {index > 0 ? (
              <span aria-hidden className="relative mx-1 h-px flex-1 bg-border" style={{ ["--flow-length" as string]: "40px" }}>
                {count > 0 ? <span className="pipeline-flow-dot absolute -top-[3px] left-0 size-[7px] rounded-full bg-brand-500" style={{ animationDelay: `${index * 0.3}s` }} /> : null}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onSelect?.(index)}
              aria-pressed={on}
              aria-label={`${step.label}: ${count}${needs ? `, ${needs} need you` : ""}`}
              className={cn(
                "relative grid min-w-[5.5rem] place-items-center gap-0.5 rounded-2xl border px-3 py-2.5 text-center transition-colors focus-visible:outline-2 focus-visible:outline-brand-500",
                on ? "border-brand-500 bg-brand-500/10" : count > 0 ? "border-brand-500/40 bg-card hover:border-brand-500" : "border-dashed border-border bg-transparent",
              )}
            >
              {needs > 0 ? <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-warning text-[10px] font-semibold text-strong">{needs}</span> : null}
              <span className={cn("font-heading text-2xl leading-none tabular-nums", count > 0 ? "text-strong" : "text-muted-foreground")}>{n(count)}</span>
              <span className="text-[11px] font-medium text-muted-foreground">{step.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Who acts next on an application, as Recruiter's plan shows it. */
export function WhoActs({ row }: { row: Pick<ApplicationRow, "nextAction" | "withPerson" | "waitingOnReply" | "closure" | "stage"> }) {
  if (row.closure || row.stage === "closed" || row.stage === "withdrawn") return <Badge variant="outline" size="sm">Closed</Badge>;
  if (row.withPerson || row.nextAction?.by === "owner")
    return (
      <Badge variant="warning" size="sm">
        <Hand aria-hidden /> Needs you
      </Badge>
    );
  if (row.waitingOnReply || row.nextAction?.by === "applicant")
    return (
      <Badge variant="outline" size="sm">
        <Clock aria-hidden /> Waiting on applicant
      </Badge>
    );
  return (
    <Badge variant="info" size="sm">
      <Sparkles aria-hidden /> Recruiter is on it
    </Badge>
  );
}

/** An applicant's journey from invitation to onboarding: done, current and still ahead. */
export function JourneyTimeline({ stage, times }: { stage: Stage; times: { invitedAt: number | null; startedAt: number | null; submittedAt: number | null } }) {
  const current = stepOf(stage);
  const closed = stage === "closed" || stage === "withdrawn";
  const when: Partial<Record<string, number | null>> = { invite: times.invitedAt, apply: times.startedAt, screen: times.submittedAt };
  return (
    <ol className="grid grid-cols-4 gap-y-3 sm:grid-cols-8" aria-label="Journey">
      {STEPS.map((step, index) => {
        const done = !closed && index < current;
        const here = !closed && index === current;
        return (
          <li key={step.id} className="relative flex flex-col items-center gap-1 text-center">
            {index > 0 ? <span aria-hidden className={cn("absolute top-3 right-1/2 h-0.5 w-full -translate-x-3", done || here ? "bg-brand-500" : "bg-border")} /> : null}
            <span className={cn("relative z-10 grid size-6 place-items-center rounded-full border-2", done ? "border-brand-500 bg-brand-500 text-white" : here ? "border-brand-500 bg-card text-brand-300" : "border-border bg-card text-muted-foreground")}>
              {done ? <Check className="size-3.5" aria-hidden /> : here ? <span className="size-2 rounded-full bg-brand-500" /> : <span className="size-1.5 rounded-full bg-border" />}
            </span>
            <span className={cn("text-[11px] leading-tight", here ? "font-semibold text-strong" : "text-muted-foreground")}>{step.label}</span>
            {when[step.id] ? <span className="text-[10px] text-muted-foreground">{new Date(when[step.id]!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export type TraceStep = { id: string; title: string; status: "done" | "attention" | "pending" | "failed"; summary?: string; detail?: React.ReactNode };

/**
 * How Recruiter got here, step by step, like an agent's reasoning trace: each step says what it found and,
 * when opened, the evidence and where it came from.
 */
export function EvidenceTrace({ steps }: { steps: TraceStep[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ol className="relative grid gap-0" aria-label="How Recruiter read this application">
      {steps.map((step, index) => {
        const isOpen = open === step.id;
        const Icon = step.status === "done" ? Check : step.status === "attention" ? TriangleAlert : step.status === "failed" ? X : CircleDashed;
        return (
          <li key={step.id} className="relative pl-8">
            {index < steps.length - 1 ? <span aria-hidden className="absolute top-6 bottom-0 left-[11px] w-px bg-border" /> : null}
            <span className={cn("absolute top-1 left-0 grid size-6 place-items-center rounded-full border", step.status === "done" ? "border-success/40 bg-success/10 text-success-foreground" : step.status === "attention" ? "border-warning/50 bg-warning/10 text-warning-foreground" : step.status === "failed" ? "border-destructive/40 bg-destructive/10 text-destructive-foreground" : "border-border bg-card text-muted-foreground")}>
              <Icon className="size-3.5" aria-hidden />
            </span>
            <button type="button" disabled={!step.detail} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : step.id)} className="flex w-full items-start justify-between gap-2 py-1.5 text-left disabled:cursor-default">
              <span>
                <span className="block text-sm font-medium text-strong">{step.title}</span>
                {step.summary ? <span className="block text-xs leading-relaxed text-muted-foreground">{step.summary}</span> : null}
              </span>
              {step.detail ? <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden /> : null}
            </button>
            {isOpen && step.detail ? <div className="mb-3 rounded-xl border border-border bg-muted/40 p-3 text-sm">{step.detail}</div> : null}
          </li>
        );
      })}
    </ol>
  );
}

const OUTCOME: Record<Screening["results"][number]["outcome"], { label: string; variant: "success" | "error" | "warning" | "outline" }> = {
  meets: { label: "Meets", variant: "success" },
  does_not_meet: { label: "Does not meet", variant: "error" },
  needs_clarification: { label: "Needs clarification", variant: "warning" },
  not_applicable: { label: "Not applicable", variant: "outline" },
};

/** Each screening criterion with its outcome and the applicant's own words as evidence. There is no score. */
export function CriteriaList({ results }: { results: Screening["results"] }) {
  if (results.length === 0) return <p className="text-sm text-muted-foreground">This role has no screening criteria yet.</p>;
  return (
    <ul className="grid gap-2">
      {results.map((row) => (
        <li key={row.key} className="rounded-xl border border-border bg-background px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-strong">
              {row.label}
              {row.fixed ? <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">fixed requirement</span> : null}
            </span>
            <Badge variant={OUTCOME[row.outcome].variant} size="sm">
              {OUTCOME[row.outcome].label}
            </Badge>
          </div>
          {row.evidence ? <blockquote className="mt-1 border-l-2 border-brand-500/40 pl-2 text-xs text-muted-foreground">“{row.evidence}”</blockquote> : null}
          <p className="mt-0.5 text-[11px] text-muted-foreground">From {row.source}</p>
        </li>
      ))}
    </ul>
  );
}

export const RECOMMENDATION: Record<Screening["recommendation"], { label: string; tone: string }> = {
  advance: { label: "Recruiter suggests an interview", tone: "border-success/40 bg-success/5" },
  clarify: { label: "Recruiter suggests asking the applicant first", tone: "border-warning/50 bg-warning/5" },
  review_requirement: { label: "A fixed requirement is not met: a person decides", tone: "border-destructive/40 bg-destructive/5" },
};

/** A ring that fills as requirements are done. */
export function ProgressRing({ done, total, size = 44 }: { done: number; total: number; size?: number }) {
  const share = total > 0 ? done / total : 0;
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${done} of ${total} done`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-brand-500)" strokeWidth={4} strokeLinecap="round" strokeDasharray={`${c * share} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size / 4} className="fill-current font-semibold">
        {done}/{total}
      </text>
    </svg>
  );
}

/** A small "working" line: shimmering while Recruiter is busy, plain otherwise. */
export function AgentStatusLine({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm">
      {busy ? <Loader2 className="size-4 animate-spin text-brand-300" aria-hidden /> : <span aria-hidden className="size-2 rounded-full bg-success" />}
      <span className={cn(busy ? "agent-shimmer font-medium text-strong" : "text-muted-foreground")}>{children}</span>
    </p>
  );
}

export const CLOSURE_WORDS: Record<NonNullable<ApplicationRow["closure"]>["reason"], string> = {
  requirement_not_met: "A requirement is not met",
  not_selected: "Not selected",
  role_closed: "The role closed",
  duplicate: "Duplicate",
  no_contact_possible: "No way to contact",
  offer_declined: "Offer declined",
  no_response: "No response",
  hired: "Hired",
  other: "Other",
};

export const SOURCE_WORDS: Record<ApplicationRow["source"], string> = { indeed: "Indeed", ziprecruiter: "ZipRecruiter", direct: "Direct email", manual: "Added by hand", other: "Other" };
