"use client";

/**
 * What Sales prepared and is holding for a person: the first review batch, decided once by the Owner,
 * and after that each draft that needs approval under the Owner's permissions. A person reads exactly
 * what will be sent, to whom and what sending it does, and may edit the words first. Each item is
 * checked again at the moment it is decided.
 */
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { eyebrow } from "@/components/app/agent";
import { useCompany } from "@/components/app/company";
import { FormError, TextArea, useRun } from "@/components/app/form";
import { Panel } from "@/components/app/shell";
import { AlertTriangle, Check, PenLine, SendIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usd } from "@/lib/app/finance";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { ChannelIcon, plural } from "./shared";

type Waiting = FunctionReturnType<typeof api.salesActions.waiting>;
type Item = Waiting["pending"][number];

/** One prepared message as it will go out: recipient, words, the quote it carries, what sending does, and why. */
function Preview({ item, body, onBody, editing, disabled }: { item: Item; body: string; onBody: (value: string) => void; editing: boolean; disabled?: boolean }) {
  return (
    <div className="grid gap-2.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <ChannelIcon channel={item.channel} />
        <span className="font-medium text-strong">{item.kindWords}</span>
        <span aria-hidden>·</span>
        To {item.recipient.name}
        {item.recipient.to ? ` (${item.recipient.to})` : ""}
        {item.recipient.channel ? ` by ${item.recipient.channel === "sms" ? "text" : "email"}` : ""}
      </p>
      {item.subject ? <p className="text-xs font-semibold text-strong">Subject: {item.subject}</p> : null}
      {editing ? (
        <TextArea value={body} onChange={(event) => onBody(event.target.value)} rows={5} disabled={disabled} aria-label={`Message to ${item.recipient.name}`} />
      ) : (
        <blockquote className="rounded-lg border-l-2 border-brand-500/50 bg-muted/40 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-strong">{body.replaceAll("{link}", "[quote link]")}</blockquote>
      )}
      {editing && item.editable.includes("{link}") ? <p className="text-xs text-muted-foreground">Keep {"{link}"} where the customer’s private quote link should go.</p> : null}
      {item.quote ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <span className="font-semibold text-strong">
            Quote Q-{item.quote.number}, version {item.quote.version}:
          </span>{" "}
          {usd(item.quote.totalCents)} {item.quote.per} for {item.quote.service}
          {item.quote.depositCents ? ` · deposit ${usd(item.quote.depositCents)}` : ""}
        </p>
      ) : null}
      <p className="text-xs leading-relaxed text-muted-foreground">
        <span className="font-semibold text-strong">If you send it:</span> {item.consequence}
      </p>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-brand-300 underline-offset-4 select-none hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">Why Sales prepared this</summary>
        <div className="mt-2 grid gap-1.5">
          <p>{item.reason}</p>
          {item.evidence.map((row, index) => (
            <p key={`${row.label}-${index}`}>
              <span className="font-medium text-strong">{row.label}:</span> {row.detail}
            </p>
          ))}
          <p>Wording: {item.writtenBy}.</p>
        </div>
      </details>
      {item.stale ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>This no longer applies and will not be sent: {item.stale}</span>
        </p>
      ) : null}
    </div>
  );
}

function PendingItem({ item, canDecide, onOpen }: { item: Item; canDecide: boolean; onOpen?: (id: string) => void }) {
  const { companyId } = useCompany();
  const decide = useMutation(api.salesActions.decide);
  const { busy, error, run, setError } = useRun();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(item.editable);
  const act = (decision: "send" | "skip") =>
    run(async () => {
      const result = await decide({ companyId, actionId: item.actionId, decision, ...(decision === "send" && editing && body !== item.editable ? { body } : {}) });
      if (!result.ok) setError(result.detail);
    });
  return (
    <li className="grid gap-3 rounded-xl border border-border bg-background p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {onOpen ? (
          <button type="button" onClick={() => onOpen(item.opportunityId)} className="text-sm font-semibold text-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
            {item.customer}
          </button>
        ) : (
          <p className="text-sm font-semibold text-strong">{item.customer}</p>
        )}
        <Badge variant="warning" size="sm">
          Needs your approval
        </Badge>
      </div>
      <Preview item={item} body={body} onBody={setBody} editing={editing} disabled={busy} />
      <FormError message={error} />
      {canDecide ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" loading={busy} disabled={Boolean(item.stale)} onClick={() => void act("send")}>
            <SendIcon aria-hidden />
            {editing && body !== item.editable ? "Send my edit" : "Approve and send"}
          </Button>
          {item.body ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing((value) => !value)}>
              <PenLine aria-hidden />
              {editing ? "Stop editing" : "Edit"}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act("skip")}>
            Set aside
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">An Owner or Manager decides this.</p>
      )}
    </li>
  );
}

function FirstBatch({ batchId, items, owner }: { batchId: Id<"salesBatches">; items: Item[]; owner: boolean }) {
  const { companyId } = useCompany();
  const decideBatch = useMutation(api.salesActions.decideBatch);
  const { busy, error, run } = useRun();
  const [choice, setChoice] = useState<Record<string, "send" | "skip">>({});
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [done, setDone] = useState<{ sent: number; skipped: number; problems: string[] } | null>(null);
  const chosen = (item: Item) => choice[item.actionId] ?? (item.stale ? "skip" : "send");
  const sending = items.filter((item) => chosen(item) === "send").length;

  if (done) {
    return (
      <div className="rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-strong" role="status">
        <p className="font-semibold">First review done: {plural(done.sent, "message")} sent, {done.skipped} set aside.</p>
        <p className="mt-1 text-muted-foreground">From here Sales acts under the permissions in Settings. Nothing about those changed.</p>
        {done.problems.map((problem) => (
          <p key={problem} className="mt-1 text-warning-foreground">
            {problem}
          </p>
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <div className="rounded-xl border border-brand-500/30 bg-brand-500/5 px-3.5 py-3">
        <p className={eyebrow}>First review</p>
        <p className="mt-1 text-sm font-medium text-strong">Sales has prepared its first {plural(items.length, "message")} and sent none of them.</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Read each one, edit the words if you like, and choose which go out. After this one review Sales works under the permissions you set in Settings; approving here does not change them.
        </p>
      </div>
      <ul className="grid gap-3">
        {items.map((item) => {
          const state = chosen(item);
          return (
            <li key={item.actionId} className={cn("grid gap-3 rounded-xl border bg-background p-3.5", state === "send" ? "border-brand-500/40" : "border-border opacity-80")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-strong">{item.customer}</p>
                <div className="inline-flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label={`Decision for ${item.customer}`}>
                  {(["send", "skip"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={!owner || busy || (value === "send" && Boolean(item.stale))}
                      aria-pressed={state === value}
                      onClick={() => setChoice((before) => ({ ...before, [item.actionId]: value }))}
                      className={cn("inline-flex min-h-8 items-center gap-1 rounded-md px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50", state === value ? (value === "send" ? "bg-brand-500 text-white" : "bg-muted text-strong") : "text-muted-foreground hover:text-strong")}
                    >
                      {state === value ? <Check className="size-3" aria-hidden /> : null}
                      {value === "send" ? "Send" : "Set aside"}
                    </button>
                  ))}
                </div>
              </div>
              <Preview item={item} body={bodies[item.actionId] ?? item.editable} onBody={(value) => setBodies((before) => ({ ...before, [item.actionId]: value }))} editing={editing === item.actionId} disabled={busy} />
              {owner && item.body ? (
                <div>
                  <Button size="xs" variant="outline" disabled={busy} onClick={() => setEditing(editing === item.actionId ? null : item.actionId)}>
                    <PenLine aria-hidden />
                    {editing === item.actionId ? "Done editing" : "Edit the words"}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <FormError message={error} />
      {owner ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            loading={busy}
            onClick={() =>
              void run(async () => {
                const result = await decideBatch({ companyId, batchId, items: items.map((item) => ({ actionId: item.actionId, decision: chosen(item), ...(chosen(item) === "send" && bodies[item.actionId] !== undefined && bodies[item.actionId] !== item.editable ? { body: bodies[item.actionId] } : {}) })) });
                setDone({ sent: result.sent, skipped: result.skipped, problems: result.results.filter((row) => !row.ok).map((row) => row.detail) });
              })
            }
          >
            <SendIcon aria-hidden />
            {sending === 0 ? "Set all aside and finish the review" : `Send ${sending} and finish the review`}
          </Button>
          <p className="text-xs text-muted-foreground">Each message is checked again as it goes. One that can no longer be sent is set aside and the rest still go.</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">The Owner decides the first review.</p>
      )}
    </div>
  );
}

/** Everything Sales is holding for a person. Renders nothing when nothing is waiting, unless `showEmpty`. */
export function ReviewQueue({ onOpen, showEmpty }: { onOpen?: (id: string) => void; showEmpty?: boolean }) {
  const { companyId } = useCompany();
  const waiting = useQuery(api.salesActions.waiting, { companyId });
  if (waiting === undefined) return <Skeleton className="h-28 rounded-2xl" />;
  const batch = !waiting.firstBatch.decided && waiting.firstBatch.batchId && waiting.firstBatch.items.length > 0 ? waiting.firstBatch : null;
  if (!batch && waiting.pending.length === 0) {
    if (!showEmpty) return null;
    return (
      <Panel title="Waiting on your approval">
        <p className="text-sm text-muted-foreground">
          {waiting.firstBatch.decided ? "Nothing Sales prepared is waiting on you." : "Sales has prepared nothing yet. Its first messages wait here for one review before anything is sent."}
        </p>
      </Panel>
    );
  }
  return (
    <Panel title={batch ? "Sales’s first messages, for your review" : `Waiting on your approval · ${waiting.pending.length}`}>
      <div className="grid gap-4">
        {batch ? <FirstBatch batchId={batch.batchId!} items={batch.items} owner={!waiting.ownerOnlyBatch} /> : null}
        {waiting.pending.length > 0 ? (
          <ul className="grid gap-3">
            {waiting.pending.map((item) => (
              <PendingItem key={item.actionId} item={item} canDecide={waiting.canDecide} onOpen={onOpen} />
            ))}
          </ul>
        ) : null}
      </div>
    </Panel>
  );
}
