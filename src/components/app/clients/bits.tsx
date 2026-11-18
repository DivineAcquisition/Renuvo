"use client";

/** Small pieces every Clients screen shares: the client's mark, labels in words, times on the company's clock, and empty states. */
import { BuildingsIcon, CircleDashed, Home, PauseCircleIcon, UserX } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { RELATIONSHIP_LABELS } from "@/lib/app/clients";
import { cn } from "@/lib/utils";

const TONES = ["bg-brand-500/12 text-brand-300", "bg-sky-500/12 text-sky-700 dark:text-sky-300", "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", "bg-amber-500/14 text-amber-800 dark:text-amber-300", "bg-rose-500/12 text-rose-700 dark:text-rose-300"];

function toneOf(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

export function initialsOf(name: string) {
  const parts = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? ""))).toUpperCase();
}

const SIZES = { sm: "size-8 text-[11px]", md: "size-10 text-xs", lg: "size-14 text-base" } as const;

/** A person's initials in a circle, or a business's in a rounded square with a building. */
export function ClientMark({ name, type, size = "md", className }: { name: string; type: "person" | "business"; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span aria-hidden className={cn("relative grid shrink-0 place-items-center font-semibold tracking-wide ring-1 ring-black/5", type === "business" ? "rounded-xl" : "rounded-full", SIZES[size], toneOf(name), className)}>
      {initialsOf(name)}
      {type === "business" ? <BuildingsIcon className="absolute -right-1 -bottom-1 size-4 rounded-full bg-card p-0.5 text-muted-foreground ring-1 ring-border" /> : null}
    </span>
  );
}

/** The relationship in words, with an icon so it never depends on color. */
export function RelationshipBadge({ relationship }: { relationship: keyof typeof RELATIONSHIP_LABELS }) {
  const style = { prospect: "info", active: "success", paused: "warning", former: "outline" } as const;
  const Icon = relationship === "paused" ? PauseCircleIcon : relationship === "former" ? UserX : relationship === "prospect" ? CircleDashed : null;
  return (
    <Badge variant={style[relationship]} size="sm">
      {Icon ? <Icon aria-hidden className="size-3" /> : null}
      {RELATIONSHIP_LABELS[relationship]}
    </Badge>
  );
}

export function CategoryChips({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <span key={label} className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {label}
        </span>
      ))}
    </span>
  );
}

export function PropertyKindIcon({ kind, className }: { kind: string; className?: string }) {
  return kind === "home" ? <Home aria-hidden className={className} /> : <BuildingsIcon aria-hidden className={className} />;
}

/** "Tue, Mar 2, 10:00 AM" on the company's clock. */
export function when(at: number, timezone: string) {
  return new Date(at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone });
}

export function day(at: number, timezone: string) {
  return new Date(at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: timezone });
}

export function clock(at: number, timezone: string) {
  return new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone });
}

/** The arrival: "10:00 AM" or "between 10:00 and 10:30 AM". */
export function arrival(startsAt: number, windowMinutes: number, timezone: string) {
  if (!windowMinutes) return `arrives ${clock(startsAt, timezone)}`;
  return `arrives ${clock(startsAt, timezone)}–${clock(startsAt + windowMinutes * 60_000, timezone)}`;
}

export function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/** Staffing in words, with a shape as well as a color: full, partial or none. */
export function StaffingLine({ staffing, compact }: { staffing: { state: "full" | "partial" | "none"; words: string | null; handling: string | null } | null; compact?: boolean }) {
  if (!staffing?.words) return null;
  const dot = staffing.state === "full" ? "bg-success" : staffing.state === "partial" ? "bg-warning" : "border border-warning-foreground/60 bg-transparent";
  const words = compact ? (staffing.state === "full" ? "Crew confirmed" : staffing.words.replace(" cleaners accepted", " accepted")) : staffing.words;
  return (
    <span className={cn("inline-flex items-baseline gap-1.5", compact ? "text-xs" : "text-sm")}>
      <span aria-hidden className={cn("inline-block size-2 shrink-0 translate-y-[-1px] rounded-full", dot)} />
      <span>
        <span className="text-strong">{words}</span>
        {staffing.handling && !compact ? <span className="text-muted-foreground"> · {staffing.handling}</span> : null}
      </span>
    </span>
  );
}

/** Guidance for an empty place: what it is for and the one thing to do next. */
export function EmptyState({ title, children, action, className }: { title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center", className)}>
      <p className="font-medium text-strong">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Card({ title, action, children, className, id }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} aria-label={title} className={cn("min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5", className)}>
      {title || action ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h3 className="font-heading text-base tracking-tight text-strong">{title}</h3> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}
