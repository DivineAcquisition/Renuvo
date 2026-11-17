"use client";

/**
 * The Cleaners workspace's visual vocabulary: a person's avatar, their engagement and readiness badges, and
 * the small chips for areas, skills and crews. Every state has words; color only reinforces them.
 */
import { Check, CircleDashed, Clock, Hand, PauseCircleIcon, TriangleAlert, UserX } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ReadinessState = "ready" | "blocked" | "onboarding" | "not_active";
export type EngagementStatus = "onboarding" | "ready" | "paused" | "suspended" | "ended";
export type Engagement = "employee" | "contractor" | "subcontractor";

/** Soft, readable tones for initials. Chosen from the name so a person keeps their color. */
const TONES = [
  "bg-[#eee8ff] text-[#5126c7] dark:bg-[#2f1777] dark:text-[#cfc2ff]",
  "bg-[#e0f2fe] text-[#075985] dark:bg-[#0c4a6e] dark:text-[#bae6fd]",
  "bg-[#dcfce7] text-[#166534] dark:bg-[#14532d] dark:text-[#bbf7d0]",
  "bg-[#fef3c7] text-[#92400e] dark:bg-[#78350f] dark:text-[#fde68a]",
  "bg-[#fce7f3] text-[#9d174d] dark:bg-[#831843] dark:text-[#fbcfe8]",
  "bg-[#e0e7ff] text-[#3730a3] dark:bg-[#312e81] dark:text-[#c7d2fe]",
];

function toneOf(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

const SIZES = { xs: "size-7 text-[11px]", sm: "size-9 text-xs", md: "size-11 text-sm", lg: "size-14 text-base", xl: "size-20 text-xl" } as const;

export function Avatar({ name, initials, photoUrl, size = "md", className }: { name: string; initials: string; photoUrl?: string | null; size?: keyof typeof SIZES; className?: string }) {
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- a private storage address, not a static asset
    return <img src={photoUrl} alt="" className={cn("shrink-0 rounded-full object-cover ring-1 ring-border", SIZES[size], className)} />;
  }
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full font-semibold tracking-wide ring-1 ring-black/5", SIZES[size], toneOf(name), className)}>
      {initials}
    </span>
  );
}

export const ENGAGEMENT_WORDS: Record<Engagement, string> = { employee: "Employee", contractor: "Independent contractor", subcontractor: "Subcontractor worker" };
export const ENGAGEMENT_SHORT: Record<Engagement, string> = { employee: "Employee", contractor: "Contractor", subcontractor: "Subcontractor" };
export const STATUS_WORDS: Record<EngagementStatus, string> = { onboarding: "Onboarding", ready: "Active", paused: "Paused", suspended: "Suspended", ended: "Ended" };

const STATUS_STYLE: Record<EngagementStatus, "info" | "success" | "warning" | "error" | "outline"> = { onboarding: "info", ready: "success", paused: "warning", suspended: "error", ended: "outline" };

/** Engagement status: whether a person made the relationship active. It says nothing about readiness. */
export function StatusBadge({ status, size = "sm" }: { status: EngagementStatus; size?: "sm" | "default" }) {
  const Icon = status === "ready" ? Check : status === "paused" ? PauseCircleIcon : status === "suspended" ? Hand : status === "ended" ? UserX : CircleDashed;
  return (
    <Badge variant={STATUS_STYLE[status]} size={size}>
      <Icon aria-hidden />
      {STATUS_WORDS[status]}
    </Badge>
  );
}

export const READINESS_WORDS: Record<ReadinessState, string> = { ready: "Ready for assignments", blocked: "Not ready for assignments", onboarding: "Onboarding", not_active: "Not taking work" };

/** Job eligibility in words, with a dot that agrees with them. */
export function ReadinessLine({ state, detail, className }: { state: ReadinessState; detail?: string | null; className?: string }) {
  const dot = state === "ready" ? "bg-success" : state === "blocked" ? "bg-destructive" : state === "onboarding" ? "bg-info" : "bg-muted-foreground/50";
  return (
    <p className={cn("flex min-w-0 items-start gap-2 text-sm", className)}>
      <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", dot)} />
      <span className="min-w-0">
        <span className="font-medium text-strong">{READINESS_WORDS[state]}</span>
        {detail ? <span className="block text-xs leading-relaxed text-muted-foreground">{detail}</span> : null}
      </span>
    </p>
  );
}

export function ReadinessBadge({ state }: { state: ReadinessState }) {
  const variant = state === "ready" ? "success" : state === "blocked" ? "error" : state === "onboarding" ? "info" : "outline";
  const Icon = state === "ready" ? Check : state === "blocked" ? TriangleAlert : state === "onboarding" ? Clock : PauseCircleIcon;
  return (
    <Badge variant={variant} size="sm">
      <Icon aria-hidden />
      {state === "ready" ? "Ready" : state === "blocked" ? "Not ready" : state === "onboarding" ? "Onboarding" : "Not taking work"}
    </Badge>
  );
}

/** A thin bar for onboarding progress. The words are always beside it. */
export function Progress({ met, total, className }: { met: number; total: number; className?: string }) {
  const share = total > 0 ? Math.round((met / total) * 100) : 0;
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span className="h-1.5 w-full min-w-12 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={met} aria-label={`${met} of ${total} requirements met`}>
        <span className="block h-full rounded-full bg-brand-500 transition-[width] duration-500" style={{ width: `${share}%` }} />
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {met}/{total}
      </span>
    </span>
  );
}

/** A few chips and a "+N" for the rest, so a card never grows a wall of tags. */
export function Chips({ items, max = 3, tone = "muted", label }: { items: string[]; max?: number; tone?: "muted" | "brand"; label: string }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, max);
  return (
    <ul className="flex flex-wrap gap-1" aria-label={label}>
      {shown.map((item) => (
        <li key={item} className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4", tone === "brand" ? "bg-brand-950 text-brand-300" : "bg-muted text-muted-foreground")}>
          {item}
        </li>
      ))}
      {items.length > max ? <li className="rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 text-muted-foreground">+{items.length - max}</li> : null}
    </ul>
  );
}

export const REQUIREMENT_STATE_WORDS = {
  not_started: "Not started",
  submitted: "Submitted",
  awaiting_review: "Awaiting review",
  accepted: "Accepted",
  needs_changes: "Needs changes",
  expired: "Expired",
  waived: "Waived",
} as const;
export type RequirementState = keyof typeof REQUIREMENT_STATE_WORDS;

export function RequirementBadge({ state }: { state: RequirementState }) {
  const variant = state === "accepted" ? "success" : state === "waived" ? "outline" : state === "awaiting_review" || state === "submitted" ? "info" : state === "needs_changes" || state === "expired" ? "warning" : "outline";
  return (
    <Badge variant={variant} size="sm">
      {REQUIREMENT_STATE_WORDS[state]}
    </Badge>
  );
}

export const EFFECT_WORDS = { blocks_assignments: "Needed before work", blocks_payment: "Needed before payment", informational: "For information" } as const;
