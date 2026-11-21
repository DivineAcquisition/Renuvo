"use client";

/**
 * One retention case, in the order a person needs it: what happened, what Selestial is doing and what
 * needs them; the relationship and the property; the evidence, each statement marked as a fact, the
 * customer's words or a hypothesis; the diagnosis with what is not known; the proposed action with its
 * approval and cost; work with other agents; verification; and the outcome.
 *
 * A customer's words are shown as plain text and nothing else. The buttons under "Ask Retention" run
 * Retention's real tools, and each result is kept on the case.
 */
import { useMutation } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useChat, useOfferChatContext } from "@/components/app/chat/chat-context";
import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { useNow } from "@/components/app/use-now";
import { AlertTriangle, ArrowUpRight, ChatIcon, CheckCircle2, Hand, ShieldCheck, Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { centsFrom, money, until, whenLabel, zonedInstant } from "@/lib/app/format";
import { useStableQuery } from "@/lib/app/stable-query";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { BasisTag, Flag, StatusPill, type ActionRow, type Detail, type Entry } from "./shared";
import { Checkbox } from "@/components/ui/selection";
import { DurationField, MoneyField } from "@/components/ui/fields";

const TOOLS = [
  { id: "explain_attention", label: "Explain why this needs attention" },
  { id: "prepare_recovery_plan", label: "Prepare a recovery plan" },
  { id: "show_original_scope", label: "Show the original scope" },
  { id: "find_correction_visit", label: "Find an available correction visit" },
  { id: "draft_response", label: "Draft a response" },
  { id: "review_after_correction", label: "Review what happened after the correction" },
] as const;

const ACTION_STATE: Record<ActionRow["status"], string> = {
  proposed: "Prepared, not sent anywhere",
  awaiting_approval: "Waiting for approval",
  underway: "Under way",
  done: "Done",
  declined: "Not approved",
  failed: "Did not go through",
  cancelled: "Set aside",
  blocked: "Not carried out",
};

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-border px-5 py-5 first:border-t-0 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** What someone outside the company wrote, as text only. */
function Quote({ children }: { children: string }) {
  return <blockquote className="rounded-lg border-l-2 border-brand-500/50 bg-muted/60 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-foreground">{children}</blockquote>;
}

function Timeline({ entries, now, timezone }: { entries: Entry[]; now: number; timezone: string }) {
  const KIND: Record<Entry["kind"], string> = { evidence: "Evidence", diagnosis: "Diagnosis", action: "Action", handoff: "Handoff", verification: "Verification", outcome: "Outcome", note: "Note", agent: "Retention" };
  return (
    <ol className="grid gap-3">
      {entries.map((entry) => (
        <li key={entry.id} className="grid gap-1.5 sm:grid-cols-[6.5rem_1fr] sm:gap-3">
          <span className="text-xs text-muted-foreground">
            <span className="block font-medium text-strong">{KIND[entry.kind]}</span>
            {whenLabel(entry.at, now, timezone)}
          </span>
          <span className="grid gap-1.5">
            <span className="flex flex-wrap items-start gap-2 text-sm leading-relaxed text-foreground">
              {entry.basis ? <BasisTag basis={entry.basis} /> : null}
              <span className="min-w-0 flex-1">{entry.text}</span>
            </span>
            {entry.quote ? <Quote>{entry.quote}</Quote> : null}
            <span className="text-[11px] text-muted-foreground">
              {entry.by}
              {entry.source ? ` · source: ${entry.source.label}` : ""}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function ActionCard({ action, detail, now, timezone }: { action: ActionRow; detail: Detail; now: number; timezone: string }) {
  const { companyId } = useCompany();
  const decide = useMutation(api.approvals.decide);
  const submit = useMutation(api.retentionAgent.submit);
  const discard = useMutation(api.retentionAgent.discard);
  const setPay = useMutation(api.retentionAgent.setCorrectionPay);
  const { busy, error, run } = useRun();
  const [body, setBody] = useState(action.message?.body ?? "");
  const [pay, setPayText] = useState("");
  // What the crew is paid for a correction is the Owner's decision each time; it is never filled in for them.
  const needsPay = action.kind === "correction_visit" && action.status === "proposed" && action.visit?.payBasisCents === null;
  const [told, setTold] = useState<string | null>(null);
  const live = action.status === "proposed" || action.status === "awaiting_approval" || action.status === "underway";
  const mayApprove = detail.can.manage && (!action.permission.ownerOnly || detail.can.owner);
  const approve = (decision: "approved" | "skipped") =>
    run(async () => {
      const result = await decide({ companyId, approvalId: action.approval!.approvalId, decision });
      setTold(result.carriedOut?.detail ?? (decision === "skipped" ? "Skipped." : "Recorded."));
    });
  return (
    <li className={cn("grid gap-3 rounded-xl border bg-background p-4", action.status === "awaiting_approval" ? "border-warning/50" : "border-border")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{action.kindWords}</p>
          <p className="text-sm font-semibold text-strong">{action.summary}</p>
        </div>
        <Flag tone={action.status === "awaiting_approval" ? "warn" : action.status === "failed" || action.status === "blocked" ? "danger" : "neutral"}>{ACTION_STATE[action.status]}</Flag>
      </div>
      <p className="text-sm leading-relaxed text-foreground">{action.reason}</p>
      {action.message ? (
        action.status === "proposed" && detail.can.manage ? (
          <Field label={`The ${action.message.channel === "sms" ? "text" : "email"} to the customer`} hint={action.message.hasLink ? "{link} is replaced by the customer's private link when it is sent." : "Edit it if you wish. Approval is of exactly these words."}>
            <TextArea rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
          </Field>
        ) : (
          <Quote>{action.message.body}</Quote>
        )
      ) : null}
      <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
        {action.visit?.when ? (
          <div>
            <dt className="text-muted-foreground">When</dt>
            <dd className="font-medium text-strong">
              {action.visit.when} · {action.visit.minutes} minutes
            </dd>
          </div>
        ) : null}
        {action.visit && action.kind === "correction_visit" ? (
          <div>
            <dt className="text-muted-foreground">Customer is charged</dt>
            <dd className="font-medium text-strong">Nothing{action.visit.payBasisCents !== null ? `. Crew pay is worked out from ${money(action.visit.payBasisCents)}, set by the Owner` : ". Crew pay is not set yet"}</dd>
          </div>
        ) : null}
        {action.money ? (
          <div>
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="font-medium text-strong">{money(action.money.amountCents)}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-muted-foreground">Estimated cost</dt>
          <dd className="font-medium text-strong">{action.estimatedCostCents !== null ? money(action.estimatedCostCents) : "No reliable estimate"}</dd>
        </div>
        {action.actualCostCents !== null ? (
          <div>
            <dt className="text-muted-foreground">Actual cost</dt>
            <dd className="font-medium text-strong">{money(action.actualCostCents)}</dd>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Permission</dt>
          <dd className="text-strong">
            {action.permission.label}
            {action.permission.ownerOnly ? " (the Owner decides)" : ""}
          </dd>
        </div>
      </dl>
      {action.costBasis ? <p className="text-xs leading-relaxed text-muted-foreground">{action.costBasis}</p> : null}
      {action.handoff ? (
        <div className="rounded-lg border border-border bg-card px-3 py-2.5 text-xs">
          <p className="font-medium text-strong">
            With {action.handoff.toWords} · {action.handoff.status === "open" ? "not back yet" : action.handoff.status === "returned" ? "returned" : "did not happen"}
          </p>
          <p className="mt-0.5 text-muted-foreground">Expected back: {action.handoff.expected}</p>
          {action.handoff.result ? <p className="mt-0.5 text-strong">{action.handoff.result}</p> : null}
        </div>
      ) : null}
      {action.delivery ? <p className={cn("text-xs", action.delivery.state === "failed" || action.delivery.state === "not_sent" ? "font-medium text-destructive-foreground" : "text-muted-foreground")}>Message: {action.delivery.words}</p> : null}
      {action.result && !action.handoff ? <p className="text-xs text-muted-foreground">{action.result}</p> : null}
      {action.stale && live ? (
        <p className="flex items-start gap-1.5 text-xs font-medium text-warning-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Something this was prepared against has changed since. It will not be carried out as it stands.
        </p>
      ) : null}
      {action.status === "awaiting_approval" && action.approval ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {mayApprove ? (
            <>
              <Button size="sm" variant="primary" loading={busy} onClick={() => void approve("approved")}>
                Approve and carry out
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void approve("skipped")}>
                Do not do this
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{action.permission.ownerOnly ? "Only the Owner approves this." : "An Owner or Manager approves this."}</p>
          )}
          <span className="ml-auto text-xs text-muted-foreground">Decide {until(action.approval.decideBy, now).text}</span>
        </div>
      ) : null}
      {needsPay ? (
        <div className="grid gap-3 border-t border-border pt-3">
          {detail.can.owner ? (
            <>
              <Field
                label="Crew pay for this visit is worked out from"
                hint={`Used the way the price is on a paid visit: each cleaner's pay for the correction comes from this amount. The customer is charged nothing.${action.visit?.payHintCents ? ` For reference, the original price in proportion to the time is ${money(action.visit.payHintCents)}.` : ""}`}
              >
                <MoneyField placeholder="0.00" value={pay} onChange={(text) => setPayText(text)} />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy}
                  disabled={centsFrom(pay) === null}
                  onClick={() => void run(async () => setTold((await setPay({ companyId, actionId: action.actionId as Id<"retentionActions">, payBasisCents: centsFrom(pay) ?? 0 })).detail))}
                >
                  Set pay and book the visit
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => discard({ companyId, actionId: action.actionId as Id<"retentionActions"> }))}>
                  Set aside
                </Button>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">The Owner sets what the crew is paid for each correction visit. It is booked once that is set.</p>
          )}
        </div>
      ) : null}
      {action.status === "proposed" && detail.can.manage && !needsPay ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button size="sm" variant="primary" loading={busy} onClick={() => void run(async () => setTold((await submit({ companyId, actionId: action.actionId as Id<"retentionActions">, ...(action.message && body !== action.message.body ? { body } : {}) })).detail))}>
            Submit
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => discard({ companyId, actionId: action.actionId as Id<"retentionActions"> }))}>
            Set aside
          </Button>
          <span className="text-xs text-muted-foreground">Submitting routes it by your permission settings: it is carried out, or it goes to Approvals.</span>
        </div>
      ) : null}
      {told ? <p className="text-xs font-medium text-strong" role="status">{told}</p> : null}
      <FormError message={error} />
      <p className="text-[11px] text-muted-foreground">Prepared {whenLabel(action.createdAt, now, timezone)}</p>
    </li>
  );
}

/** A person proposes a remedy. Proposing is not approving: it is routed like any other. */
function ProposeRemedy({ detail, timezone }: { detail: Detail; timezone: string }) {
  const { companyId } = useCompany();
  const propose = useMutation(api.retentionAgent.proposeRemedy);
  const { busy, error, run } = useRun();
  const [kind, setKind] = useState<"correction_visit" | "credit" | "refund" | "inspection" | "message" | "different_cleaner">("correction_visit");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [minutes, setMinutes] = useState("60");
  const [amount, setAmount] = useState("");
  const [invoice, setInvoice] = useState("");
  const [body, setBody] = useState("");
  const [avoid, setAvoid] = useState("");
  const [ask, setAsk] = useState(false);
  const [crewPay, setCrewPay] = useState("");
  const [told, setTold] = useState<string | null>(null);
  const caseId = detail.card.caseId as Id<"retentionCases">;
  const send = () =>
    run(async () => {
      const startsAt = kind === "correction_visit" ? zonedInstant(date, time, timezone) : null;
      const result = await propose({
        companyId,
        caseId,
        kind,
        reason,
        ...(kind === "correction_visit" ? { startsAt: startsAt ?? 0, minutes: Number(minutes), askCustomerFirst: ask, ...(detail.can.owner && centsFrom(crewPay) !== null ? { payBasisCents: centsFrom(crewPay)! } : {}) } : {}),
        ...(kind === "credit" || kind === "refund" ? { amountCents: centsFrom(amount) ?? 0, ...(invoice ? { invoiceId: invoice as Id<"invoices"> } : {}) } : {}),
        ...(kind === "message" ? { body } : {}),
        ...(kind === "different_cleaner" && avoid ? { avoidCleanerIds: [avoid as Id<"cleaners">] } : {}),
      });
      setTold(result.detail);
      setReason("");
    });
  return (
    <details className="rounded-xl border border-border bg-background">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-strong">Propose a different step</summary>
      <div className="grid gap-3 border-t border-border p-4">
        <Field label="What">
          <SelectInput value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="correction_visit">Correction visit, at no charge</option>
            <option value="inspection">Inspection</option>
            <option value="different_cleaner">Different cleaner</option>
            <option value="credit">Credit on an invoice</option>
            <option value="refund">Refund</option>
            <option value="message">Message to the customer</option>
          </SelectInput>
        </Field>
        {kind === "correction_visit" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Day">
                <TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </Field>
              <Field label="Start">
                <TextInput type="time" value={time} onChange={(event) => setTime(event.target.value)} />
              </Field>
              <Field label="Minutes">
                <DurationField value={minutes} onChange={(text) => setMinutes(text)} stepper />
              </Field>
            </div>
            {detail.can.owner ? (
              <Field label="Crew pay is worked out from" hint="Your decision for this visit. Leave it empty to set it later; the visit is not booked until it is set.">
                <MoneyField placeholder="0.00" value={crewPay} onChange={(text) => setCrewPay(text)} />
              </Field>
            ) : (
              <p className="text-xs text-muted-foreground">The Owner sets what the crew is paid for a correction visit before it is booked.</p>
            )}
            <label className="flex items-start gap-2 text-sm text-foreground">
              <Checkbox className="mt-1" checked={ask} onCheckedChange={(checked) => setAsk(checked)} />
              <span>Ask the customer first. They review it on a private page, and nothing is booked until they accept.</span>
            </label>
          </>
        ) : null}
        {kind === "credit" || kind === "refund" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount" hint={kind === "refund" ? "The Owner approves every refund and issues it in Finance." : "The Owner records the credit in Finance's ledger."}>
              <MoneyField placeholder="0.00" value={amount} onChange={(text) => setAmount(text)} />
            </Field>
            {detail.invoices ? (
              <Field label="Invoice">
                <SelectInput value={invoice} onChange={(event) => setInvoice(event.target.value)}>
                  <option value="">Not chosen</option>
                  {detail.invoices.map((row) => (
                    <option key={row.invoiceId} value={row.invoiceId}>
                      {row.number} · {money(row.balanceCents)} owed
                    </option>
                  ))}
                </SelectInput>
              </Field>
            ) : null}
          </div>
        ) : null}
        {kind === "different_cleaner" ? (
          <Field label="Who the customer asked not to have back" hint="This changes who Dispatch offers this property's visits to. It changes nothing about anyone's pay or standing.">
            <SelectInput value={avoid} onChange={(event) => setAvoid(event.target.value)}>
              <option value="">Choose</option>
              {detail.crew.map((member) => (
                <option key={member.cleanerId} value={member.cleanerId}>
                  {member.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        ) : null}
        {kind === "message" ? (
          <Field label="Message">
            <TextArea rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
          </Field>
        ) : null}
        <Field label="Why">
          <TextArea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" loading={busy} disabled={!reason.trim()} onClick={() => void send()}>
            Prepare and submit
          </Button>
          {told ? <span className="text-xs font-medium text-strong" role="status">{told}</span> : null}
        </div>
        <FormError message={error} />
      </div>
    </details>
  );
}

function Controls({ detail }: { detail: Detail }) {
  const { companyId } = useCompany();
  const caseId = detail.card.caseId as Id<"retentionCases">;
  const takeOver = useMutation(api.retentionAgent.takeOver);
  const handBack = useMutation(api.retentionAgent.handBack);
  const recordAnswer = useMutation(api.retentionAgent.recordAnswer);
  const close = useMutation(api.retentionAgent.close);
  const addNote = useMutation(api.retentionAgent.addNote);
  const { busy, error, run } = useRun();
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("handled_by_person");
  const [answer, setAnswer] = useState<"resolved" | "not_resolved">("resolved");
  if (detail.card.status === "closed") return null;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {detail.heldBy ? (
          <Button size="sm" variant="outline" loading={busy} disabled={detail.serious !== null} onClick={() => void run(() => handBack({ companyId, caseId }))}>
            Hand back to Retention
          </Button>
        ) : (
          <Button size="sm" variant="outline" loading={busy} onClick={() => void run(() => takeOver({ companyId, caseId }))}>
            <Hand aria-hidden />
            Take this case over
          </Button>
        )}
      </div>
      <Field label="Note, or what the customer told you">
        <TextArea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <div className="flex flex-wrap items-end gap-2">
        <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => void run(async () => (await addNote({ companyId, caseId, body: note }), setNote("")))}>
          Add as a note
        </Button>
        {detail.verification?.correctionCompletedAt && !detail.verification.customerAnswer ? (
          <span className="flex items-end gap-2">
            <SelectInput aria-label="What the customer said about the correction" value={answer} onChange={(event) => setAnswer(event.target.value as typeof answer)}>
              <option value="resolved">They said it is put right</option>
              <option value="not_resolved">They said it is not put right</option>
            </SelectInput>
            <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => void run(async () => (await recordAnswer({ companyId, caseId, answer, note }), setNote("")))}>
              Record their answer
            </Button>
          </span>
        ) : null}
      </div>
      {detail.can.manage ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <Field label="Close the case as" className="min-w-56 flex-1">
            <SelectInput value={outcome} onChange={(event) => setOutcome(event.target.value)}>
              {detail.outcomeChoices.map((choice) => (
                <option key={choice.code} value={choice.code}>
                  {choice.words}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => (await close({ companyId, caseId, outcome: outcome as never, ...(note.trim() ? { note } : {}) }), setNote("")))}>
            Close with this outcome
          </Button>
        </div>
      ) : null}
      <FormError message={error} />
    </div>
  );
}

function AskRetention({ detail, now, timezone }: { detail: Detail; now: number; timezone: string }) {
  const { companyId } = useCompany();
  const runTool = useMutation(api.retentionAgent.runTool);
  const { busy, error, run } = useRun();
  const [running, setRunning] = useState<string | null>(null);
  const { openPanel } = useChat();
  const offered = useMemo(() => [{ table: "customers" as const, id: detail.card.customerId as string }], [detail.card.customerId]);
  useOfferChatContext(offered);
  const use = (tool: (typeof TOOLS)[number]["id"]) => {
    setRunning(tool);
    void run(() => runTool({ companyId, caseId: detail.card.caseId as Id<"retentionCases">, tool, key: `${tool.slice(0, 20)}-${Date.now().toString(36)}` })).finally(() => setRunning(null));
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {TOOLS.map((tool) => (
          <Button key={tool.id} size="xs" variant="outline" loading={busy && running === tool.id} disabled={busy} onClick={() => use(tool.id)}>
            <Sparkles aria-hidden />
            {tool.label}
          </Button>
        ))}
        <Button size="xs" variant="ghost" onClick={() => openPanel()} title="Opens Company Chat with this customer attached. Chat works with your permissions.">
          <ChatIcon aria-hidden />
          Ask Chat about this customer
        </Button>
      </div>
      <FormError message={error} />
      {detail.toolRuns.length ? (
        <ul className="grid gap-2">
          {detail.toolRuns.map((result) => (
            <li key={result.id} className="rounded-xl border border-border bg-background p-3.5">
              <p className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-strong">
                {result.words}
                <span className="text-[11px] font-normal text-muted-foreground">
                  {result.outcome === "proposed" ? "Prepared, not carried out · " : result.outcome === "refused" ? "Not done · " : ""}
                  {whenLabel(result.at, now, timezone)}
                </span>
              </p>
              <ul className="mt-1.5 grid gap-1 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                {result.result.lines.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Each of these reads the records again and keeps its answer here. Nothing is sent or booked by asking.</p>
      )}
    </div>
  );
}

function Body({ caseId }: { caseId: Id<"retentionCases"> }) {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const detail = useStableQuery(api.retentionAgent.caseDetail, now ? { companyId, caseId, asOf: now } : "skip");
  if (!detail) {
    return (
      <div className="grid gap-4 p-6" aria-busy="true" aria-label="Loading the case">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  const { card, relationship, site, diagnosis, verification } = detail;
  const due = until(card.dueAt, now);
  const handoffs = detail.actions.filter((action) => action.handoff);
  return (
    <div>
      <header className="grid gap-4 bg-card px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <StatusPill status={card.status} words={card.statusWords} />
          <span className="text-xs text-muted-foreground">
            {card.kindWords} · {card.segmentWords}
          </span>
          {card.status !== "closed" ? <span className={cn("text-xs", card.overdue ? "font-semibold text-destructive-foreground" : "text-muted-foreground")}>{card.overdue ? `Overdue: ${due.text}` : `Due ${due.text}`}</span> : null}
        </div>
        <h2 className="font-heading text-xl tracking-tight text-strong">{card.title}</h2>
        {detail.serious ? (
          <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm text-destructive-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{detail.serious.reason} Retention organises the evidence and tracks it. It proposes no remedy and writes nothing to the customer.</span>
          </p>
        ) : null}
        {detail.heldBy ? (
          <p className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3.5 py-2.5 text-sm text-strong">
            <Hand className="size-4 shrink-0" aria-hidden />
            {detail.heldBy.you ? "You have" : `${detail.heldBy.name} has`} this case. Retention sends nothing to the customer until it is handed back.
          </p>
        ) : null}
        {detail.conversation ? <p className="rounded-xl border border-border bg-muted px-3.5 py-2.5 text-sm text-strong">{detail.conversation}</p> : null}
        <dl className="grid gap-3">
          <div>
            <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">What happened</dt>
            <dd className="mt-0.5 text-sm leading-relaxed text-foreground">{card.happened}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">What Selestial is doing</dt>
            <dd className="mt-0.5 text-sm leading-relaxed text-foreground">{card.doing}</dd>
          </div>
          <div className={cn("rounded-xl border px-3.5 py-3", card.needs ? "border-warning/50 bg-warning/10" : "border-border bg-background")}>
            <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">What needs you</dt>
            <dd className="mt-0.5 text-sm leading-relaxed font-medium text-strong">{card.needs ?? (card.outcome ? card.outcome.words : "Nothing right now.")}</dd>
          </div>
        </dl>
      </header>

      <Section
        title="Relationship and property"
        aside={
          <Link href={`/app/clients/${card.customerId}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-300 underline-offset-4 hover:underline">
            Open the client
            <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        }
      >
        <div className="grid gap-2 text-sm">
          <p className="text-foreground">
            <span className="font-semibold text-strong">{relationship.name}</span> · Account: {relationship.account.words}
            {relationship.account.note ? ` (${relationship.account.note})` : ""}
          </p>
          {detail.service ? (
            <p className="text-foreground">
              About: {detail.service.service}, {detail.service.when}
            </p>
          ) : (
            <p className="text-muted-foreground">No single service is linked to this case.</p>
          )}
        </div>
        <ul className="grid gap-2">
          {relationship.sites.map((row) => (
            <li key={row.propertyId} className={cn("rounded-xl border bg-background px-3.5 py-3", row.propertyId === site?.propertyId ? "border-brand-500/40" : "border-border")}>
              <p className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold text-strong">
                  {row.name}
                  {row.propertyId === site?.propertyId ? <span className="font-normal text-muted-foreground"> · this case</span> : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {row.segmentWords} · {row.health.words}
                </span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {row.plans.length ? row.plans.map((plan) => `${plan.words} (${plan.cadence.toLowerCase()})`).join("; ") : "No recurring plan"}
                {row.nextVisitAt ? ` · next visit ${whenLabel(row.nextVisitAt, now, timezone)}` : " · no visit booked"}
              </p>
              {row.note ? <p className="mt-1 text-xs text-strong">{row.note}</p> : null}
            </li>
          ))}
        </ul>
        {relationship.agreements.length ? (
          <ul className="grid gap-1 text-xs text-muted-foreground">
            {relationship.agreements.map((agreement) => (
              <li key={agreement.agreementId}>
                Agreement: {agreement.title} · {agreement.words}
                {agreement.noticeBy ? ` · notice by ${agreement.noticeBy}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
        {relationship.contacts.length ? (
          <p className="text-xs text-muted-foreground">
            Contacts:{" "}
            {relationship.contacts
              .map((contact) => `${contact.name} (${contact.roles.join(", ") || "contact"})`)
              .join("; ")}
          </p>
        ) : null}
      </Section>

      {detail.review ? (
        <Section title="Service review for this term">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Visits completed", detail.review.totals.completed],
              ["Visits cancelled", detail.review.totals.cancelled],
              ["Concerns raised", detail.review.totals.concerns],
              ["Still open", detail.review.totals.openConcerns],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border bg-background px-3 py-2.5">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className="font-heading text-xl text-strong tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Each site, by itself</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Site</th>
                <th className="py-1 font-medium">Completed</th>
                <th className="py-1 font-medium">Cancelled</th>
                <th className="py-1 font-medium">Concerns</th>
              </tr>
            </thead>
            <tbody>
              {detail.review.sites.map((row) => (
                <tr key={row.propertyId} className="border-t border-border text-strong">
                  <td className="py-1.5">
                    {row.name}
                    {row.active ? "" : " (no longer served)"}
                  </td>
                  <td className="py-1.5 tabular-nums">{row.completed}</td>
                  <td className="py-1.5 tabular-nums">{row.cancelled}</td>
                  <td className="py-1.5 tabular-nums">
                    {row.concerns}
                    {row.openConcerns ? ` (${row.openConcerns} open)` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">{detail.review.limits[0]}</p>
        </Section>
      ) : null}

      <Section title="Evidence">
        {detail.timeline.filter((entry) => entry.kind === "evidence" || entry.kind === "note").length ? <Timeline entries={detail.timeline.filter((entry) => entry.kind === "evidence" || entry.kind === "note")} now={now} timezone={timezone} /> : <p className="text-sm text-muted-foreground">Nothing has been gathered yet.</p>}
        {detail.evidenceGaps.length ? (
          <div className="rounded-xl border border-dashed border-border bg-background px-3.5 py-3">
            <p className="text-xs font-semibold text-strong">What the record does not hold</p>
            <ul className="mt-1 grid list-disc gap-0.5 pl-4 text-xs text-muted-foreground">
              {detail.evidenceGaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      {diagnosis ? (
        <Section title="Diagnosis and uncertainty" aside={<span className="text-[11px] text-muted-foreground">Read by {diagnosis.reader === "person" ? "a person" : diagnosis.reader === "rules" ? "the company's rules" : `${diagnosis.reader} (AI), checked by rules`}</span>}>
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-strong">
            {diagnosis.words}
            <BasisTag basis={diagnosis.basis} />
          </p>
          <ul className="grid gap-1 text-sm leading-relaxed text-foreground">
            {diagnosis.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {diagnosis.uncertain.length ? (
            <div className="rounded-xl border border-dashed border-border bg-background px-3.5 py-3">
              <p className="text-xs font-semibold text-strong">Not known</p>
              <ul className="mt-1 grid list-disc gap-0.5 pl-4 text-xs text-muted-foreground">
                {diagnosis.uncertain.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">A diagnosis is about the service. It never changes a cleaner&rsquo;s pay or standing: those are a person&rsquo;s decisions.</p>
        </Section>
      ) : null}

      <Section title="Proposed action, approval and cost">
        {detail.actions.length ? (
          <ul className="grid gap-3">
            {detail.actions.map((action) => (
              <ActionCard key={action.actionId} action={action} detail={detail} now={now} timezone={timezone} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{detail.serious ? "None. A person decides what to do about a concern like this." : "No step has been prepared yet."}</p>
        )}
        {detail.can.manage && card.status !== "closed" ? <ProposeRemedy detail={detail} timezone={timezone} /> : null}
      </Section>

      <Section title="Work with other agents">
        {handoffs.length ? (
          <ul className="grid gap-2">
            {handoffs.map((action) => (
              <li key={action.actionId} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-border bg-background px-3.5 py-3">
                <span className="min-w-0 text-sm">
                  <span className="font-semibold text-strong">{action.handoff!.toWords}</span>
                  <span className="block text-xs text-muted-foreground">Expected back: {action.handoff!.expected}</span>
                  {action.handoff!.result ? <span className="block text-xs text-strong">{action.handoff!.result}</span> : null}
                </span>
                <Flag tone={action.handoff!.status === "failed" ? "danger" : action.handoff!.status === "open" ? "warn" : "neutral"}>{action.handoff!.status === "open" ? "Not back yet" : action.handoff!.status === "returned" ? "Returned" : "Did not happen"}</Flag>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing has been handed to Dispatch, Sales, Quality or Finance. A handoff is progress, not completion: the case stays open until the result comes back.</p>
        )}
      </Section>

      <Section title="Verification">
        {verification ? (
          <ul className="grid gap-2 text-sm">
            {verification.criteria ? <li className="text-foreground">Counts as recovered when: {verification.criteria}</li> : null}
            <li className="flex items-center gap-2">{verification.correctionCompletedAt ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <span aria-hidden className="size-2 rounded-full border border-muted-foreground" />}The correction {verification.correctionCompletedAt ? `was completed ${whenLabel(verification.correctionCompletedAt, now, timezone)}` : "has not been completed"}</li>
            <li className="flex items-center gap-2">{verification.customerAnswer?.answer === "resolved" ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <span aria-hidden className="size-2 rounded-full border border-muted-foreground" />}{verification.customerAnswer ? (verification.customerAnswer.answer === "resolved" ? "The customer confirmed it is put right" : "The customer said it is not put right") : verification.customerAsked ? "The customer was asked and has not answered" : "The customer has not been asked yet"}</li>
            <li className="flex items-center gap-2">{verification.nextService && !verification.nextService.repeatReported ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <span aria-hidden className="size-2 rounded-full border border-muted-foreground" />}{verification.nextService ? (verification.nextService.repeatReported ? "The same issue was reported again on the next service" : "The next service was completed with no repeat report") : "The next ordinary service has not happened yet"}</li>
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing to verify yet. A sent message or a booked visit is not a resolved case.</p>
        )}
      </Section>

      <Section title="Ask Retention">
        <AskRetention detail={detail} now={now} timezone={timezone} />
      </Section>

      <Section title="History and outcome">
        {card.outcome ? (
          <p className={cn("rounded-xl border px-3.5 py-3 text-sm font-medium", card.outcome.verified ? "border-success/30 bg-success/10 text-success-foreground" : "border-border bg-background text-strong")}>
            {card.outcome.words} <span className="font-normal text-muted-foreground">· closed {whenLabel(card.outcome.at, now, timezone)}</span>
          </p>
        ) : null}
        <Timeline entries={detail.timeline.filter((entry) => entry.kind !== "evidence" && entry.kind !== "note")} now={now} timezone={timezone} />
        <Controls detail={detail} />
      </Section>
    </div>
  );
}

export function CaseDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <Sheet open={id !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetPopup side="right" className="w-full max-w-2xl bg-background">
        <SheetTitle className="sr-only">Retention case</SheetTitle>
        <ScrollArea className="min-h-0 flex-1">{id ? <Body caseId={id as Id<"retentionCases">} /> : null}</ScrollArea>
      </SheetPopup>
    </Sheet>
  );
}
