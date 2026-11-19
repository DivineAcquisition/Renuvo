"use client";

/**
 * Re-engagement: former customers who could be asked back, one at a time. Each shows why they are
 * listed, their service history, what they said when they left, whether they may be contacted, and
 * whether anything is unresolved. Nothing goes to a list, and nobody is here because time passed.
 */
import { useMutation } from "convex/react";
import { useState } from "react";

import { canManage, useCompany } from "@/components/app/company";
import { Field, FormError, TextArea, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { whenLabel } from "@/lib/app/format";
import { useStableQuery } from "@/lib/app/stable-query";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { CaseDrawer } from "./drawer";
import { CaseCardView, Empty, Flag, plural, useCaseParam } from "./shared";

type Candidate = FunctionReturnType<typeof api.retentionAgent.reengagement>["candidates"][number];

function Offer({ candidate, onClose, onCase }: { candidate: Candidate; onClose: () => void; onCase: (id: string) => void }) {
  const { companyId } = useCompany();
  const prepare = useMutation(api.retentionAgent.prepareReturnOffer);
  const { busy, error, run } = useRun();
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [refused, setRefused] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={`Return offer for ${candidate.name}`} description="Write a reason for this customer to come back that answers why they left. Offers follow your approved pricing, so the message names no price or discount.">
      <div className="grid gap-3">
        <div className="rounded-xl border border-border bg-background p-3.5 text-sm">
          <p className="text-strong">
            Last service: {candidate.lastService ?? "none on record"} · {plural(candidate.completedVisits, "completed visit")}
          </p>
          <p className="mt-1 text-muted-foreground">{candidate.statedReason ? `${candidate.statedReason.source}: “${candidate.statedReason.words}”` : "Why they left is not on record. Do not assume a reason."}</p>
          <p className="mt-1 text-muted-foreground">{candidate.contact.words}</p>
        </div>
        <Field label="Message">
          <TextArea rows={5} value={body} onChange={(event) => setBody(event.target.value)} />
        </Field>
        <Field label="Why this customer, why now">
          <TextInput value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {refused ? <p className="text-sm font-medium text-warning-foreground" role="alert">{refused}</p> : null}
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={body.trim().length < 20}
            onClick={() =>
              void run(async () => {
                const result = await prepare({ companyId, customerId: candidate.customerId, body, reason });
                if (!result.ok) return setRefused(result.words);
                onClose();
                onCase(result.caseId);
              })
            }
          >
            Prepare the offer
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function RetentionReengagementScreen() {
  const { companyId, timezone, role } = useCompany();
  const now = useNow();
  const { openId, open, close } = useCaseParam();
  const data = useStableQuery(api.retentionAgent.reengagement, now ? { companyId, asOf: now } : "skip");
  const offers = useStableQuery(api.retentionAgent.cases, now ? { companyId, asOf: now, view: "reactivation" } : "skip");
  const [writing, setWriting] = useState<Candidate | null>(null);
  return (
    <>
      <PageHeader title="Re-engagement" lead="Former customers who could be asked back, one at a time, each with a reason. No campaign goes to everyone marked inactive, and a request to cancel or not to be contacted is honoured." />
      <div className="grid gap-5">
        {offers?.length ? (
          <Panel title={`Offers under way · ${offers.length}`}>
            <div className="grid gap-3">
              {offers.map((card) => (
                <CaseCardView key={card.caseId} card={card} now={now} timezone={timezone} onOpen={open} />
              ))}
            </div>
          </Panel>
        ) : null}
        <Panel title={`Former customers · ${data?.candidates.length ?? 0}`} action={data ? <span className="max-w-md text-right text-xs text-muted-foreground">{data.rule}</span> : undefined}>
          {!data ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : data.candidates.length ? (
            <ul className="grid gap-3">
              {data.candidates.map((candidate) => (
                <li key={candidate.customerId} className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-strong">{candidate.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {candidate.segmentWords} · {candidate.basis}
                      </p>
                    </div>
                    <Flag tone={candidate.eligible ? "neutral" : "warn"}>{candidate.eligible ? "May be asked" : "Not now"}</Flag>
                  </div>
                  <dl className="grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Service history</dt>
                      <dd className="mt-0.5 text-strong">
                        {plural(candidate.completedVisits, "completed visit")}
                        {candidate.lastServiceAt ? `, last ${whenLabel(candidate.lastServiceAt, now, timezone)}` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Why they left</dt>
                      <dd className="mt-0.5 text-strong">{candidate.statedReason ? `“${candidate.statedReason.words}”` : <span className="text-muted-foreground">Not on record</span>}</dd>
                      {candidate.statedReason ? <dd className="text-xs text-muted-foreground">{candidate.statedReason.source}</dd> : null}
                    </div>
                    <div>
                      <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Contact</dt>
                      <dd className={cn("mt-0.5", candidate.contact.ok ? "text-strong" : "text-warning-foreground")}>{candidate.contact.words}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                    <p className="min-w-0 flex-1 text-sm text-foreground">{candidate.why}</p>
                    {candidate.caseId ? (
                      <Button size="sm" variant="outline" onClick={() => open(candidate.caseId!)}>
                        Open the offer
                      </Button>
                    ) : candidate.eligible && canManage(role) ? (
                      <Button size="sm" variant="primary" onClick={() => setWriting(candidate)}>
                        Prepare a return offer
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No former customer is on record" body="A customer is listed when a person marks the relationship as former, or when their recurring service ended and nothing is booked. A completed one-time job is not a customer who left, and nobody is listed for being quiet." />
          )}
        </Panel>
      </div>
      {writing ? <Offer candidate={writing} onClose={() => setWriting(null)} onCase={open} /> : null}
      <CaseDrawer id={openId} onClose={close} />
    </>
  );
}
