"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { canManage, useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { FormError, TextInput, useRun } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Check, Copy } from "@/components/icons";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { dayName, clock, whenLabel } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import { DELIVERY, Filter } from "./shared";

type Row = FunctionReturnType<typeof api.dispatchViews.actionLinks>[number];
type Variant = NonNullable<BadgeProps["variant"]>;

const STATUS: Record<Row["status"], { label: string; variant: Variant }> = {
  active: { label: "Works", variant: "success" },
  expired: { label: "Expired", variant: "outline" },
  revoked: { label: "Closed", variant: "outline" },
};
/** "Send an ETA" → "send an ETA": only the first letter changes, so ETA keeps its capitals. */
const lower = (words: string) => words.charAt(0).toLowerCase() + words.slice(1);
const PURPOSE: Record<Row["purpose"], string> = { offer: "Offer", job: "Accepted job" };
const ACTION: Record<string, string> = {
  accept: "Accept the offer",
  decline: "Decline the offer",
  check_in: "Check in",
  report_delay: "Send an ETA",
  cannot_attend: "Say they cannot come",
  checklist: "Update the checklist",
  photos: "Add photos",
  report: "Send a report",
  complete: "Submit the job",
};

function Reveal({ row }: { row: Row }) {
  const { companyId } = useCompany();
  const reveal = useMutation(api.dispatchOps.revealActionLink);
  const { busy, error, run } = useRun();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (url) {
    return (
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <TextInput readOnly value={url} aria-label="The link" onFocus={(event) => event.target.select()} className="min-h-8 py-1 font-mono text-xs" />
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              void navigator.clipboard?.writeText(url).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              })
            }
          >
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setUrl(null)}>
            Hide
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Anyone with this address can act as {row.recipient.name ?? "the cleaner"} on this {row.purpose === "offer" ? "offer" : "job"}. Send it only to them. Showing it was recorded.</p>
      </div>
    );
  }
  return (
    <>
      <Button variant="outline" size="xs" disabled={busy} onClick={() => void run(async () => setUrl((await reveal({ companyId, linkId: row.linkId })).url))}>
        Show the link
      </Button>
      <FormError message={error} />
    </>
  );
}

function LinkRow({ row, now, timezone }: { row: Row; now: number; timezone: string }) {
  const { companyId, role } = useCompany();
  const open = useDetail();
  const revoke = useMutation(api.dispatchOps.revokeActionLink);
  const reissue = useMutation(api.dispatchOps.reissueLink);
  const { busy, error, run } = useRun();
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const status = STATUS[row.status];
  const manager = canManage(role);
  const live = row.status === "active";
  const stillHeld = row.response !== null && (row.purpose === "offer" ? row.response.assignmentStatus === "offered" : row.response.assignmentStatus === "accepted");
  const last = row.messages[row.messages.length - 1];
  const textWords = last ? (DELIVERY[last.status] ?? { label: last.status, variant: "outline" as Variant }) : null;
  return (
    <li className="grid gap-2 px-4 py-3.5 text-sm sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p>
            <span className="font-medium text-strong">{row.recipient.name ?? "A cleaner"}</span>
            <span className="text-muted-foreground"> · {PURPOSE[row.purpose]} link</span>
          </p>
          <button type="button" onClick={() => open({ kind: "job", id: row.jobId })} className="text-left text-xs font-medium text-brand-300 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
            {row.customer ?? "Unknown customer"}
            {row.serviceType ? ` · ${row.serviceType}` : ""}
            {row.jobStartsAt ? ` · ${dayName(row.jobStartsAt, timezone)}, ${clock(row.jobStartsAt, timezone)}` : ""}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={status.variant} size="sm">
            {status.label}
          </Badge>
          {textWords ? (
            <Badge variant={textWords.variant} size="sm">
              {textWords.label}
            </Badge>
          ) : (
            <Badge variant="warning" size="sm">
              Never texted
            </Badge>
          )}
        </div>
      </div>
      <dl className="grid gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="inline">Issued </dt>
          <dd className="inline text-strong">{whenLabel(row.issuedAt, now, timezone)}</dd>
        </div>
        <div>
          <dt className="inline">{row.status === "revoked" ? "Closed " : row.status === "expired" ? "Expired " : "Works until "}</dt>
          <dd className="inline text-strong">{whenLabel(row.revokedAt ?? row.expiresAt, now, timezone)}</dd>
        </div>
        <div>
          <dt className="inline">Opened: </dt>
          <dd className="inline text-strong" title="Page views are not recorded, so whether the link was opened is not known.">
            Not tracked
          </dd>
        </div>
        <div>
          <dt className="inline">Last action: </dt>
          <dd className="inline text-strong">{row.lastAction ? `${lower(ACTION[row.lastAction] ?? row.lastAction)}, ${whenLabel(row.lastActionAt!, now, timezone)}` : "None"}</dd>
        </div>
      </dl>
      {row.revokeReason ? <p className="text-xs text-muted-foreground">Closed because: {row.revokeReason}</p> : null}
      {last?.problem ? (
        <details className="text-xs text-destructive-foreground">
          <summary className="cursor-pointer font-medium">Why the text did not go</summary>
          <p className="mt-1 leading-relaxed">{last.problem}</p>
        </details>
      ) : null}
      <p className="text-xs text-strong">
        <span className="text-muted-foreground">Next: </span>
        {row.nextAction}
      </p>
      <p className="text-[11px] text-muted-foreground">Can do: {row.allowed.map((action) => lower(ACTION[action] ?? action)).join(", ")}.</p>
      <FormError message={error} />
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {manager ? (
        revoking ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await revoke({ companyId, linkId: row.linkId, reason: reason.trim() });
                setRevoking(false);
              });
            }}
          >
            <TextInput autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this link being closed?" aria-label="Why is this link being closed?" required maxLength={300} className="max-w-sm" />
            <Button type="submit" variant="destructive-outline" size="xs" loading={busy}>
              Close the link
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setRevoking(false)}>
              Never mind
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap items-start gap-2">
            {live ? <Reveal row={row} /> : null}
            {stillHeld ? (
              <Button
                variant="outline"
                size="xs"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const sent = await reissue({ companyId, assignmentId: row.assignmentId });
                    setNote(sent.problem ? `A new link was issued and this one closed, but the text did not go: ${sent.problem}` : "A new link was issued and texted. This one is closed.");
                  })
                }
              >
                Replace with a new link
              </Button>
            ) : null}
            {live ? (
              <Button variant="ghost" size="xs" onClick={() => setRevoking(true)}>
                Close the link
              </Button>
            ) : null}
          </div>
        )
      ) : null}
    </li>
  );
}

/**
 * Action Links: every link texted to a cleaner, what it lets them do, whether the text went, what they
 * did through it and what happens next. Whether a link was opened is not recorded, and is never guessed.
 */
export function ActionLinksScreen() {
  const { companyId, timezone, role } = useCompany();
  const now = useNow();
  const [limit, setLimit] = useState(100);
  const rows = useQuery(api.dispatchViews.actionLinks, { companyId, limit });
  const [filters, setFilters] = useState({ status: "active", purpose: "all", text: "all" });
  const [search, setSearch] = useState("");
  const set = (key: keyof typeof filters) => (value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const term = search.trim().toLowerCase();
  const failed = (row: Row) => {
    const last = row.messages[row.messages.length - 1];
    return !last || ["failed", "not_sent", "unconfirmed"].includes(last.status);
  };
  const shown = (rows ?? [])
    .filter((row) => filters.status === "all" || row.status === filters.status)
    .filter((row) => filters.purpose === "all" || row.purpose === filters.purpose)
    .filter((row) => filters.text === "all" || failed(row))
    .filter((row) => !term || `${row.recipient.name ?? ""} ${row.customer ?? ""} ${row.serviceType ?? ""}`.toLowerCase().includes(term));
  const full = rows !== undefined && rows.length === limit;

  return (
    <>
      <PageHeader title="Action Links" lead="Every link texted to a cleaner: what it lets them do, until when, whether the text went, and what they did with it. Replacing a link closes the old one." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by cleaner or customer" aria-label="Search by cleaner or customer" className="min-h-8 max-w-xs py-1 text-sm" />
        <Filter label="State" value={filters.status} onChange={set("status")} options={[{ id: "active", label: "Works" }, { id: "all", label: "All" }, { id: "expired", label: "Expired" }, { id: "revoked", label: "Closed" }]} />
        <Filter label="Kind" value={filters.purpose} onChange={set("purpose")} options={[{ id: "all", label: "All" }, { id: "offer", label: "Offer" }, { id: "job", label: "Accepted job" }]} />
        <Filter label="Text" value={filters.text} onChange={set("text")} options={[{ id: "all", label: "Any" }, { id: "failed", label: "Not delivered or never sent" }]} />
      </div>
      {!canManage(role) ? <p className="mb-3 text-sm text-muted-foreground">Owners and Managers can show, replace and close links.</p> : null}
      <Panel flush>
        {rows === undefined ? (
          <div className="grid gap-2 p-5">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : shown.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">{rows.length === 0 ? "No link has been issued yet. One is issued with every offer and every acceptance." : `None of the ${rows.length} most recent links match.`}</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((row) => (
              <LinkRow key={row.linkId} row={row} now={now} timezone={timezone} />
            ))}
          </ul>
        )}
      </Panel>
      {full ? (
        <div className={cn("mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground")}>
          <span>Showing the {limit} most recent links. Older ones are not in this list.</span>
          {limit < 200 ? (
            <Button variant="outline" size="xs" onClick={() => setLimit(200)}>
              Show up to 200
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
