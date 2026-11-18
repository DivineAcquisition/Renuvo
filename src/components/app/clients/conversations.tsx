"use client";

/**
 * A client's conversation: texts and emails both ways, internal notes, and follow-ups scheduled for
 * later, in one thread read from the outbox and the client's replies. Before anything is sent the person
 * sees who it is to, at which address, on which channel, and what the sending policy says now.
 */
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Clock, Hand, Lock, Mail, MessageSquareText, NotebookPenIcon, SendIcon, TriangleAlert, X } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { localDay } from "../../../../convex/lib/chat/localDay";
import { Card, clock, day, EmptyState, when } from "./bits";

/** +15125550199 as (512) 555-0199; anything else as it is. */
function phone(value: string | null) {
  const m = value ? /^\+1(\d{3})(\d{3})(\d{4})$/.exec(value) : null;
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (value ?? "");
}

import type { Profile } from "./profile";

type Thread = NonNullable<ReturnType<typeof useQuery<typeof api.clientConversations.thread>>>;
type Item = Thread["items"][number];
type Composer = NonNullable<ReturnType<typeof useQuery<typeof api.clientConversations.composer>>>;

const CHANNEL_WORDS = { sms: "Text", email: "Email" } as const;

export function ConversationsTab({ profile }: { profile: Profile }) {
  const { companyId } = useCompany();
  const thread = useQuery(api.clientConversations.thread, { companyId, customerId: profile.id });
  if (thread === undefined) return <Skeleton className="h-96 rounded-2xl" />;
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid min-w-0 content-start gap-4">
        <Handling profile={profile} thread={thread} />
        <section aria-label="Conversation" className="min-w-0 rounded-2xl border border-border bg-card">
          {thread.items.length === 0 ? (
            <EmptyState title="No messages yet" className="m-4">
              Texts and emails to and from {profile.name}, and the team&apos;s internal notes, appear here in order.
            </EmptyState>
          ) : (
            <ThreadList items={thread.items} timezone={thread.timezone} />
          )}
          {thread.hiddenBilling > 0 ? (
            <p className="flex items-center gap-1.5 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
              <Lock className="size-3.5" aria-hidden /> {thread.hiddenBilling} billing {thread.hiddenBilling === 1 ? "message is" : "messages are"} visible to the Owner only.
            </p>
          ) : null}
          <Compose profile={profile} />
        </section>
      </div>
      <aside className="grid min-w-0 content-start gap-4">
        <Scheduled thread={thread} />
        <Reach profile={profile} />
      </aside>
    </div>
  );
}

/** Who is handling the conversation: the agents, or a person who took it over. From the record, never assumed. */
function Handling({ profile, thread }: { profile: Profile; thread: Thread }) {
  const { companyId } = useCompany();
  const takeOver = useMutation(api.clientConversations.takeOver);
  const resume = useMutation(api.clientConversations.resume);
  const { busy, error, run } = useRun();
  const [result, setResult] = useState<string | null>(null);
  const held = thread.held;
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm", held ? "border-warning/30 bg-warning/[0.06]" : "border-border bg-card")}>
      <Hand className={cn("size-5 shrink-0", held ? "text-warning-foreground" : "text-muted-foreground")} aria-hidden />
      <div className="min-w-0 flex-1">
        {held ? (
          <>
            <p className="font-medium text-strong">{held.mine ? "You took over this conversation" : `${held.by} took over this conversation`}</p>
            <p className="text-muted-foreground">Since {when(held.since, thread.timezone)}. Agent drafts and agent follow-ups don&apos;t go to {profile.name} until it&apos;s handed back.</p>
          </>
        ) : (
          <>
            <p className="font-medium text-strong">Nobody has taken over this conversation</p>
            <p className="text-muted-foreground">An agent&apos;s draft goes to the client only after a person approves it. Taking over stops any agent follow-ups waiting to go and keeps new ones from being sent.</p>
          </>
        )}
        {result ? <p className="mt-1 text-muted-foreground">{result}</p> : null}
        <FormError message={error} />
      </div>
      {held ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => (await resume({ companyId, customerId: profile.id }), setResult("Handed back to the agents.")))}>
          Hand back to agents
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const { stopped } = await takeOver({ companyId, customerId: profile.id });
              setResult(stopped ? `${stopped} agent follow-up${stopped === 1 ? " was" : "s were"} stopped.` : "No agent follow-ups were waiting.");
            })
          }
        >
          Take over
        </Button>
      )}
    </div>
  );
}

function ThreadList({ items, timezone }: { items: Item[]; timezone: string }) {
  const groups = useMemo(() => {
    const out: { day: string; items: Item[] }[] = [];
    for (const item of items) {
      const label = day(item.at, timezone);
      const last = out.at(-1);
      if (last && last.day === label) last.items.push(item);
      else out.push({ day: label, items: [item] });
    }
    return out;
  }, [items, timezone]);
  return (
    <ol className="grid gap-1 p-4" aria-label="Messages and notes, oldest first">
      {groups.map((group) => (
        <li key={group.day} className="grid gap-3">
          <p className="mt-2 text-center text-xs font-medium text-muted-foreground">{group.day}</p>
          <ol className="grid gap-3">
            {group.items.map((item) => (
              <li key={item.id}>{item.type === "note" ? <Note item={item} timezone={timezone} /> : item.type === "in" ? <Incoming item={item} timezone={timezone} /> : <Outgoing item={item} timezone={timezone} />}</li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}

const OUT_TONE: Record<string, "success" | "warning" | "error" | "outline" | "info"> = {
  Delivered: "success",
  Scheduled: "info",
  "Waiting to send": "warning",
  Sending: "outline",
  "Sent, delivery not confirmed": "outline",
  Failed: "error",
  "Not sent": "error",
  "Unknown: the send never confirmed": "warning",
};

function Outgoing({ item, timezone }: { item: Extract<Item, { type: "out" }>; timezone: string }) {
  const open = useDetail();
  const Icon = item.channel === "email" ? Mail : MessageSquareText;
  return (
    <article className="ml-auto grid max-w-[min(36rem,92%)] gap-1.5 rounded-2xl rounded-br-md border border-brand-500/20 bg-brand-500/[0.05] px-3.5 py-2.5 text-sm">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        <span>
          {CHANNEL_WORDS[item.channel]} to <span className="font-medium text-strong">{item.toName}</span>
          {item.to ? ` · ${item.channel === "sms" ? phone(item.to) : item.to}` : ""}
        </span>
        <span>· {item.by}</span>
        {item.draftedBy === "agent" ? <Badge variant="info" size="sm">Agent draft, approved</Badge> : null}
        {item.billing ? <Badge variant="outline" size="sm">Billing</Badge> : null}
      </header>
      {item.subject ? <p className="font-medium text-strong">{item.subject}</p> : null}
      <p className="whitespace-pre-wrap break-words text-strong">{item.body}</p>
      <footer className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={OUT_TONE[item.statusWords] ?? "outline"} size="sm">
          {item.statusWords}
        </Badge>
        <span className="text-muted-foreground">{item.scheduledFor && item.status === "held" ? `Goes ${when(item.scheduledFor, timezone)}` : clock(item.at, timezone)}</span>
        {item.about ? (
          item.about.table === "jobs" ? (
            <button type="button" className="text-brand-600 underline-offset-2 hover:underline dark:text-brand-300" onClick={() => open({ kind: "job", id: item.about!.id as Id<"jobs"> })}>
              {item.about.label}
            </button>
          ) : (
            <span className="text-muted-foreground">{item.about.label}</span>
          )
        ) : null}
      </footer>
      {item.problem ? <p className="text-xs text-muted-foreground">{item.problem}</p> : null}
    </article>
  );
}

function Incoming({ item, timezone }: { item: Extract<Item, { type: "in" }>; timezone: string }) {
  const open = useDetail();
  if (item.kind !== "message") {
    const words = item.kind === "opt_out" ? `${item.fromName} asked to stop texts. Texts to ${phone(item.from)} are stopped.` : item.kind === "opt_in" ? `${item.fromName} texted START. Texts they had stopped can go again.` : `${item.fromName} texted HELP and was sent the company's contact details.`;
    return (
      <p role="note" className={cn("mx-auto flex max-w-xl items-start gap-2 rounded-xl px-3 py-2 text-xs", item.kind === "opt_out" ? "bg-warning/[0.08] text-warning-foreground" : "bg-muted text-muted-foreground")}>
        <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          {words} {clock(item.at, timezone)}
        </span>
      </p>
    );
  }
  return (
    <article className="mr-auto grid max-w-[min(36rem,92%)] gap-1.5 rounded-2xl rounded-bl-md border border-border bg-muted/40 px-3.5 py-2.5 text-sm">
      <header className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <MessageSquareText className="size-3.5" aria-hidden />
        <span>
          Text from <span className="font-medium text-strong">{item.fromName}</span> · {phone(item.from)}
        </span>
      </header>
      <p className="whitespace-pre-wrap break-words text-strong">{item.body}</p>
      <footer className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{clock(item.at, timezone)}</span>
        {item.taskId ? (
          <button type="button" className="text-brand-600 underline-offset-2 hover:underline dark:text-brand-300" onClick={() => open({ kind: "task", id: item.taskId as Id<"tasks"> })}>
            Open the reply task
          </button>
        ) : null}
        <span>Kept as its first 200 characters, links removed.</span>
      </footer>
    </article>
  );
}

function Note({ item, timezone }: { item: Extract<Item, { type: "note" }>; timezone: string }) {
  return (
    <article className="grid gap-1 rounded-xl border border-dashed border-warning/40 bg-warning/[0.04] px-3.5 py-2.5 text-sm">
      <header className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <Lock className="size-3.5" aria-hidden />
        <span className="font-medium text-warning-foreground">Internal note</span>
        <span>· not sent to the client · {item.by}</span>
        {item.about ? <span>· {item.about}</span> : null}
        <span>· {clock(item.at, timezone)}</span>
      </header>
      <p className="whitespace-pre-wrap break-words text-strong">{item.body}</p>
    </article>
  );
}

type Mode = "message" | "note";

function Compose({ profile }: { profile: Profile }) {
  const { companyId } = useCompany();
  const composer = useQuery(api.clientConversations.composer, { companyId, customerId: profile.id });
  const [mode, setMode] = useState<Mode>("message");
  return (
    <div className="border-t border-border p-4">
      <div role="group" aria-label="Write" className="mb-3 inline-flex rounded-lg border border-border p-0.5 text-sm">
        {(
          [
            ["message", "Message the client", SendIcon],
            ["note", "Internal note", NotebookPenIcon],
          ] as const
        ).map(([id, label, Icon]) => (
          <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5", mode === id ? "bg-brand-500/10 font-medium text-brand-300" : "text-muted-foreground hover:text-strong")}>
            <Icon className="size-4" aria-hidden /> {label}
          </button>
        ))}
      </div>
      {mode === "note" ? <NoteForm profile={profile} /> : composer === undefined ? <Skeleton className="h-40 rounded-xl" /> : <MessageForm profile={profile} composer={composer} />}
    </div>
  );
}

function NoteForm({ profile }: { profile: Profile }) {
  const { companyId } = useCompany();
  const add = useMutation(api.clientConversations.addNote);
  const { busy, error, run } = useRun();
  const [body, setBody] = useState("");
  const [propertyId, setPropertyId] = useState("");
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await add({ companyId, customerId: profile.id, body, ...(propertyId ? { propertyId: propertyId as Id<"properties"> } : {}) });
          setBody("");
        });
      }}
    >
      <Field label="Note" hint="Only the team sees notes. They are never sent to the client.">
        <TextArea rows={3} value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} required />
      </Field>
      {profile.properties.length > 1 ? (
        <Field label="About a property (optional)">
          <SelectInput value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
            <option value="">The client in general</option>
            {profile.properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectInput>
        </Field>
      ) : null}
      <FormError message={error} />
      <div>
        <Button type="submit" variant="outline" disabled={busy || !body.trim()}>
          <Lock aria-hidden /> Add internal note
        </Button>
      </div>
    </form>
  );
}

function MessageForm({ profile, composer }: { profile: Profile; composer: Composer }) {
  const { companyId } = useCompany();
  const send = useMutation(api.clientConversations.send);
  const { busy, error, run } = useRun();
  const firstOk = composer.recipients.findIndex((r) => r.sms.ok || r.email.ok);
  const [who, setWho] = useState(String(Math.max(0, firstOk)));
  const recipient = composer.recipients[Number(who)] ?? composer.recipients[0];
  const preferred = composer.preferred === "email" ? "email" : "sms";
  // A draft from Chat arrives in the address. It is only text in the box: a person reads it, edits it and sends it.
  const params = useSearchParams();
  const drafted = params.get("draft");
  const draftChannel = params.get("channel") === "email" ? "email" : params.get("channel") === "sms" ? "sms" : null;
  const [channel, setChannel] = useState<"sms" | "email">(draftChannel ?? (recipient && !recipient[preferred].ok && recipient[preferred === "sms" ? "email" : "sms"].ok ? (preferred === "sms" ? "email" : "sms") : preferred));
  const [subject, setSubject] = useState(params.get("subject") ?? "");
  const [body, setBody] = useState(drafted ?? "");
  const [fromChat, setFromChat] = useState(Boolean(drafted));
  const [about, setAbout] = useState("");
  const [later, setLater] = useState(false);
  const [sendDay, setSendDay] = useState("");
  const [sendTime, setSendTime] = useState("09:00");
  const [sent, setSent] = useState<string | null>(null);
  if (composer.archived) return <p className="text-sm text-muted-foreground">This client is archived. Restore them to send messages. Notes can still be added.</p>;
  const check = recipient[channel];
  const sendAt = later && /^\d{4}-\d{2}-\d{2}$/.test(sendDay) ? localDay(sendDay, composer.timezone) + minutesOf(sendTime) * 60_000 : undefined;
  const aboutRow = composer.about.find((a) => `${a.table}:${a.id}` === about);
  const blocked = !check.address || (!check.ok && !check.until);
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!check.address) return;
        void run(async () => {
          const result = await send({
            companyId,
            customerId: profile.id,
            contactId: recipient.contactId,
            channel,
            to: check.address!,
            body,
            ...(channel === "email" ? { subject } : {}),
            ...(aboutRow ? { about: { table: aboutRow.table, id: aboutRow.id } } : {}),
            ...(sendAt !== undefined ? { sendAt } : {}),
          });
          setBody("");
          setSubject("");
          if (fromChat) {
            setFromChat(false);
            const url = new URL(window.location.href);
            for (const key of ["draft", "channel", "subject"]) url.searchParams.delete(key);
            window.history.replaceState(window.history.state, "", url.toString());
          }
          setSent(result.status === "queued" ? "Sending now. Its delivery shows in the thread." : result.sendAt ? `Held. It goes ${when(result.sendAt, composer.timezone)}${result.words ? `: ${result.words}` : "."}` : "Held.");
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="To">
          <SelectInput value={who} onChange={(event) => setWho(event.target.value)}>
            {composer.recipients.map((r, i) => (
              <option key={r.contactId ?? "client"} value={i}>
                {r.name}
                {r.contactId ? ` (${r.roles.join(", ")})` : ""}
              </option>
            ))}
          </SelectInput>
        </Field>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-sm font-medium text-strong">By</legend>
          <div className="flex gap-2">
            {(["sms", "email"] as const).map((c) => (
              <label key={c} className={cn("flex min-h-10 flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-500/[0.06]", !recipient[c].address && "opacity-60")}>
                <input type="radio" name="channel" className="accent-brand-500" checked={channel === c} onChange={() => setChannel(c)} />
                {c === "sms" ? <MessageSquareText className="size-4" aria-hidden /> : <Mail className="size-4" aria-hidden />}
                {CHANNEL_WORDS[c]}
                {composer.preferred === c ? <span className="text-xs text-muted-foreground">preferred</span> : null}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <p className={cn("rounded-lg px-3 py-2 text-sm", check.ok ? "bg-muted/60 text-muted-foreground" : "bg-warning/[0.08] text-warning-foreground")} aria-live="polite">
        {check.address ? (
          <>
            To <span className="font-medium text-strong">{recipient.name}</span> at <span className="font-medium text-strong">{channel === "sms" ? phone(check.address) : check.address}</span>
            {aboutRow ? <> · about {aboutRow.label}</> : null}
            {check.ok ? "." : <>. {check.until ? `Not now: ${check.words}` : check.words}</>}
          </>
        ) : (
          check.words
        )}
      </p>
      {channel === "email" ? (
        <Field label="Subject">
          <TextInput value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={200} required />
        </Field>
      ) : null}
      {fromChat ? <p className="rounded-lg bg-info/[0.08] px-3 py-2 text-sm text-info-foreground">Drafted in Chat. Nothing has been sent: read it, check who it goes to, and edit it before sending.</p> : null}
      <Field label="Message" hint={channel === "sms" ? `${body.length}/1600 · texts over 160 characters arrive in parts` : undefined}>
        <TextArea rows={4} value={body} onChange={(event) => setBody(event.target.value)} maxLength={channel === "sms" ? 1600 : 10000} required />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="About (optional)">
          <SelectInput value={about} onChange={(event) => setAbout(event.target.value)}>
            <option value="">Nothing in particular</option>
            {composer.about.map((a) => (
              <option key={`${a.table}:${a.id}`} value={`${a.table}:${a.id}`}>
                {a.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <div className="grid content-start gap-2">
          <label className="mt-7 flex items-center gap-2 text-sm text-strong">
            <input type="checkbox" className="size-4 accent-brand-500" checked={later} onChange={(event) => setLater(event.target.checked)} />
            Schedule as a follow-up
          </label>
          {later ? (
            <div className="grid grid-cols-2 gap-2">
              <TextInput type="date" aria-label="Send on" value={sendDay} onChange={(event) => setSendDay(event.target.value)} required />
              <TextInput type="time" aria-label="At" value={sendTime} onChange={(event) => setSendTime(event.target.value)} required />
            </div>
          ) : null}
        </div>
      </div>
      {later ? <p className="text-xs text-muted-foreground">Company time ({composer.timezone}). A scheduled follow-up stops if the client replies or opts out first.</p> : null}
      <FormError message={error} />
      {sent ? <p className="text-sm text-muted-foreground">{sent}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" loading={busy} disabled={busy || blocked || !body.trim() || (later && sendAt === undefined)}>
          <SendIcon aria-hidden /> {later ? "Schedule" : check.until ? "Send when allowed" : "Send"}
        </Button>
        {blocked ? <span className="text-xs text-muted-foreground">Choose another recipient or channel.</span> : null}
      </div>
    </form>
  );
}

function minutesOf(time: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 9 * 60;
}

function Scheduled({ thread }: { thread: Thread }) {
  const { companyId } = useCompany();
  const cancel = useMutation(api.clientConversations.cancelScheduled);
  const { busy, error, run } = useRun();
  return (
    <Card title="Scheduled follow-ups">
      {thread.scheduled.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
      ) : (
        <ul className="grid gap-3">
          {thread.scheduled.map((m) => (
            <li key={m.id} className="grid gap-1 text-sm">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="size-3.5" aria-hidden /> {when(m.at, thread.timezone)} · {CHANNEL_WORDS[m.channel]} to {m.toName}
                {m.draftedBy === "agent" ? " · agent draft" : ""}
              </p>
              <p className="line-clamp-2 text-strong">{m.body}</p>
              <div>
                <Button size="xs" variant="ghost" disabled={busy} onClick={() => void run(() => cancel({ companyId, messageId: m.id }))}>
                  <X aria-hidden /> Cancel
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <FormError message={error} />
      <p className="mt-3 text-xs text-muted-foreground">A reply or an opt-out from the client stops these. Taking over stops the agents&apos; ones.</p>
    </Card>
  );
}

/** What the sending policy says now for each person and channel, so a refusal is known before writing. */
function Reach({ profile }: { profile: Profile }) {
  const { companyId } = useCompany();
  const composer = useQuery(api.clientConversations.composer, { companyId, customerId: profile.id });
  return (
    <Card title="Who can be reached">
      {composer === undefined ? (
        <Skeleton className="h-24" />
      ) : (
        <ul className="grid gap-3 text-sm">
          {composer.recipients.map((r) => (
            <li key={r.contactId ?? "client"} className="grid gap-1">
              <p className="font-medium text-strong">{r.name}</p>
              {(["sms", "email"] as const).map((c) => (
                <p key={c} className="flex items-start gap-1.5 text-xs">
                  <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", r[c].ok ? "bg-success" : r[c].until ? "bg-warning" : "bg-muted-foreground/50")} aria-hidden />
                  <span className="text-muted-foreground">
                    <span className="text-strong">{CHANNEL_WORDS[c]}:</span> {r[c].ok ? `can send to ${c === "sms" ? phone(r[c].address) : r[c].address}` : r[c].words}
                  </span>
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">From the same consent, do-not-contact and quiet-hours rules every message follows.</p>
    </Card>
  );
}
