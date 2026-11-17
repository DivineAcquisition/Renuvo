"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { useNow } from "@/components/app/use-now";
import { Field, FormError, TextArea, useRun } from "@/components/app/form";
import { ArrowLeft } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { changePath, SERVICES_ROOT, servicePath } from "@/lib/app/services";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ChangeBadge, day, Empty, formatCents, Notice, SectionTitle, when } from "./shared";

/** Every change: waiting first, then the history. */
export function ChangesList() {
  const { companyId } = useCompany();
  const data = useQuery(api.services.changes, { companyId });
  if (!data) return <Skeleton className="h-64 rounded-2xl" />;
  const open = data.changes.filter((c) => c.state === "in_review" || c.state === "approved" || c.state === "scheduled");
  const past = data.changes.filter((c) => !open.includes(c));
  return (
    <div className="grid grid-cols-1 gap-6">
      <section aria-labelledby="waiting">
        <SectionTitle title="Waiting">{data.canPublish ? "Changes waiting for you to review, approve or publish." : "Changes waiting for the Owner. Only the Owner approves and publishes."}</SectionTitle>
        {open.length === 0 ? <Empty title="Nothing waiting">When a draft is submitted, it shows here with what it changes and what the specialists checked.</Empty> : <List rows={open} />}
      </section>
      {past.length ? (
        <section aria-labelledby="history">
          <SectionTitle title="History">Published, returned, withdrawn and replaced changes, newest first.</SectionTitle>
          <List rows={past} />
        </section>
      ) : null}
    </div>
  );
}

function List({ rows }: { rows: NonNullable<ReturnType<typeof useQuery<typeof api.services.changes>>>["changes"] }) {
  return (
    <ul className="grid grid-cols-1 gap-2">
      {rows.map((c) => (
        <li key={c.id}>
          <Link href={changePath(c.id)} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500/50">
            <span className="min-w-0">
              <span className="block font-medium text-strong">{c.title}</span>
              <span className="block text-xs text-muted-foreground">
                {c.kind === "publish" ? `Version ${c.version}` : c.kind === "archive" ? "Archive" : "Restore"} · submitted {when(c.submittedAt)} by {c.by}
                {c.effectiveAt ? ` · from ${day(c.effectiveAt)}` : ""}
                {c.publishedAt ? ` · live ${when(c.publishedAt)}` : ""}
              </span>
            </span>
            <span className="flex items-center gap-2">
              {c.concerns ? (
                <Badge variant="warning" size="sm">
                  {c.concerns} concern{c.concerns === 1 ? "" : "s"}
                </Badge>
              ) : null}
              <ChangeBadge state={c.state} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * One change, as the reviewer needs it: what changes, the prices before and after, why, the evidence,
 * what the specialists found, and exactly what approving authorizes. Approval is for this exact change.
 */
export function ChangeReview({ changeId }: { changeId: string }) {
  const { companyId } = useCompany();
  const change = useQuery(api.services.change, { companyId, changeId: changeId as Id<"serviceChanges"> });
  const approve = useMutation(api.services.approve);
  const publish = useMutation(api.services.publish);
  const sendBack = useMutation(api.services.returnChange);
  const withdraw = useMutation(api.services.withdraw);
  const apply = useMutation(api.services.applySuggestion);
  const { busy, error, run } = useRun();
  const [note, setNote] = useState("");
  const [returning, setReturning] = useState(false);
  const now = useNow();
  if (!change) return <Skeleton className="h-96 rounded-2xl" />;
  const open = change.state === "in_review" || change.state === "approved" || change.state === "scheduled";
  const blocked = change.liveMoved || change.draftMoved;
  const scheduled = change.effectiveAt !== null && change.effectiveAt > now;
  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`${SERVICES_ROOT}/changes`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-strong">
            <ArrowLeft aria-hidden className="size-4" /> All changes
          </Link>
          <h2 className="mt-1 font-heading text-xl tracking-tight text-strong">{change.title}</h2>
          <p className="text-sm text-muted-foreground">
            Submitted {when(change.submittedAt)} by {change.submittedBy} ·{" "}
            <Link href={servicePath(change.service.id)} className="underline-offset-4 hover:underline">
              open the service
            </Link>
          </p>
        </div>
        <ChangeBadge state={change.state} />
      </div>

      {change.closedReason ? <Notice tone={change.state === "returned" ? "warning" : "info"} title={change.state === "returned" ? "Returned to draft" : "Closed"}>{change.closedReason}</Notice> : null}
      {open && change.draftMoved ? <Notice tone="warning" title="The draft changed after this was submitted">This review no longer describes the draft. It can&apos;t be approved; submit the draft again.</Notice> : null}
      {open && change.liveMoved ? <Notice tone="warning" title="The live version changed">Another change went live after this one was submitted. Review the newer version first.</Notice> : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid grid-cols-1 gap-5">
          <Panel title="Why">
            <p className="whitespace-pre-line text-sm text-strong">{change.reason}</p>
          </Panel>
          {change.changesInWords.length ? (
            <Panel title="What changes">
              <ul className="grid grid-cols-1 gap-1 text-sm text-strong">
                {change.changesInWords.map((c) => (
                  <li key={c}>• {c}</li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {change.prices.length ? (
            <Panel title="Prices before and after">
              <table className="w-full text-sm">
                <caption className="sr-only">Example jobs priced by the live version and by this change</caption>
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-1.5 font-medium">Example job</th>
                    <th className="pb-1.5 text-right font-medium">Now</th>
                    <th className="pb-1.5 text-right font-medium">After</th>
                    <th className="pb-1.5 text-right font-medium">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {change.prices.map((row) => {
                    const diff = row.before !== null && row.after !== null ? row.after - row.before : null;
                    return (
                      <tr key={row.label} className="border-t border-border">
                        <td className="py-1.5 text-strong">{row.label}</td>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">{row.before === null ? "—" : formatCents(row.before)}</td>
                        <td className="py-1.5 text-right tabular-nums text-strong">{row.after === null ? (row.note ?? "No price") : formatCents(row.after)}</td>
                        <td className={cn("py-1.5 text-right tabular-nums", diff === null ? "text-muted-foreground" : diff > 0 ? "text-strong" : "text-success-foreground")}>{diff === null ? "—" : `${diff > 0 ? "+" : ""}${formatCents(diff)}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">Worked out by the pricing engine from each version. They describe the price, not how customers will respond.</p>
            </Panel>
          ) : null}
          <Panel title="What it affects">
            <ul className="grid grid-cols-1 gap-1 text-sm text-strong">
              {change.impact.map((line) => (
                <li key={line}>• {line}</li>
              ))}
            </ul>
            <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Customers to be told</dt>
                <dd className="text-strong">{change.customerNotice.required ? change.customerNotice.note || "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Agreements to review</dt>
                <dd className="text-strong">{change.contractReview.required ? change.contractReview.note || "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Takes effect</dt>
                <dd className="text-strong">{change.effectiveAt ? day(change.effectiveAt) : "When published"}</dd>
              </div>
            </dl>
          </Panel>
          {change.evidence.length ? (
            <Panel title="Evidence">
              <ul className="grid grid-cols-1 gap-1.5 text-sm">
                {change.evidence.map((e, i) => (
                  <li key={i} className="rounded-lg border border-border px-3 py-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{e.kind === "scenario" ? "Example job" : e.kind === "research" ? "Research" : e.kind === "import" ? "Imported from" : e.kind}</span>
                    <span className="block text-strong">{e.label}</span>
                    <span className="block text-muted-foreground">{e.detail}</span>
                    {e.kind === "research" && e.ref ? (
                      <Link href={`${SERVICES_ROOT}/research/${e.ref}`} className="text-xs text-brand-700 underline-offset-4 hover:underline dark:text-brand-300">
                        Open the brief
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div className="grid grid-cols-1 content-start gap-5">
          {change.agentNotes.length ? (
            <Panel title="What the specialists checked">
              <ul className="grid grid-cols-1 gap-2">
                {change.agentNotes.map((n) => (
                  <li key={n.agent} className={cn("rounded-lg border px-3 py-2 text-sm", n.status === "concern" ? "border-warning/40 bg-warning/[0.07]" : n.status === "ok" ? "border-success/30 bg-success/[0.05]" : "border-border")}>
                    <span className="block font-medium text-strong">
                      {n.status === "concern" ? "Concern · " : n.status === "ok" ? "Checked · " : "Not reviewed · "}
                      {n.title}
                    </span>
                    <span className="block text-muted-foreground">{n.detail}</span>
                    {n.suggestion && open && change.canWithdraw ? (
                      <Button
                        size="xs"
                        variant="secondary"
                        className="mt-2"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`${n.suggestion!.label}? This edits the draft, which returns this change to draft for resubmission.`)) return;
                          void run(async () => apply({ companyId, serviceId: change.service.id, field: n.suggestion!.field as "team.crewSize", value: n.suggestion!.value }));
                        }}
                      >
                        {n.suggestion.label}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">Checks run in code against your records. A specialist suggests; a person decides.</p>
            </Panel>
          ) : null}

          <Panel title="Decision">
            {change.approval ? (
              <p className="text-sm text-strong">
                Approved by {change.approval.by} {when(change.approval.at)}
                {change.approval.note ? `: “${change.approval.note}”` : ""}.
              </p>
            ) : null}
            {change.publishedAt ? (
              <p className="text-sm text-strong">
                Published {when(change.publishedAt)}
                {change.publishedBy ? ` by ${change.publishedBy}` : ""}.
              </p>
            ) : null}
            {open && change.canPublish ? (
              <div className="mt-2 grid gap-3">
                <p className="text-sm text-muted-foreground">
                  Approving authorizes exactly this {change.kind === "publish" ? `version ${change.version}` : change.kind}. {change.kind === "publish" ? "New quotes and visits use it from " + (scheduled ? day(change.effectiveAt!) : "the moment it is published") + "; booked visits and signed agreements are not changed." : ""} A later edit to the draft cancels this approval.
                </p>
                {change.state === "in_review" ? (
                  <>
                    <Field label="Note (optional)">
                      <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" loading={busy} disabled={blocked} onClick={() => void run(async () => approve({ companyId, changeId: change.id, hash: change.hash, note: note || undefined, publish: true }))}>
                        {scheduled ? `Approve and schedule for ${day(change.effectiveAt!)}` : "Approve and publish"}
                      </Button>
                      <Button variant="secondary" disabled={busy || blocked} onClick={() => void run(async () => approve({ companyId, changeId: change.id, hash: change.hash, note: note || undefined, publish: false }))}>
                        Approve only
                      </Button>
                    </div>
                  </>
                ) : change.state === "approved" ? (
                  <Button variant="primary" loading={busy} disabled={blocked} onClick={() => void run(async () => publish({ companyId, changeId: change.id, hash: change.hash }))}>
                    {scheduled ? `Schedule for ${day(change.effectiveAt!)}` : "Publish now"}
                  </Button>
                ) : (
                  <p className="text-sm text-strong">Scheduled for {day(change.effectiveAt!)}. Everything is checked again then; if anything moved, it is not published and you&apos;re told why.</p>
                )}
                {returning ? (
                  <ReturnForm onCancel={() => setReturning(false)} onReturn={(reason) => void run(async () => sendBack({ companyId, changeId: change.id, reason }))} busy={busy} />
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setReturning(true)}>
                    Send back with a note
                  </Button>
                )}
              </div>
            ) : open ? (
              <p className="mt-1 text-sm text-muted-foreground">Waiting for the Owner. Only the Owner approves and publishes price changes.</p>
            ) : null}
            {open && change.canWithdraw ? (
              <Button variant="ghost" size="sm" className="mt-2" disabled={busy} onClick={() => window.confirm("Withdraw this change? The draft stays.") && void run(async () => withdraw({ companyId, changeId: change.id }))}>
                Withdraw
              </Button>
            ) : null}
            <FormError message={error} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function ReturnForm({ onReturn, onCancel, busy }: { onReturn: (reason: string) => void; onCancel: () => void; busy: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <div className="grid grid-cols-1 gap-2">
      <Field label="What needs to change">
        <TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={!reason.trim() || busy} onClick={() => onReturn(reason)}>
          Send back
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <h3 className="mb-2 font-heading text-base tracking-tight text-strong">{title}</h3>
      {children}
    </section>
  );
}
