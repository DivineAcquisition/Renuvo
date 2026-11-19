"use client";

import { useMutation, useQuery } from "convex/react";
import { useId } from "react";

import { useCompany } from "@/components/app/company";
import { useRun } from "@/components/app/form";
import { SwitchButton } from "@/components/app/services/shared";
import { Panel } from "@/components/app/shell";
import { Lock, Mail } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

const STATUS_WORDS: Record<string, { label: string; tone: "ok" | "wait" | "bad" | "muted" }> = {
  queued: { label: "Sending", tone: "wait" },
  held: { label: "Waiting", tone: "wait" },
  sending: { label: "Sending", tone: "wait" },
  sent: { label: "Sent", tone: "ok" },
  delivered: { label: "Delivered", tone: "ok" },
  failed: { label: "Didn't arrive", tone: "bad" },
  unconfirmed: { label: "Not confirmed", tone: "bad" },
  not_sent: { label: "Not sent", tone: "muted" },
};

const TONE = { ok: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20", wait: "bg-amber-500/10 text-amber-700 ring-amber-500/20", bad: "bg-red-500/10 text-red-700 ring-red-500/20", muted: "bg-muted text-muted-foreground ring-border" } as const;

function Row({ label, about, on, locked, onChange, busy }: { label: string; about: string; on: boolean; locked: boolean; onChange: (on: boolean) => void; busy: boolean }) {
  const id = useId();
  return (
    <li className="flex items-start justify-between gap-4 px-4 py-3.5 sm:px-5">
      <div className="min-w-0">
        <p id={id} className="text-sm font-medium text-strong">
          {label}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">{about}</p>
      </div>
      {locked ? (
        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <Lock aria-hidden className="size-3.5" />
          Always on
        </span>
      ) : (
        <SwitchButton checked={on} onChange={onChange} disabled={busy} labelledBy={id} className="mt-0.5" />
      )}
    </li>
  );
}

export type PreferencesData = (typeof api.notifications.mine)["_returnType"];

/**
 * This person's own notification settings: what Selestial emails them about, and the notices it sent
 * them lately with what happened to each. Everyone sets their own; nobody sets anyone else's.
 */
export function NotificationPreferences() {
  const { companyId, timezone } = useCompany();
  const mine = useQuery(api.notifications.mine, { companyId });
  const setEmail = useMutation(api.notifications.setEmail);
  const clearBlock = useMutation(api.notifications.clearBlock);
  const { busy, error, run } = useRun();
  if (mine === undefined) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  return <PreferencesView data={mine} timezone={timezone} busy={busy} error={error} onToggle={(category, on) => void run(() => setEmail({ companyId, category, on }))} onClearBlock={() => void run(() => clearBlock({ companyId }))} />;
}

export function PreferencesView({ data: mine, timezone, busy, error, onToggle, onClearBlock }: { data: PreferencesData; timezone: string; busy: boolean; error: string | null; onToggle: (category: PreferencesData["categories"][number]["category"], on: boolean) => void; onClearBlock: () => void }) {
  const when = (at: number) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(at));
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        <Mail aria-hidden className="mr-1.5 inline size-4 align-[-3px]" />
        Notices go to <span className="font-medium break-all text-strong">{mine.email}</span>, the address you sign in with. Everything in them is also in Selestial.
      </p>

      {mine.blocked ? (
        <div role="status" className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-strong">Notices to your address are stopped</p>
            <p className="text-sm text-muted-foreground">{mine.blocked.words} If your inbox works now, start them again.</p>
          </div>
          <Button size="sm" variant="secondary" loading={busy} onClick={onClearBlock}>
            My address works again
          </Button>
        </div>
      ) : null}

      <Panel flush title="Email me about">
        <ul className="divide-y divide-border">
          {mine.categories.map((row) => (
            <Row key={row.category} label={row.label} about={row.about} on={row.on} locked={row.locked} busy={busy} onChange={(on) => onToggle(row.category, on)} />
          ))}
        </ul>
      </Panel>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Panel flush title="Recent notices to you">
        {mine.recent.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nothing yet. Notices Selestial sends you will be listed here with what happened to each.</p>
        ) : (
          <ul className="divide-y divide-border">
            {mine.recent.map((row) => {
              const status = STATUS_WORDS[row.status] ?? STATUS_WORDS.not_sent;
              return (
                <li key={row.id} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-strong">{row.subject ?? "Notice being written"}</p>
                    <p className="text-xs text-muted-foreground">
                      {when(row.at)}
                      {row.problem && row.status !== "delivered" && row.status !== "sent" ? ` · ${row.problem}` : ""}
                      {row.complained ? " · Marked as spam" : ""}
                    </p>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1", TONE[status.tone])}>{status.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
