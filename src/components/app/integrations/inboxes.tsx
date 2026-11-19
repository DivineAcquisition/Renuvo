"use client";

/**
 * Connected inboxes, in Connected apps › Gmail (convex/inboxes.ts). The Owner chooses what an inbox is
 * for, which decides which agents use it; how far back Selestial may read; and whether it may send as
 * that address. Everyone can see what is connected; only the Owner connects, changes or disconnects.
 */
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { createContext, useContext, useState } from "react";

import { AgentAvatar } from "@/components/app/agent";
import { useCompany } from "@/components/app/company";
import { messageOf } from "@/components/app/form";
import { AlertTriangle, CheckCircle2, Lock, Mail, Plug } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

export type Listing = FunctionReturnType<typeof api.inboxes.list>;
type Inbox = Listing["inboxes"][number];
type Purpose = "sales" | "hiring" | "care" | "operations";

/** What the panel can ask the server to do. The live panel passes Convex mutations; a preview passes stand-ins. */
export type InboxActions = {
  start: (input: { purposes: Purpose[]; label?: string; historyDays: number; canSend: boolean; returnTo: string }) => Promise<{ url: string }>;
  update: (input: { connectionId: Inbox["id"]; purposes: Purpose[] }) => Promise<unknown>;
  disconnect: (input: { connectionId: Inbox["id"] }) => Promise<unknown>;
};
const Actions = createContext<InboxActions | null>(null);
const useActions = () => {
  const actions = useContext(Actions);
  if (!actions) throw new Error("InboxActions missing");
  return actions;
};

const PURPOSES: { id: Purpose; label: string; agent: "sales" | "recruiter" | "retention" | "dispatch"; does: string }[] = [
  { id: "sales", label: "Sales", agent: "sales", does: "Quotes, proposals and replies to people asking about service go from this address, in the same thread." },
  { id: "hiring", label: "Hiring", agent: "recruiter", does: "Recruiter reads job-board and applicant mail here, and applicant email goes from this address." },
  { id: "care", label: "Care & Retention", agent: "retention", does: "Booking confirmations, invoices and payment reminders go from this address." },
  { id: "operations", label: "Operations", agent: "dispatch", does: "Kept for operations mail. Dispatch texts cleaners, so nothing is sent from it yet." },
];

const HISTORY = [
  { days: 0, label: "From now on" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
];

const RESULT_WORDS: Record<string, { tone: "ok" | "bad"; words: string }> = {
  connected: { tone: "ok", words: "Connected. Selestial is reading the inbox now; what it finds appears below." },
  failed: { tone: "bad", words: "The inbox wasn't connected. Google didn't finish, or the permission to read mail wasn't given. Nothing was stored." },
  expired: { tone: "bad", words: "That took too long, so nothing was connected. Start again." },
};

const day = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const ago = (at: number) => {
  const minutes = Math.max(1, Math.round((Date.now() - at) / 60_000));
  return minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : day(at);
};

function PurposePicker({ value, onChange, disabled }: { value: Purpose[]; onChange: (next: Purpose[]) => void; disabled?: boolean }) {
  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium text-strong">What is this inbox for?</legend>
      {PURPOSES.map((p) => {
        const on = value.includes(p.id);
        return (
          <label key={p.id} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors", on ? "border-brand-500/50 bg-brand-500/5" : "border-border hover:bg-muted/50")}>
            <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((v) => v !== p.id) : [...value, p.id])} className="mt-1 size-4 accent-[#6838ef]" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium text-strong">
                {p.label}
                <AgentAvatar agent={p.agent} size="xs" />
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{p.does}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function ConnectForm({ onCancel, initial }: { onCancel?: () => void; initial?: { purposes: Purpose[]; label: string | null; canSend: boolean } }) {
  const { start } = useActions();
  const [purposes, setPurposes] = useState<Purpose[]>(initial?.purposes ?? ["sales"]);
  const [label, setLabel] = useState(initial?.label ?? "");
  const [history, setHistory] = useState(initial ? 0 : 30);
  const [canSend, setCanSend] = useState(initial?.canSend ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        start({ purposes, label: label.trim() || undefined, historyDays: history, canSend, returnTo: window.location.origin })
          .then(({ url }) => window.location.assign(url))
          .catch((caught: unknown) => {
            setError(messageOf(caught));
            setBusy(false);
          });
      }}
    >
      <PurposePicker value={purposes} onChange={setPurposes} disabled={busy} />

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-strong">Only read one label (optional)</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} placeholder="For example: Hiring" className="h-10 rounded-lg border border-border bg-card px-3 text-sm text-strong" />
        <span className="text-xs text-muted-foreground">Leave empty to read the whole inbox. Mail outside the label is never opened.</span>
      </label>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium text-strong">How far back should the first read go?</legend>
        <div className="flex flex-wrap gap-2">
          {HISTORY.map((h) => (
            <button key={h.days} type="button" onClick={() => setHistory(h.days)} aria-pressed={history === h.days} className={cn("rounded-lg border px-3 py-1.5 text-sm", history === h.days ? "border-brand-500 bg-brand-500/10 font-medium text-strong" : "border-border text-muted-foreground hover:bg-muted")}>
              {h.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">Older mail is never read. What the first read finds is listed on the inbox here. Agents still act only as their permissions allow.</span>
      </fieldset>

      <label className="flex items-start gap-3 rounded-xl border border-border p-3">
        <input type="checkbox" checked={canSend} onChange={(e) => setCanSend(e.target.checked)} className="mt-1 size-4 accent-[#6838ef]" />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-strong">Let agents send as this address</span>
          <span className="block text-xs text-muted-foreground">Replies go from your own address in the same thread, only for the purposes above and only as each agent&apos;s permissions allow. Off: Selestial only reads, and mail goes from Selestial&apos;s address with your company name.</span>
        </span>
      </label>

      <p className="flex items-start gap-2 rounded-lg bg-muted/70 p-3 text-xs text-muted-foreground">
        <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Google will ask you to allow: <span className="font-medium text-strong">read your email</span>
          {canSend ? (
            <>
              {" "}and <span className="font-medium text-strong">send email as you</span>
            </>
          ) : null}
          . Selestial never asks to change, delete or draft in your mailbox. Your access is stored encrypted and you can disconnect at any time.
        </span>
      </p>

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" loading={busy} disabled={purposes.length === 0}>
          <Plug aria-hidden className="size-4" />
          Continue to Google
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function StateBadge({ inbox }: { inbox: Inbox }) {
  const tone = inbox.status === "connected" ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20" : inbox.status === "disconnected" ? "bg-muted text-muted-foreground ring-border" : "bg-red-500/10 text-red-700 ring-red-500/20";
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium ring-1", tone)}>{inbox.state}</span>;
}

function InboxCard({ inbox, owner }: { inbox: Inbox; owner: boolean }) {
  const { update, disconnect } = useActions();
  const [editing, setEditing] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [purposes, setPurposes] = useState<Purpose[]>(inbox.purposes.map((p) => p.id as Purpose));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const broken = inbox.status === "expired" || inbox.status === "error";
  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    work()
      .then(() => {
        setEditing(false);
        setConfirming(false);
      })
      .catch((caught: unknown) => setError(messageOf(caught)))
      .finally(() => setBusy(false));
  };

  if (reconnecting) {
    return (
      <li className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-sm font-medium text-strong">Reconnect {inbox.address}</p>
        <ConnectForm initial={{ purposes: inbox.purposes.map((p) => p.id as Purpose), label: inbox.label, canSend: inbox.canSend }} onCancel={() => setReconnecting(false)} />
      </li>
    );
  }

  return (
    <li className={cn("grid gap-3 rounded-xl border bg-card p-4", broken ? "border-red-500/40" : "border-border")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium break-all text-strong">
            <Mail aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            {inbox.address}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Connected by {inbox.connectedBy ?? "a former member"} on {day(inbox.connectedAt)}
            {inbox.legacy ? " from Recruiting settings" : ""}
          </p>
        </div>
        <StateBadge inbox={inbox} />
      </div>

      {broken ? (
        <p className="flex items-start gap-2 rounded-lg bg-red-500/10 p-2.5 text-sm text-red-800">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {inbox.problem ?? "Selestial can't use this inbox right now."} Nothing is sent from another address in the meantime.
        </p>
      ) : null}

      {editing ? (
        <PurposePicker value={purposes} onChange={setPurposes} disabled={busy} />
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {inbox.purposes.map((p) => (
            <span key={p.id} className="rounded-md border border-border bg-muted/60 px-2 py-0.5 text-xs text-strong" title={p.does}>
              {p.label}
            </span>
          ))}
          <span className="ml-1 flex -space-x-1.5" aria-label={`Used by ${inbox.agents.join(", ")}`}>
            {inbox.agents.map((a) => (
              <span key={a} className="rounded-full ring-2 ring-card">
                <AgentAvatar agent={a} size="xs" />
              </span>
            ))}
          </span>
        </div>
      )}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Reads</dt>
        <dd className="text-strong">
          {inbox.label ? `Label "${inbox.label}"` : "The whole inbox"}, mail from {day(inbox.readsFrom)} on
        </dd>
        <dt className="text-muted-foreground">Sends</dt>
        <dd className="text-strong">{inbox.canSend ? "As this address, in the same thread" : "No: read only"}</dd>
        {inbox.lastReadAt ? (
          <>
            <dt className="text-muted-foreground">Last read</dt>
            <dd className="text-strong">{ago(inbox.lastReadAt)}</dd>
          </>
        ) : null}
        {inbox.status === "disconnected" ? (
          <>
            <dt className="text-muted-foreground">Google access</dt>
            <dd className="text-strong">{inbox.grant === "revoked" ? "Ended at Google" : inbox.grant === "kept_shared" ? "Kept: another Selestial connection uses the same Google account" : inbox.grant === "revoke_failed" ? "Couldn't be ended at Google. Remove Selestial in your Google Account's security settings." : "Being ended at Google"}</dd>
          </>
        ) : null}
      </dl>

      {inbox.findings && inbox.status !== "disconnected" ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">What Recruiter found</p>
          {inbox.findings.read === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">{inbox.lastReadAt ? "No hiring mail in the time it read." : "Reading for the first time…"}</p>
          ) : (
            <ul className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-3">
              <li>
                <span className="font-semibold text-strong">{inbox.findings.applications}</span> <span className="text-muted-foreground">applications</span>
              </li>
              <li>
                <span className="font-semibold text-strong">{inbox.findings.replies}</span> <span className="text-muted-foreground">applicant replies</span>
              </li>
              <li>
                <span className="font-semibold text-strong">{inbox.findings.duplicates + inbox.findings.updates}</span> <span className="text-muted-foreground">updates and repeats</span>
              </li>
              <li className="col-span-full text-xs text-muted-foreground">{inbox.findings.skipped} other messages were left alone: only the verdict is kept, not the sender, subject or words.</li>
            </ul>
          )}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {owner && inbox.status !== "disconnected" ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {editing ? (
            <>
              <Button size="sm" variant="primary" loading={busy} disabled={purposes.length === 0} onClick={() => run(() => update({ connectionId: inbox.id, purposes }))}>
                Save
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : confirming ? (
            <>
              <p className="w-full text-sm text-strong">Disconnect {inbox.address}? Selestial stops reading and sending at once, deletes its stored access, and ends Google&apos;s permission unless another connection uses the same account. Messages waiting for it go from Selestial&apos;s address instead.</p>
              <Button size="sm" variant="destructive" loading={busy} onClick={() => run(() => disconnect({ connectionId: inbox.id }))}>
                Disconnect
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <>
              {broken ? (
                <Button size="sm" variant="primary" onClick={() => setReconnecting(true)}>
                  Reconnect
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Change what it&apos;s for
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function InboxesPanel({ result }: { result: string | null }) {
  const { companyId, role } = useCompany();
  const listing = useQuery(api.inboxes.list, { companyId });
  const start = useMutation(api.inboxes.startConnect);
  const update = useMutation(api.inboxes.update);
  const disconnect = useMutation(api.inboxes.disconnect);
  if (listing === undefined) return <Skeleton className="h-64" />;
  const actions: InboxActions = {
    start: (input) => start({ companyId, ...input }),
    update: (input) => update({ companyId, ...input }),
    disconnect: (input) => disconnect({ companyId, ...input }),
  };
  return (
    <Actions.Provider value={actions}>
      <InboxesView listing={listing} owner={role === "owner"} result={result} />
    </Actions.Provider>
  );
}

/** The panel itself, from a listing. Exported with InboxActions so it can be previewed without a server. */
export function InboxesPreview({ listing, owner, result, actions }: { listing: Listing; owner: boolean; result: string | null; actions: InboxActions }) {
  return (
    <Actions.Provider value={actions}>
      <InboxesView listing={listing} owner={owner} result={result} />
    </Actions.Provider>
  );
}

function InboxesView({ listing, owner, result }: { listing: Listing; owner: boolean; result: string | null }) {
  const [adding, setAdding] = useState(false);
  const active = listing.inboxes.filter((i) => i.status !== "disconnected");
  const past = listing.inboxes.filter((i) => i.status === "disconnected");
  const outcome = result ? RESULT_WORDS[result] : null;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">Connect your company&apos;s Gmail and choose what it&apos;s for. Agents reply from your own address, in the same conversation, so customers and applicants see you, not a template.</p>
      {outcome ? (
        <p role="status" className={cn("flex items-start gap-2 rounded-lg p-3 text-sm", outcome.tone === "ok" ? "bg-emerald-500/10 text-emerald-800" : "bg-red-500/10 text-red-800")}>
          {outcome.tone === "ok" ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />}
          {outcome.words}
        </p>
      ) : null}
      {listing.waiting > 0 ? (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-900">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {listing.waiting === 1 ? "1 message is" : `${listing.waiting} messages are`} waiting for an inbox to be reconnected. They&apos;ll go from it once it is.
        </p>
      ) : null}

      {active.length ? (
        <ul className="grid gap-3">
          {active.map((inbox) => (
            <InboxCard key={inbox.id} inbox={inbox} owner={owner} />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No inbox is connected. Until one is, email goes from Selestial&apos;s address with your company&apos;s name on it.</p>
      )}

      {owner ? (
        adding ? (
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-3 font-medium text-strong">Connect a Gmail inbox</p>
            {listing.canConnect ? <ConnectForm onCancel={() => setAdding(false)} /> : <p className="text-sm text-muted-foreground">Connecting Gmail isn&apos;t switched on for your account yet. Selestial&apos;s team has to finish Google&apos;s setup first.</p>}
          </div>
        ) : (
          <Button variant={active.length ? "secondary" : "primary"} className="w-fit" onClick={() => setAdding(true)}>
            <Plug aria-hidden className="size-4" />
            {active.length ? "Connect another inbox" : "Connect a Gmail inbox"}
          </Button>
        )
      ) : (
        <p className="text-xs text-muted-foreground">Only the Owner can connect, change or disconnect an inbox.</p>
      )}

      {past.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Disconnected ({past.length})</summary>
          <ul className="mt-2 grid gap-3">
            {past.map((inbox) => (
              <InboxCard key={inbox.id} inbox={inbox} owner={false} />
            ))}
          </ul>
        </details>
      ) : null}

      <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4 opacity-90">
        <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#0078D4]/10 text-sm font-bold text-[#0078D4]">
          O
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-strong">
            Microsoft Outlook and 365
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Coming soon</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Connecting an Outlook or Microsoft 365 inbox the same way isn&apos;t available yet. Until then, Gmail inboxes work as above and everything else goes from Selestial&apos;s address.</p>
        </div>
      </div>
    </div>
  );
}
