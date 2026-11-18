"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, messageOf } from "@/components/app/form";
import { ArrowLeft, ChatIcon, ChevronDown, Eye, Save } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { BookingActions } from "./booking-actions";
import { CustomerSection } from "./customer-section";
import { Chip } from "./kit";
import { PaymentSection } from "./payment-section";
import { ProposalWorkspace } from "./proposal-sections";
import { ScheduleSection } from "./schedule-section";
import { ServiceSection } from "./service-section";
import { BookingSummary } from "./summary";
import { useDraft, type SaveState, type Segment, type Working } from "./use-draft";

const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "residential", label: "Residential" },
  { id: "commercial", label: "Commercial" },
  { id: "office", label: "Office" },
  { id: "str", label: "Short-term rental" },
];

function SaveStatus({ state, onReload }: { state: SaveState; onReload: () => void }) {
  if (state.kind === "saving") return <span className="text-xs text-muted-foreground">Saving…</span>;
  if (state.kind === "dirty") return <span className="text-xs text-muted-foreground">Unsaved changes</span>;
  if (state.kind === "error")
    return (
      <span role="alert" className="text-xs text-destructive-foreground">
        Not saved: {state.message}
      </span>
    );
  if (state.kind === "conflict")
    return (
      <span role="alert" className="flex items-center gap-1.5 text-xs text-destructive-foreground">
        Changed in another window.
        <button type="button" onClick={onReload} className="font-medium underline">
          Load latest
        </button>
      </span>
    );
  return <span className="text-xs text-muted-foreground">{state.at ? `Draft saved ${new Date(state.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "Draft saved"}</span>;
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { id: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-border bg-muted/60 p-1">
      {options.map((option) => (
        <label key={option.id} className={cn("cursor-pointer rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors focus-within:outline-2 focus-within:outline-brand-500", value === option.id ? "bg-card font-medium text-strong shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-strong")}>
          <input type="radio" className="sr-only" name={label} checked={value === option.id} onChange={() => onChange(option.id)} />
          {option.label}
        </label>
      ))}
    </div>
  );
}

/** The customer's view of what they will receive, without anything internal. */
function CustomerPreview({ working, data, onClose }: { working: Working; data: NonNullable<ReturnType<typeof useDraft>["data"]>; onClose: () => void }) {
  const { companyId } = useCompany();
  const summary = useQuery(api.sales.price, { companyId, draftId: data.draft._id });
  const booking = summary?.mode === "booking" ? summary : null;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="preview-title" className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 id="preview-title" className="font-heading text-lg text-strong">
            What the customer sees
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        {booking?.visit ? (
          <div className="mt-4 grid gap-3 text-sm">
            <p className="font-medium text-strong">{booking.first ? `${booking.first.name}, then ${booking.visit.name}` : booking.visit.name}</p>
            {booking.cadence ? <p className="text-muted-foreground">{booking.cadence}</p> : null}
            <ul className="grid gap-1 text-strong">
              {booking.visit.includedScope.slice(0, 12).map((item) => (
                <li key={item}>✓ {item}</li>
              ))}
            </ul>
            <dl className="grid gap-1 border-t border-border pt-3">
              {booking.firstCents !== null ? (
                <div className="flex justify-between">
                  <dt>{working.bookingKind === "recurring" ? "First visit" : "Price"}</dt>
                  <dd className="font-semibold tabular-nums">{money(booking.firstCents)}</dd>
                </div>
              ) : null}
              {booking.ongoingCents !== null ? (
                <div className="flex justify-between">
                  <dt>Each visit after</dt>
                  <dd className="font-semibold tabular-nums">{money(booking.ongoingCents)}</dd>
                </div>
              ) : null}
              {booking.dueNowCents ? (
                <div className="flex justify-between">
                  <dt>Due now</dt>
                  <dd className="tabular-nums">{money(booking.dueNowCents)}</dd>
                </div>
              ) : null}
            </dl>
            {working.body.notes?.customer ? <p className="rounded-lg bg-muted/40 p-3 text-strong">{working.body.notes.customer}</p> : null}
            {working.body.agreement?.required ? <p className="text-xs text-muted-foreground">You’ll be asked to review and sign a service agreement.</p> : null}
            <p className="text-xs text-muted-foreground">Access notes and office notes are not shown to the customer.</p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Choose a service to preview it.</p>
        )}
      </div>
    </div>
  );
}

export function SalesWorkspace({ draftId }: { draftId: Id<"salesDrafts"> }) {
  const { companyId } = useCompany();
  const { data, working, state, update, setBody, flush, reload, revision } = useDraft(companyId, draftId);
  const summary = useQuery(api.sales.price, { companyId, draftId });
  const sendChat = useMutation(api.chat.send);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [preview, setPreview] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  if (data === undefined || working === null) return <Skeleton className="h-[70vh] rounded-2xl" />;
  if (data === null) return <p className="text-sm text-muted-foreground">This draft no longer exists.</p>;

  const booking = summary?.mode === "booking" ? summary : null;
  const sectionDone = (section: string) => Boolean(summary && !summary.needs.some((n) => n.section === section && n.blocking));
  const name = data.customer && data.customer._id === working.customerId ? data.customer.name : (data.opportunity?.title ?? "New customer");
  const back = data.draft.entry?.from === "dispatch" ? "/app/agents/dispatch/schedule" : data.draft.entry?.from === "customer" ? "/app/customers" : "/app/agents/sales/quotes-proposals";
  // Chat opens in a new tab with this draft as its context, so the call in progress is never lost.
  const askChat = () => {
    setChatError(null);
    const text = question.trim();
    if (!text) return;
    void flush()
      .then(() => sendChat({ companyId, text, clientKey: `sales-${draftId}-${Date.now()}`, origin: { kind: "sales_draft", draftId }, page: window.location.pathname }))
      .then((result) => {
        setAsking(false);
        setQuestion("");
        window.open(`/app/chat/${result.conversationId}`, "_blank", "noopener");
      })
      .catch((caught: unknown) => setChatError(messageOf(caught)));
  };

  return (
    <div className="mx-auto max-w-[1320px] pb-28 xl:pb-10">
      {/* Top bar */}
      <div className="sticky top-0 z-30 -mx-4 mb-5 border-b border-border bg-background/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href={back} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-strong">
            <ArrowLeft aria-hidden className="size-4" />
            <span className="sr-only">Back</span>
          </Link>
          <div className="min-w-0">
            <p className="text-[0.6875rem] font-semibold tracking-wide text-brand-600 uppercase">{working.mode === "booking" ? "Book service" : "Prepare proposal"}</p>
            <h1 className="truncate font-heading text-lg tracking-tight text-strong">{name}</h1>
          </div>
          <Segmented
            label="Workspace mode"
            value={working.mode}
            options={[
              { id: "booking", label: "Book service" },
              { id: "proposal", label: "Prepare proposal" },
            ]}
            onChange={(mode) => update({ mode, segment: mode === "proposal" && working.segment === "residential" ? "commercial" : working.segment })}
          />
          <label className="text-sm">
            <span className="sr-only">Service category</span>
            <select className="min-h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-strong" value={working.segment} onChange={(e) => update({ segment: e.target.value as Segment })}>
              {SEGMENTS.filter((s) => working.mode === "booking" || s.id !== "residential").map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SaveStatus state={state} onReload={reload} />
            <Button size="sm" variant="outline" onClick={() => setPreview(true)} disabled={working.mode !== "booking"}>
              <Eye aria-hidden className="size-4" /> Customer preview
            </Button>
            <Button size="sm" variant="outline" aria-expanded={asking} aria-controls="ask-chat" onClick={() => setAsking((v) => !v)}>
              <ChatIcon aria-hidden className="size-4" /> Ask Chat
            </Button>
            <Button size="sm" onClick={() => void flush()} disabled={state.kind === "saved" || state.kind === "saving"}>
              <Save aria-hidden className="size-4" /> Save draft
            </Button>
          </div>
        </div>
        {asking ? (
          <form
            id="ask-chat"
            className="mt-3 flex flex-wrap items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              askChat();
            }}
          >
            <label className="min-w-64 flex-1">
              <span className="sr-only">Ask Chat about this draft</span>
              <textarea
                className="min-h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-strong"
                rows={2}
                autoFocus
                placeholder="For example: what's still missing to book this? Compare weekly and every 2 weeks."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </label>
            <Button type="submit" size="sm" disabled={!question.trim()}>
              Ask
            </Button>
            <p className="basis-full text-xs text-muted-foreground">Chat reads this draft and prepares changes; you apply them here. It can’t send, charge or confirm anything.</p>
          </form>
        ) : null}
        <FormError message={chatError} />
      </div>

      {working.mode === "proposal" ? (
        <ProposalWorkspace data={data} working={working} update={update} setBody={setBody} summary={summary} flush={flush} revision={revision} />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="grid gap-5 xl:col-span-8">
            <Segmented
              label="Booking type"
              value={working.bookingKind}
              options={[
                { id: "one_time", label: "One-time" },
                { id: "recurring", label: "Recurring" },
              ]}
              onChange={(bookingKind) => update({ bookingKind })}
            />
            <CustomerSection n={1} data={data} working={working} update={update} setBody={setBody} done={sectionDone("customer")} companyId={companyId} />
            <ServiceSection n={2} data={data} working={working} setBody={setBody} summary={summary} done={sectionDone("service")} />
            <ScheduleSection n={3} data={data} working={working} setBody={setBody} summary={summary} done={sectionDone("schedule")} companyId={companyId} />
            <PaymentSection n={4} working={working} setBody={setBody} summary={summary} done={sectionDone("payment")} />
            <BookingActions n={5} data={data} working={working} setBody={setBody} summary={summary} flush={flush} revision={revision} saving={state.kind !== "saved"} />
          </div>
          <aside className="hidden xl:col-span-4 xl:block" aria-label="Live summary">
            <div className="sticky top-24">
              <BookingSummary data={data} working={working} summary={summary} saving={state.kind === "saving" || state.kind === "dirty"} />
            </div>
          </aside>
        </div>
      )}

      {/* Small screens: a collapsible summary and an action bar that stay reachable. */}
      {working.mode === "booking" ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur xl:hidden">
          {summaryOpen ? (
            <div id="mobile-summary" className="max-h-[60vh] overflow-y-auto px-4 pt-4">
              <BookingSummary data={data} working={working} summary={summary} saving={state.kind !== "saved"} />
            </div>
          ) : null}
          <div className="flex items-center gap-3 px-4 py-3">
            <button type="button" aria-expanded={summaryOpen} aria-controls="mobile-summary" onClick={() => setSummaryOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <ChevronDown aria-hidden className={cn("size-4 shrink-0 transition-transform", summaryOpen ? "" : "rotate-180")} />
              <span className="min-w-0">
                <span className="block text-xs text-muted-foreground">{summaryOpen ? "Hide summary" : "Show summary"}</span>
                <span className="block truncate font-semibold text-strong tabular-nums">{booking?.firstCents !== null && booking?.firstCents !== undefined ? money(booking.firstCents) : "—"}</span>
              </span>
            </button>
            {booking && booking.needs.length ? <Chip tone="warning">{booking.needs.length} still needed</Chip> : <Chip tone="success">Ready</Chip>}
            <a href="#review" className="inline-flex min-h-9 items-center rounded-lg bg-brand-500 px-3 text-sm font-medium text-white">
              Review
            </a>
          </div>
        </div>
      ) : null}
      {preview ? <CustomerPreview working={working} data={data} onClose={() => setPreview(false)} /> : null}
    </div>
  );
}
