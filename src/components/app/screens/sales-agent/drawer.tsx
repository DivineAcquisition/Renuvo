"use client";

/**
 * One opportunity, opened over whichever Sales page the person is on. Everything about it is here: where
 * it stands and who acts next, the conversation, the quote, what a booking still needs, and what Sales
 * did and why. What a person does here goes through the same rules Sales follows: a stage's entry
 * condition, the sending policy, and the booking checks.
 */
import { useMutation, useQuery } from "convex/react";
import { Component, useState, type ReactNode } from "react";

import { eyebrow } from "@/components/app/agent";
import { useChat, useOfferChatContext } from "@/components/app/chat/chat-context";
import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { AlertTriangle, CalendarCheckIcon, ChatIcon, Hand, Loader2, RotateCcw, SendIcon, Sparkles } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { clientKey, usd } from "@/lib/app/finance";
import { ago, clock, dayName, localDate, whenLabel, zonedInstant } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { ActionCard, AttentionBadge, BookingChecklist, FollowUpTimeline, LOST_WORDS, NextStep, OpenLink, QualificationChecklist, QUOTE_STATE, QuotePreview, RunTimeline, StageBadge, Thread, type ChecklistRow, type Detail, type Stage } from "./shared";
import { SegmentedControl } from "@/components/ui/selection";

const TABS = [
  { id: "summary", label: "Summary" },
  { id: "conversation", label: "Conversation" },
  { id: "quote", label: "Quote" },
  { id: "booking", label: "Booking" },
  { id: "activity", label: "Activity" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const STAGE_CHOICES: { stage: Stage; label: string }[] = [
  { stage: "qualifying", label: "Qualifying" },
  { stage: "quote_ready", label: "Quote ready" },
  { stage: "quote_sent", label: "Quote sent" },
  { stage: "booking_pending", label: "Booking pending" },
  { stage: "deferred", label: "Deferred" },
  { stage: "closed_lost", label: "Closed lost" },
];

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="p-6">
          <p className="text-base font-semibold text-strong">This opportunity can’t be opened</p>
          <p className="mt-1 text-sm text-muted-foreground">It may have been removed, or the link is incomplete. Close this and choose one from the pipeline.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function Section({ title, hint, children, action }: { title: string; hint?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="grid gap-2.5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-strong">{title}</h3>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

// ── Summary ─────────────────────────────────────────────────────────────────────────────────────────

function factInput(row: ChecklistRow, value: string, onChange: (value: string) => void) {
  if (row.type === "choice" && row.options) {
    return (
      <SelectInput value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Not known</option>
        {row.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectInput>
    );
  }
  if (row.type === "yes_no") {
    return (
      <SelectInput value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Not known</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </SelectInput>
    );
  }
  return <TextInput value={value} inputMode={row.type === "number" ? "decimal" : undefined} onChange={(event) => onChange(event.target.value)} />;
}

function Details({ detail }: { detail: Detail }) {
  const { companyId } = useCompany();
  const setDetails = useMutation(api.salesInquiries.setDetails);
  const { busy, error, run, setError } = useRun();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [serviceKey, setServiceKey] = useState(detail.serviceKey ?? "");
  const start = () => {
    setValues(Object.fromEntries(detail.checklist.map((row) => [row.key, row.raw === null ? "" : String(row.raw)])));
    setServiceKey(detail.serviceKey ?? "");
    setEditing(true);
  };
  const save = () =>
    run(async () => {
      const facts: { key: string; value: string | number | boolean | null }[] = [];
      for (const row of detail.checklist) {
        const before = row.raw === null ? "" : String(row.raw);
        const after = (values[row.key] ?? "").trim();
        if (after === before) continue;
        if (after === "") facts.push({ key: row.key, value: null });
        else if (row.type === "number") {
          const number = Number(after.replace(/,/g, ""));
          if (!Number.isFinite(number) || number < 0) return setError(`${row.label} needs a number.`);
          facts.push({ key: row.key, value: number });
        } else if (row.type === "yes_no") facts.push({ key: row.key, value: after === "true" });
        else facts.push({ key: row.key, value: after });
      }
      await setDetails({ companyId, opportunityId: detail.card.opportunityId, facts, ...(serviceKey !== (detail.serviceKey ?? "") ? { serviceKey } : {}) });
      setEditing(false);
    });

  if (!editing) {
    return (
      <Section
        title="What Sales knows"
        hint={detail.serviceName ? `For ${detail.serviceName}. Only what the price or the schedule depends on is asked.` : "No service is chosen yet, so only the service and the area are asked for."}
        action={
          <Button size="xs" variant="outline" onClick={start}>
            Correct or add details
          </Button>
        }
      >
        <QualificationChecklist rows={detail.checklist} />
        {detail.otherFacts.length > 0 ? (
          <dl className="grid gap-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            {detail.otherFacts.map((fact) => (
              <div key={fact.key} className="grid grid-cols-[9rem_1fr] gap-2">
                <dt className="font-medium text-strong">{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Section>
    );
  }
  return (
    <Section title="Correct or add details" hint="What you record here is treated as confirmed. Sales will not overwrite it from a message, and looks at the opportunity again once you save.">
      <div className="grid gap-3 rounded-xl border border-border bg-background p-3.5 sm:grid-cols-2">
        <Field label="Service" className="sm:col-span-2">
          <SelectInput value={serviceKey} onChange={(event) => setServiceKey(event.target.value)}>
            <option value="">Not chosen yet</option>
            {detail.services.map((service) => (
              <option key={service.key} value={service.key}>
                {service.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        {detail.checklist.map((row) => (
          <Field key={row.key} label={row.label}>
            {factInput(row, values[row.key] ?? "", (value) => setValues((before) => ({ ...before, [row.key]: value })))}
          </Field>
        ))}
      </div>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>
          Save details
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </Section>
  );
}

function MoveStage({ detail, now }: { detail: Detail; now: number }) {
  const { companyId, timezone } = useCompany();
  const move = useMutation(api.salesInquiries.move);
  const { busy, error, run } = useRun();
  const [to, setTo] = useState<Stage | "">("");
  const [reason, setReason] = useState("other");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [blockers, setBlockers] = useState<string[]>([]);
  const choices = STAGE_CHOICES.filter((choice) => choice.stage !== detail.card.stage);
  return (
    <Section title="Move to another stage" hint="Each stage has a condition. A move that does not meet it is refused, with the reason.">
      <div className="grid gap-3 rounded-xl border border-border bg-background p-3.5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Stage">
            <SelectInput
              value={to}
              onChange={(event) => {
                setTo(event.target.value as Stage | "");
                setBlockers([]);
              }}
            >
              <option value="">Choose a stage</option>
              {choices.map((choice) => (
                <option key={choice.stage} value={choice.stage}>
                  {choice.label}
                </option>
              ))}
            </SelectInput>
          </Field>
          {to === "closed_lost" ? (
            <Field label="Reason">
              <SelectInput value={reason} onChange={(event) => setReason(event.target.value)}>
                {Object.entries(LOST_WORDS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectInput>
            </Field>
          ) : null}
          {to === "deferred" ? (
            <Field label="Check back on" hint="Sales checks back once on this day, then leaves it with you.">
              <TextInput type="date" value={date} min={localDate(now, timezone)} onChange={(event) => setDate(event.target.value)} />
            </Field>
          ) : null}
        </div>
        {to === "closed_lost" || to === "deferred" ? (
          <Field label="Note">
            <TextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder="What the customer said, in a few words" />
          </Field>
        ) : null}
        {blockers.length > 0 ? (
          <ul className="grid gap-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground" role="alert">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        ) : null}
        <FormError message={error} />
        <div>
          <Button
            size="sm"
            variant="outline"
            loading={busy}
            disabled={to === "" || (to === "deferred" && !date)}
            onClick={() =>
              void run(async () => {
                if (to === "") return;
                const deferredUntil = to === "deferred" ? (zonedInstant(date, "09:00", timezone) ?? undefined) : undefined;
                const result = await move({ companyId, opportunityId: detail.card.opportunityId, to, ...(to === "closed_lost" ? { reason: reason as never } : {}), ...(note.trim() ? { note } : {}), ...(deferredUntil ? { deferredUntil } : {}) });
                setBlockers(result.ok ? [] : result.blockers);
                if (result.ok) setTo("");
              })
            }
          >
            Move
          </Button>
        </div>
      </div>
    </Section>
  );
}

/** A person records how the prospect agreed to be contacted. Until then nothing is sent; an imported contact alone never counts. */
function RecordPermission({ detail }: { detail: Detail }) {
  const { companyId } = useCompany();
  const record = useMutation(api.consent.record);
  const work = useMutation(api.salesInquiries.work);
  const { busy, error, run, setError } = useRun();
  const [source, setSource] = useState<"verbal" | "paper_form" | "staff">("verbal");
  const [evidence, setEvidence] = useState("");
  if (!detail.canManage) return <p className="text-xs text-muted-foreground">An Owner or Manager records how this person agreed to be contacted.</p>;
  const channel = detail.reach!.channel;
  return (
    <div className="grid gap-3 rounded-xl border border-border bg-background p-3.5">
      <div>
        <p className="text-sm font-semibold text-strong">Record how they agreed to be contacted</p>
        <p className="text-xs text-muted-foreground">Only if they did. This is kept as the record of their permission for {channel === "sms" ? "texts" : "emails"} about this request.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="How they agreed">
          <SelectInput value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
            <option value="verbal">They said so, in person or on a call</option>
            <option value="paper_form">They signed a paper form</option>
            <option value="staff">They asked a team member to follow up</option>
          </SelectInput>
        </Field>
        <Field label="What they said, or where the proof is">
          <TextInput value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Asked us to text a price, on the call of Nov 12" />
        </Field>
      </div>
      <FormError message={error} />
      <div>
        <Button
          size="sm"
          variant="outline"
          loading={busy}
          onClick={() =>
            void run(async () => {
              if (evidence.trim().length < 3) return setError("Say in a few words how they agreed, for the record.");
              await record({ companyId, recipient: { kind: "customer", id: detail.customer!.customerId }, channel, category: "operational", status: "granted", source, evidence });
              // With permission on record, Sales looks at the opportunity again, unless a person is handling it.
              if (!detail.takeover && detail.card.stage !== "won" && detail.card.stage !== "closed_lost") await work({ companyId, opportunityId: detail.card.opportunityId }).catch(() => undefined);
            })
          }
        >
          Record permission
        </Button>
      </div>
    </div>
  );
}

function Summary({ detail, now }: { detail: Detail; now: number }) {
  const { companyId, timezone } = useCompany();
  const resolveMatch = useMutation(api.salesInquiries.resolveMatch);
  const { busy, error, run } = useRun();
  return (
    <div className="grid gap-5">
      {detail.match.state === "needs_review" ? (
        <div className="grid gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3.5" role="status">
          <p className="text-sm font-semibold text-strong">Is this someone already on record?</p>
          <p className="text-xs text-muted-foreground">The contact details partly match a customer you have. Sales waits for your answer so one person never becomes two records, or two people one.</p>
          <ul className="grid gap-1.5">
            {detail.match.candidates.map((candidate) => (
              <li key={candidate.customerId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
                <span className="text-strong">
                  {candidate.name}
                  <span className="block text-xs text-muted-foreground">{[candidate.email, candidate.phone].filter(Boolean).join(" · ") || "No contact details"}</span>
                </span>
                {detail.canManage ? (
                  <Button size="xs" variant="outline" loading={busy} onClick={() => void run(() => resolveMatch({ companyId, opportunityId: detail.card.opportunityId, sameAs: candidate.customerId }))}>
                    Same person
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {detail.canManage ? (
            <div>
              <Button size="xs" variant="ghost" loading={busy} onClick={() => void run(() => resolveMatch({ companyId, opportunityId: detail.card.opportunityId, sameAs: null }))}>
                A different person
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">An Owner or Manager decides this.</p>
          )}
          <FormError message={error} />
        </div>
      ) : null}

      {detail.reach && !detail.reach.ok ? (
        <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm text-warning-foreground" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Sales cannot message this person by {detail.reach.channel === "sms" ? "text" : "email"}: {detail.reach.words}
          </span>
        </p>
      ) : null}
      {detail.reach && !detail.reach.ok && detail.reach.code === "no_permission" && detail.customer ? <RecordPermission detail={detail} /> : null}

      <Section title="The inquiry">
        <div className="rounded-xl border border-border bg-background p-3.5">
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-strong">{detail.inquiry}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {detail.source?.words ?? detail.card.sourceWords}
            {detail.source?.campaign ? ` · ${detail.source.campaign}` : ""}
            {detail.source?.referrer ? ` · from ${detail.source.referrer}` : ""} · received {whenLabel(detail.receivedAt, now, timezone)}
            {detail.measures.firstResponseMinutes !== null ? ` · first reply after ${detail.measures.firstResponseMinutes < 1 ? "under a minute" : `${detail.measures.firstResponseMinutes} min`}` : ""}
          </p>
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <dt className="text-xs text-muted-foreground">Contact</dt>
            <dd className="text-strong">{[detail.customer?.phone, detail.customer?.email].filter(Boolean).join(" · ") || "No contact details"}</dd>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <dt className="text-xs text-muted-foreground">Wants</dt>
            <dd className="text-strong">
              {detail.serviceName ?? detail.kindWords}
              {detail.timing.text ? ` · ${detail.timing.text}` : ""}
            </dd>
          </div>
        </dl>
      </Section>

      <Details detail={detail} />
      {detail.others.length > 0 ? (
        <Section title="Other requests from this person">
          <ul className="grid gap-1 text-sm text-muted-foreground">
            {detail.others.map((other) => (
              <li key={other.opportunityId}>
                {other.stageWords} · received {whenLabel(other.receivedAt, now, timezone)}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <MoveStage detail={detail} now={now} />
    </div>
  );
}

// ── Conversation ────────────────────────────────────────────────────────────────────────────────────

function Conversation({ detail, now }: { detail: Detail; now: number }) {
  const { companyId, timezone } = useCompany();
  const send = useMutation(api.salesConversations.send);
  const addNote = useMutation(api.salesConversations.note);
  const { busy, error, run, setError } = useRun();
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [channel, setChannel] = useState<"sms" | "email">(detail.card.channel);
  const [body, setBody] = useState("");
  const [key, setKey] = useState(() => clientKey());
  const [sent, setSent] = useState<string | null>(null);
  const canText = Boolean(detail.customer?.phone);
  const canEmail = Boolean(detail.customer?.email);
  return (
    <div className="grid gap-4">
      <Thread rows={detail.thread} now={now} timezone={timezone} />
      <div className="grid gap-2.5 rounded-xl border border-border bg-background p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl label="What to write" hideLabel density="compact" value={mode} options={[{ id: "reply", label: "Reply to the customer" }, { id: "note", label: "Note for the team" }]} onChange={setMode} />
          {mode === "reply" ? (
            <SelectInput value={channel} onChange={(event) => setChannel(event.target.value as "sms" | "email")} className="ml-auto w-auto min-w-28" aria-label="Send by">
              <option value="sms" disabled={!canText}>
                Text{canText ? "" : " (no number)"}
              </option>
              <option value="email" disabled={!canEmail}>
                Email{canEmail ? "" : " (no address)"}
              </option>
            </SelectInput>
          ) : null}
        </div>
        <TextArea value={body} onChange={(event) => setBody(event.target.value)} rows={3} placeholder={mode === "reply" ? `Write to ${detail.card.customer}` : "Only your team sees this"} aria-label={mode === "reply" ? "Your reply" : "Your note"} />
        {mode === "reply" && !detail.takeover ? <p className="text-xs text-muted-foreground">Sending this puts the conversation in your hands: Sales stops its reminders and drafts until you hand it back, so the customer hears one voice.</p> : null}
        <FormError message={error} />
        {sent ? (
          <p className="text-xs text-success-foreground" role="status">
            {sent}
          </p>
        ) : null}
        <div>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={body.trim().length < 2}
            onClick={() =>
              void run(async () => {
                setSent(null);
                if (mode === "note") {
                  await addNote({ companyId, opportunityId: detail.card.opportunityId, body });
                  setBody("");
                  return;
                }
                const result = await send({ companyId, opportunityId: detail.card.opportunityId, channel, body, clientKey: key });
                if (!result.ok) return setError(result.detail);
                setSent(result.detail);
                setBody("");
                setKey(clientKey());
              })
            }
          >
            <SendIcon aria-hidden />
            {mode === "reply" ? "Send" : "Save note"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Quote ───────────────────────────────────────────────────────────────────────────────────────────

function QuoteTab({ detail, now }: { detail: Detail; now: number }) {
  const { companyId, name, timezone } = useCompany();
  const work = useMutation(api.salesInquiries.work);
  const { busy, error, run } = useRun();
  const quote = detail.quote;
  const workspace = detail.draftId ? `/app/agents/sales/book/${detail.draftId}?from=sales-agent` : null;

  if (!quote) {
    return (
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">No quote has been prepared. The agent prepares one through the booking workspace as soon as everything the price needs is known.</p>
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          {detail.card.source !== null && !detail.takeover ? (
            <Button size="sm" variant="outline" loading={busy} onClick={() => void run(() => work({ companyId, opportunityId: detail.card.opportunityId }))}>
              <Sparkles aria-hidden />
              Have the agent look again
            </Button>
          ) : null}
          {workspace ? <OpenLink href={workspace}>Open in the booking workspace</OpenLink> : null}
        </div>
      </div>
    );
  }
  const state = QUOTE_STATE[quote.status] ?? QUOTE_STATE.saved;
  const expired = quote.status === "sent" && quote.expiresAt <= now;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={expired ? "outline" : state.badge} size="sm">
            {expired ? "Expired" : state.label}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {quote.sentAt ? `Sent ${ago(quote.sentAt, now, timezone)}` : `Prepared ${ago(quote.createdAt, now, timezone)}`}
          </span>
        </div>
        {workspace ? <OpenLink href={workspace}>Open in the booking workspace</OpenLink> : null}
      </div>
      {quote.status === "awaiting_approval" ? (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm text-strong" role="status">
          This quote waits for a person before it goes out. Decide it in Approvals. To change it, edit the booking workspace and the agent quotes again.
        </p>
      ) : null}
      {quote.question ? (
        <div className="grid gap-1 rounded-xl border border-info/40 bg-info/10 p-3.5" role="status">
          <p className="text-sm font-semibold text-strong">The customer asked on the quote page</p>
          <p className="text-sm text-strong">“{quote.question.text}”</p>
          <p className="text-xs text-muted-foreground">Asked {ago(quote.question.at, now, timezone)}. It is in the conversation too.</p>
        </div>
      ) : null}
      {quote.acceptance ? (
        <p className="rounded-xl border border-success/40 bg-success/10 px-3.5 py-3 text-sm text-strong" role="status">
          {quote.acceptance.name} accepted {whenLabel(quote.acceptance.at, now, timezone)}. An acceptance is a yes to the price and scope. The booking is confirmed separately, under Booking.
        </p>
      ) : null}
      {quote.declined ? (
        <p className="rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-sm text-strong">
          The customer declined {whenLabel(quote.declined.at, now, timezone)}
          {quote.declined.reason ? `: “${quote.declined.reason}”` : "."}
        </p>
      ) : null}
      <div>
        <p className={cn(eyebrow, "mb-2")}>As the customer sees it</p>
        <QuotePreview quote={quote} company={name} timezone={timezone} />
      </div>
    </div>
  );
}

// ── Booking ─────────────────────────────────────────────────────────────────────────────────────────

function Slots({ detail, now }: { detail: Detail; now: number }) {
  const { companyId, timezone } = useCompany();
  const found = useQuery(api.salesInquiries.times, { companyId, opportunityId: detail.card.opportunityId });
  const setSlot = useMutation(api.salesInquiries.setSlot);
  const { busy, error, run } = useRun();
  const [saved, setSaved] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const choose = (startsAt: number) =>
    run(async () => {
      setSaved(false);
      await setSlot({ companyId, opportunityId: detail.card.opportunityId, startsAt });
      setSaved(true);
    });
  const chosen = detail.timing.slot?.startsAt ?? null;
  return (
    <Section title="Choose a time" hint="These times are open right now for the quoted visit. The booking checks and holds the time when it is requested.">
      {found === undefined ? (
        <Skeleton className="h-20 rounded-xl" />
      ) : found.slots.length === 0 ? (
        <p className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">{found.why}</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-3">
          {found.slots.map((slot) => (
            <li key={slot.startsAt}>
              <button
                type="button"
                disabled={busy}
                aria-pressed={chosen === slot.startsAt}
                onClick={() => void choose(slot.startsAt)}
                className={cn("grid w-full rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-60", chosen === slot.startsAt ? "border-brand-500 bg-brand-500/10 text-strong" : "border-border bg-background text-strong hover:border-brand-500/50")}
              >
                <span className="font-medium">{dayName(slot.startsAt, timezone)}</span>
                <span className="text-xs text-muted-foreground">
                  {clock(slot.startsAt, timezone)} to {clock(slot.endsAt, timezone)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Another day">
          <TextInput type="date" value={date} min={localDate(now, timezone)} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="Start">
          <TextInput type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </Field>
        <Button
          size="sm"
          variant="outline"
          loading={busy}
          disabled={!date}
          onClick={() => {
            const at = zonedInstant(date, time, timezone);
            if (at) void choose(at);
          }}
        >
          Use this time
        </Button>
      </div>
      <FormError message={error} />
      {saved ? (
        <p className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-strong" role="status">
          Saved. The agent requests the booking for this time, and the booking checks capacity as it holds it.
        </p>
      ) : null}
    </Section>
  );
}

function Address({ detail }: { detail: Detail }) {
  const { companyId } = useCompany();
  const setProperty = useMutation(api.salesInquiries.setProperty);
  const { busy, error, run } = useRun();
  const [form, setForm] = useState({ line1: "", city: "", region: "", postalCode: String(detail.checklist.find((row) => row.key === "postalCode")?.raw ?? ""), access: "" });
  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement>) => setForm((before) => ({ ...before, [key]: event.target.value })) });
  if (detail.property) {
    const address = detail.property.address;
    return (
      <Section title="Where">
        <p className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-strong">
          {address.line1}
          {address.line2 ? `, ${address.line2}` : ""}, {address.city}, {address.region} {address.postalCode}
          <span className="block text-xs text-muted-foreground">{detail.property.access.onRecord ? (detail.property.access.text ? `Access: ${detail.property.access.text}` : "Access instructions are on record for the people who run the work.") : "How the team gets in is not recorded yet."}</span>
        </p>
      </Section>
    );
  }
  return (
    <Section title="Where" hint="The address becomes a property on the customer’s record. The customer can also give it on their quote page.">
      <div className="grid gap-3 rounded-xl border border-border bg-background p-3.5 sm:grid-cols-2">
        <Field label="Street address" className="sm:col-span-2">
          <TextInput autoComplete="off" {...field("line1")} />
        </Field>
        <Field label="City">
          <TextInput {...field("city")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="State">
            <TextInput {...field("region")} />
          </Field>
          <Field label="ZIP">
            <TextInput {...field("postalCode")} />
          </Field>
        </div>
        <Field label="How the team gets in" className="sm:col-span-2">
          <TextInput {...field("access")} placeholder="Someone home, a key, a code" />
        </Field>
        <div className="sm:col-span-2">
          <FormError message={error} />
          <Button size="sm" variant="outline" loading={busy} disabled={!form.line1.trim() || !form.city.trim() || !form.region.trim() || !form.postalCode.trim()} onClick={() => void run(() => setProperty({ companyId, opportunityId: detail.card.opportunityId, address: { line1: form.line1, city: form.city, region: form.region, postalCode: form.postalCode }, ...(form.access.trim() ? { accessInstructions: form.access } : {}) }))}>
            Save the address
          </Button>
        </div>
      </div>
    </Section>
  );
}

function Booking({ detail, now }: { detail: Detail; now: number }) {
  const { companyId, timezone } = useCompany();
  const prepareAgreement = useMutation(api.bookings.prepareAgreement);
  const { busy, error, run } = useRun();
  const [agreementId, setAgreementId] = useState<string | null>(null);
  const booking = detail.booking;
  const workspace = detail.draftId ? `/app/agents/sales/book/${detail.draftId}?from=sales-agent` : null;

  if (!booking) {
    return <p className="text-sm text-muted-foreground">The booking steps start once the customer accepts a quote. Until then there is nothing to book.</p>;
  }
  if (booking.status === "confirmed") {
    return (
      <div className="grid gap-4">
        <div className="rounded-xl border border-success/40 bg-success/10 p-4" role="status">
          <p className="flex items-center gap-2 text-sm font-semibold text-strong">
            <CalendarCheckIcon className="size-4 text-success" aria-hidden />
            Booked{detail.timing.slot ? ` for ${whenLabel(detail.timing.slot.startsAt, now, timezone)}` : ""}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">The visit is with Dispatch, which finds and confirms the crew. A booking is not the same as a crew that has accepted: Dispatch shows that.</p>
          {workspace ? <OpenLink href={workspace}>Open the booking</OpenLink> : null}
        </div>
        <BookingChecklist items={booking.items} />
      </div>
    );
  }
  return (
    <div className="grid gap-5">
      <Section title="What this booking needs" hint="Read from the quote, the booking, Finance and the schedule as they are now. The booking confirms itself when every line is done.">
        <BookingChecklist items={booking.items} />
      </Section>
      {booking.agreementToPrepare ? (
        <Section title="Agreement" hint="Your Playbook asks for a signed agreement. An agreement is drafted under a person’s authority: prepare it here, then review and send it from the booking.">
          <FormError message={error} />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" loading={busy} onClick={() => void run(async () => setAgreementId(String(await prepareAgreement({ companyId, bookingId: booking.bookingId as Id<"bookings"> }))))}>
              Prepare the agreement
            </Button>
            {agreementId && workspace ? <OpenLink href={workspace}>Review and send it from the booking</OpenLink> : null}
          </div>
        </Section>
      ) : null}
      {booking.items.some((item) => item.key === "payment" && item.by === "owner") ? <p className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">The payment link waits for an Owner or Manager in Approvals. The customer gets it as soon as it is approved.</p> : null}
      {booking.bookingId ? null : (
        <>
          <Address detail={detail} />
          <Slots detail={detail} now={now} />
        </>
      )}
      {workspace ? <OpenLink href={workspace}>Open in the booking workspace</OpenLink> : null}
    </div>
  );
}

// ── Activity ────────────────────────────────────────────────────────────────────────────────────────

function Activity({ detail, now }: { detail: Detail; now: number }) {
  const { companyId, timezone } = useCompany();
  const cancel = useMutation(api.salesFollowUps.cancel);
  const { busy, error, run } = useRun();
  return (
    <div className="grid gap-5">
      <Section title="Follow-ups" hint="A reminder stops by itself when the customer replies, declines, opts out or books, or when a person takes over.">
        <FollowUpTimeline
          rows={detail.followUps}
          now={now}
          timezone={timezone}
          action={(row) =>
            detail.canManage ? (
              <Button size="xs" variant="ghost" loading={busy} onClick={() => void run(() => cancel({ companyId, followUpId: row.followUpId as Id<"salesFollowUps"> }))}>
                Cancel this reminder
              </Button>
            ) : null
          }
        />
        <FormError message={error} />
      </Section>
      <Section title="What Sales prepared and sent">
        {detail.actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <div className="grid gap-2.5">
            {detail.actions.map((action) => (
              <ActionCard key={action.actionId} action={action} now={now} timezone={timezone} />
            ))}
          </div>
        )}
      </Section>
      <Section title="Each time Sales looked" hint="The steps Sales took, in order. Rules decide what is allowed; the reader only reads the customer’s message.">
        <RunTimeline runs={detail.runs} now={now} timezone={timezone} />
      </Section>
    </div>
  );
}

// ── The drawer ──────────────────────────────────────────────────────────────────────────────────────

function Body({ opportunityId, now, initial }: { opportunityId: string; now: number; initial?: TabId }) {
  const { companyId, timezone } = useCompany();
  const detail = useQuery(api.salesInquiries.opportunity, { companyId, opportunityId: opportunityId as Id<"salesOpportunities"> });
  const takeOver = useMutation(api.salesInquiries.takeOver);
  const handBack = useMutation(api.salesInquiries.handBack);
  const work = useMutation(api.salesInquiries.work);
  const { openPanel } = useChat();
  const { busy, error, run } = useRun();
  const [tab, setTab] = useState<TabId | null>(null);
  // Chat is offered the customer this opportunity is about.
  useOfferChatContext(detail ? [{ table: "salesOpportunities", id: opportunityId }, ...(detail.customer ? [{ table: "customers" as const, id: detail.customer.customerId }] : [])] : null);

  if (detail === undefined) {
    return (
      <div className="grid gap-4 p-5 sm:p-6" aria-busy="true" aria-label="Loading the opportunity">
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  const card = detail.card;
  const open = card.stage !== "won" && card.stage !== "closed_lost";
  // Open on what matters now: the booking once a quote is accepted, the quote once there is one.
  const active: TabId = tab ?? initial ?? (card.stage === "booking_pending" || card.stage === "won" ? "booking" : card.stage === "quote_ready" || card.stage === "quote_sent" ? "quote" : "summary");
  return (
    <div className="grid gap-4 p-5 sm:p-6">
      <header className="grid gap-2 pr-8">
        <div className="flex flex-wrap items-center gap-2">
          <StageBadge stage={card.stage} words={card.stageWords} />
          <AttentionBadge attention={card.attention} words={card.attentionWords} />
          {detail.queued && !detail.working ? <span className="text-xs text-muted-foreground">Sales is about to look at this</span> : null}
        </div>
        <h2 className="font-heading text-2xl tracking-tight text-strong">{card.customer}</h2>
        <p className="text-sm text-muted-foreground">
          {detail.serviceName ?? detail.kindWords} · {detail.source?.words ?? card.sourceWords} · by {card.channel === "sms" ? "text" : "email"}
          {card.quote ? ` · ${usd(card.quote.totalCents)} ${card.quote.per}` : ""}
        </p>
      </header>

      {detail.outcome && card.stage === "closed_lost" ? (
        <p className="rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-sm text-strong">
          Closed without a booking{detail.outcome.reason ? `: ${LOST_WORDS[detail.outcome.reason] ?? detail.outcome.reason}` : ""}.{detail.outcome.note ? ` “${detail.outcome.note}”` : ""}
        </p>
      ) : null}

      {open ? (
        <div className={cn("rounded-xl border px-3.5 py-3", detail.takeover ? "border-warning/40 bg-warning/10" : "border-brand-500/30 bg-brand-500/5")}>
          <p className={eyebrow}>{detail.takeover ? "You have this conversation" : "Next step"}</p>
          {detail.takeover ? <p className="mt-1 text-sm text-strong">{detail.takeover.by} took over {ago(detail.takeover.at, now, timezone)}. Sales sends nothing and plans nothing until it is handed back.</p> : null}
          <div className="mt-1">{card.nextAction ? <NextStep next={card.nextAction} now={now} /> : <p className="text-sm text-muted-foreground">No next step is recorded.</p>}</div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {detail.takeover ? (
              <Button size="xs" variant="primary" loading={busy} onClick={() => void run(() => handBack({ companyId, opportunityId: card.opportunityId }))}>
                <RotateCcw aria-hidden />
                Hand back to Sales
              </Button>
            ) : (
              <>
                <Button size="xs" variant="outline" loading={busy} onClick={() => void run(() => takeOver({ companyId, opportunityId: card.opportunityId }))}>
                  <Hand aria-hidden />
                  Take over
                </Button>
                <Button size="xs" variant="ghost" disabled={busy || detail.working} onClick={() => void run(() => work({ companyId, opportunityId: card.opportunityId }))}>
                  {detail.working ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Sparkles aria-hidden />}
                  {detail.working ? "Sales is working" : "Have Sales look now"}
                </Button>
              </>
            )}
            <Button size="xs" variant="ghost" onClick={() => openPanel()}>
              <ChatIcon aria-hidden />
              Ask Chat about this
            </Button>
          </div>
          <FormError message={error} />
        </div>
      ) : (
        <div>
          <Button size="xs" variant="ghost" onClick={() => openPanel()}>
            <ChatIcon aria-hidden />
            Ask Chat about this
          </Button>
        </div>
      )}

      <div role="tablist" aria-label="Opportunity sections" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`sales-tab-${item.id}`}
            aria-selected={active === item.id}
            aria-controls={`sales-panel-${item.id}`}
            tabIndex={active === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              const index = TABS.findIndex((row) => row.id === active);
              const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
              setTab(next.id);
              document.getElementById(`sales-tab-${next.id}`)?.focus();
            }}
            className={cn("-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-500", active === item.id ? "border-brand-500 text-strong" : "border-transparent text-muted-foreground hover:text-strong")}
          >
            {item.label}
            {item.id === "conversation" && detail.thread.length > 0 ? <span className="ml-1 text-xs text-muted-foreground">{detail.thread.length}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`sales-panel-${active}`} aria-labelledby={`sales-tab-${active}`}>
        {active === "summary" ? <Summary detail={detail} now={now} /> : active === "conversation" ? <Conversation detail={detail} now={now} /> : active === "quote" ? <QuoteTab detail={detail} now={now} /> : active === "booking" ? <Booking detail={detail} now={now} /> : <Activity detail={detail} now={now} />}
      </div>
    </div>
  );
}

export function OpportunityDrawer({ opportunityId, now, onClose, tab }: { opportunityId: string | null; now: number; onClose: () => void; tab?: TabId }) {
  return (
    <Sheet open={opportunityId !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetPopup side="right" className="w-full max-w-2xl bg-background">
        <SheetTitle className="sr-only">Opportunity</SheetTitle>
        <ScrollArea className="min-h-0 flex-1">
          {opportunityId ? (
            <Boundary key={opportunityId}>
              <Body opportunityId={opportunityId} now={now} initial={tab} />
            </Boundary>
          ) : null}
        </ScrollArea>
      </SheetPopup>
    </Sheet>
  );
}
