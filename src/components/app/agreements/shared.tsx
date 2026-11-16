"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ACCESS, agreementPath, isoDay, LIFECYCLE, READINESS, WORKFLOW, type Tone } from "@/lib/app/agreements";
import { cn } from "@/lib/utils";

const VARIANT: Record<Tone, "outline" | "info" | "warning" | "success" | "error"> = { neutral: "outline", info: "info", warning: "warning", success: "success", error: "error" };

export function ToneBadge({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <Badge variant={VARIANT[tone]} size="sm" title={title}>
      {children}
    </Badge>
  );
}

export function WorkflowBadge({ workflow }: { workflow: string }) {
  const look = WORKFLOW[workflow] ?? { label: workflow, tone: "neutral" as const, meaning: "" };
  return (
    <ToneBadge tone={look.tone} title={look.meaning}>
      {look.label}
    </ToneBadge>
  );
}

export function LifecycleBadge({ status }: { status: string }) {
  if (status === "none") return null;
  const look = LIFECYCLE[status] ?? { label: status, tone: "neutral" as const };
  return <ToneBadge tone={look.tone}>{look.label}</ToneBadge>;
}

export function ReadinessBadge({ readiness }: { readiness: string }) {
  const look = READINESS[readiness];
  return (
    <ToneBadge tone={readiness === "specialist_review" ? "warning" : readiness === "template" ? "success" : "info"} title={look?.meaning}>
      {look?.label ?? readiness}
    </ToneBadge>
  );
}

export function AccessBadge({ access }: { access: string }) {
  if (access === "company") return null;
  return (
    <ToneBadge tone="neutral" title={ACCESS[access]}>
      {access === "restricted" ? "Owner only" : "Owners & Managers"}
    </ToneBadge>
  );
}

export type Row = {
  id: string;
  title: string;
  typeLabel: string;
  workflow: string;
  lifecycle: string;
  access: string;
  effectiveOn: string | null;
  renewalOn: string | null;
  expiresOn: string | null;
  parties: { role: string; name: string }[];
  version: number;
  provenance: string;
  archived: boolean;
};

/** One agreement in a list. The whole row is a link to the same detail workspace Chat and records open. */
export function AgreementRow({ row, show = "dates" }: { row: Row; show?: "dates" | "renewal" }) {
  const others = row.parties.filter((p) => p.role !== "company").map((p) => p.name);
  return (
    <li>
      <Link href={agreementPath(row.id)} className="group flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none sm:px-5">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-strong group-hover:text-brand-600">{row.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {row.typeLabel}
            {others.length ? ` · ${others.join(", ")}` : ""} · version {row.version}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <AccessBadge access={row.access} />
          <WorkflowBadge workflow={row.workflow} />
          <LifecycleBadge status={row.lifecycle} />
          <span className="text-xs text-muted-foreground">{show === "renewal" ? `Renews or ends ${isoDay(row.renewalOn ?? row.expiresOn)}` : row.effectiveOn ? `Effective ${isoDay(row.effectiveOn)}` : ""}</span>
        </span>
      </Link>
    </li>
  );
}

export function Empty({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
      <p className="text-base font-semibold text-strong">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{children}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = "info", children, className }: { tone?: "info" | "warning" | "error"; children: React.ReactNode; className?: string }) {
  const style = tone === "error" ? "border-destructive/30 bg-destructive/5" : tone === "warning" ? "border-warning/40 bg-warning/10" : "border-border bg-muted/50";
  return (
    <p role={tone === "info" ? "note" : "alert"} className={cn("rounded-xl border px-3.5 py-2.5 text-sm text-strong", style, className)}>
      {children}
    </p>
  );
}
