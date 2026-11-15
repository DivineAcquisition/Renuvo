"use client";

import { AgentAvatar } from "@/components/app/agent";
import { HoldButton } from "@/components/app/hold-button";
import { RunTrace } from "@/components/app/run-trace";
import { BorderBeam } from "@/components/ui/border-beam";
import { Clock, LightningIcon, ShieldCheck } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { until, whenLabel } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import type { Decision, RecordRef } from "../../../../convex/overview";

/** The agent's reason, one sentence to a line, so it reads as the steps it took. */
function steps(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * One decision brought to a person: the problem, the proposed response, what approving authorizes, and
 * what waiting costs. Approving takes a held press.
 */
export function DecisionCard({
  decision,
  now,
  timezone,
  busy,
  error,
  onApprove,
  onOpen,
}: {
  decision: Decision;
  now: number;
  timezone: string;
  busy?: boolean;
  error?: string | null;
  onApprove: (decision: Decision) => void;
  onOpen: (ref: RecordRef) => void;
}) {
  const due = until(decision.deadline, now);
  const proposal = decision.ref.kind === "approval";
  return (
    <article className={cn("live-enter relative overflow-hidden rounded-2xl border bg-card p-4 sm:p-5", due.late ? "border-destructive/50" : due.soon ? "border-warning/60" : "border-border")}>
      {/* The agent is waiting on a person: the edge keeps moving until someone decides. */}
      {due.soon ? <BorderBeam size={90} duration={7} colorFrom="#f0b45c" colorTo="#6838ef" borderWidth={2} /> : null}
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2.5 text-xs text-muted-foreground">
          <AgentAvatar agent={decision.agent} state="needs_you" size="sm" />
          <span>
            <span className="block text-sm font-semibold text-strong">
              {decision.agentName} {proposal ? "proposes" : "handed this to you"}
            </span>
            <span className="block">{decision.department} · waiting on you</span>
          </span>
        </span>
        <Badge variant={due.late ? "error" : due.soon ? "warning" : "outline"} size="sm">
          <Clock aria-hidden />
          {due.late ? due.text : `Decide ${whenLabel(decision.deadline, now, timezone)}`}
        </Badge>
      </header>

      <h3 className="mt-3 text-base font-semibold leading-snug text-strong">{decision.title}</h3>

      {decision.context.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {decision.context.map((fact) => {
            const ref = fact.ref;
            const chip = (
              <>
                <span className="text-muted-foreground">{fact.label}</span> <span className="font-medium text-strong">{fact.value}</span>
              </>
            );
            return (
              <li key={`${fact.label}:${fact.value}`}>
                {ref ? (
                  <button type="button" onClick={() => onOpen(ref)} className="rounded-md border border-border bg-background px-2 py-1 text-xs hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
                    {chip}
                  </button>
                ) : (
                  <span className="inline-block rounded-md border border-border bg-background px-2 py-1 text-xs">{chip}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="mt-3">
        <p className="text-xs font-semibold text-muted-foreground">{proposal ? `${decision.agentName}’s reasoning` : "Why this is with you"}</p>
        <ol className="mt-1.5 grid gap-1.5 border-l-2 border-brand-500/30 pl-3">
          {steps(decision.situation).map((step) => (
            <li key={step} className="text-sm leading-relaxed text-foreground">
              {step}
            </li>
          ))}
        </ol>
      </div>

      {decision.run.length > 0 ? (
        <div className="mt-4 rounded-xl border border-border bg-muted/60 px-3 py-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">What {decision.agentName} did, and where it stopped</p>
          <RunTrace steps={decision.run} compact />
        </div>
      ) : null}

      {proposal ? (
        <dl className="mt-3 grid gap-2 text-sm">
          <div className="rounded-xl border border-brand-500/30 bg-brand-500/5 px-3 py-2.5">
            <dt className="flex items-center gap-1.5 text-xs font-semibold text-brand-200">
              <ShieldCheck className="size-3.5" aria-hidden />
              Approving authorizes
            </dt>
            <dd className="mt-1 leading-relaxed text-strong">{decision.authorizes ?? `${decision.agentName} to carry out the proposal above. Nothing else.`}</dd>
          </div>
          <div className="px-3">
            <dt className="inline text-xs font-semibold text-muted-foreground">If you wait: </dt>
            <dd className="inline text-xs leading-relaxed text-muted-foreground">{decision.ifWaiting ?? "the proposal expires at the deadline. It is never treated as approved."}</dd>
          </div>
        </dl>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}

      <footer className="mt-4 flex flex-wrap items-center gap-2">
        {proposal ? (
          <>
            <HoldButton label="Hold to approve" holdingLabel="Keep holding" busy={busy} onConfirm={() => onApprove(decision)} />
            <Button variant="outline" size="sm" onClick={() => onOpen(decision.ref)}>
              View alternatives
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onOpen(decision.ref)}>
              Handle myself
            </Button>
          </>
        ) : (
          <Button variant="primary" size="sm" onClick={() => onOpen(decision.ref)}>
            <LightningIcon aria-hidden />
            Decide
          </Button>
        )}
      </footer>
    </article>
  );
}

export function NoDecisions() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center">
      <p className="text-sm font-medium text-strong">Nothing is waiting on your decision.</p>
      <p className="mt-1 text-xs text-muted-foreground">When an agent needs your judgment, it appears here with its reason and a deadline.</p>
    </div>
  );
}
