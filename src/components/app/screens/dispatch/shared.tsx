"use client";

import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { TextInput } from "@/components/app/form";
import { TriangleAlert } from "@/components/icons";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { addLocalDays, clock, dayName, localDate, localDayStart, zonedInstant } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import type { api } from "../../../../../convex/_generated/api";

export type Board = FunctionReturnType<typeof api.dispatchViews.board>;
export type JobRow = Board["jobs"][number];
export type Group = JobRow["group"];

type Variant = NonNullable<BadgeProps["variant"]>;

/** The board's groups, in the order work moves through them. Each is worked out from the record, never stored. */
export const GROUPS: { id: Group; label: string; hint: string; variant: Variant }[] = [
  { id: "needs_staffing", label: "Needs staffing", hint: "Nobody accepted, no offer out, nothing waiting on you.", variant: "error" },
  { id: "awaiting_approval", label: "Awaiting approval", hint: "Dispatch proposed a cleaner and is waiting for a decision.", variant: "warning" },
  { id: "offers_out", label: "Offers out", hint: "At least one place is open and has an offer out.", variant: "info" },
  { id: "partially_staffed", label: "Partially staffed", hint: "Some places accepted, and no offer out for the rest.", variant: "warning" },
  { id: "fully_staffed", label: "Fully staffed", hint: "Every required place has an accepted cleaner.", variant: "success" },
  { id: "in_progress", label: "In progress", hint: "A cleaner checked in, or the office started the visit.", variant: "info" },
  { id: "awaiting_completion_review", label: "Awaiting completion review", hint: "The crew reported it done. A person has not reviewed it.", variant: "warning" },
  { id: "closed", label: "Closed", hint: "Completed or cancelled.", variant: "outline" },
];
export const GROUP = Object.fromEntries(GROUPS.map((group) => [group.id, group])) as Record<Group, (typeof GROUPS)[number]>;

/** What a text's last reported state means, in the words a person can act on. Delivered is not read. */
export const DELIVERY: Record<string, { label: string; variant: Variant }> = {
  queued: { label: "Text queued", variant: "outline" },
  held: { label: "Text held for quiet hours", variant: "outline" },
  sending: { label: "Text sending", variant: "outline" },
  sent: { label: "Text sent · delivery not confirmed", variant: "info" },
  delivered: { label: "Text delivered to the phone", variant: "success" },
  failed: { label: "Text not delivered", variant: "error" },
  unconfirmed: { label: "Text delivery unknown", variant: "warning" },
  not_sent: { label: "No text sent", variant: "warning" },
};

export function deliveryOf(messages: { status: string; problem: string | null }[]) {
  const last = messages[messages.length - 1];
  if (!last) return { label: "No text planned", variant: "warning" as Variant, problem: null as string | null, failed: true };
  const words = DELIVERY[last.status] ?? { label: last.status, variant: "outline" as Variant };
  return { ...words, problem: last.problem, failed: last.status === "failed" || last.status === "not_sent" || last.status === "unconfirmed" };
}

/** "1 of 3": accepted against required, always both numbers. */
export function Staffing({ row }: { row: Pick<JobRow, "requiredCrew" | "acceptedCrew" | "openPlaces" | "status"> }) {
  const full = row.openPlaces === 0;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold tabular-nums", row.status === "cancelled" ? "text-muted-foreground" : full ? "text-success-foreground" : "text-warning-foreground")} title="Accepted cleaners of the number this visit needs">
      {row.acceptedCrew} of {row.requiredCrew}
      <span className="font-normal text-muted-foreground">accepted</span>
    </span>
  );
}

export function GroupBadge({ group }: { group: Group }) {
  return (
    <Badge variant={GROUP[group].variant} size="sm">
      {GROUP[group].label}
    </Badge>
  );
}

/** "10:00 AM to 10:30 AM arrival" when there is a window; one time is never shown for a span. */
export function arrivalLabel(row: Pick<JobRow, "startsAt" | "arrivalEndsAt">, timezone: string): string {
  return row.arrivalEndsAt > row.startsAt ? `Arrive ${clock(row.startsAt, timezone)} to ${clock(row.arrivalEndsAt, timezone)}` : `Arrive ${clock(row.startsAt, timezone)}`;
}

/** Shown when a list hit the most a query reads, so a total is never taken for the whole. */
export function Incomplete({ what }: { what: string }) {
  return (
    <p role="status" className="flex items-start gap-2 rounded-xl border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>This list stops at 200 {what}, so it may not be all of them and the counts here are not totals. Choose a shorter range to see everything in it.</span>
    </p>
  );
}

// ── The range of days a screen shows ────────────────────────────────────────────────────────────────

export type RangeMode = "today" | "tomorrow" | "week" | "day";
export type Range = { mode: RangeMode; from: number; to: number; label: string; set: (mode: RangeMode) => void; day: string; setDay: (day: string) => void; step: (days: number) => void };

/** Days on the company's clock. `now` only decides what "today" is, so the range is steady within a day. */
export function useRange(now: number, timezone: string, initial: RangeMode = "today"): Range {
  const [mode, setMode] = useState<RangeMode>(initial);
  const [picked, setPicked] = useState<string | null>(null);
  const today = localDayStart(now, timezone);
  const pickedStart = picked ? zonedInstant(picked, "00:00", timezone) : null;
  const from = mode === "tomorrow" ? addLocalDays(today, 1, timezone) : mode === "day" && pickedStart !== null ? pickedStart : today;
  const to = addLocalDays(from, mode === "week" ? 7 : 1, timezone);
  const label = mode === "today" ? "Today" : mode === "tomorrow" ? "Tomorrow" : mode === "week" ? "The next 7 days" : dayName(from, timezone);
  return {
    mode,
    from,
    to,
    label,
    set: setMode,
    day: localDate(from, timezone),
    setDay: (day) => {
      setPicked(day);
      setMode("day");
    },
    step: (days) => {
      setPicked(localDate(addLocalDays(from, days, timezone), timezone));
      setMode("day");
    },
  };
}

export function RangePicker({ range, week = true }: { range: Range; week?: boolean }) {
  const options: { id: RangeMode; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "tomorrow", label: "Tomorrow" },
    ...(week ? [{ id: "week" as const, label: "7 days" }] : []),
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="tablist" aria-label="Which days to show" className="inline-flex rounded-lg border border-border bg-muted p-0.5">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={range.mode === option.id}
            onClick={() => range.set(option.id)}
            className={cn("rounded-md px-3 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500", range.mode === option.id ? "bg-card text-strong shadow-sm" : "text-muted-foreground hover:text-strong")}
          >
            {option.label}
          </button>
        ))}
      </div>
      <TextInput type="date" aria-label="Choose a day" value={range.mode === "week" ? "" : range.day} onChange={(event) => (event.target.value ? range.setDay(event.target.value) : undefined)} className="min-h-8 w-auto px-2 py-1 text-xs" />
    </div>
  );
}

/** A row of choices that narrows a list. "all" is always the first choice. */
export function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { id: string; label: string }[] }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="min-h-8 cursor-pointer rounded-lg border border-border bg-card px-2 py-1 text-xs font-medium text-strong focus-visible:outline-2 focus-visible:outline-brand-500/30">
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
