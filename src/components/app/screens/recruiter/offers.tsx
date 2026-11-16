"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, TextArea, useRun } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Check, FileText } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { until } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { ProgressRing, STAGE_WORDS } from "./shared";

type Board = NonNullable<ReturnType<typeof useQuery<typeof api.hiringOffers.board>>>;
type Row = Board["rows"][number];
type Offer = Row["offers"][number];

const OFFER_STEPS: { id: Offer["status"]; label: string }[] = [
  { id: "draft", label: "Drafted" },
  { id: "awaiting_approval", label: "Approval" },
  { id: "approved", label: "Approved" },
  { id: "sent", label: "Sent" },
  { id: "accepted", label: "Accepted" },
];
const ENDED: Partial<Record<Offer["status"], string>> = { declined: "Declined", expired: "Expired", withdrawn: "Withdrawn" };

/** Offers & Agreements: each offer's path to acceptance, its agreement, and onboarding until ready for Dispatch. */
export function OffersScreen() {
  const { companyId } = useCompany();
  const board = useQuery(api.hiringOffers.board, { companyId });
  const queue = useQuery(api.onboarding.queue, { companyId, status: "open" });
  if (!board || !queue) {
    return (
      <>
        <PageHeader title="Offers & Agreements" lead="Offers you approve, the agreement each needs, and onboarding until a new worker is ready." />
        <Skeleton className="h-96 rounded-2xl" />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Offers & Agreements" lead="Offers you approve, the agreement each needs, and onboarding until a new worker is ready." />
      <div className="grid gap-5">
        <Badge variant={board.signing ? "success" : "outline"} size="sm" className="justify-self-start">
          <FileText aria-hidden /> {board.signing ? `Signing: ${board.signing}` : "No signing service connected: a person records each signed agreement"}
        </Badge>
        <Panel title={`Offers · ${board.rows.length}`}>
          {board.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applicant has reached an offer. After a decision to hire, the offer is drafted here and sent only after you approve it.</p>
          ) : (
            <ul className="grid gap-3">
              {board.rows.map((row) => (
                <OfferRow key={row.applicationId} row={row} />
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={`Onboarding · ${queue.length}`}>
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody is onboarding. When an offer is accepted, the new worker&apos;s checklist appears here.</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {queue.map((row) => (
                <Onboarding key={row.handoffId} row={row} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function OfferRow({ row }: { row: Row }) {
  const { companyId, role } = useCompany();
  const now = useNow();
  const draft = useMutation(api.hiringOffers.draft);
  const requestSend = useMutation(api.hiringOffers.requestSend);
  const withdraw = useMutation(api.hiringOffers.withdraw);
  const sendAgreement = useMutation(api.hiringOffers.sendAgreement);
  const recordAgreement = useMutation(api.hiringOffers.recordAgreement);
  const { busy, error, run } = useRun();
  const [drafting, setDrafting] = useState(false);
  const [terms, setTerms] = useState({ startConditions: "", expectations: "" });
  const offer = row.offers[0] ?? null;
  const reached = offer ? OFFER_STEPS.findIndex((step) => step.id === offer.status) : -1;
  const manager = role !== "office";
  return (
    <li className="rounded-2xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/app/agents/recruiter/applicants?open=${row.applicationId}`} className="font-medium text-strong hover:underline">
            {row.applicant ?? "Applicant"}
          </Link>
          <p className="text-xs text-muted-foreground">
            {row.role ?? "No role"} · {STAGE_WORDS[row.stage]}
            {row.approvedTerms ? ` · ${row.approvedTerms.engagement === "employee" ? "Employee" : "Contractor"}, ${row.approvedTerms.pay}` : " · pay not approved for this role yet"}
          </p>
        </div>
        {offer?.expiresAt && offer.status === "sent" ? <Badge variant="outline" size="sm">Answer by {until(offer.expiresAt, now).text}</Badge> : null}
      </div>
      {offer ? (
        <>
          <ol className="mt-3 flex items-center" aria-label="Offer progress">
            {OFFER_STEPS.map((step, index) => {
              const done = !ENDED[offer.status] && index <= reached;
              return (
                <li key={step.id} className="flex flex-1 items-center last:flex-none">
                  <span className="flex flex-col items-center gap-1">
                    <span className={cn("grid size-6 place-items-center rounded-full border-2 text-[10px]", done ? "border-brand-500 bg-brand-500 text-white" : "border-border bg-card text-muted-foreground")}>{done ? <Check className="size-3.5" aria-hidden /> : index + 1}</span>
                    <span className={cn("text-[11px]", index === reached ? "font-semibold text-strong" : "text-muted-foreground")}>{step.label}</span>
                  </span>
                  {index < OFFER_STEPS.length - 1 ? <span aria-hidden className={cn("mx-1 mb-5 h-0.5 flex-1", done && index < reached ? "bg-brand-500" : "bg-border")} /> : null}
                </li>
              );
            })}
          </ol>
          {ENDED[offer.status] ? <p className="mt-2 text-sm font-medium text-strong">{ENDED[offer.status]}</p> : null}
          <p className="mt-2 text-xs text-muted-foreground">
            Agreement: {offer.agreement.status === "completed" ? "signed" : offer.agreement.status === "sent" ? `sent${offer.agreement.provider ? ` through ${offer.agreement.provider}` : ""}, not signed yet` : "not started"}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No offer drafted yet.</p>
      )}
      {row.nextAction ? <p className="mt-2 text-sm text-strong">Next: {row.nextAction.what}</p> : null}
      {manager ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {!offer || offer.status === "declined" || offer.status === "expired" || offer.status === "withdrawn" ? (
            row.stage === "decision_pending" || row.stage === "offer_sent" ? (
              <Button size="xs" variant="primary" onClick={() => setDrafting(true)}>
                Draft the offer
              </Button>
            ) : null
          ) : null}
          {offer?.status === "draft" ? (
            <Button size="xs" variant="primary" loading={busy} onClick={() => void run(() => requestSend({ companyId, offerId: offer.offerId as Id<"hiringOffers"> }))}>
              Ask for approval to send
            </Button>
          ) : null}
          {offer && (offer.status === "draft" || offer.status === "awaiting_approval" || offer.status === "approved" || offer.status === "sent") ? (
            <Button size="xs" variant="ghost" loading={busy} onClick={() => void run(() => withdraw({ companyId, offerId: offer.offerId as Id<"hiringOffers"> }))}>
              Withdraw
            </Button>
          ) : null}
          {offer?.status === "accepted" && offer.agreement.status === "not_started" ? (
            <Button size="xs" variant="outline" loading={busy} onClick={() => void run(() => sendAgreement({ companyId, offerId: offer.offerId as Id<"hiringOffers"> }))}>
              Send the agreement
            </Button>
          ) : null}
          {offer?.status === "accepted" && offer.agreement.status !== "completed" ? (
            <Button size="xs" variant="ghost" loading={busy} onClick={() => void run(() => recordAgreement({ companyId, offerId: offer.offerId as Id<"hiringOffers"> }))}>
              Record it as signed
            </Button>
          ) : null}
        </div>
      ) : null}
      {drafting ? (
        <form
          className="mt-3 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await draft({ companyId, applicationId: row.applicationId as Id<"applications">, ...terms });
              setDrafting(false);
            });
          }}
        >
          <Field label="Start conditions" hint="For example: after the background check and one shadow shift.">
            <TextArea value={terms.startConditions} onChange={(event) => setTerms({ ...terms, startConditions: event.target.value })} required />
          </Field>
          <Field label="Expectations">
            <TextArea value={terms.expectations} onChange={(event) => setTerms({ ...terms, expectations: event.target.value })} required />
          </Field>
          <p className="text-xs text-muted-foreground">Pay and worker type come from the role&apos;s approved terms. Nothing is sent until you approve it.</p>
          <div className="flex gap-2">
            <Button type="submit" size="xs" variant="primary" loading={busy}>
              Save draft
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => setDrafting(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      <FormError message={error} />
    </li>
  );
}

function Onboarding({ row }: { row: NonNullable<ReturnType<typeof useQuery<typeof api.onboarding.queue>>>[number] }) {
  const { companyId, role } = useCompany();
  const now = useNow();
  const record = useMutation(api.onboarding.record);
  const complete = useMutation(api.onboarding.complete);
  const { busy, error, run } = useRun();
  const done = row.requirements.filter((item) => item.status === "done").length;
  return (
    <section className="rounded-2xl border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        <ProgressRing done={done} total={row.requirements.length} />
        <div className="min-w-0 flex-1">
          <Link href={`/app/agents/recruiter/applicants?open=${row.applicationId}`} className="font-medium text-strong hover:underline">
            {row.applicant ?? "New worker"}
          </Link>
          <p className="text-xs text-muted-foreground">
            {row.role} · {row.approvedTerms.payWords} · {row.responsible ? `with ${row.responsible}` : "no one responsible yet"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Next: {row.nextAction} · {until(row.dueAt, now).text}
          </p>
        </div>
        <Badge variant={row.dispatchReady ? "success" : "outline"} size="sm">
          {row.dispatchReady ? "Ready for Dispatch" : "Not ready yet"}
        </Badge>
      </div>
      <ul className="mt-3 grid gap-1.5">
        {row.requirements.map((item) => (
          <li key={item.key}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={item.status === "done"} disabled={busy || role === "office"} onChange={(event) => void run(() => record({ companyId, handoffId: row.handoffId as Id<"onboardingHandoffs">, requirement: item.key, done: event.target.checked }))} />
              <span className={cn(item.status === "done" ? "text-muted-foreground line-through" : "text-strong")}>{item.label}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">A person records each one; nothing here is checked automatically.</p>
      {role === "owner" && done === row.requirements.length ? (
        <Button className="mt-2" size="xs" variant="primary" loading={busy} onClick={() => void run(() => complete({ companyId, handoffId: row.handoffId as Id<"onboardingHandoffs"> }))}>
          Mark ready to work
        </Button>
      ) : null}
      <FormError message={error} />
    </section>
  );
}
