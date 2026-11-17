"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { useNow } from "@/components/app/use-now";
import { Field, FormError, TextArea, useRun } from "@/components/app/form";
import { ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, CheckCircle2, Home } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { changePath, SERVICES_ROOT, servicePath } from "@/lib/app/services";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { quote as runQuote } from "../../../../convex/lib/services/engine";
import { lowerFirst, minutesWords } from "../../../../convex/lib/services/words";
import { defaultInput } from "./preview";
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
          <SectionTitle title="History" />
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
                {c.kind === "publish" ? `Version ${c.version}` : c.kind === "archive" ? "Archive" : c.kind === "restore" ? "Restore" : `Property price · ${c.serviceName}`} · submitted {when(c.submittedAt)} by {c.by}
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
  const ownPrice = change.propertyPrice;
  const blocked = change.liveMoved || change.draftMoved || Boolean(ownPrice?.moved);
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

      {change.closedReason ? <Notice tone={change.state === "returned" ? "warning" : "info"} title={change.state === "returned" ? (ownPrice ? "Sent back" : "Returned to draft") : "Closed"}>{change.closedReason}</Notice> : null}
      {open && change.draftMoved ? <Notice tone="warning" title="The draft changed after this was submitted">This review no longer describes the draft. It can&apos;t be approved; submit the draft again.</Notice> : null}
      {open && change.liveMoved ? <Notice tone="warning" title="The live version changed">Another change went live after this one was submitted. Review the newer version first.</Notice> : null}
      {open && ownPrice?.moved ? <Notice tone="warning" title="This property's price changed">{ownPrice.moved} It can&apos;t be approved; send it back and propose again from the current price.</Notice> : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid grid-cols-1 gap-5">
          {ownPrice ? <ProposedPrice price={ownPrice} /> : null}
          <Panel title="Why">
            <p className="whitespace-pre-line text-sm text-strong">{change.reason}</p>
          </Panel>
          {change.changesInWords.length ? (
            <Panel title="What changes">
              <ul className="grid grid-cols-1 gap-1.5 text-sm">
                {change.changesInWords.map((c) => {
                  const pair = beforeAfter(c);
                  return (
                    <li key={c} className="rounded-lg border border-border px-3 py-2">
                      {pair ? (
                        <span className="grid grid-cols-1 gap-0.5">
                          <span className="text-xs text-muted-foreground">{pair.label}</span>
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-muted-foreground line-through decoration-muted-foreground/60">
                              <span className="sr-only">was </span>
                              {pair.before}
                            </span>
                            <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="font-medium text-strong">
                              <span className="sr-only">now </span>
                              {pair.after}
                            </span>
                          </span>
                        </span>
                      ) : (
                        <span className="text-strong">{c}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}
          {change.prices.length ? <PriceDiff rows={change.prices} /> : null}
          {change.ownPrices.length ? (
            <Panel title="Properties that keep their own price">
              <ul className="grid grid-cols-1 gap-1 text-sm">
                {change.ownPrices.map((row) => (
                  <li key={row.id} className="flex flex-wrap justify-between gap-x-3 rounded-lg border border-border px-3 py-2">
                    <span className="min-w-0">
                      <span className="block text-strong">{row.property}</span>
                      <span className="block text-xs text-muted-foreground">
                        {row.customer}
                        {row.untilWords ? ` · ${lowerFirst(row.untilWords)}` : ""}
                      </span>
                    </span>
                    <span className="tabular-nums text-strong">{formatCents(row.baseCents)} base</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">Their base price stays. Extras, discounts and the minimum there follow the version you publish.</p>
            </Panel>
          ) : null}
          <Panel title="What it affects">
            <ul className="grid grid-cols-1 gap-1 text-sm text-strong">
              {change.impact.map((line) => (
                <li key={line}>• {line}</li>
              ))}
            </ul>
            {ownPrice ? null : (
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
            )}
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
                      <Link href={`${SERVICES_ROOT}/research/${e.ref}`} className="text-xs text-brand-300 underline-offset-4 hover:underline dark:text-brand-300">
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
                <ul aria-label="What approving does" className="grid grid-cols-1 gap-1.5 text-sm">
                  {ownPrice ? (
                    <>
                      <Assurance>Approves exactly this price for {ownPrice.property?.name ?? "this property"}, nothing else</Assurance>
                      <Assurance>New visits there use it once approved; booked visits keep their price</Assurance>
                      <Assurance>The service&apos;s price and other properties stay as they are</Assurance>
                    </>
                  ) : (
                    <>
                      <Assurance>Approves exactly this {change.kind === "publish" ? `version ${change.version}` : change.kind}, nothing else</Assurance>
                      {change.kind === "publish" ? (
                        <>
                          <Assurance>New quotes and visits use it {scheduled ? `from ${day(change.effectiveAt!)}` : "once published"}</Assurance>
                          <Assurance>Booked visits and signed agreements keep their price</Assurance>
                        </>
                      ) : null}
                      <Assurance>Editing the draft later cancels this approval</Assurance>
                    </>
                  )}
                </ul>
                {change.state === "in_review" ? (
                  <>
                    <Field label="Note (optional)">
                      <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" loading={busy} disabled={blocked} onClick={() => void run(async () => approve({ companyId, changeId: change.id, hash: change.hash, note: note || undefined, publish: true }))}>
                        {ownPrice ? "Approve this price" : scheduled ? `Approve and schedule for ${day(change.effectiveAt!)}` : "Approve and publish"}
                      </Button>
                      {ownPrice ? null : (
                        <Button variant="secondary" disabled={busy || blocked} onClick={() => void run(async () => approve({ companyId, changeId: change.id, hash: change.hash, note: note || undefined, publish: false }))}>
                          Approve only
                        </Button>
                      )}
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
              <Button variant="ghost" size="sm" className="mt-2" disabled={busy} onClick={() => window.confirm(ownPrice ? "Withdraw this proposal? The property keeps the price it has now." : "Withdraw this change? The draft stays.") && void run(async () => withdraw({ companyId, changeId: change.id }))}>
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

/** "Price: $150.00 → $165.00." read as its label, the old value and the new one. Anything else is left as written. */
export function beforeAfter(line: string): { label: string; before: string; after: string } | null {
  const match = /^([^:]+): (.+?) → (.+?)\.?$/.exec(line);
  return match ? { label: match[1], before: match[2], after: match[3] } : null;
}

type PriceRow = { label: string; before: number | null; after: number | null; note?: string | null };

/**
 * Example jobs priced by the live version and by this change. Only the jobs whose price moves are
 * shown up front, each with how much and which way; jobs priced the same are folded away.
 */
function PriceDiff({ rows }: { rows: PriceRow[] }) {
  const same = rows.filter((r) => r.before !== null && r.after !== null && r.before === r.after);
  const moved = rows.filter((r) => !same.includes(r));
  return (
    <Panel title="Prices before and after">
      {moved.length ? (
        <ul className="grid grid-cols-1 gap-1.5">
          {moved.map((row) => {
            const diff = row.before !== null && row.after !== null ? row.after - row.before : null;
            const percent = diff !== null && row.before ? Math.round((diff / row.before) * 1000) / 10 : null;
            return (
              <li key={row.label} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="min-w-0 text-strong">{row.label}</span>
                <span className="flex flex-wrap items-center gap-2 tabular-nums">
                  {row.before !== null ? (
                    <>
                      <span className="text-muted-foreground line-through decoration-muted-foreground/60">
                        <span className="sr-only">was </span>
                        {formatCents(row.before)}
                      </span>
                      <ArrowRight aria-hidden className="size-3.5 text-muted-foreground" />
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">New</span>
                  )}
                  <span className="font-medium text-strong">{row.after === null ? (row.note ?? "No price") : formatCents(row.after)}</span>
                  {diff !== null ? (
                    <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium", diff > 0 ? "bg-brand-500/10 text-brand-300" : "bg-success/10 text-success-foreground")}>
                      {diff > 0 ? <ArrowUpRight aria-hidden className="size-3.5" /> : <ArrowDownRight aria-hidden className="size-3.5" />}
                      <span className="sr-only">{diff > 0 ? "up " : "down "}</span>
                      {diff > 0 ? "+" : ""}
                      {formatCents(diff)}
                      {percent !== null ? ` (${diff > 0 ? "+" : ""}${percent}%)` : ""}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-strong">Every example job keeps its price.</p>
      )}
      {same.length && moved.length ? (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-strong">
            {same.length} example job{same.length === 1 ? "" : "s"} priced the same
          </summary>
          <ul className="mt-1.5 grid grid-cols-1 gap-1">
            {same.map((row) => (
              <li key={row.label} className="flex justify-between gap-3 px-3 text-muted-foreground">
                <span>{row.label}</span>
                <span className="tabular-nums">{formatCents(row.after!)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">Worked out by the pricing engine from each version. They describe the price, not how customers will respond.</p>
    </Panel>
  );
}

type OwnPrice = NonNullable<NonNullable<ReturnType<typeof useQuery<typeof api.services.change>>>["propertyPrice"]>;

/**
 * A property's own price as its reviewer needs it: which property, the price proposed against the price
 * it has now, and the service's example job priced both ways by the engine visits use.
 */
function ProposedPrice({ price }: { price: OwnPrice }) {
  const spec = price.catalog?.spec ?? null;
  const per = spec ? (spec.pricing.method === "recurring_package" ? "month" : spec.visitWord) : "visit";
  const example = useMemo(() => {
    if (!spec) return null;
    const sample = defaultInput(spec);
    const usual = runQuote(spec, sample);
    const here = runQuote(spec, { ...sample, propertyPrice: { baseCents: price.baseCents, laborMinutes: price.laborMinutes } });
    return { usual: usual.outcome === "firm" || usual.outcome === "estimate" ? usual.totalCents : null, here: here.totalCents };
  }, [spec, price.baseCents, price.laborMinutes]);
  return (
    <Panel title="The price">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span aria-hidden className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-300">
            <Home className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-strong">{price.property?.name ?? "A property that was removed"}</p>
            <p className="text-xs text-muted-foreground">
              {price.customer?.name ?? "Unknown customer"}
              {price.property ? ` · ${price.property.address}` : ""}
            </p>
          </div>
        </div>
        <p className="text-right">
          {price.current ? (
            <span className="mr-2 text-sm text-muted-foreground line-through decoration-muted-foreground/60 tabular-nums">
              <span className="sr-only">now </span>
              {formatCents(price.current.baseCents)}
            </span>
          ) : null}
          <span className="font-heading text-2xl tabular-nums text-strong">
            <span className="sr-only">{price.current ? "proposed " : ""}</span>
            {formatCents(price.baseCents)}
          </span>
          <span className="block text-[11px] text-muted-foreground">base per {per}</span>
        </p>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Service&apos;s price</dt>
          <dd className="text-strong">{price.catalog ? `${price.catalog.summary} (version ${price.catalog.version})` : "No live version"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Review or end</dt>
          <dd className="text-strong">{price.untilWords ?? "No date"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Cleaner time here</dt>
          <dd className="text-strong">{price.laborMinutes ? minutesWords(price.laborMinutes) : "The service's"}</dd>
        </div>
      </dl>
      {example && example.here !== null ? (
        <p className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          The service&apos;s example job: <span className="font-medium tabular-nums text-strong">{formatCents(example.here)}</span> here
          {example.usual !== null ? (
            <>
              {" "}
              and <span className="tabular-nums text-strong">{formatCents(example.usual)}</span> elsewhere
            </>
          ) : null}
          .
        </p>
      ) : null}
    </Panel>
  );
}

/** One thing approving does, as a checked line instead of a sentence in a paragraph. */
function Assurance({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-strong">
      <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-300" />
      <span>{children}</span>
    </li>
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
