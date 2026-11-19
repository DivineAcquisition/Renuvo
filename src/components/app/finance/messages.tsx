"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, Loader2, Mail, MessageSquareText, RotateCcw, SendIcon, ShieldCheck, Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { moment, usd } from "@/lib/app/finance";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Chip, Empty, Notice, eyebrow } from "./kit";

/**
 * Selestial's prepared work in Finance: invoice and reminder messages it drafted, waiting for the Owner.
 * Every message shows who it goes to, on which channel, for what amount, and whether the sending rules
 * would let it go now. Nothing is sent until the Owner approves the exact words.
 */

type Queue = FunctionReturnType<typeof api.financeMessages.queue>;
export type Draft = Queue["waiting"][number];

const CHANNEL = { email: { label: "Email", icon: Mail }, sms: { label: "Text", icon: MessageSquareText } } as const;

const DELIVERY_TONE = { scheduled: "neutral", processing: "progress", completed: "success", needs_attention: "danger" } as const;

export function DeliveryChip({ delivery }: { delivery: NonNullable<Draft["delivery"]> }) {
  const tone = DELIVERY_TONE[delivery.state];
  return <Chip tone={tone === "neutral" ? "muted" : tone}>{delivery.words}</Chip>;
}

// ── The rail on the Overview ─────────────────────────────────────────────────────────────────────

export function ReadyForYou({ onReview, onOpenInvoice }: { onReview: () => void; onOpenInvoice: (id: Id<"invoices">) => void }) {
  const { companyId, timezone } = useCompany();
  const queue = useQuery(api.financeMessages.queue, { companyId });
  const [sendAll, setSendAll] = useState(false);
  if (!queue) return <Skeleton className="h-40 rounded-2xl" />;
  const ready = queue.waiting;
  const sendable = ready.filter((d) => d.canSend?.ok);
  return (
    <section aria-labelledby="ready-title" className="rounded-2xl border border-border bg-card">
      <header className="flex items-start gap-2.5 border-b border-border px-4 py-3.5 sm:px-5">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="ready-title" className="font-heading text-base tracking-tight text-strong">
            Ready for you
          </h2>
          <p className="text-xs text-muted-foreground">
            {ready.length ? `${ready.length} message${ready.length === 1 ? "" : "s"} Selestial prepared · nothing is sent until you approve` : queue.remindersOn ? "Selestial prepares reminders 3 days before due, then 1, 7 and 14 days late" : "Reminder drafting is off in Payments setup"}
          </p>
        </div>
      </header>
      {ready.length ? (
        <>
          <ul className="divide-y divide-border">
            {ready.slice(0, 4).map((draft) => {
              const Icon = CHANNEL[draft.channel].icon;
              return (
                <li key={draft.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-label={CHANNEL[draft.channel].label} />
                  <button type="button" onClick={() => onOpenInvoice(draft.invoiceId)} className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-brand-500">
                    <span className="block truncate text-sm font-medium text-strong">{draft.customer}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {draft.stageWords} · {draft.invoiceNumber}
                    </span>
                  </button>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm tabular-nums text-strong">{usd(draft.requestedCents)}</span>
                    {draft.canSend?.ok ? (
                      <span className="text-[11px] text-success-foreground">Can send</span>
                    ) : (
                      <span className="text-[11px] text-warning-foreground">Needs you</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {ready.length > 4 ? <p className="px-4 pb-1 text-xs text-muted-foreground sm:px-5">and {ready.length - 4} more</p> : null}
          <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3 sm:px-5">
            <Button size="sm" variant="default" onClick={onReview}>
              Review messages
            </Button>
            {sendable.length > 1 ? (
              <Button size="sm" variant="outline" onClick={() => setSendAll(true)}>
                <SendIcon aria-hidden />
                Send all {sendable.length}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
      {queue.recent.length ? (
        <div className="border-t border-border px-4 py-3 sm:px-5">
          <p className={eyebrow}>Sent recently</p>
          <ul className="mt-2 grid gap-1.5">
            {queue.recent.slice(0, 4).map((row) => (
              <li key={row.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-strong">
                  {row.customer} <span className="text-muted-foreground">· {row.stageWords}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{moment(row.approvedAt, timezone)}</span>
                {row.delivery ? <DeliveryChip delivery={row.delivery} /> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <SendAllDialog drafts={sendable} blocked={ready.filter((d) => !d.canSend?.ok)} open={sendAll} onClose={() => setSendAll(false)} />
    </section>
  );
}

// ── Send all ─────────────────────────────────────────────────────────────────────────────────────

function SendAllDialog({ drafts, blocked, open, onClose }: { drafts: Draft[]; blocked: Draft[]; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={`Send ${drafts.length} messages`} description="Each goes exactly as written. Anything that changed since this list loaded is not sent and is listed for you.">
      <SendAllBody drafts={drafts} blocked={blocked} onClose={onClose} />
    </Modal>
  );
}

function SendAllBody({ drafts, blocked, onClose }: { drafts: Draft[]; blocked: Draft[]; onClose: () => void }) {
  const { companyId } = useCompany();
  const approveAll = useMutation(api.financeMessages.approveAll);
  const { busy, error, run } = useRun();
  const [results, setResults] = useState<{ draftId: string; ok: boolean; words: string }[] | null>(null);
  const total = drafts.reduce((s, d) => s + d.requestedCents, 0);
  if (results) {
    const sent = results.filter((r) => r.ok).length;
    return (
      <div className="grid gap-3">
        <Notice tone={sent === results.length ? "success" : "warning"} title={`${sent} of ${results.length} sent`}>
          {sent === results.length ? "They're on their way. Delivery shows on each invoice." : "Those not sent are still waiting for you, with the reason."}
        </Notice>
        <ul className="grid gap-1.5 text-sm">
          {results.map((r) => {
            const draft = drafts.find((d) => d.id === r.draftId);
            return (
              <li key={r.draftId} className="flex items-start gap-2">
                {r.ok ? <CheckCircle2 className="mt-0.5 size-4 text-success-foreground" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 text-warning-foreground" aria-hidden />}
                <span>
                  <span className="text-strong">{draft?.customer ?? "Message"}</span> <span className="text-muted-foreground">· {r.words}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">
        {drafts.map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-strong">{d.customer}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {CHANNEL[d.channel].label} to {d.to} · {d.stageWords} · {d.invoiceNumber}
              </span>
            </span>
            <span className="tabular-nums text-strong">{usd(d.requestedCents)}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        {drafts.length} message{drafts.length === 1 ? "" : "s"} asking for {usd(total)} in total. Each is checked against the sending rules again as it goes.
      </p>
      {blocked.length ? (
        <p className="text-sm text-warning-foreground">
          {blocked.length} other{blocked.length === 1 ? "" : "s"} can&apos;t be sent yet and {blocked.length === 1 ? "isn’t" : "aren’t"} included. Review {blocked.length === 1 ? "it" : "them"} for the reason.
        </p>
      ) : null}
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="default" disabled={busy || drafts.length === 0} onClick={() => run(async () => setResults((await approveAll({ companyId, items: drafts.map((d) => ({ draftId: d.id, bindsTo: d.bindsTo! })) })).results))}>
          <SendIcon aria-hidden />
          Send {drafts.length}
        </Button>
      </div>
    </div>
  );
}

// ── Review drawer ────────────────────────────────────────────────────────────────────────────────

export function ReviewSheet({ open, onClose, onOpenInvoice }: { open: boolean; onClose: () => void; onOpenInvoice: (id: Id<"invoices">) => void }) {
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetPopup side="right" className="max-w-2xl bg-card">
        <SheetTitle className="sr-only">Messages ready for you</SheetTitle>
        <ScrollArea className="min-h-0 flex-1">{open ? <ReviewBody onOpenInvoice={onOpenInvoice} /> : null}</ScrollArea>
      </SheetPopup>
    </Sheet>
  );
}

function ReviewBody({ onOpenInvoice }: { onOpenInvoice: (id: Id<"invoices">) => void }) {
  const { companyId } = useCompany();
  const queue = useQuery(api.financeMessages.queue, { companyId });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 px-5 pt-6 pb-10 sm:px-7">
      <header className="pr-10">
        <p className={eyebrow}>Selestial prepared</p>
        <h2 className="mt-1 font-heading text-2xl tracking-tight text-strong">Messages ready for you</h2>
        <p className="mt-1 text-sm text-muted-foreground">Written from each invoice as it is now. Edit anything, choose email or text, then approve. Nothing goes until you do.</p>
      </header>
      {!queue ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : queue.waiting.length === 0 ? (
        <Empty icon={CheckCircle2} title="Nothing waiting" body="Selestial will prepare reminders as invoices come due. You can also prepare one from any invoice." />
      ) : (
        queue.waiting.map((draft) => <DraftCard key={draft.id} draft={draft} onOpenInvoice={onOpenInvoice} />)
      )}
    </div>
  );
}

// ── One draft ────────────────────────────────────────────────────────────────────────────────────

export function DraftCard({ draft, onOpenInvoice, compact }: { draft: Draft; onOpenInvoice?: (id: Id<"invoices">) => void; compact?: boolean }) {
  const { companyId } = useCompany();
  const edit = useMutation(api.financeMessages.edit);
  const approve = useMutation(api.financeMessages.approve);
  const skip = useMutation(api.financeMessages.skip);
  const rewrite = useMutation(api.financeMessages.rewrite);
  const { busy, error, run, setError } = useRun();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [permission, setPermission] = useState(false);
  const Icon = CHANNEL[draft.channel].icon;
  const preview = draft.body.replaceAll("{link}", "[pay link]");

  const switchChannel = (channel: "email" | "sms") =>
    run(async () => {
      await edit({ companyId, draftId: draft.id, channel, subject: channel === "email" ? draft.subject ?? `About ${draft.invoiceNumber}` : null, body: draft.body });
    });

  return (
    <article className="rounded-2xl border border-border bg-card" aria-label={`${draft.stageWords} to ${draft.customer}`}>
      <header className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-strong">
            {draft.stageWords} to {draft.customer}
            <span className="rounded border border-border px-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{draft.canSend?.ok ? "Needs your approval" : "Needs attention"}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {CHANNEL[draft.channel].label} to {draft.to ?? "no address on file"} ·{" "}
            {onOpenInvoice ? (
              <button type="button" onClick={() => onOpenInvoice(draft.invoiceId)} className="underline-offset-4 hover:underline">
                {draft.invoiceNumber}
              </button>
            ) : (
              draft.invoiceNumber
            )}{" "}
            · asking for {usd(draft.requestedCents)} · {draft.preparedBySelestial ? "prepared by Selestial" : "prepared at your request"}
            {draft.edited ? " · edited by you" : ""}
          </p>
        </div>
      </header>

      <div className="grid gap-3 px-4 py-3">
        {draft.changed && draft.edited ? (
          <Notice tone="warning" title={`What's owed is now ${usd(draft.requestedCents)}`} action={<Button size="xs" variant="outline" onClick={() => run(() => rewrite({ companyId, draftId: draft.id }))}><RotateCcw aria-hidden />Rewrite</Button>}>
            You edited this before it changed. Check the amount in your words, or let Selestial rewrite it.
          </Notice>
        ) : null}
        {editing ? (
          <div className="grid gap-3">
            {draft.channel === "email" ? (
              <Field label="Subject">
                <TextInput value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} />
              </Field>
            ) : null}
            <Field label="Message" hint={`{link} becomes the customer's pay link when it's sent.${draft.channel === "sms" ? ` ${body.length}/640 characters.` : ""}`}>
              <TextArea value={body} rows={draft.channel === "sms" ? 4 : 9} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setBody(draft.body), setSubject(draft.subject ?? ""))}>
                Cancel
              </Button>
              <Button size="sm" variant="default" disabled={busy} onClick={() => run(async () => (await edit({ companyId, draftId: draft.id, channel: draft.channel, subject: draft.channel === "email" ? subject : null, body }), setEditing(false)))}>
                Save changes
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-sm">
            {draft.subject ? <p className="mb-2 font-medium text-strong">{draft.subject}</p> : null}
            <p className={cn("whitespace-pre-line text-muted-foreground", compact && "line-clamp-4")}>{preview}</p>
          </div>
        )}

        {draft.canSend && !draft.canSend.ok ? (
          <Notice
            tone="warning"
            title="Can't send this yet"
            action={
              draft.canSend.code === "no_permission" ? (
                <Button size="xs" variant="outline" onClick={() => setPermission(true)}>
                  <ShieldCheck aria-hidden />
                  Record permission
                </Button>
              ) : draft.canSend.code === "sender_not_ready" || draft.canSend.code === "not_registered" ? (
                <Link href={draft.canSend.code === "not_registered" ? "/app/texting" : "/app/settings/compliance"} className="inline-flex h-7 items-center rounded-md border border-border bg-card px-2 text-xs font-medium text-strong hover:border-brand-500/50">
                  Messaging setup
                </Link>
              ) : null
            }
          >
            {draft.canSend.words}
          </Notice>
        ) : null}
        {draft.otherChannel?.available && !editing ? (
          <p className="text-xs text-muted-foreground">
            {draft.otherChannel.ok ? (
              <button type="button" className="font-medium text-info-foreground underline-offset-4 hover:underline" onClick={() => switchChannel(draft.otherChannel!.channel)}>
                Send as {draft.otherChannel.channel === "sms" ? "a text" : "an email"} instead
              </button>
            ) : (
              <>
                {draft.otherChannel.channel === "sms" ? "Texting" : "Email"} isn&apos;t possible for this customer: {draft.otherChannel.words}
              </>
            )}
          </p>
        ) : null}
        {outcome ? <p role="status" className="text-sm text-strong">{outcome}</p> : null}
        <FormError message={error} />
      </div>

      {!editing ? (
        <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => skip({ companyId, draftId: draft.id, reason: null }))}>
            Skip
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => (setEditing(true), setError(null))}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="default"
            className="ml-auto"
            disabled={busy || !draft.bindsTo || !draft.canSend?.ok}
            onClick={() =>
              run(async () => {
                const result = await approve({ companyId, draftId: draft.id, bindsTo: draft.bindsTo! });
                setOutcome(result.ok ? result.words : null);
                if (!result.ok) setError(result.words);
              })
            }
          >
            {busy ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <SendIcon aria-hidden />}
            Approve and send
          </Button>
        </footer>
      ) : null}
      <PermissionDialog open={permission} onClose={() => setPermission(false)} customerId={draft.customerId} customer={draft.customer} channel={draft.channel} />
    </article>
  );
}

// ── Recording a customer's permission ────────────────────────────────────────────────────────────

const SOURCES = [
  { id: "web_form", label: "They agreed on a booking or web form" },
  { id: "onboarding", label: "They agreed when they became a customer" },
  { id: "paper_form", label: "They signed a form" },
  { id: "verbal", label: "They said yes, in person or by phone" },
  { id: "email_reply", label: "They agreed by email" },
] as const;

export function PermissionDialog({ open, onClose, customerId, customer, channel }: { open: boolean; onClose: () => void; customerId: Id<"customers">; customer: string; channel: "email" | "sms" }) {
  return (
    <Modal open={open} onClose={onClose} title={`Permission to ${channel === "sms" ? "text" : "email"} ${customer}`} description="Billing messages: invoices, receipts and payment reminders. Not marketing.">
      <PermissionForm customerId={customerId} channel={channel} onDone={onClose} />
    </Modal>
  );
}

function PermissionForm({ customerId, channel, onDone }: { customerId: Id<"customers">; channel: "email" | "sms"; onDone: () => void }) {
  const { companyId } = useCompany();
  const record = useMutation(api.consent.record);
  const { busy, error, run } = useRun();
  const [source, setSource] = useState<(typeof SOURCES)[number]["id"]>("web_form");
  const [evidence, setEvidence] = useState("");
  const needsProof = source === "verbal" || source === "paper_form";
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await record({ companyId, recipient: { kind: "customer", id: customerId }, channel, category: "operational", status: "granted", source, evidence: evidence || undefined });
          onDone();
        });
      }}
    >
      <Field label="How they agreed">
        <SelectInput value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
          {SOURCES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Where the proof is kept" hint={needsProof ? "Required: for example, the signed form in the customer folder, or the call date." : "Optional"}>
        <TextInput value={evidence} maxLength={500} onChange={(e) => setEvidence(e.target.value)} />
      </Field>
      <p className="text-xs text-muted-foreground">Only record what really happened. The customer can withdraw at any time{channel === "sms" ? " by replying STOP" : ""}, and that is honored at once.</p>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="default" disabled={busy || (needsProof && !evidence.trim())}>
          Record permission
        </Button>
      </div>
    </form>
  );
}

// ── On an invoice ────────────────────────────────────────────────────────────────────────────────

export function InvoiceMessages({ invoiceId }: { invoiceId: Id<"invoices"> }) {
  const { companyId, timezone } = useCompany();
  const data = useQuery(api.financeMessages.forInvoice, { companyId, invoiceId });
  const prepare = useMutation(api.financeMessages.prepare);
  const { busy, error, run } = useRun();
  const [showHistory, setShowHistory] = useState(false);
  if (!data) return <Skeleton className="h-24 rounded-xl" />;
  const startedFor = (kind: "invoice" | "reminder", channel?: "email" | "sms") => run(() => prepare({ companyId, invoiceId, kind, channel }));
  const noAddress = !data.channels.email.address && !data.channels.sms.address;
  return (
    <section aria-label="Messages to the customer" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-strong">Messages to the customer</h3>
        <div className="flex flex-wrap gap-2">
          {data.canPrepareInvoice ? (
            <Button size="sm" variant="outline" disabled={busy || noAddress} onClick={() => startedFor("invoice")}>
              <Mail aria-hidden />
              {data.invoiceDelivered ? "Send invoice again" : "Send invoice"}
            </Button>
          ) : null}
          {data.canPrepareReminder ? (
            <Button size="sm" variant="ghost" disabled={busy || noAddress} onClick={() => startedFor("reminder")}>
              <Clock aria-hidden />
              Prepare reminder
            </Button>
          ) : null}
        </div>
      </div>
      {noAddress && data.canPrepareInvoice ? <p className="text-xs text-muted-foreground">This customer has no email or phone on file. Add one in Customers &amp; Properties to message them.</p> : null}
      <FormError message={error} />
      {data.drafts.map((draft) => (
        <DraftCard key={draft.id} draft={draft} compact />
      ))}
      {data.scheduleDone ? <p className="text-xs text-muted-foreground">Every scheduled reminder has gone out. Selestial won&apos;t prepare more on its own.</p> : null}
      {data.history.length || data.otherMessages.length ? (
        <div className="rounded-xl border border-border">
          <button type="button" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory} className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm text-strong">
            {data.history.filter((h) => h.status === "approved").length} sent, {data.history.filter((h) => h.status !== "approved").length} set aside
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", showHistory && "rotate-180")} aria-hidden />
          </button>
          {showHistory ? (
            <ul className="divide-y divide-border border-t border-border">
              {data.history.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="text-strong">{row.stageWords}</span>{" "}
                    <span className="text-muted-foreground">
                      · {CHANNEL[row.channel].label}
                      {row.approvedAt ? ` · ${moment(row.approvedAt, timezone, true)}` : ""}
                    </span>
                    {row.delivery?.detail && row.delivery.state === "needs_attention" ? <span className="block text-xs text-destructive-foreground">{row.delivery.detail}</span> : null}
                    {row.status !== "approved" && row.closedReason ? <span className="block text-xs text-muted-foreground">{row.closedReason}</span> : null}
                  </span>
                  {row.delivery ? <DeliveryChip delivery={row.delivery} /> : <Chip tone="muted">{row.status === "skipped" ? "Skipped" : "Set aside"}</Chip>}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
