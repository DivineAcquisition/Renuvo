"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextInput, useRun } from "@/components/app/form";
import { WeekMeasures } from "@/components/app/overview/week-measures";
import { NotBuilt, PageHeader } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { dayName } from "@/lib/app/format";
import { invitePath } from "@/lib/auth/routes";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { INVITATION_DAYS } from "../../../../convex/lib/invitationTerms";

export function InsightsScreen() {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const week = useQuery(api.overview.week, now ? { companyId, asOf: now } : "skip");
  return (
    <>
      <PageHeader title="Reports" lead="Business results, with the comparison period and what each number leaves out. Booked revenue, completed service revenue and cash collected are kept apart." />
      {week ? (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            {dayName(week.from, timezone)} to {dayName(week.to - 1, timezone)}, against {dayName(week.previousFrom, timezone)} to {dayName(week.from - 1, timezone)}.
          </p>
          <WeekMeasures measures={week.measures} />
        </>
      ) : (
        <Skeleton className="h-40 rounded-2xl" />
      )}
      <div className="mt-5">
        <NotBuilt
          title="Agent performance is not measured yet"
          body="Once agents have acted, this shows the work each completed without your intervention beside its escalations and the proposals you changed or skipped. Autonomy alone is not success if you have to repair the results."
        />
      </div>
    </>
  );
}

export function InboxScreen() {
  return (
    <>
      <PageHeader title="Inbox" lead="One conversation thread per person, shared by every agent, with a way for you to take over." />
      <NotBuilt
        title="Conversations are not built yet"
        body="Texting needs carrier registration for your company, which takes the longest of anything in setup. Until messages can be sent and received, nothing is shown here."
        points={["Customer and applicant conversations", "One send gate for consent, quiet hours and how often a person was contacted", "Take over a thread; the agent stops the moment you do"]}
      />
    </>
  );
}

const INVITE_STATE: Record<string, { word: string; variant: "warning" | "outline" | "success" }> = {
  pending: { word: "Waiting to be accepted", variant: "warning" },
  expired: { word: "Expired", variant: "outline" },
  accepted: { word: "Accepted", variant: "success" },
  revoked: { word: "Withdrawn", variant: "outline" },
};

/** What is known about the invitation email, in words. Only what the mail service reported. */
function deliveryWords(delivery: { state: string; at?: number; problem?: string }): string {
  if (delivery.state === "sent") return `Email sent${delivery.at ? ` ${new Date(delivery.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}`;
  if (delivery.state === "queued") return "Email is being sent";
  if (delivery.state === "failed") return `Email failed. ${delivery.problem ?? ""}`.trim();
  return `Email not sent. ${delivery.problem ?? ""}`.trim();
}

export function Invitations() {
  const { companyId } = useCompany();
  const invitations = useQuery(api.invitations.list, { companyId });
  const create = useMutation(api.invitations.create);
  const revoke = useMutation(api.invitations.revoke);
  const reissue = useMutation(api.invitations.reissue);
  const link = useMutation(api.invitations.link);
  const [form, setForm] = useState({ name: "", email: "", role: "office" as "manager" | "office" });
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const { busy, error, run } = useRun();
  const rowRun = useRun();

  /** The link is built from the page's own address and copied. It is never stored or shown in the list. */
  async function copy(invitationId: Id<"invitations">) {
    await rowRun.run(async () => {
      const { token } = await link({ companyId, invitationId });
      if (!token) return;
      await navigator.clipboard.writeText(`${window.location.origin}${invitePath(token)}`);
      setCopied(invitationId);
      window.setTimeout(() => setCopied((current) => (current === invitationId ? null : current)), 2500);
    });
  }

  return (
    <div className="mt-5 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-strong">Invite someone</h3>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setNote(null);
          void run(async () => {
            const result = await create({ companyId, ...form });
            setNote(result.delivery === "queued" ? `Invitation created. An email is on its way to ${form.email.trim()}.` : `Invitation created. Copy the link below and send it to ${form.email.trim()} yourself.`);
            setForm({ name: "", email: "", role: "office" });
          });
        }}
      >
        <Field label="Name">
          <TextInput value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required autoComplete="off" />
        </Field>
        <Field label="Email">
          <TextInput type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required autoComplete="off" />
        </Field>
        <Field label="Role">
          <SelectInput value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as "manager" | "office" }))}>
            <option value="office">Office</option>
            <option value="manager">Manager</option>
          </SelectInput>
        </Field>
        <Button type="submit" variant="primary" loading={busy}>
          Invite
        </Button>
        <div className="sm:col-span-4">
          <FormError message={error} />
          {note ? (
            <p className="text-sm text-strong" role="status">
              {note}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">Only this email address can accept, and the link works for {INVITATION_DAYS} days. Managers run operations and approvals. Office works customers, visits and tasks.</p>
        </div>
      </form>

      <h3 className="mt-6 text-sm font-semibold text-strong">Invitations</h3>
      {invitations === undefined ? (
        <Skeleton className="mt-3 h-14" />
      ) : invitations.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No invitations yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {invitations.map((row) => {
            const state = INVITE_STATE[row.state] ?? INVITE_STATE.pending;
            return (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-strong">{row.name}</span> <span className="text-muted-foreground">· {row.email}</span>
                  <span className="block text-xs text-muted-foreground">
                    {row.state === "pending" ? `${deliveryWords(row.delivery)} · works until ${new Date(row.expiresAt).toLocaleDateString([], { month: "short", day: "numeric" })}` : row.state === "accepted" && row.acceptedAt ? `Joined ${new Date(row.acceptedAt).toLocaleDateString([], { month: "short", day: "numeric" })}` : state.word}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" size="sm" className="capitalize">
                    {row.role}
                  </Badge>
                  <Badge variant={state.variant} size="sm">
                    {state.word}
                  </Badge>
                  {row.state === "pending" ? (
                    <Button size="sm" variant="secondary" disabled={rowRun.busy} onClick={() => void copy(row.id)}>
                      {copied === row.id ? "Copied" : "Copy link"}
                    </Button>
                  ) : null}
                  {row.state !== "accepted" ? (
                    <Button size="sm" variant="secondary" disabled={rowRun.busy} onClick={() => void rowRun.run(() => reissue({ companyId, invitationId: row.id }))} title="Makes a new link and sends it. The earlier link stops working.">
                      {row.state === "pending" ? "Send a new link" : "Invite again"}
                    </Button>
                  ) : null}
                  {row.state === "pending" || row.state === "expired" ? (
                    <Button size="sm" variant="ghost" disabled={rowRun.busy} onClick={() => void rowRun.run(() => revoke({ companyId, invitationId: row.id }))}>
                      Withdraw
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <FormError message={rowRun.error} />
    </div>
  );
}
