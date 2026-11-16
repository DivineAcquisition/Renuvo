"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { motion } from "motion/react";
import Link from "next/link";
import { Component, useEffect, useMemo, useRef, useState } from "react";

import { useChat } from "@/components/app/chat/chat-context";
import { Composer, type Outgoing } from "@/components/app/chat/composer";
import { Markdown } from "@/components/app/chat/markdown";
import { useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { messageOf } from "@/components/app/form";
import { LogoMark } from "@/components/brand/logo";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleSlash,
  Copy,
  FileText,
  Hand,
  Hourglass,
  Info,
  Lock,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  X,
  type LucideIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { newClientKey, money, SPECIALIST_NAMES, STARTERS, STEP_WORDS, toolWords, type StepStatus } from "@/lib/app/chat/session";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type Thread = FunctionReturnType<typeof api.chat.thread>;
type Message = Thread["messages"][number];
type Part = Message["parts"][number];
type Step = { stepId: string; tool: string; agent: string | null; status: StepStatus; summary: string | null; preview: { summary: string; lines: string[] } | null; link: { href: string; label: string } | null; record: { kind: "job" | "approval" | "task"; id: string } | null; result: string | null; mine: boolean };
type Artifact = { artifactId: string; title: string; kind: string; state: string; currentVersion: number };

// ── Small pieces ─────────────────────────────────────────────────────────────────────────────────

function Avatar({ live }: { live?: boolean }) {
  return (
    <span className="relative mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-brand-500/30 bg-card shadow-[0_6px_18px_-10px_rgba(104,56,239,0.7)]" aria-hidden>
      <LogoMark className="size-5" />
      {live ? <span className="live-pulse absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-brand-400" /> : null}
    </span>
  );
}

export function Thinking() {
  return (
    <span className="inline-flex h-9 w-16 items-center justify-center gap-1 rounded-2xl rounded-tl-md bg-muted" role="status" aria-label="Thinking">
      {[0, 1, 2].map((index) => (
        <motion.span key={index} className="size-1.5 rounded-full bg-muted-foreground" animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }} transition={{ duration: 1, repeat: Infinity, delay: index * 0.15 }} />
      ))}
    </span>
  );
}

const STEP_LOOK: Record<StepStatus, { icon: LucideIcon | null; ring: string }> = {
  running: { icon: null, ring: "border-brand-500/40 bg-brand-500/10 text-brand-300" },
  done: { icon: Check, ring: "border-success/50 bg-success/10 text-success" },
  proposed: { icon: Hourglass, ring: "border-info/50 bg-info/10 text-info" },
  awaiting_approval: { icon: Hand, ring: "border-warning/60 bg-warning/15 text-warning" },
  refused: { icon: CircleSlash, ring: "border-destructive/40 bg-destructive/10 text-destructive" },
  unavailable: { icon: Lock, ring: "border-border bg-muted text-muted-foreground" },
  rejected: { icon: X, ring: "border-border bg-muted text-muted-foreground" },
  expired: { icon: TriangleAlert, ring: "border-warning/50 bg-warning/10 text-warning" },
  failed: { icon: TriangleAlert, ring: "border-destructive/40 bg-destructive/10 text-destructive" },
  cancelled: { icon: X, ring: "border-border bg-muted text-muted-foreground" },
};

function StepMark({ status }: { status: StepStatus }) {
  const look = STEP_LOOK[status];
  const Icon = look.icon;
  return (
    <span className={cn("relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border", look.ring)} aria-hidden>
      {Icon ? <Icon className="size-3.5" /> : <Spinner className="size-3.5" />}
      {status === "running" || status === "awaiting_approval" ? <span className={cn("live-pulse absolute -inset-1 -z-10 rounded-full", status === "running" ? "bg-brand-500/20" : "bg-warning/25")} /> : null}
    </span>
  );
}

/** The calculator's result, as a table with the formulas behind it. */
function PricingResult({ raw }: { raw: string }) {
  const parsed = useMemo(() => {
    try {
      return JSON.parse(raw) as { scenarios?: { name: string; laborHours: number; elapsedHours: number | null; totalCostCents: number; priceAtMarginCents: number | null; priceAtMarkupCents: number | null; checks: { basis: string; marginPercent: number; markupPercent: number }[]; formulas: string[]; assumptions: string[]; monthly: { visits: number; priceAtMarginCents: number | null } | null }[]; value?: number; expression?: string };
    } catch {
      return null;
    }
  }, [raw]);
  if (!parsed) return null;
  if (parsed.expression !== undefined) return <p className="mt-1 font-mono text-xs text-muted-foreground">{`${parsed.expression} = ${parsed.value}`}</p>;
  if (!parsed.scenarios?.length) return null;
  return (
    <div className="mt-2 grid gap-2">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-xs tabular-nums">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>
              <th scope="col" className="px-2.5 py-1.5 font-medium">Scenario</th>
              <th scope="col" className="px-2.5 py-1.5 font-medium">Labor-hours</th>
              <th scope="col" className="px-2.5 py-1.5 font-medium">On the clock</th>
              <th scope="col" className="px-2.5 py-1.5 font-medium">Cost</th>
              <th scope="col" className="px-2.5 py-1.5 font-medium">Price</th>
              <th scope="col" className="px-2.5 py-1.5 font-medium">Margin / markup</th>
            </tr>
          </thead>
          <tbody>
            {parsed.scenarios.map((row) => {
              const price = row.priceAtMarginCents ?? row.priceAtMarkupCents;
              const check = row.checks[0];
              return (
                <tr key={row.name} className="border-t border-border">
                  <td className="px-2.5 py-1.5 font-medium text-strong">{row.name}</td>
                  <td className="px-2.5 py-1.5">{row.laborHours}</td>
                  <td className="px-2.5 py-1.5">{row.elapsedHours === null ? "—" : `${Math.round(row.elapsedHours * 100) / 100} h`}</td>
                  <td className="px-2.5 py-1.5">{money(row.totalCostCents)}</td>
                  <td className="px-2.5 py-1.5 font-semibold text-strong">
                    {price === null ? "—" : money(price)}
                    {row.monthly?.priceAtMarginCents ? <span className="block text-[11px] font-normal text-muted-foreground">{money(row.monthly.priceAtMarginCents)} / month</span> : null}
                  </td>
                  <td className="px-2.5 py-1.5">{check ? `${check.marginPercent}% / ${check.markupPercent}%` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details className="group text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium text-brand-300 hover:text-brand-200">Show the formulas and assumptions</summary>
        <ul className="mt-1.5 grid gap-0.5 font-mono text-[11px] leading-relaxed">
          {parsed.scenarios.flatMap((row) => [...row.formulas, ...row.assumptions.map((line) => `Assumed: ${line}`)].map((line, index) => <li key={`${row.name}-${index}`}>{line}</li>))}
        </ul>
      </details>
    </div>
  );
}

/** A step the person must approve: the exact effect, and two buttons. The approval is bound to what is shown. */
function ApprovalCard({ step }: { step: Step }) {
  const { companyId } = useCompany();
  const decide = useMutation(api.chat.decideStep);
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const answer = async (approve: boolean) => {
    setBusy(approve ? "approve" : "decline");
    setError(null);
    try {
      await decide({ companyId, stepId: step.stepId, approve });
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mt-2 rounded-xl border border-brand-500/30 bg-gradient-to-br from-brand-500/[0.08] to-transparent p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-warning-foreground uppercase">
        <Hand className="size-3.5" aria-hidden /> Needs your approval
      </p>
      <p className="mt-1.5 text-sm font-semibold text-strong">{step.preview?.summary}</p>
      {step.preview?.lines.length ? (
        <ul className="mt-1.5 grid gap-1 text-[13px] leading-relaxed text-muted-foreground">
          {step.preview.lines.map((line) => (
            <li key={line} className="flex gap-2">
              <ArrowRight className="mt-1 size-3 shrink-0 text-brand-300" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive-foreground">
          {error}
        </p>
      ) : null}
      {step.mine ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="gradient" size="sm" loading={busy === "approve"} disabled={busy !== null} onClick={() => void answer(true)}>
            Approve
          </Button>
          <Button variant="ghost" size="sm" loading={busy === "decline"} disabled={busy !== null} onClick={() => void answer(false)}>
            Decline
          </Button>
          <span className="text-[11px] text-muted-foreground">Checked again when you approve. If anything changed, nothing is done.</span>
        </div>
      ) : null}
    </div>
  );
}

/** The work the assistant did for one reply, step by step, from the record. */
function WorkLog({ steps }: { steps: Step[] }) {
  const open = useDetail();
  const working = steps.some((step) => step.status === "running");
  const specialists = [...new Set(steps.map((step) => step.agent).filter((agent): agent is string => Boolean(agent)))];
  return (
    <section aria-label="Work done for this answer" className="rounded-xl border border-border bg-card/70">
      <header className="flex items-center gap-2 border-b border-border px-3.5 py-2 text-xs">
        <Sparkles className="size-3.5 text-brand-300" aria-hidden />
        <span className={cn("font-medium text-strong", working && "live-shimmer-text")}>{working ? "Working" : `${steps.length} step${steps.length === 1 ? "" : "s"}`}</span>
        {specialists.length ? <span className="text-muted-foreground">· with {specialists.map((agent) => SPECIALIST_NAMES[agent] ?? agent).join(", ")}</span> : null}
      </header>
      <ol className="grid px-3.5 py-2.5">
        {steps.map((step, index) => (
          <li key={step.stepId} className="relative flex gap-3 pb-3 last:pb-0">
            {index < steps.length - 1 ? <span className={cn("absolute top-6 left-[11px] h-[calc(100%-1.5rem)] w-0.5", step.status === "done" ? "bg-success/40" : "bg-border")} aria-hidden /> : null}
            <StepMark status={step.status} />
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <span className={cn("font-medium text-strong", step.status === "running" && "live-shimmer-text")}>{toolWords(step.tool, step.status)}</span>
                {step.agent ? <span className="rounded-full border border-brand-500/30 bg-brand-500/10 px-1.5 py-px text-[10px] font-semibold text-brand-300">{SPECIALIST_NAMES[step.agent] ?? step.agent}</span> : null}
                <span className="text-xs text-muted-foreground">{STEP_WORDS[step.status]}</span>
              </p>
              {step.summary && step.status !== "awaiting_approval" ? <p className={cn("mt-0.5 text-[13px] leading-relaxed", step.status === "refused" || step.status === "unavailable" || step.status === "expired" ? "text-strong" : "text-muted-foreground")}>{step.summary}</p> : null}
              {step.result && (step.tool === "price_service" || step.tool === "calculate") ? <PricingResult raw={step.result} /> : null}
              {step.status === "awaiting_approval" ? <ApprovalCard step={step} /> : null}
              {step.record || step.link ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {step.record ? (
                    <button type="button" onClick={() => open({ kind: step.record!.kind, id: step.record!.id } as Parameters<typeof open>[0])} className="group inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-strong hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
                      Open the {step.record.kind === "job" ? "visit" : step.record.kind}
                      <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </button>
                  ) : null}
                  {step.link ? (
                    <Link href={step.link.href} className="group inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-strong hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
                      {step.link.label}
                      <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const ARTIFACT_STATE: Record<string, string> = { draft: "Draft", terms_approved: "Terms approved", sent: "Sent", signed: "Signed" };

function ArtifactCard({ artifact, version }: { artifact: Artifact | undefined; version: number }) {
  const { openArtifact } = useChat();
  if (!artifact) return null;
  return (
    <button type="button" onClick={() => openArtifact(artifact.artifactId)} className="group flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-left hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/10 text-brand-300" aria-hidden>
        <FileText className="size-4.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-strong">{artifact.title}</span>
        <span className="block text-xs text-muted-foreground">
          {ARTIFACT_STATE[artifact.state] ?? artifact.state} · version {version}
          {artifact.currentVersion > version ? ` (now at ${artifact.currentVersion})` : ""}
        </span>
      </span>
      <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-300">
        Open <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </button>
  );
}

function NoticeLine({ tone, text }: { tone: "info" | "warning" | "error"; text: string }) {
  const Icon = tone === "error" ? TriangleAlert : tone === "warning" ? CircleSlash : Info;
  return (
    <p role={tone === "error" ? "alert" : undefined} className={cn("flex items-start gap-2 rounded-xl border px-3 py-2 text-[13px] leading-relaxed", tone === "error" ? "border-destructive/30 bg-destructive/5 text-destructive-foreground" : tone === "warning" ? "border-warning/40 bg-warning/10 text-warning-foreground" : "border-border bg-muted/60 text-muted-foreground")}>
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {text}
    </p>
  );
}

// ── Turns ────────────────────────────────────────────────────────────────────────────────────────

function UserTurn({ message }: { message: Message }) {
  return (
    <motion.li initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-end gap-1.5">
      {message.contextRefs.length || message.attachments.length ? (
        <div className="flex max-w-[min(34rem,85%)] flex-wrap justify-end gap-1.5">
          {message.contextRefs.map((ref) => (
            <span key={`${ref.table}:${ref.id}`} className="rounded-lg border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
              {ref.label}
            </span>
          ))}
          {message.attachments.map((file) => (
            <span key={file.name} className={cn("rounded-lg border px-2 py-0.5 text-[11px]", file.state === "unreadable" ? "border-destructive/40 text-destructive-foreground" : "border-border text-muted-foreground")} title={file.note ?? undefined}>
              {file.name}
              {file.state === "unreadable" ? ` · could not be read${file.note ? `: ${file.note}` : ""}` : file.state === "pending" ? " · reading" : ""}
            </span>
          ))}
        </div>
      ) : null}
      <p className="max-w-[min(34rem,85%)] rounded-2xl rounded-tr-md bg-brand-500/10 px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap text-strong ring-1 ring-brand-500/20">{message.text}</p>
    </motion.li>
  );
}

function verbFor(message: Message, steps: Step[]): string {
  if (message.status === "streaming") return steps.some((step) => step.status === "running") ? "is working on it" : message.parts.length ? "is writing" : "is thinking";
  if (message.status === "failed") return "could not finish";
  if (message.status === "stopped") return "stopped";
  if (steps.some((step) => step.status === "awaiting_approval")) return "needs your approval";
  if (message.parts.some((part) => part.kind === "choices")) return "has a question";
  return steps.length ? "worked on this" : "answered";
}

function AgentTurn({ message, thread, last, onChoice, onRetry }: { message: Message; thread: Thread; last: boolean; onChoice: (text: string) => void; onRetry: () => void }) {
  const [copied, setCopied] = useState(false);
  const stepOf = (id: string) => thread.steps[id] as Step | undefined;
  const allSteps = message.parts.flatMap((part) => (part.kind === "step" ? [stepOf(part.stepId)].filter((step): step is Step => Boolean(step)) : []));
  const streaming = message.status === "streaming";
  const text = message.parts.map((part) => (part.kind === "text" ? part.text : "")).join("\n\n").trim();

  // Consecutive steps are one work log; text, drafts, questions and notices sit between them in order.
  const groups: ({ kind: "steps"; steps: Step[] } | { kind: "part"; part: Part; index: number })[] = [];
  message.parts.forEach((part, index) => {
    if (part.kind === "step") {
      const step = stepOf(part.stepId);
      if (!step) return;
      const lastGroup = groups.at(-1);
      if (lastGroup?.kind === "steps") lastGroup.steps.push(step);
      else groups.push({ kind: "steps", steps: [step] });
    } else groups.push({ kind: "part", part, index });
  });
  const lastText = [...message.parts.keys()].filter((index) => message.parts[index].kind === "text").at(-1);

  return (
    <motion.li initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
      <Avatar live={streaming} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
          <span className="font-semibold text-strong">Selestial</span>
          <span className={cn("text-muted-foreground", streaming && "live-shimmer-text")}>{verbFor(message, allSteps)}</span>
        </p>
        <div className="mt-2 grid gap-3">
          {groups.length === 0 && streaming ? <Thinking /> : null}
          {groups.map((group, index) => {
            if (group.kind === "steps") return <WorkLog key={`steps-${index}`} steps={group.steps} />;
            const { part } = group;
            if (part.kind === "text") return part.text.trim() ? <Markdown key={group.index} source={part.text} streaming={streaming && group.index === lastText} /> : null;
            if (part.kind === "artifact") return <ArtifactCard key={group.index} artifact={thread.artifacts[part.artifactId] as Artifact | undefined} version={part.version} />;
            if (part.kind === "notice") return <NoticeLine key={group.index} tone={part.tone} text={part.text} />;
            if (part.kind === "choices")
              return (
                <div key={group.index} className="grid gap-2">
                  <p className="text-sm font-medium text-strong">{part.question}</p>
                  {last && thread.conversation.state === "needs_input" ? (
                    <div className="flex flex-wrap gap-2">
                      {part.options.map((option) => (
                        <button key={option} type="button" onClick={() => onChoice(option)} className="rounded-full border border-brand-500/30 bg-card px-3 py-1.5 text-sm text-brand-300 hover:bg-brand-500/10 focus-visible:outline-2 focus-visible:outline-brand-500">
                          {option}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Choices: {part.options.join(" · ")}</p>
                  )}
                </div>
              );
            return null;
          })}
        </div>
        {!streaming && (text || (last && thread.run?.canRetry)) ? (
          <div className="mt-2 flex items-center gap-1">
            {text ? (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(text).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  });
                }}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                {copied ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </button>
            ) : null}
            {last && thread.run?.canRetry ? (
              <button type="button" onClick={onRetry} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500">
                <RotateCcw className="size-3.5" aria-hidden /> Retry
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </motion.li>
  );
}

// ── The thread ───────────────────────────────────────────────────────────────────────────────────

export function EmptyChat({ compact, onPick }: { compact?: boolean; onPick: (text: string) => void }) {
  return (
    <div className={cn("flex flex-col", compact ? "gap-4 py-4" : "gap-6 py-6 sm:py-10")}>
      <div className="flex items-center gap-3">
        <span className="relative inline-flex size-11 items-center justify-center rounded-full border border-brand-500/30 bg-card shadow-[0_12px_32px_-14px_rgba(104,56,239,0.8)]" aria-hidden>
          <LogoMark className="size-7" />
        </span>
        <div>
          <h2 className={cn("font-heading tracking-tight text-strong", compact ? "text-lg" : "text-2xl sm:text-3xl")}>What would you like to work on?</h2>
          <p className="text-sm text-muted-foreground">Ask about your business, build something useful, or get work done.</p>
        </div>
      </div>
      <ul className={cn("grid gap-2", compact ? "" : "sm:grid-cols-2")}>
        {STARTERS.map((starter) => (
          <li key={starter}>
            <button type="button" onClick={() => onPick(starter)} className="group flex w-full items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3 text-left text-sm text-strong hover:border-brand-500/50 hover:bg-brand-500/[0.04] focus-visible:outline-2 focus-visible:outline-brand-500">
              <Sparkles className="size-4 shrink-0 text-brand-300" aria-hidden />
              <span className="flex-1">{starter}</span>
              <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

class Unavailable extends Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ConversationBody({ conversationId, compact, onChoice }: { conversationId: string; compact?: boolean; onChoice: (text: string) => void }) {
  const { companyId } = useCompany();
  const thread = useQuery(api.chat.thread, { companyId, conversationId });
  const retry = useMutation(api.chat.retry);
  const end = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const lastSignature = thread ? `${thread.messages.length}:${JSON.stringify(thread.messages.at(-1)?.parts ?? []).length}` : "";
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [lastSignature]);
  if (thread === undefined) {
    return (
      <div className="grid gap-4 py-6" aria-busy="true" aria-label="Loading the conversation">
        <Thinking />
      </div>
    );
  }
  const live = thread.run?.status === "running" || thread.run?.status === "queued";
  const lastAssistant = thread.messages.map((message, index) => (message.role === "assistant" ? index : -1)).filter((index) => index >= 0).at(-1);
  return (
    <>
      <ol className={cn("grid", compact ? "gap-5 py-3" : "gap-7 py-6")}>
        {thread.messages.map((message, index) =>
          message.role === "user" ? (
            <UserTurn key={message.messageId} message={message} />
          ) : (
            <AgentTurn
              key={message.messageId}
              message={message}
              thread={thread}
              last={index === lastAssistant}
              onChoice={onChoice}
              onRetry={() => {
                setError(null);
                retry({ companyId, conversationId }).catch((caught: unknown) => setError(messageOf(caught)));
              }}
            />
          ),
        )}
      </ol>
      {error ? <NoticeLine tone="error" text={error} /> : null}
      <p className="sr-only" aria-live="polite">
        {live ? "Selestial is working on a response." : thread.conversation.state === "awaiting_approval" ? "A step needs your approval." : thread.run?.status === "failed" ? "The response failed." : thread.run?.status === "completed" ? "The response is complete." : ""}
      </p>
      <div ref={end} />
    </>
  );
}

/**
 * One conversation and its composer, used by the full page and the side panel alike. With no
 * conversation yet, it shows the empty state; the first send creates the chat.
 */
export function ChatThread({ conversationId, compact, onStarted, autoFocus }: { conversationId: string | null; compact?: boolean; onStarted: (conversationId: string) => void; autoFocus?: boolean }) {
  const { companyId } = useCompany();
  const { page } = useChat();
  const send = useMutation(api.chat.send);
  const stop = useMutation(api.chat.stop);
  const thread = useQuery(api.chat.thread, conversationId ? { companyId, conversationId } : "skip");
  const [draft, setDraft] = useState("");
  const live = thread?.run?.status === "running" || thread?.run?.status === "queued";

  const submit = async (outgoing: Outgoing) => {
    const result = await send({
      companyId,
      conversationId: conversationId ?? undefined,
      text: outgoing.text,
      clientKey: outgoing.clientKey,
      page: outgoing.includePage && page ? page.path : undefined,
      context: outgoing.records.map((record) => ({ table: record.table, id: record.id })),
      attachments: outgoing.files.map((file) => ({ storageId: file.storageId as Id<"_storage">, name: file.name })),
    });
    if (!conversationId || result.conversationId !== conversationId) onStarted(result.conversationId);
  };
  const choose = (text: string) => {
    void submit({ text, clientKey: newClientKey(), includePage: false, records: [], files: [] }).catch(() => undefined);
  };

  return (
    // Not allowed to shrink below its content, so the composer sticks to the bottom of whatever scrolls.
    <div className="flex flex-1 flex-col">
      <div className={cn("flex-1", compact ? "px-4" : "")}>
        {conversationId ? (
          <Unavailable key={conversationId} fallback={<NoticeLine tone="warning" text="This chat is not available. It may have been deleted, or it belongs to someone else or another company." />}>
            <ConversationBody conversationId={conversationId} compact={compact} onChoice={choose} />
          </Unavailable>
        ) : (
          <EmptyChat compact={compact} onPick={(starter) => setDraft(starter)} />
        )}
      </div>
      <div className={cn("sticky bottom-0 z-10 bg-gradient-to-t from-background via-background to-transparent pt-4", compact ? "px-3 pb-3" : "pb-2")}>
        <Composer
          key={conversationId ?? "new"}
          compact={compact}
          working={live}
          stopping={Boolean(thread?.run?.stopping)}
          seed={draft}
          autoFocus={autoFocus}
          placeholder={conversationId ? (thread?.conversation.state === "needs_input" ? "Answer, or tap a choice…" : "Reply, ask a follow-up, or ask for something new…") : "Ask anything about your business…"}
          onSend={submit}
          onStop={() => (conversationId ? stop({ companyId, conversationId }).then(() => undefined) : Promise.resolve())}
        />
      </div>
    </div>
  );
}
