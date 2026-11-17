"use client";

/**
 * The Cleaners workspace's visual vocabulary: a person's initials, their engagement status, their
 * readiness in a phrase, and the address-bar state the directory lives in. Every word shown comes from
 * the record; nothing here reassures or guesses.
 */
import type { FunctionReturnType } from "convex/server";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { CheckCircle2, CircleDashed, Clock, PauseCircleIcon, TriangleAlert, UserX } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { parseDirectory, writeDirectory, type DirectoryState } from "@/lib/app/cleaners";
import { cn } from "@/lib/utils";

import type { api } from "../../../../convex/_generated/api";

export type Workspace = FunctionReturnType<typeof api.workforce.workspace>;
export type Row = Workspace["rows"][number];
export type Attention = Workspace["attention"][number];
export type Profile = FunctionReturnType<typeof api.workforce.profile>;
export type ReadinessState = Row["readiness"]["state"];

const TINTS = [
  "bg-brand-500/12 text-brand-700 dark:text-brand-200",
  "bg-indigo-500/12 text-indigo-700 dark:text-indigo-200",
  "bg-fuchsia-500/10 text-fuchsia-800 dark:text-fuchsia-200",
  "bg-slate-500/12 text-slate-700 dark:text-slate-200",
  "bg-violet-500/14 text-violet-800 dark:text-violet-200",
  "bg-sky-500/10 text-sky-800 dark:text-sky-200",
];

function tintOf(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length];
}

/** Neutral initials on a soft tint chosen from the id, so the same person always looks the same. */
export function Avatar({ initials, seed, size = "md", className }: { initials: string; seed: string; size?: "sm" | "md" | "lg" | "xl"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold tracking-tight select-none",
        tintOf(seed),
        size === "sm" ? "size-7 text-[11px]" : size === "md" ? "size-10 text-sm" : size === "lg" ? "size-12 text-base" : "size-16 text-xl",
        className,
      )}
    >
      {initials}
    </span>
  );
}

export const STATUS_LOOK: Record<Row["status"], { label: string; variant: "success" | "info" | "warning" | "outline" }> = {
  ready: { label: "Active", variant: "success" },
  onboarding: { label: "Onboarding", variant: "info" },
  paused: { label: "Paused", variant: "warning" },
  ended: { label: "Ended", variant: "outline" },
};

/** The engagement status a person set. It is never readiness: an active worker can still be blocked. */
export function StatusBadge({ status, size = "sm" }: { status: Row["status"]; size?: "sm" | "default" }) {
  const look = STATUS_LOOK[status];
  return (
    <Badge variant={look.variant} size={size}>
      {look.label}
    </Badge>
  );
}

const READINESS_LOOK: Record<ReadinessState, { icon: typeof CheckCircle2; tone: string; label: string }> = {
  ready: { icon: CheckCircle2, tone: "text-success-foreground", label: "Ready" },
  blocked: { icon: TriangleAlert, tone: "text-warning-foreground", label: "Blocked" },
  onboarding: { icon: CircleDashed, tone: "text-info-foreground", label: "Onboarding" },
  paused: { icon: PauseCircleIcon, tone: "text-muted-foreground", label: "Paused" },
  ended: { icon: UserX, tone: "text-muted-foreground", label: "Ended" },
};

export const READINESS_WORDS: Record<ReadinessState, string> = {
  ready: "Ready for assignments",
  blocked: "Active but blocked",
  onboarding: "Onboarding",
  paused: "Paused",
  ended: "Ended",
};

/** Readiness in one line: an icon and the record's own short explanation. Never color alone. */
export function ReadinessLine({ readiness, className }: { readiness: Row["readiness"]; className?: string }) {
  const look = READINESS_LOOK[readiness.state];
  const Icon = look.icon;
  return (
    <span className={cn("flex min-w-0 items-start gap-1.5 text-xs", className)}>
      <Icon className={cn("mt-px size-3.5 shrink-0", look.tone)} aria-hidden />
      <span className={cn("min-w-0", readiness.state === "ready" ? "font-medium text-strong" : readiness.state === "blocked" ? "font-medium text-warning-foreground" : "text-muted-foreground")}>{readiness.headline}</span>
    </span>
  );
}

export const TYPE_WORDS: Record<Row["engagement"], string> = { employee: "Employee", contractor: "Contractor", subcontracted: "Subcontractor worker" };

export function TypeLabel({ row }: { row: Pick<Row, "engagement" | "subcontractor"> }) {
  return (
    <span className="truncate">
      {TYPE_WORDS[row.engagement]}
      {row.subcontractor ? <span className="text-muted-foreground"> · {row.subcontractor.name}</span> : null}
    </span>
  );
}

/** A few values as quiet chips, with how many more there are. */
export function Chips({ values, max = 3, empty, mono }: { values: string[]; max?: number; empty?: string; mono?: boolean }) {
  if (values.length === 0) return empty ? <span className="text-xs text-muted-foreground">{empty}</span> : null;
  const shown = values.slice(0, max);
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      {shown.map((value) => (
        <span key={value} className={cn("inline-flex h-5 items-center rounded-md border border-border bg-muted/50 px-1.5 text-[11px] leading-none text-strong", mono && "tabular-nums")}>
          {value}
        </span>
      ))}
      {values.length > max ? <span className="inline-flex h-5 items-center px-1 text-[11px] text-muted-foreground">+{values.length - max}</span> : null}
    </span>
  );
}

/** The next accepted visit, or what is known about when they work. */
export function NextLine({ row }: { row: Pick<Row, "next" | "hoursWords" | "offersOut" | "status"> }) {
  if (row.next) {
    return (
      <span className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground">
        <Clock className="mt-px size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0">
          <span className="font-medium text-strong">Next: {row.next.words}</span>
          <span className="block truncate">
            {row.next.service}
            {row.next.area ? ` · ${row.next.area}` : ""}
          </span>
        </span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground">
      <Clock className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span>{row.status === "ready" ? "No accepted visit in the next two weeks" : "No visits"}</span>
        <span className="block truncate">
          Hours: {row.hoursWords}
          {row.offersOut > 0 ? ` · ${row.offersOut} ${row.offersOut === 1 ? "offer" : "offers"} awaiting their answer` : ""}
        </span>
      </span>
    </span>
  );
}

/**
 * The directory's state, read from and written to the address. Filters replace the current entry, so
 * Back does not step through every keystroke; opening a worker adds one entry, so Back closes it.
 */
export function useDirectoryState(): [DirectoryState, (next: Partial<DirectoryState>, mode?: "push" | "replace") => void] {
  const params = useSearchParams();
  const state = useMemo(() => parseDirectory(new URLSearchParams(params.toString())), [params]);
  const set = useCallback(
    (next: Partial<DirectoryState>, mode: "push" | "replace" = "replace") => {
      const merged = { ...parseDirectory(new URLSearchParams(window.location.search)), ...next };
      const url = `${window.location.pathname}${writeDirectory(merged, new URLSearchParams(window.location.search))}${window.location.hash}`;
      if (mode === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [],
  );
  return [state, set];
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}
