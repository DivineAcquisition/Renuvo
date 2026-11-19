"use client";

/**
 * Continuity & Renewals: each recurring service with its service status and its billing stated
 * separately, the mismatches the records show, and each customer agreement with its real dates. A plan
 * change is always previewed first: the visits it cancels, future dates, billing and credits.
 */
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { canManage, useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { AlertTriangle, Copy } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useStableQuery } from "@/lib/app/stable-query";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { CaseDrawer } from "./drawer";
import { CaseCardView, Empty, Flag, NotConnected, useCaseParam } from "./shared";

type Plans = FunctionReturnType<typeof api.retentionAgent.continuity>;
type PlanRow = Plans["plans"][number];
type Change = "skip_visit" | "reschedule_visit" | "change_cadence" | "pause_service" | "pause_billing" | "resume" | "end_service";

const CHANGES: { id: Change; label: string; hint: string }[] = [
  { id: "skip_visit", label: "Skip one visit", hint: "The next visit only. The rest of the schedule is unchanged." },
  { id: "reschedule_visit", label: "Move one visit", hint: "A request to Dispatch. Nothing moves until a new time is confirmed." },
  { id: "change_cadence", label: "Change how often", hint: "A request to the Owner, because the price can change with the schedule." },
  { id: "pause_service", label: "Pause service", hint: "Cancels the visits in the pause. It does not pause billing." },
  { id: "pause_billing", label: "Pause billing", hint: "A request to the Owner about what is due. It does not pause service." },
  { id: "resume", label: "Resume service", hint: "Books visits again from today." },
  { id: "end_service", label: "End service", hint: "Cancels every visit from the end date." },
];

function ChangePlan({ row, onClose, onCase }: { row: PlanRow; onClose: () => void; onCase: (id: string) => void }) {
  const { companyId } = useCompany();
  const [change, setChange] = useState<Change>(row.servicePaused ? "resume" : "skip_visit");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [cadence, setCadence] = useState("");
  const [reason, setReason] = useState("");
  const [told, setTold] = useState<string | null>(null);
  const preview = useQuery(api.retentionAgent.planPreview, { companyId, plan: row.plan, change, ...(from ? { from } : {}), ...(until ? { until } : {}), ...(cadence ? { cadence } : {}) });
  const request = useMutation(api.retentionAgent.requestChange);
  const { busy, error, run } = useRun();
  const TOPIC: Record<string, string> = { bookings: "Booked visits", future: "Future dates", billing: "Billing", credits: "Credits" };
  return (
    <Modal open onClose={onClose} title={`${row.customer} · ${row.property}`} description="Choose the change, read what it does, then confirm. Nothing changes until you confirm.">
      <div className="grid gap-4">
        <Field label="Change" hint={CHANGES.find((c) => c.id === change)?.hint}>
          <SelectInput value={change} onChange={(event) => (setChange(event.target.value as Change), setTold(null))}>
            {CHANGES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        {change === "pause_service" || change === "end_service" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={change === "end_service" ? "Ends on" : "Pause from"} hint="Leave empty for today.">
              <TextInput type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            {change === "pause_service" ? (
              <Field label="Resumes on" hint="Leave empty to pause until resumed.">
                <TextInput type="date" value={until} onChange={(event) => setUntil(event.target.value)} />
              </Field>
            ) : null}
          </div>
        ) : null}
        {change === "change_cadence" ? (
          <Field label="New schedule asked for">
            <TextInput placeholder="For example: every 2 weeks" value={cadence} onChange={(event) => setCadence(event.target.value)} />
          </Field>
        ) : null}
        <Field label="Reason">
          <TextInput value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <section aria-label="What this change does" className="rounded-xl border border-border bg-background p-4">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">What this does</p>
          {preview === undefined ? (
            <Skeleton className="mt-2 h-24 rounded-lg" />
          ) : preview === null ? (
            <p className="mt-2 text-sm text-muted-foreground">That plan was not found.</p>
          ) : preview.blocked ? (
            <p className="mt-2 flex items-start gap-2 text-sm font-medium text-warning-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {preview.blocked}
            </p>
          ) : (
            <>
              <dl className="mt-2 grid gap-2.5">
                {preview.consequences.map((line) => (
                  <div key={line.topic} className="grid gap-0.5 sm:grid-cols-[7rem_1fr] sm:gap-3">
                    <dt className="text-xs font-semibold text-strong">{TOPIC[line.topic]}</dt>
                    <dd className={cn("text-sm leading-relaxed", line.topic === "billing" ? "font-medium text-strong" : "text-foreground")}>{line.text}</dd>
                  </div>
                ))}
              </dl>
              {preview.visits.length ? (
                <ul className="mt-3 grid gap-1 border-t border-border pt-3 text-sm text-foreground">
                  {preview.visits.map((visit) => (
                    <li key={visit.jobId}>
                      {visit.when} · {visit.service}
                    </li>
                  ))}
                </ul>
              ) : null}
              {preview.needsPerson ? <p className="mt-3 text-xs text-muted-foreground">This is recorded as a request and handed to the person who decides it. Nothing changes until they do.</p> : null}
            </>
          )}
        </section>
        {told ? <p className="text-sm font-medium text-strong" role="status">{told}</p> : null}
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant={change === "end_service" ? "destructive" : "primary"}
            loading={busy}
            disabled={!preview || preview.blocked !== null || told !== null}
            onClick={() =>
              void run(async () => {
                const result = await request({ companyId, plan: row.plan, change, shown: preview!.shown as Id<"jobs">[], ...(from ? { from } : {}), ...(until ? { until } : {}), ...(cadence ? { cadence } : {}), ...(reason ? { reason } : {}) });
                setTold(result.words);
                if (result.caseId && result.status !== "done") onCase(result.caseId);
              })
            }
          >
            Confirm: {CHANGES.find((c) => c.id === change)?.label.toLowerCase()}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ShareLink({ row }: { row: PlanRow }) {
  const { companyId } = useCompany();
  const share = useMutation(api.retentionAgent.shareLink);
  const { busy, error, run } = useRun();
  const [url, setUrl] = useState<string | null>(null);
  return (
    <span className="grid gap-1">
      <Button size="xs" variant="ghost" loading={busy} onClick={() => void run(async () => setUrl((await share({ companyId, customerId: row.customerId, purpose: "manage", plan: row.plan })).url))} title="A private page where the customer can skip, pause, resume or end this service themselves">
        <Copy aria-hidden />
        Customer link
      </Button>
      {url ? <input readOnly aria-label="The customer's private link" value={url} onFocus={(event) => event.currentTarget.select()} className="w-56 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-strong" /> : null}
      {error ? <span className="text-[11px] text-destructive-foreground">{error}</span> : null}
    </span>
  );
}

export function RetentionContinuityScreen() {
  const { companyId, timezone, role } = useCompany();
  const now = useNow();
  const { openId, open, close } = useCaseParam();
  const data = useStableQuery(api.retentionAgent.continuity, now ? { companyId, asOf: now } : "skip");
  const requests = useStableQuery(api.retentionAgent.cases, now ? { companyId, asOf: now, view: "continuity" } : "skip");
  const renewalCases = useStableQuery(api.retentionAgent.cases, now ? { companyId, asOf: now, view: "renewals" } : "skip");
  const fromSignal = useMutation(api.retentionAgent.caseFromSignal);
  const { error, run } = useRun();
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const signals = useStableQuery(api.retentionAgent.signals, now ? { companyId, asOf: now } : "skip");
  return (
    <>
      <PageHeader title="Continuity & Renewals" lead="Each recurring service, its booked visits and its billing, checked against each other. Service and billing are separate: pausing one never pauses the other." />
      <FormError message={error} />
      <div className="grid gap-5">
        {requests?.length ? (
          <Panel title={`Requests under way · ${requests.length}`}>
            <div className="grid gap-3">
              {requests.map((card) => (
                <CaseCardView key={card.caseId} card={card} now={now} timezone={timezone} onOpen={open} />
              ))}
            </div>
          </Panel>
        ) : null}
        <Panel title={`Recurring services · ${data?.plans.length ?? 0}`}>
          {!data ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : data.plans.length ? (
            <ul className="grid gap-3">
              {data.plans.map((row) => (
                <li key={row.plan.id} className={cn("grid gap-3 rounded-2xl border bg-card p-4 sm:p-5", row.mismatches.length ? "border-warning/40" : "border-border")}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-strong">{row.customer}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.property} · {row.cadence}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-start gap-2">
                      {canManage(role) ? (
                        <>
                          <ShareLink row={row} />
                          <Button size="xs" variant="outline" disabled={!row.recurring} onClick={() => setEditing(row)}>
                            Change
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <dl className="grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Service</dt>
                      <dd className="mt-0.5 font-medium text-strong">{row.service}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Next visit</dt>
                      <dd className="mt-0.5 text-strong">{row.nextVisit}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Billing</dt>
                      <dd className="mt-0.5 text-foreground">{row.billing}</dd>
                    </div>
                  </dl>
                  {row.mismatches.map((mismatch) => (
                    <div key={mismatch.signalId} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3">
                      <p className="min-w-0 flex-1 text-sm text-strong">
                        <span className="font-semibold">{mismatch.kindWords}. </span>
                        {mismatch.what}
                      </p>
                      {canManage(role) ? (
                        <Button size="xs" variant="outline" onClick={() => void run(async () => open((await fromSignal({ companyId, signalId: mismatch.signalId })).caseId))}>
                          Follow this through
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No recurring service is running" body="Recurring services set up in Clients & Properties or booked through Sales appear here, each checked against its booked visits and what is still due." />
          )}
        </Panel>

        {(signals ?? []).some((s) => s.status === "open" && (s.kind === "paid_without_service" || s.kind === "invoice_dispute" || s.kind === "cancel_request" || s.kind === "reduce_request")) ? (
          <Panel title="Payments and requests that need a look">
            <ul className="grid gap-2">
              {(signals ?? [])
                .filter((s) => s.status === "open" && (s.kind === "paid_without_service" || s.kind === "invoice_dispute" || s.kind === "cancel_request" || s.kind === "reduce_request"))
                .map((signal) => (
                  <li key={signal.signalId} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-warning/40 bg-background px-3.5 py-3">
                    <p className="min-w-0 flex-1 text-sm text-strong">
                      <span className="font-semibold">
                        {signal.customer} · {signal.kindWords}.{" "}
                      </span>
                      {signal.what}
                      <span className="mt-1 block text-xs text-muted-foreground">{signal.suggestedAction}</span>
                    </p>
                    {canManage(role) ? (
                      <Button size="xs" variant="outline" onClick={() => void run(async () => open((await fromSignal({ companyId, signalId: signal.signalId as Id<"retentionSignals"> })).caseId))}>
                        Follow this through
                      </Button>
                    ) : null}
                  </li>
                ))}
            </ul>
          </Panel>
        ) : null}

        <Panel title={`Agreements and renewals · ${data?.renewals.length ?? 0}`}>
          {!data ? (
            <Skeleton className="h-32 rounded-xl" />
          ) : data.renewals.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <caption className="sr-only">Customer agreements with their end of term and notice dates</caption>
                <thead className="text-[11px] tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">Customer and agreement</th>
                    <th className="py-2 pr-3 font-semibold">Term</th>
                    <th className="py-2 pr-3 font-semibold">Notice due by</th>
                    <th className="py-2 font-semibold">Renewal</th>
                  </tr>
                </thead>
                <tbody>
                  {data.renewals.map((row) => (
                    <tr key={row.agreementId} className="border-t border-border align-top">
                      <td className="py-3 pr-3">
                        <span className="block font-semibold text-strong">{row.customer || "Customer"}</span>
                        <span className="block text-xs text-muted-foreground">{row.title}</span>
                      </td>
                      <td className="py-3 pr-3 text-strong">{row.words}</td>
                      <td className={cn("py-3 pr-3", row.noticePassed ? "font-medium text-destructive-foreground" : "text-strong")}>{row.noticeBy ? `${row.noticeBy}${row.noticePassed ? " (passed)" : ""}` : <span className="text-muted-foreground">Not recorded on the agreement</span>}</td>
                      <td className="py-3">
                        {row.caseId ? (
                          <Button size="xs" variant="outline" onClick={() => open(row.caseId!)}>
                            {row.caseStatus}
                          </Button>
                        ) : row.due ? (
                          <Flag tone="warn">Due soon</Flag>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not yet due</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No customer agreement has an end of term on record" body="A signed customer agreement with a renewal or expiry date appears here with its notice deadline. Selestial prepares the service review and never renews an agreement itself." />
          )}
          {renewalCases?.length ? <p className="mt-3 text-xs text-muted-foreground">{renewalCases.length === 1 ? "One renewal decision is" : `${renewalCases.length} renewal decisions are`} open. Each tracks the account and every site separately.</p> : null}
        </Panel>

        {data ? (
          <Panel title="What these checks cannot see">
            <NotConnected items={data.missing} />
          </Panel>
        ) : null}
      </div>
      {editing ? <ChangePlan row={editing} onClose={() => setEditing(null)} onCase={open} /> : null}
      <CaseDrawer id={openId} onClose={close} />
    </>
  );
}
