"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, SelectInput, TextInput, useRun } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/shell";
import { Sparkles } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { CriteriaList, RECOMMENDATION, STAGE_WORDS, type Screening } from "./shared";

/**
 * Screening: each submitted application with Recruiter's reading against the role's criteria. Recruiter
 * suggests; a person decides. There is no score, and no protected characteristic is ever a criterion.
 */
export function ScreeningScreen() {
  const { companyId } = useCompany();
  const queue = useQuery(api.applications.screeningQueue, { companyId });
  if (!queue) {
    return (
      <>
        <PageHeader title="Screening" lead="Recruiter reads each submitted application against the role. A person decides." />
        <Skeleton className="h-96 rounded-2xl" />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Screening" lead="Recruiter reads each submitted application against the role. A person decides." />
      {queue.length === 0 ? (
        <Panel>
          <p className="py-8 text-center text-sm text-muted-foreground">No submitted applications are waiting. They appear here as applicants finish the form.</p>
        </Panel>
      ) : (
        <div className="grid gap-5">
          {queue.map((row) => (
            <ScreeningCard key={row.applicationId} row={row} />
          ))}
        </div>
      )}
    </>
  );
}

function ScreeningCard({ row }: { row: NonNullable<ReturnType<typeof useQuery<typeof api.applications.screeningQueue>>>[number] }) {
  const { companyId, role } = useCompany();
  const decide = useMutation(api.applications.decide);
  const rescreen = useMutation(api.applications.rescreen);
  const ask = useMutation(api.applications.askApplicant);
  const { busy, error, run } = useRun();
  const [mode, setMode] = useState<null | "hold" | "reject" | "ask">(null);
  const [reason, setReason] = useState("");
  const [rejectReason, setRejectReason] = useState<"requirement_not_met" | "not_selected" | "no_response" | "other">("not_selected");
  const screening = row.screening as Screening | null;
  const applicationId = row.applicationId as Id<"applications">;
  const canDecide = role !== "office" && (row.stage === "screening" || row.stage === "interview" || row.stage === "decision_pending");
  const tally = screening ? { meets: screening.results.filter((r) => r.outcome === "meets").length, total: screening.results.filter((r) => r.outcome !== "not_applicable").length } : null;
  return (
    <Panel>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="grid content-start gap-3">
          <div>
            <Link href={`/app/agents/recruiter/applicants?open=${row.applicationId}`} className="font-heading text-lg tracking-tight text-strong hover:underline">
              {row.name ?? "Name not known"}
            </Link>
            <p className="text-sm text-muted-foreground">
              {row.role ?? "No role"} · {STAGE_WORDS[row.stage]}
            </p>
          </div>
          {screening ? (
            <>
              <div className={cn("rounded-xl border px-3 py-2.5", RECOMMENDATION[screening.recommendation].tone)}>
                <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase">
                  <Sparkles className="size-3.5" aria-hidden /> Recruiter&apos;s reading
                </p>
                <p className="mt-1 text-sm font-medium text-strong">{RECOMMENDATION[screening.recommendation].label}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{screening.summary.suggestedNextStep}</p>
              </div>
              {tally ? (
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Criteria met</span>
                    <span className="tabular-nums">
                      {tally.meets} of {tally.total}
                    </span>
                  </div>
                  <div className="mt-1 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
                    {screening.results
                      .filter((r) => r.outcome !== "not_applicable")
                      .map((r) => (
                        <span key={r.key} className={cn("flex-1", r.outcome === "meets" ? "bg-success" : r.outcome === "does_not_meet" ? "bg-destructive" : "bg-warning")} />
                      ))}
                  </div>
                </div>
              ) : null}
              <dl className="grid gap-1 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Experience</dt>
                  <dd className="text-strong">{screening.summary.experience || "Not stated"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Availability</dt>
                  <dd className="text-strong">{screening.summary.availability || "Not stated"}</dd>
                </div>
              </dl>
              {screening.summary.concerns.length ? (
                <div className="flex flex-wrap gap-1">
                  {screening.summary.concerns.map((concern) => (
                    <Badge key={concern} variant="warning" size="sm">
                      {concern}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {screening.missing.length ? <p className="text-xs text-warning-foreground">Missing: {screening.missing.join(", ")}</p> : null}
              {screening.contradictions.length ? <p className="text-xs text-warning-foreground">Contradictions: {screening.contradictions.join("; ")}</p> : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Not screened yet.</p>
          )}
        </div>
        <div className="grid content-start gap-3">
          {screening ? <CriteriaList results={screening.results} /> : null}
          {canDecide ? (
            <div className="grid gap-2 border-t border-border pt-3">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" loading={busy} onClick={() => void run(() => decide({ companyId, applicationId, decision: "interview" }))}>
                  Invite to interview
                </Button>
                <Button size="sm" variant="outline" loading={busy} onClick={() => void run(() => decide({ companyId, applicationId, decision: "offer" }))}>
                  Make an offer
                </Button>
                <Button size="sm" variant="outline" onClick={() => setMode(mode === "ask" ? null : "ask")}>
                  Ask the applicant
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode(mode === "hold" ? null : "hold")}>
                  Hold
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode(mode === "reject" ? null : "reject")}>
                  Decline
                </Button>
                <Button size="sm" variant="ghost" loading={busy} onClick={() => void run(() => rescreen({ companyId, applicationId }))}>
                  Screen again
                </Button>
              </div>
              {mode ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      if (mode === "ask") await ask({ companyId, applicationId, question: reason });
                      else await decide({ companyId, applicationId, decision: mode, reason, ...(mode === "reject" ? { rejectReason, tellApplicant: true } : {}) });
                      setMode(null);
                      setReason("");
                    });
                  }}
                >
                  {mode === "reject" ? (
                    <SelectInput aria-label="Why" value={rejectReason} onChange={(event) => setRejectReason(event.target.value as typeof rejectReason)}>
                      <option value="not_selected">Not selected</option>
                      <option value="requirement_not_met">A requirement is not met</option>
                      <option value="no_response">No response</option>
                      <option value="other">Other</option>
                    </SelectInput>
                  ) : null}
                  <TextInput aria-label={mode === "ask" ? "Question" : "Reason"} placeholder={mode === "ask" ? "What should Recruiter ask?" : "The reason, for the record"} value={reason} onChange={(event) => setReason(event.target.value)} className="min-w-0 flex-1" />
                  <Button type="submit" size="sm" variant={mode === "reject" ? "destructive-outline" : "outline"} loading={busy} disabled={!reason.trim()}>
                    {mode === "ask" ? "Send question" : mode === "hold" ? "Hold" : "Decline"}
                  </Button>
                </form>
              ) : null}
              <p className="text-xs text-muted-foreground">Recruiter suggests; you decide. Every decline is made by a person, with the reason recorded.</p>
            </div>
          ) : null}
          <FormError message={error} />
        </div>
      </div>
    </Panel>
  );
}
