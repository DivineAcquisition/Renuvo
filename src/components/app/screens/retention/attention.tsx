"use client";

/**
 * Needs Attention: what the company's records show, each as one explainable signal, and the cases that
 * are waiting on a person. A signal says what happened, where it came from and when, what it affects,
 * whether it is a fact, the customer's words or a hypothesis, what is not known, and a suggested step.
 */
import { useMutation } from "convex/react";
import { useState } from "react";

import { useCompany, canManage } from "@/components/app/company";
import { Field, FormError, TextInput, useRun } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { AlertTriangle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { whenLabel } from "@/lib/app/format";
import { useStableQuery } from "@/lib/app/stable-query";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { CaseDrawer } from "./drawer";
import { BasisTag, CaseCardView, Empty, Flag, useCaseParam, type Signal } from "./shared";

function SignalCard({ signal, now, timezone, onOpen }: { signal: Signal; now: number; timezone: string; onOpen: (id: string) => void }) {
  const { companyId, role } = useCompany();
  const toCase = useMutation(api.retentionAgent.caseFromSignal);
  const dismiss = useMutation(api.retentionAgent.dismissSignal);
  const { busy, error, run } = useRun();
  const [reason, setReason] = useState("");
  const [dismissing, setDismissing] = useState(false);
  const id = signal.signalId as Id<"retentionSignals">;
  return (
    <li className={cn("grid gap-3 rounded-2xl border bg-card p-4 sm:p-5", signal.priority === "high" && signal.status === "open" ? "border-warning/40" : "border-border")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-semibold text-strong">{signal.customer}</p>
          <p className="text-xs text-muted-foreground">
            {signal.kindWords} · {signal.segmentWords} · affects {signal.affects}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {signal.priority === "high" ? <Flag tone="warn">High priority</Flag> : null}
          {signal.seen > 1 ? <Flag>Seen {signal.seen} times</Flag> : null}
          <BasisTag basis={signal.basis} />
        </div>
      </div>
      <p className="text-sm leading-relaxed text-foreground">{signal.what}</p>
      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-muted-foreground uppercase">Source</dt>
          <dd className="mt-0.5 text-strong">
            {signal.source.label} · {whenLabel(signal.occurredAt, now, timezone)}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-muted-foreground uppercase">What it rests on</dt>
          <dd className="mt-0.5 text-strong">{signal.basisWords}</dd>
        </div>
        {signal.missing.length ? (
          <div className="sm:col-span-2">
            <dt className="font-semibold text-muted-foreground uppercase">Not known</dt>
            <dd className="mt-0.5 text-strong">{signal.missing.join(" ")}</dd>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <dt className="font-semibold text-muted-foreground uppercase">Suggested next step</dt>
          <dd className="mt-0.5 text-strong">{signal.suggestedAction}</dd>
        </div>
      </dl>
      {signal.deadlineAt ? (
        <p className={cn("inline-flex items-center gap-1.5 text-xs", signal.late ? "font-semibold text-destructive-foreground" : "font-medium text-warning-foreground")}>
          <AlertTriangle className="size-3.5" aria-hidden />
          {signal.late ? "Deadline passed" : "Deadline"} {whenLabel(signal.deadlineAt, now, timezone)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {signal.caseId ? (
          <Button size="sm" variant="outline" onClick={() => onOpen(signal.caseId!)}>
            Open the case ({signal.caseStatus})
          </Button>
        ) : canManage(role) ? (
          <>
            <Button size="sm" variant="primary" loading={busy} onClick={() => void run(async () => onOpen((await toCase({ companyId, signalId: id })).caseId))}>
              Follow this through
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDismissing((value) => !value)}>
              Nothing needed
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">An Owner or Manager decides what to do with this.</span>
        )}
      </div>
      {dismissing ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Why nothing is needed" className="min-w-56 flex-1">
            <TextInput value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          <Button size="sm" variant="outline" disabled={busy || !reason.trim()} onClick={() => void run(() => dismiss({ companyId, signalId: id, reason }))}>
            Dismiss
          </Button>
        </div>
      ) : null}
      <FormError message={error} />
    </li>
  );
}

export function RetentionAttentionScreen() {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const { openId, open, close } = useCaseParam();
  const cases = useStableQuery(api.retentionAgent.cases, now ? { companyId, asOf: now, view: "attention" } : "skip");
  const signals = useStableQuery(api.retentionAgent.signals, now ? { companyId, asOf: now } : "skip");
  const openSignals = (signals ?? []).filter((signal) => signal.status === "open");
  const carried = (signals ?? []).filter((signal) => signal.status === "in_case");
  return (
    <>
      <PageHeader title="Needs Attention" lead="Who needs attention, on what evidence, and what is suggested. Nothing here is a risk score: each line names the record it came from, and silence is never read as dissatisfaction." />
      <div className="grid gap-5">
        <Panel title={`Cases waiting on a person · ${cases?.length ?? 0}`}>
          {!cases ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : cases.length ? (
            <div className="grid gap-3">
              {cases.map((card) => (
                <CaseCardView key={card.caseId} card={card} now={now} timezone={timezone} onOpen={open} />
              ))}
            </div>
          ) : (
            <Empty title="No case is waiting on a person" body="A case arrives here when a step needs approval, when the record does not settle what happened, or when a concern is one only a person handles." />
          )}
        </Panel>
        <Panel title={`From the records · ${openSignals.length}`} action={<span className="text-xs text-muted-foreground">Read again every ten minutes. The same evidence is one line, counted.</span>}>
          {!signals ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : openSignals.length ? (
            <ul className="grid gap-3">
              {openSignals.map((signal) => (
                <SignalCard key={signal.signalId} signal={signal} now={now} timezone={timezone} onOpen={open} />
              ))}
            </ul>
          ) : (
            <Empty title="The records show nothing that needs attention" body="Retention compares plans with booked visits, payments with the service they paid for, paused service with what is still due, and agreements with their dates. That nothing is flagged does not mean every customer is satisfied." />
          )}
        </Panel>
        {carried.length ? (
          <Panel title={`Already in a case · ${carried.length}`}>
            <ul className="grid gap-3">
              {carried.map((signal) => (
                <SignalCard key={signal.signalId} signal={signal} now={now} timezone={timezone} onOpen={open} />
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
      <CaseDrawer id={openId} onClose={close} />
    </>
  );
}
