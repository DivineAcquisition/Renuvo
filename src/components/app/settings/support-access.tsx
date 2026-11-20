"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, useRun } from "@/components/app/form";
import { OwnerOnly } from "@/components/app/settings/billing";
import { Guard } from "@/components/app/settings/guard";
import { Panel } from "@/components/app/shell";
import { Eye, Lock, ShieldCheck } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../../convex/_generated/api";

const when = (at: number, timezone: string) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(at));

/**
 * Settings › Support access: every time Selestial Support opened the workspace, why, whether it could
 * change anything, and what it changed. The Owner also decides here whether Support may make changes.
 */
function SupportAccessInner() {
  const { companyId, role, timezone } = useCompany();
  const data = useQuery(api.support.history, role === "owner" ? { companyId } : "skip");
  const grant = useMutation(api.support.grantManage);
  const revoke = useMutation(api.support.revokeManage);
  const [hours, setHours] = useState("24");
  const { busy, error, run } = useRun();
  if (role !== "owner") return <OwnerOnly what="Support access" />;
  if (data === undefined) return <Skeleton className="h-48 rounded-2xl" />;
  return (
    <div className="grid gap-5">
      <Panel title="How Selestial Support can help">
        <div className="grid gap-3 text-sm">
          <p className="flex items-start gap-2.5">
            <Eye aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600" />
            <span>
              <span className="font-medium text-strong">Viewing.</span> To solve a problem, Selestial Support can open your workspace to see your setup, workflows and records, for a stated reason and an hour at a time. Messages between you and your customers, cleaners and applicants stay hidden unless Support gives a reason to read one, which is listed below. Passwords, payment details and connection keys are never shown.
            </span>
          </p>
          <p className="flex items-start gap-2.5">
            <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600" />
            <span>
              <span className="font-medium text-strong">Making changes.</span> Only with your permission below, or while Selestial is working on a problem with your account. Support can correct settings and drafts, pause an agent and retry failed work. It never sends messages, approves anything, changes prices or agent authority, or touches billing for you. You&rsquo;re told when changes start, and get a summary when Support finishes.
            </span>
          </p>
          {!data.enabled ? <p className="text-xs text-muted-foreground">Support access isn&rsquo;t turned on for Selestial yet. This page will list every session once it is.</p> : null}
        </div>
      </Panel>

      <Panel title="Let Support make changes">
        {data.grant ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="flex items-center gap-2">
              <ShieldCheck aria-hidden className="size-4 text-success-foreground" />
              <span className="text-strong">
                Allowed until {when(data.grant.expiresAt, timezone)}.
              </span>
            </p>
            <Button size="sm" variant="outline" loading={busy} onClick={() => void run(() => revoke({ companyId }))}>
              End permission now
            </Button>
          </div>
        ) : (
          <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => (event.preventDefault(), void run(() => grant({ companyId, hours: Number(hours) })))}>
            <Field label="Allow changes for" className="w-44">
              <SelectInput value={hours} onChange={(event) => setHours(event.target.value)}>
                <option value="4">4 hours</option>
                <option value="24">24 hours</option>
                <option value="72">3 days</option>
              </SelectInput>
            </Field>
            <Button type="submit" size="sm" variant="primary" loading={busy}>
              Allow changes
            </Button>
            <p className="w-full text-xs text-muted-foreground">Viewing doesn&rsquo;t need this. Ending it stops changes at once.</p>
          </form>
        )}
        <FormError message={error} />
      </Panel>

      <Panel title="Support access history" flush>
        {data.sessions.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Selestial Support hasn&rsquo;t opened your workspace.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.sessions.map((session) => (
              <li key={session.id} className="grid gap-2 px-4 py-3.5 text-sm sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-strong">{when(session.startedAt, timezone)}</span>
                  <Badge variant={session.mode === "manage" ? "warning" : "outline"} size="sm">{session.mode === "manage" ? "Made changes" : "Viewed only"}</Badge>
                  {session.open ? <Badge variant="info" size="sm">In progress</Badge> : null}
                  {session.ticket ? <span className="text-xs text-muted-foreground">Ticket {session.ticket}</span> : null}
                </div>
                <p className="text-strong">Why: {session.reason}</p>
                {session.manageReason ? <p className="text-muted-foreground">Changes: {session.manageReason} {session.basis === "owner_grant" ? "(you allowed changes)" : "(during a problem Selestial was fixing)"}</p> : null}
                {session.changes.length ? (
                  <ul className="grid gap-0.5 pl-4 text-muted-foreground">
                    {session.changes.map((change, index) => (
                      <li key={index} className="list-disc">
                        Selestial Support {change.summary} · {when(change.at, timezone)}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {session.revealed.map((row, index) => (
                  <p key={index} className="text-xs text-muted-foreground">
                    Selestial Support {row.summary} · {when(row.at, timezone)}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export function SupportAccessScreen() {
  return (
    <Guard>
      <SupportAccessInner />
    </Guard>
  );
}
