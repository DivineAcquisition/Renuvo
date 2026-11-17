"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { AlertTriangle, CheckCircle2, Clock, Copy, HistoryIcon, Mail, MessageSquareText, Minus, Plus, RotateCcw, Users, Wallet } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { calendarDate, clientKey, moment, moneyInput, parseMoney, todayKey, usd } from "@/lib/app/finance";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { FinanceNav } from "./finance-screen";
import { Chip, Empty, Notice, eyebrow } from "./kit";

/**
 * Finance › Team Pay. Each cleaner's earnings per completed job, worked out by Selestial from their pay
 * method and the hours they worked, reviewed and approved by the Owner, then paid outside Selestial and
 * recorded here. Calculated, needs review, approved, payment started and paid are separate states.
 */

type Overview = FunctionReturnType<typeof api.teamPay.overview>;
type Row = Overview["rows"][number];
type Nav = FinanceNav & { set: (c: Record<string, string | null>, push?: boolean) => void; params: URLSearchParams };

const STATUS_TONE: Record<Row["status"], "muted" | "info" | "warning" | "success" | "progress" | "danger"> = {
  calculated: "info",
  needs_review: "warning",
  approved: "progress",
  payment_started: "progress",
  paid: "success",
  void: "muted",
};

const FILTERS = [
  { id: "review", label: "To review" },
  { id: "approved", label: "Approved, not paid" },
  { id: "started", label: "Payment started" },
  { id: "paid", label: "Paid" },
  { id: "all", label: "All" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

const PAY_METHODS = [
  { id: "zelle", label: "Zelle" },
  { id: "venmo", label: "Venmo" },
  { id: "cash", label: "Cash" },
  { id: "check", label: "Check" },
  { id: "bank_transfer", label: "Bank transfer" },
  { id: "payroll", label: "Through payroll" },
  { id: "other", label: "Other" },
] as const;

const hours = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
};

export function TeamPayTab({ nav }: { nav: Nav }) {
  const { companyId } = useCompany();
  const filter = (FILTERS.find((f) => f.id === nav.filter)?.id ?? "review") as Filter;
  const data = useQuery(api.teamPay.overview, { companyId, filter });
  const refresh = useMutation(api.teamPay.refresh);
  const [approveAll, setApproveAll] = useState(false);
  const [payFor, setPayFor] = useState<Id<"cleaners"> | null>(null);
  // Opening Team Pay brings every recent completed job's earnings up to date.
  useEffect(() => {
    void refresh({ companyId }).catch(() => undefined);
  }, [refresh, companyId]);
  const ready = useMemo(() => (data?.rows ?? []).filter((r) => r.status === "calculated" && r.bindsTo), [data]);
  if (!data) return <Skeleton className="h-96 rounded-2xl" />;
  const t = data.totals;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <section aria-label="Team pay summary" className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-card lg:grid-cols-4">
        {[
          { label: "To review", value: t.reviewCents, sub: `${data.counts.review} job${data.counts.review === 1 ? "" : "s"}${t.needsReview ? ` · ${t.needsReview} need${t.needsReview === 1 ? "s" : ""} a look` : ""}${t.reviewMissing ? ` · ${t.reviewMissing} can't be worked out yet` : ""}`, tone: t.needsReview ? "warning" : undefined, filter: "review" as const },
          { label: "Approved, not paid", value: t.approvedUnpaidCents, sub: `${data.owed.length} cleaner${data.owed.length === 1 ? "" : "s"} owed`, filter: "approved" as const },
          { label: "Payment started", value: t.startedCents, sub: `${data.counts.started} job${data.counts.started === 1 ? "" : "s"} · confirm when it arrives`, filter: "started" as const },
          { label: "Paid this month", value: t.paidThisMonthCents, sub: "Payments you confirmed", filter: "paid" as const },
        ].map((cell, i) => (
          <button
            key={cell.label}
            type="button"
            onClick={() => nav.set({ filter: cell.filter })}
            className={cn("px-4 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 sm:px-5", i % 2 === 1 && "border-l border-border", i >= 2 && "border-t border-border lg:border-t-0", i === 2 && "lg:border-l", filter === cell.filter && "bg-muted/40")}
          >
            <span className={eyebrow}>{cell.label}</span>
            <span className={cn("mt-2 block font-heading text-2xl leading-none tracking-tight tabular-nums sm:text-[1.7rem]", cell.tone === "warning" ? "text-warning-foreground" : "text-strong")}>{usd(cell.value)}</span>
            <span className="mt-2 block text-xs text-muted-foreground">{cell.sub}</span>
          </button>
        ))}
      </section>

      {data.hasEmployees ? (
        <Notice tone="info" title="Employees are paid through your payroll">
          For employees, Selestial records hours and gross pay for your payroll provider. It doesn&apos;t calculate or withhold taxes or file payroll.
        </Notice>
      ) : null}
      {data.noPay.length ? (
        <Notice tone="warning" title={`${data.noPay.length} cleaner${data.noPay.length === 1 ? " has" : "s have"} no pay set`} action={<Button size="xs" variant="outline" onClick={() => nav.set({ cleaner: data.noPay[0].id }, true)}>Set pay</Button>}>
          {data.noPay.map((c) => c.name).join(", ")}. Their jobs can&apos;t be worked out until you set how they&apos;re paid.
        </Notice>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Show" className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:px-0">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={filter === f.id}
                  onClick={() => nav.set({ filter: f.id === "review" ? null : f.id })}
                  className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-500", filter === f.id ? "border-brand-500/50 bg-brand-500/10 text-strong" : "border-border bg-card text-muted-foreground hover:text-strong")}
                >
                  {f.label}
                  <span className="text-xs tabular-nums text-muted-foreground">{data.counts[f.id]}</span>
                </button>
              ))}
            </div>
            {filter === "review" && ready.length > 1 ? (
              <Button size="sm" variant="default" className="ml-auto" onClick={() => setApproveAll(true)}>
                <CheckCircle2 aria-hidden />
                Approve {ready.length} ready
              </Button>
            ) : null}
          </div>
          <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-label="Earnings">
            {data.rows.length === 0 ? (
              <Empty icon={Users} title="Nothing here" body={filter === "review" ? "When a job is completed, each cleaner's pay for it appears here for you to review." : "No earnings in this state right now."} />
            ) : (
              <ul className="divide-y divide-border">
                {data.rows.map((row) => (
                  <li key={row.id}>
                    <button type="button" onClick={() => nav.set({ earning: row.id }, true)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 px-4 py-3.5 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_auto_6.5rem] sm:items-center sm:gap-4 sm:px-5">
                      <span className="order-1 min-w-0">
                        <span className="block truncate text-sm font-medium text-strong">{row.cleaner}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {row.service} · {row.day} · {row.customer}
                        </span>
                      </span>
                      <span className="order-3 line-clamp-2 min-w-0 text-xs text-muted-foreground sm:order-2">
                        {row.basis}
                        {row.method === "hourly" && row.minutesSource !== "worked" ? ` (${row.minutesSource} hours)` : ""}
                        {row.tipCents ? ` · tip ${usd(row.tipCents)}` : ""}
                      </span>
                      <span className="order-4 flex items-center justify-end gap-1.5 sm:order-3">
                        {row.flags.length ? <AlertTriangle className="size-4 text-warning-foreground" aria-label={`${row.flags.length} to check`} /> : null}
                        <Chip tone={STATUS_TONE[row.status]}>{row.statusWords}</Chip>
                      </span>
                      <span className="order-2 text-right text-sm font-semibold tabular-nums text-strong sm:order-4">{row.totalCents === null ? <span className="font-normal text-muted-foreground">Not worked out</span> : usd(row.totalCents)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="grid min-w-0 gap-4 lg:sticky lg:top-20">
          <section className="rounded-2xl border border-border bg-card" aria-labelledby="owed-title">
            <header className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Wallet className="size-4 text-muted-foreground" aria-hidden />
              <h2 id="owed-title" className="font-heading text-base tracking-tight text-strong">
                Owed to your team
              </h2>
            </header>
            {data.owed.length === 0 ? (
              <p className="px-4 py-5 text-sm text-muted-foreground">Nothing approved is waiting to be paid.</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.owed.map((o) => (
                  <li key={o.cleanerId} className="flex items-center gap-3 px-4 py-3">
                    <button type="button" onClick={() => nav.set({ cleaner: o.cleanerId }, true)} className="min-w-0 flex-1 text-left text-sm">
                      <span className="block truncate font-medium text-strong">{o.cleaner}</span>
                      <span className="text-xs text-muted-foreground">
                        {o.count} job{o.count === 1 ? "" : "s"}
                      </span>
                    </button>
                    <span className="text-sm font-semibold tabular-nums text-strong">{usd(o.cents)}</span>
                    <Button size="xs" variant="default" onClick={() => setPayFor(o.cleanerId)}>
                      Pay
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">
            Approving agrees the amount. It isn&apos;t a payment: pay the way you usually do, then record it. Paid means you confirmed it arrived.
          </p>
        </aside>
      </div>
      <ApproveAllDialog rows={ready} open={approveAll} onClose={() => setApproveAll(false)} />
      {payFor ? <PaymentDialog cleanerId={payFor} open onClose={() => setPayFor(null)} /> : null}
    </div>
  );
}

function ApproveAllDialog({ rows, open, onClose }: { rows: Row[]; open: boolean; onClose: () => void }) {
  const { companyId } = useCompany();
  const approveMany = useMutation(api.teamPay.approveMany);
  const { busy, error, run } = useRun();
  const [done, setDone] = useState<{ approved: number; total: number } | null>(null);
  const total = rows.reduce((s, r) => s + (r.totalCents ?? 0), 0);
  return (
    <Modal open={open} onClose={() => (setDone(null), onClose())} title={`Approve ${rows.length} jobs`} description="Only jobs with nothing to check are included. Approving agrees the amount; it isn't a payment.">
      {done ? (
        <div className="grid gap-3">
          <Notice tone="success" title={`${done.approved} of ${done.total} approved`}>Anything that changed since this list loaded was left for you to review.</Notice>
          <div className="flex justify-end">
            <Button onClick={() => (setDone(null), onClose())}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-strong">{r.cleaner}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.service} · {r.day} · {r.basis}
                  </span>
                </span>
                <span className="tabular-nums text-strong">{usd(r.totalCents ?? 0)}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">{usd(total)} in total.</p>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="default" disabled={busy || !rows.length} onClick={() => run(async () => {
              const result = await approveMany({ companyId, items: rows.map((r) => ({ earningId: r.id, bindsTo: r.bindsTo! })) });
              setDone({ approved: result.approved, total: rows.length });
            })}>
              Approve {usd(total)}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── One earning ──────────────────────────────────────────────────────────────────────────────────

export function EarningSheet({ earningId, onClose, onOpenCleaner }: { earningId: Id<"earnings"> | null; onClose: () => void; onOpenCleaner: (id: Id<"cleaners">) => void }) {
  return (
    <Sheet open={earningId !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetPopup side="right" className="max-w-xl bg-card">
        <SheetTitle className="sr-only">Earnings for a job</SheetTitle>
        <ScrollArea className="min-h-0 flex-1">{earningId ? <EarningBody key={earningId} earningId={earningId} onOpenCleaner={onOpenCleaner} /> : null}</ScrollArea>
      </SheetPopup>
    </Sheet>
  );
}

function EarningBody({ earningId, onOpenCleaner }: { earningId: Id<"earnings">; onOpenCleaner: (id: Id<"cleaners">) => void }) {
  const { companyId, timezone } = useCompany();
  const e = useQuery(api.teamPay.earning, { companyId, earningId });
  const approve = useMutation(api.teamPay.approve);
  const unapprove = useMutation(api.teamPay.unapprove);
  const recalculate = useMutation(api.teamPay.useCurrentPay);
  const reverse = useMutation(api.teamPay.reverseAdjustment);
  const { busy, error, run, setError } = useRun();
  const [dialog, setDialog] = useState<null | "hours" | "adjust" | "pay" | "tip">(null);
  const [reversing, setReversing] = useState<{ id: string; cents: number; reason: string } | null>(null);
  if (!e) return <div className="grid gap-3 p-6"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-48 w-full" /></div>;
  const frozen = e.status === "payment_started" || e.status === "paid";
  const canEdit = !frozen && e.status !== "void";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 px-5 pt-6 pb-10 sm:px-7">
      <header className="grid gap-2 pr-10">
        <div className="flex flex-wrap items-center gap-2">
          <span className={eyebrow}>Earnings · {e.day}</span>
          <Chip tone={STATUS_TONE[e.status]}>{e.statusWords}</Chip>
        </div>
        <button type="button" onClick={() => onOpenCleaner(e.cleanerId)} className="w-fit text-left font-heading text-2xl tracking-tight text-strong underline-offset-4 hover:underline">
          {e.cleaner}
        </button>
        <p className="text-sm text-muted-foreground">
          {e.service} for {e.customer} · {e.engagement === "employee" ? "Employee" : e.engagement === "subcontractor" ? "Through a subcontractor company" : "Contractor"}
        </p>
      </header>

      {e.flags.length ? (
        <Notice tone="warning" title="Check before approving">
          <ul className="grid gap-1">
            {e.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {e.voidReason ? <Notice tone="info" title="Set aside">{e.voidReason}</Notice> : null}

      <section aria-label="How it's worked out" className="rounded-2xl border border-border bg-muted/30 p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className={eyebrow}>{e.status === "paid" ? "Paid" : "Pay for this job"}</p>
            <p className="mt-1 font-heading text-4xl leading-none tracking-tight text-strong tabular-nums">{e.totalCents === null ? "—" : usd(e.totalCents)}</p>
          </div>
          {e.lateTipCents ? <Chip tone="warning">{usd(e.lateTipCents)} tip owed</Chip> : null}
        </div>
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">
            Base <span className="block text-xs">{e.basis}</span>
          </dt>
          <dd className="text-right tabular-nums text-strong">{e.baseCents === null ? "—" : usd(e.baseCents)}</dd>
          {e.adjustments.filter((a) => !a.reversed).map((a) => (
            <div key={a.id} className="contents">
              <dt className="text-muted-foreground">
                {a.cents > 0 ? "Added" : "Taken off"} <span className="block text-xs">{a.reason}</span>
              </dt>
              <dd className="flex items-center justify-end gap-2 tabular-nums text-strong">
                {usd(a.cents)}
                {canEdit ? (
                  <button type="button" aria-label={`Reverse the ${usd(a.cents)} adjustment`} className="rounded p-0.5 text-muted-foreground hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500" onClick={() => setReversing(a)}>
                    <RotateCcw className="size-3.5" aria-hidden />
                  </button>
                ) : null}
              </dd>
            </div>
          ))}
          {e.tipCents ? (
            <>
              <dt className="text-muted-foreground">Tips</dt>
              <dd className="text-right tabular-nums text-strong">{usd(e.tipCents)}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section aria-label="Hours" className="grid gap-2">
        <h3 className="text-sm font-semibold text-strong">Time on the job</h3>
        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border p-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Checked in</dt>
            <dd className="text-strong">{e.facts.checkInAt ? moment(e.facts.checkInAt, timezone, true) : "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Marked complete</dt>
            <dd className="text-strong">{e.facts.completedAt ? moment(e.facts.completedAt, timezone, true) : "Not recorded"}</dd>
          </div>
          {e.method === "hourly" ? (
            <div>
              <dt className="text-xs text-muted-foreground">Paid hours</dt>
              <dd className="text-strong">
                {hours(e.facts.paidMinutes)} <span className="text-xs text-muted-foreground">({e.facts.minutesSource === "worked" ? "worked" : e.facts.minutesSource === "corrected" ? "corrected" : "scheduled"}; {hours(e.facts.scheduledMinutes)} scheduled)</span>
              </dd>
            </div>
          ) : (
            <div>
              <dt className="text-xs text-muted-foreground">Time worked</dt>
              <dd className="text-strong">
                {e.facts.workedMinutes === null ? "Not recorded" : hours(e.facts.workedMinutes)} <span className="text-xs text-muted-foreground">({hours(e.facts.scheduledMinutes)} scheduled; pay doesn&apos;t depend on it)</span>
              </dd>
            </div>
          )}
        </dl>
        {e.hoursCorrection ? <p className="text-xs text-muted-foreground">You corrected the hours: {e.hoursCorrection.reason}</p> : null}
      </section>

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {e.status === "approved" ? (
            <>
              <Button variant="default" onClick={() => setDialog("pay")}>
                <Wallet aria-hidden />
                Record payment
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => run(() => unapprove({ companyId, earningId: e.id }))}>
                Undo approval
              </Button>
            </>
          ) : (
            <Button
              variant="default"
              disabled={busy || !e.bindsTo}
              onClick={() =>
                run(async () => {
                  const result = await approve({ companyId, earningId: e.id, bindsTo: e.bindsTo! });
                  if (!result.ok) setError(result.words);
                })
              }
            >
              <CheckCircle2 aria-hidden />
              Approve {e.totalCents === null ? "" : usd(e.totalCents)}
            </Button>
          )}
          <Button variant="outline" onClick={() => setDialog("adjust")}>
            <Plus aria-hidden />
            Adjust
          </Button>
          {e.method === "hourly" ? (
            <Button variant="outline" onClick={() => setDialog("hours")}>
              <Clock aria-hidden />
              Correct hours
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => setDialog("tip")}>
            Record a tip
          </Button>
          {e.payUsedDiffers ? (
            <Button variant="ghost" disabled={busy} onClick={() => run(() => recalculate({ companyId, earningId: e.id }))}>
              Use current pay ({e.currentPay})
            </Button>
          ) : null}
        </div>
      ) : e.lateTipCents ? (
        <Button variant="default" className="w-fit" onClick={() => setDialog("pay")}>
          Pay the {usd(e.lateTipCents)} tip
        </Button>
      ) : null}
      <FormError message={error} />

      {e.payment ? (
        <section aria-label="Payment" className="rounded-xl border border-border p-3 text-sm">
          <p className="font-medium text-strong">
            {e.payment.status === "paid" ? "Paid" : e.payment.status === "started" ? "Payment started" : "Payment canceled"} · {usd(e.payment.amountCents)} by {e.payment.method}
          </p>
          <p className="text-xs text-muted-foreground">
            {e.payment.paidOn ? `Paid ${calendarDate(e.payment.paidOn)}` : `Started ${moment(e.payment.startedAt, timezone)}`}
            {e.payment.reference ? ` · ${e.payment.reference}` : ""}
          </p>
          {e.payment.status === "started" ? <p className="mt-1 text-xs text-muted-foreground">Confirm it from {e.cleaner}&apos;s page when it arrives.</p> : null}
        </section>
      ) : null}
      {e.approved ? <p className="text-xs text-muted-foreground">Approved {usd(e.approved.totalCents)} by {e.approved.by} · {moment(e.approved.at, timezone, true)}</p> : null}
      {e.adjustments.some((a) => a.reversed) ? (
        <p className="text-xs text-muted-foreground">Reversed: {e.adjustments.filter((a) => a.reversed).map((a) => `${usd(a.cents)} (${a.reversed!.reason})`).join("; ")}</p>
      ) : null}
      {e.timeline.length ? (
        <section aria-label="History">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-strong">
            <HistoryIcon className="size-4 text-muted-foreground" aria-hidden />
            History
          </h3>
          <ol className="grid gap-1.5 text-sm">
            {e.timeline.map((row) => (
              <li key={row.id} className="flex justify-between gap-3">
                <span className="text-strong">{TIMELINE_WORDS[row.type] ?? "Updated"}</span>
                <span className="text-xs text-muted-foreground">
                  {row.amountCents !== null ? `${usd(row.amountCents)} · ` : ""}
                  {moment(row.at, timezone, true)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <HoursDialog open={dialog === "hours"} onClose={() => setDialog(null)} earningId={e.id} current={e.facts.paidMinutes} corrected={Boolean(e.hoursCorrection)} />
      <AdjustDialog open={dialog === "adjust"} onClose={() => setDialog(null)} earningId={e.id} />
      <TipDialog open={dialog === "tip"} onClose={() => setDialog(null)} jobId={e.jobId} />
      <ReasonDialog
        open={reversing !== null}
        onClose={() => setReversing(null)}
        title={reversing ? `Reverse the ${usd(reversing.cents)} adjustment` : "Reverse"}
        description={reversing ? `"${reversing.reason}". It stays in the history, marked reversed, with your reason.` : undefined}
        label="Why reverse it"
        action="Reverse it"
        onSubmit={(reason) => reverse({ companyId, earningId: e.id, adjustmentId: reversing!.id, reason })}
      />
      {dialog === "pay" ? <PaymentDialog cleanerId={e.cleanerId} preselect={[e.id]} open onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

const TIMELINE_WORDS: Record<string, string> = {
  "earning.calculated": "Worked out from the job",
  "earning.approved": "Approved",
  "earning.unapproved": "Approval undone",
  "earning.reopened": "Changed after approval",
  "earning.adjusted": "Adjusted",
  "earning.adjustment_reversed": "Adjustment reversed",
  "earning.hours_corrected": "Hours corrected",
  "earning.recalculated": "Worked out with current pay",
  "earning.voided": "Set aside",
};

function HoursDialog({ open, onClose, earningId, current, corrected }: { open: boolean; onClose: () => void; earningId: Id<"earnings">; current: number; corrected: boolean }) {
  const { companyId } = useCompany();
  const correct = useMutation(api.teamPay.correctHours);
  const { busy, error, run } = useRun();
  const [h, setH] = useState(String(Math.floor(current / 60)));
  const [m, setM] = useState(String(current % 60));
  const [reason, setReason] = useState("");
  const minutes = Number(h) * 60 + Number(m);
  return (
    <Modal open={open} onClose={onClose} title="Correct the hours" description="The cleaner's statement shows your correction and its reason.">
      <form className="grid gap-4" onSubmit={(event) => (event.preventDefault(), void run(async () => (await correct({ companyId, earningId, minutes, reason }), onClose())))}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hours">
            <TextInput type="number" min={0} max={16} value={h} onChange={(e) => setH(e.target.value)} />
          </Field>
          <Field label="Minutes">
            <TextInput type="number" min={0} max={59} value={m} onChange={(e) => setM(e.target.value)} />
          </Field>
        </div>
        <Field label="Why">
          <TextInput value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Forgot to mark complete; left at 2:15" />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          {corrected ? (
            <Button variant="ghost" disabled={busy} onClick={() => run(async () => (await correct({ companyId, earningId, minutes: null, reason: "" }), onClose()))}>
              Use recorded time
            </Button>
          ) : null}
          <Button type="submit" variant="default" disabled={busy || !reason.trim() || !Number.isFinite(minutes) || minutes < 1}>
            Save {hours(Number.isFinite(minutes) ? minutes : 0)}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AdjustDialog({ open, onClose, earningId }: { open: boolean; onClose: () => void; earningId: Id<"earnings"> }) {
  const { companyId } = useCompany();
  const add = useMutation(api.teamPay.addAdjustment);
  const { busy, error, run } = useRun();
  const [direction, setDirection] = useState<"add" | "take">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const cents = parseMoney(amount);
  return (
    <Modal open={open} onClose={onClose} title="Adjust pay for this job" description="Each adjustment keeps its reason, and the cleaner sees it on their statement.">
      <form className="grid gap-4" onSubmit={(event) => (event.preventDefault(), cents && void run(async () => (await add({ companyId, earningId, cents: direction === "add" ? cents : -cents, reason }), onClose())))}>
        <div role="radiogroup" className="grid grid-cols-2 gap-2">
          {(["add", "take"] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={direction === d} onClick={() => setDirection(d)} className={cn("inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm", direction === d ? "border-brand-500/60 bg-brand-500/8 text-strong" : "border-border text-muted-foreground")}>
              {d === "add" ? <Plus className="size-4" aria-hidden /> : <Minus className="size-4" aria-hidden />}
              {d === "add" ? "Add to pay" : "Take off pay"}
            </button>
          ))}
        </div>
        <Field label="Amount">
          <TextInput inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="15.00" />
        </Field>
        <Field label="Reason">
          <TextInput value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Stayed an extra 30 minutes for the oven" />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end">
          <Button type="submit" variant="default" disabled={busy || !cents || !reason.trim()}>
            {direction === "add" ? "Add" : "Take off"} {cents ? usd(cents) : ""}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TipDialog({ open, onClose, jobId }: { open: boolean; onClose: () => void; jobId: Id<"jobs"> }) {
  const { companyId } = useCompany();
  const record = useMutation(api.teamPay.recordTip);
  const { busy, error, run } = useRun();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const cents = parseMoney(amount);
  return (
    <Modal open={open} onClose={onClose} title="Record a tip" description="A tip the customer gave outside the pay page. All of it goes to this job's crew, split evenly.">
      <form className="grid gap-4" onSubmit={(event) => (event.preventDefault(), cents && void run(async () => (await record({ companyId, jobId, amountCents: cents, note: note || null, confirmedReceived: confirmed }), onClose())))}>
        <Field label="Tip">
          <TextInput inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="20.00" />
        </Field>
        <Field label="Note" hint="Optional">
          <TextInput value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Cash left on the counter" />
        </Field>
        <label className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-sm text-strong">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-4 accent-brand-500" />
          <span>The customer gave this tip for this job.</span>
        </label>
        <FormError message={error} />
        <div className="flex justify-end">
          <Button type="submit" variant="default" disabled={busy || !cents || !confirmed}>
            Record {cents ? usd(cents) : "tip"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Paying ───────────────────────────────────────────────────────────────────────────────────────

export function PaymentDialog({ cleanerId, preselect, open, onClose }: { cleanerId: Id<"cleaners">; preselect?: Id<"earnings">[]; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Record a payment" description="Selestial doesn't send this money. Pay the way you usually do, then record it here.">
      <PaymentForm cleanerId={cleanerId} preselect={preselect} onDone={onClose} />
    </Modal>
  );
}

function PaymentForm({ cleanerId, preselect, onDone }: { cleanerId: Id<"cleaners">; preselect?: Id<"earnings">[]; onDone: () => void }) {
  const { companyId, timezone } = useCompany();
  const data = useQuery(api.teamPay.cleaner, { companyId, cleanerId });
  const owed = (data?.rows ?? []).filter((r) => r.owedCents > 0);
  const [picked, setPicked] = useState<Id<"earnings">[] | null>(preselect ?? null);
  const chosen = picked ?? owed.map((r) => r.id);
  const preview = useQuery(api.teamPay.paymentPreview, chosen.length ? { companyId, cleanerId, earningIds: chosen } : "skip");
  const record = useMutation(api.teamPay.recordPayment);
  const { busy, error, run } = useRun();
  const [method, setMethod] = useState<(typeof PAY_METHODS)[number]["id"]>(data?.engagement === "employee" ? "payroll" : "zelle");
  const [stage, setStage] = useState<"paid" | "started">("paid");
  const [paidOn, setPaidOn] = useState(todayKey(timezone));
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [key] = useState(clientKey);
  if (!data) return <Skeleton className="h-48 rounded-xl" />;
  if (!owed.length) return <p className="text-sm text-muted-foreground">Nothing approved is waiting to be paid for {data.name}.</p>;
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!preview || preview.blocked) return;
        void run(async () => {
          await record({ companyId, cleanerId, earningIds: chosen, method, stage, paidOn: stage === "paid" ? paidOn : null, reference: reference || null, note: null, confirmedPaid: confirmed, bindsTo: preview.bindsTo, clientKey: key });
          onDone();
        });
      }}
    >
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-sm font-medium text-strong">Jobs this pays for · {data.name}</legend>
        <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {owed.map((r) => (
            <li key={r.id}>
              <label className="flex items-center gap-3 px-3 py-2 text-sm">
                <input type="checkbox" checked={chosen.includes(r.id)} onChange={(e) => setPicked(e.target.checked ? [...chosen, r.id] : chosen.filter((id) => id !== r.id))} className="size-4 accent-brand-500" />
                <span className="min-w-0 flex-1 truncate text-strong">
                  {r.service} · {r.day}
                  {r.lateTipCents ? <span className="text-muted-foreground"> · tip that came later</span> : null}
                </span>
                <span className="tabular-nums text-strong">{usd(r.owedCents)}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="How you paid">
          <SelectInput value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {PAY_METHODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Reference" hint="Optional: check number, confirmation">
          <TextInput value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
      <div role="radiogroup" aria-label="Where it stands" className="grid gap-2 sm:grid-cols-2">
        {(
          [
            { id: "paid", label: "It's paid", body: "The money reached them." },
            { id: "started", label: "Payment started", body: "On its way; confirm it later." },
          ] as const
        ).map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={stage === o.id} onClick={() => setStage(o.id)} className={cn("rounded-xl border p-3 text-left", stage === o.id ? "border-brand-500/60 bg-brand-500/8" : "border-border")}>
            <span className="block text-sm font-medium text-strong">{o.label}</span>
            <span className="block text-xs text-muted-foreground">{o.body}</span>
          </button>
        ))}
      </div>
      {stage === "paid" ? (
        <>
          <Field label="Day paid">
            <TextInput type="date" value={paidOn} max={todayKey(timezone)} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
          <label className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-sm text-strong">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-4 accent-brand-500" />
            <span>I paid {data.name} this amount. It isn&apos;t only scheduled or promised.</span>
          </label>
        </>
      ) : null}
      {preview ? (
        <ul className="grid gap-1 rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-sm text-strong">
          {preview.blocked ? <li className="text-destructive-foreground">{preview.blocked}</li> : preview.lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
      ) : null}
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="default" disabled={busy || !preview || Boolean(preview.blocked) || (stage === "paid" && !confirmed)}>
          {stage === "paid" ? `Record ${usd(preview?.totalCents ?? 0)} paid` : `Record ${usd(preview?.totalCents ?? 0)} started`}
        </Button>
      </div>
    </form>
  );
}

// ── One cleaner ──────────────────────────────────────────────────────────────────────────────────

export function CleanerSheet({ cleanerId, onClose, onOpenEarning }: { cleanerId: Id<"cleaners"> | null; onClose: () => void; onOpenEarning: (id: Id<"earnings">) => void }) {
  return (
    <Sheet open={cleanerId !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetPopup side="right" className="max-w-xl bg-card">
        <SheetTitle className="sr-only">Cleaner pay</SheetTitle>
        <ScrollArea className="min-h-0 flex-1">{cleanerId ? <CleanerBody key={cleanerId} cleanerId={cleanerId} onOpenEarning={onOpenEarning} /> : null}</ScrollArea>
      </SheetPopup>
    </Sheet>
  );
}

function CleanerBody({ cleanerId, onOpenEarning }: { cleanerId: Id<"cleaners">; onOpenEarning: (id: Id<"earnings">) => void }) {
  const { companyId, timezone } = useCompany();
  const c = useQuery(api.teamPay.cleaner, { companyId, cleanerId });
  const cancel = useMutation(api.teamPay.cancelPayment);
  const issue = useMutation(api.teamPay.issueStatement);
  const { error, run } = useRun();
  const [pay, setPay] = useState(false);
  const [confirming, setConfirming] = useState<CleanerPayment | null>(null);
  const [canceling, setCanceling] = useState<CleanerPayment | null>(null);
  const [send, setSend] = useState<null | "sms" | "email">(null);
  const [copied, setCopied] = useState(false);
  if (!c) return <div className="grid gap-3 p-6"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-48 w-full" /></div>;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 px-5 pt-6 pb-10 sm:px-7">
      <header className="pr-10">
        <p className={eyebrow}>{c.engagement === "employee" ? "Employee" : c.engagement === "subcontractor" ? "Through a subcontractor company" : "Contractor"}</p>
        <h2 className="mt-1 font-heading text-2xl tracking-tight text-strong">{c.name}</h2>
      </header>
      <PayMethod cleaner={c} />
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-muted/30 p-4">
        <div>
          <p className={eyebrow}>Approved, not paid</p>
          <p className="mt-1 font-heading text-3xl tracking-tight text-strong tabular-nums">{usd(c.owedCents)}</p>
        </div>
        {c.owedCents > 0 ? (
          <Button variant="default" onClick={() => setPay(true)}>
            <Wallet aria-hidden />
            Record payment
          </Button>
        ) : null}
      </section>

      <section aria-label="Statement" className="grid gap-2 rounded-2xl border border-border p-4">
        <h3 className="text-sm font-semibold text-strong">Earnings statement</h3>
        <p className="text-xs text-muted-foreground">A private page showing only {c.name.split(" ")[0]}&apos;s own jobs, pay and payments for the last 90 days.</p>
        {!c.statement.configured ? (
          <p className="text-sm text-muted-foreground">Private links aren&apos;t switched on for this deployment yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!c.channels.sms.address} onClick={() => setSend("sms")}>
              <MessageSquareText aria-hidden />
              Text it
            </Button>
            <Button size="sm" variant="outline" disabled={!c.channels.email.address} onClick={() => setSend("email")}>
              <Mail aria-hidden />
              Email it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run(async () => {
              const url = c.statement.url ?? (await issue({ companyId, cleanerId })).url;
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })}>
              <Copy aria-hidden />
              {copied ? "Copied" : "Copy link"}
            </Button>
            {c.statement.url ? (
              <Button size="sm" variant="ghost" onClick={() => run(() => issue({ companyId, cleanerId }))}>
                New link
              </Button>
            ) : null}
          </div>
        )}
        {c.statement.expiresAt ? <p className="text-xs text-muted-foreground">Current link works until {moment(c.statement.expiresAt, timezone)}. Making a new one closes it.</p> : null}
      </section>
      <FormError message={error} />

      {c.payments.length ? (
        <section aria-label="Payments" className="grid gap-2">
          <h3 className="text-sm font-semibold text-strong">Payments</h3>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {c.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium tabular-nums text-strong">{usd(p.amountCents)}</span> <span className="text-muted-foreground">· {p.method} · {p.jobs} job{p.jobs === 1 ? "" : "s"}</span>
                  <span className="block text-xs text-muted-foreground">
                    {p.status === "paid" ? `Paid ${calendarDate(p.paidOn)}` : p.status === "started" ? `Started ${moment(p.startedAt, timezone)}` : `Canceled: ${p.canceled}`}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </span>
                </span>
                {p.status === "started" ? (
                  <>
                    <Button size="xs" variant="default" onClick={() => setConfirming(p)}>
                      Confirm paid
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setCanceling(p)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Chip tone={p.status === "paid" ? "success" : "muted"}>{p.status === "paid" ? "Paid" : "Canceled"}</Chip>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Jobs" className="grid gap-2">
        <h3 className="text-sm font-semibold text-strong">Jobs, last 120 days</h3>
        {c.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No completed jobs yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {c.rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onOpenEarning(r.id)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm hover:bg-muted/40">
                  <span className="min-w-0 flex-1 truncate text-strong">
                    {r.service} · {r.day}
                  </span>
                  <Chip tone={STATUS_TONE[r.status]}>{r.statusWords}</Chip>
                  <span className="w-20 text-right tabular-nums text-strong">{r.totalCents === null ? "—" : usd(r.totalCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {pay ? <PaymentDialog cleanerId={c.id} open onClose={() => setPay(false)} /> : null}
      {send ? <SendStatementDialog cleanerId={c.id} channel={send} onClose={() => setSend(null)} /> : null}
      {confirming ? <ConfirmPaidDialog payment={confirming} cleaner={c.name} onClose={() => setConfirming(null)} /> : null}
      <ReasonDialog
        open={canceling !== null}
        onClose={() => setCanceling(null)}
        title={canceling ? `Cancel the ${usd(canceling.amountCents)} payment` : "Cancel payment"}
        description="For a payment that didn't go through. The jobs it covered go back to approved, not paid."
        label="What happened"
        action="Cancel the payment"
        onSubmit={(reason) => cancel({ companyId, paymentId: canceling!.id, reason })}
      />
    </div>
  );
}

type CleanerPayment = NonNullable<FunctionReturnType<typeof api.teamPay.cleaner>>["payments"][number];

function ConfirmPaidDialog({ payment, cleaner, onClose }: { payment: CleanerPayment; cleaner: string; onClose: () => void }) {
  const { companyId, timezone } = useCompany();
  const confirm = useMutation(api.teamPay.confirmPaid);
  const { busy, error, run } = useRun();
  const [paidOn, setPaidOn] = useState(todayKey(timezone));
  const [confirmed, setConfirmed] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Confirm ${usd(payment.amountCents)} was paid`} description={`Started ${moment(payment.startedAt, timezone)} by ${payment.method}${payment.reference ? ` · ${payment.reference}` : ""}.`}>
      <form className="grid gap-4" onSubmit={(event) => (event.preventDefault(), void run(async () => (await confirm({ companyId, paymentId: payment.id, paidOn, confirmedPaid: confirmed }), onClose())))}>
        <Field label="Day it arrived">
          <TextInput type="date" value={paidOn} max={todayKey(timezone)} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-sm text-strong">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-4 accent-brand-500" />
          <span>The money reached {cleaner}.</span>
        </label>
        <FormError message={error} />
        <div className="flex justify-end">
          <Button type="submit" variant="default" disabled={busy || !confirmed}>
            Mark paid
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ReasonDialog({ open, onClose, title, description, label, action, onSubmit }: { open: boolean; onClose: () => void; title: string; description?: string; label: string; action: string; onSubmit: (reason: string) => Promise<unknown> }) {
  const { busy, error, run } = useRun();
  const [reason, setReason] = useState("");
  return (
    <Modal open={open} onClose={() => (setReason(""), onClose())} title={title} description={description}>
      <form className="grid gap-4" onSubmit={(event) => (event.preventDefault(), void run(async () => (await onSubmit(reason.trim()), setReason(""), onClose())))}>
        <Field label={label}>
          <TextInput autoFocus value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button type="submit" variant="destructive" disabled={busy || !reason.trim()}>
            {action}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PayMethod({ cleaner }: { cleaner: NonNullable<FunctionReturnType<typeof api.teamPay.cleaner>> }) {
  if (cleaner.engagement === "subcontractor") {
    return (
      <p className="rounded-xl border border-border px-3.5 py-2.5 text-sm text-muted-foreground">
        Supplied by a subcontractor company. Their pay goes to that company, under its arrangement in Cleaners › Subcontractor companies.
      </p>
    );
  }
  return <PayMethodEditor cleaner={cleaner} />;
}

function PayMethodEditor({ cleaner }: { cleaner: NonNullable<FunctionReturnType<typeof api.teamPay.cleaner>> }) {
  const { companyId } = useCompany();
  const setPay = useMutation(api.cleaners.setPay);
  const { busy, error, run } = useRun();
  const [editing, setEditing] = useState(!cleaner.pay);
  const employee = cleaner.engagement === "employee";
  const initial = cleaner.pay;
  const [kind, setKind] = useState<"tier" | "share" | "fixed" | "hourly">(employee ? "hourly" : initial?.kind === "share" || initial?.kind === "fixed" ? initial.kind : cleaner.tiers.length ? "tier" : "share");
  const [tierId, setTierId] = useState(initial?.kind === "tier" ? initial.tierId : (cleaner.tiers[0]?.id ?? ""));
  const [percent, setPercent] = useState(initial?.kind === "share" ? String(initial.shareBps / 100) : "");
  const [amount, setAmount] = useState(initial?.kind === "fixed" ? moneyInput(initial.perJobCents) : initial?.kind === "hourly" ? moneyInput(initial.hourlyCents) : "");
  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5 text-sm">
        <span className="text-muted-foreground">
          Pay method: <span className="text-strong">{cleaner.payWords}</span>
        </span>
        <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
          Change
        </Button>
      </div>
    );
  }
  const save = () =>
    run(async () => {
      const pay =
        kind === "tier"
          ? { kind, tierId }
          : kind === "share"
            ? { kind, shareBps: Math.round(Number(percent) * 100) }
            : kind === "fixed"
              ? { kind, perJobCents: parseMoney(amount) ?? -1 }
              : { kind, hourlyCents: parseMoney(amount) ?? -1 };
      await setPay({ companyId, cleanerId: cleaner.id, pay });
      setEditing(false);
    });
  return (
    <section aria-label="Pay method" className="grid gap-3 rounded-xl border border-border p-3.5">
      <p className="text-sm font-medium text-strong">How {cleaner.name.split(" ")[0]} is paid</p>
      {employee ? (
        <Field label="Hourly rate">
          <TextInput inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="22.00" />
        </Field>
      ) : (
        <>
          <div role="radiogroup" className="flex flex-wrap gap-2">
            {(
              [
                { id: "tier", label: "Pay tier", disabled: cleaner.tiers.length === 0 },
                { id: "share", label: "Their own %" },
                { id: "fixed", label: "Fixed per job" },
              ] as const
            ).map((o) => (
              <button key={o.id} type="button" role="radio" aria-checked={kind === o.id} disabled={"disabled" in o && o.disabled} onClick={() => setKind(o.id)} className={cn("rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50", kind === o.id ? "border-brand-500/60 bg-brand-500/8 text-strong" : "border-border text-muted-foreground")}>
                {o.label}
              </button>
            ))}
          </div>
          {kind === "tier" ? (
            <Field label="Tier" hint="Edit tiers in Payments setup">
              <SelectInput value={tierId} onChange={(e) => setTierId(e.target.value)}>
                {cleaner.tiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.shareBps / 100}%
                  </option>
                ))}
              </SelectInput>
            </Field>
          ) : kind === "share" ? (
            <Field label="Share of each job" hint="Of the job price before tax">
              <TextInput inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="40" />
            </Field>
          ) : (
            <Field label="Amount per job">
              <TextInput inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="90.00" />
            </Field>
          )}
        </>
      )}
      <p className="text-xs text-muted-foreground">Jobs already worked keep the pay they were worked out with.</p>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        {cleaner.pay ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        ) : null}
        <Button size="sm" variant="default" disabled={busy} onClick={save}>
          Save pay method
        </Button>
      </div>
    </section>
  );
}

function SendStatementDialog({ cleanerId, channel, onClose }: { cleanerId: Id<"cleaners">; channel: "sms" | "email"; onClose: () => void }) {
  const { companyId } = useCompany();
  const preview = useQuery(api.teamPay.statementPreview, { companyId, cleanerId, channel });
  const send = useMutation(api.teamPay.sendStatement);
  const { busy, error, run } = useRun();
  const [result, setResult] = useState<{ status: string; problem: string | null } | null>(null);
  return (
    <Modal open onClose={onClose} title={channel === "sms" ? "Text the statement link" : "Email the statement link"} description="This is exactly what will be sent. The link is made when it goes, and only opens their own statement.">
      {!preview ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : result ? (
        <div className="grid gap-3">
          <Notice tone={result.status === "not_sent" ? "warning" : "success"} title={result.status === "not_sent" ? "Not sent" : result.status === "held" ? "Scheduled" : "Sending"}>
            {result.problem ?? "It's on its way."}
          </Notice>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">To {preview.to ?? "no address on file"}</p>
          <div className="rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-sm whitespace-pre-line text-strong">
            {preview.subject ? <p className="mb-2 font-medium">{preview.subject}</p> : null}
            {preview.preview}
          </div>
          {!preview.canSend.ok ? <Notice tone="warning" title="Can't send this yet">{preview.canSend.words}</Notice> : null}
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="default" disabled={busy || !preview.canSend.ok} onClick={() => run(async () => setResult(await send({ companyId, cleanerId, channel, bindsTo: preview.bindsTo })))}>
              Approve and send
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
