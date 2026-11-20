"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState } from "react";

import { canManage, useCompany } from "@/components/app/company";
import { FormError, useRun } from "@/components/app/form";
import { CheckCircle2, ChevronRight, Clock, Mail, RefreshCw, ShieldCheck } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { FACTS } from "@/lib/trust/documents/types";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type Issues = FunctionReturnType<typeof api.operations.issues>;
type Card = Issues["open"][number];
export type IssuePlace = "home" | "integrations" | "texting" | "first-work" | "notifications";

const when = (at: number, timezone: string) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(at));

/**
 * Problems that affect the company's work, where they affect it (docs/operations/04-owner-recovery.md):
 * the consolidated list on Home, and the same cards beside the work they touch. Each card says what is
 * affected, what Selestial has already done, and one next step that does the real thing.
 * Owners and Managers see them; nothing is shown when nothing is wrong.
 */
export function IssueCards({ place, className }: { place: IssuePlace; className?: string }) {
  const { companyId, role } = useCompany();
  const data = useQuery(api.operations.issues, canManage(role) ? { companyId } : "skip");
  if (!data) return null;
  const open = data.open.filter((card) => card.places.includes(place));
  const fixed = place === "home" ? data.fixed : [];
  if (open.length === 0 && fixed.length === 0) return null;
  return (
    <section aria-label={place === "home" ? "Needs your attention" : "Problems affecting this"} className={cn("grid gap-3", className)}>
      {place === "home" && open.length ? <h2 className="font-heading text-base tracking-tight text-strong">Needs your attention</h2> : null}
      {open.map((card) => (
        <IssueCard key={card.id} card={card} />
      ))}
      {fixed.length ? <Fixed rows={fixed} /> : null}
    </section>
  );
}

function IssueCard({ card }: { card: Card }) {
  const { companyId, timezone, role } = useCompany();
  const [open, setOpen] = useState(false);
  const retry = useMutation(api.activation.retry);
  const contact = useMutation(api.operations.contactSupport);
  const { busy, error, run } = useRun();
  const [asked, setAsked] = useState(card.supportAsked);
  const action = card.action;
  const detailsId = `issue-${card.id}`;

  async function askSupport() {
    const handoff = await contact({ companyId, incidentId: card.id as Id<"incidents"> });
    setAsked(true);
    window.location.href = `mailto:${FACTS.supportEmail}?subject=${encodeURIComponent(handoff.subject)}&body=${encodeURIComponent(handoff.body)}`;
  }

  return (
    <article className={cn("rounded-2xl border bg-card p-4 sm:p-5", card.tone === "action" ? "border-warning/35" : "border-border")}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <span aria-hidden className={cn("mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full", card.tone === "action" ? "bg-warning/12 text-warning-foreground" : "bg-brand-500/10 text-brand-600")}>
          {card.tone === "action" ? <Clock className="size-4" /> : <ShieldCheck className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-strong">{card.title}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{card.affected}</p>
          <p className="mt-2 flex items-start gap-1.5 text-sm text-strong">
            <RefreshCw aria-hidden className="mt-0.5 size-3.5 shrink-0 text-brand-600" />
            <span>{card.done}</span>
          </p>
        </div>
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
          {action.kind === "link" ? (
            <Button render={<Link href={action.href} />} size="sm" variant={card.tone === "action" ? "primary" : "outline"}>
              {action.label}
            </Button>
          ) : action.kind === "retry" ? (
            role === "owner" ? (
              <Button size="sm" variant="primary" loading={busy} onClick={() => void run(() => retry({ companyId, taskId: action.taskId as Id<"activationTasks"> }))}>
                {action.label}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">The Owner can try it again.</span>
            )
          ) : null}
          <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(!open)}>
            Details
            <ChevronRight aria-hidden className={cn("size-4 transition-transform", open && "rotate-90")} />
          </Button>
        </div>
      </div>
      <FormError message={error} />
      {open ? (
        <div id={detailsId} className="mt-4 grid gap-3 border-t border-border pt-3 text-sm">
          <ol className="grid gap-1.5">
            {card.updates.map((update, index) => (
              <li key={index} className="flex justify-between gap-3">
                <span className="text-strong">{update.words}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{when(update.at, timezone)}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Reference {card.reference} · last checked {when(card.checkedAt, timezone)}
            </span>
            {asked ? (
              <span className="flex items-center gap-1">
                <CheckCircle2 aria-hidden className="size-3.5 text-success-foreground" />
                Selestial support has been told
              </span>
            ) : (
              <Button size="xs" variant="outline" loading={busy} onClick={() => void run(askSupport)}>
                <Mail aria-hidden className="size-3.5" />
                Contact support
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function Fixed({ rows }: { rows: Issues["fixed"] }) {
  const { timezone } = useCompany();
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3 sm:px-5">
      <p className="text-xs font-medium text-muted-foreground">Fixed recently</p>
      <ul className="mt-1.5 grid gap-1">
        {rows.slice(0, 3).map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <CheckCircle2 aria-hidden className="size-4 shrink-0 text-success-foreground" />
              <span className="truncate text-strong">{row.title}</span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{row.resolvedAt ? when(row.resolvedAt, timezone) : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
