"use client";

import { CheckCircle2, CircleDashed, Info, TriangleAlert } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function StepHeading({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: React.ReactNode }) {
  return (
    <header className="grid gap-1.5">
      <p className="text-xs font-semibold tracking-wide text-brand-300 uppercase">{eyebrow}</p>
      <h2 className="font-display text-2xl font-semibold text-balance text-strong">{title}</h2>
      {lead ? <p className="text-sm text-muted-foreground">{lead}</p> : null}
    </header>
  );
}

export function Section({ title, lead, action, children }: { title: string; lead?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="grid gap-0.5">
          <h3 className="text-sm font-semibold text-strong">{title}</h3>
          {lead ? <p className="text-xs text-muted-foreground">{lead}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warning" | "done" }) {
  const Icon = tone === "warning" ? TriangleAlert : tone === "done" ? CheckCircle2 : Info;
  return (
    <p className={cn("flex gap-2 rounded-xl px-3 py-2.5 text-xs", tone === "warning" ? "bg-warning/10 text-warning-foreground" : tone === "done" ? "bg-success/10 text-success-foreground" : "bg-muted/60 text-muted-foreground")}>
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export const STATE_WORDS: Record<string, { label: string; variant: "success" | "info" | "warning" | "error" | "secondary" | "outline" }> = {
  ready: { label: "Ready to create", variant: "success" },
  update: { label: "Imported before", variant: "info" },
  duplicate: { label: "Possible duplicate", variant: "warning" },
  review: { label: "Needs your review", variant: "warning" },
  error: { label: "Needs correction", variant: "error" },
  skip: { label: "Skipped", variant: "secondary" },
  held: { label: "Not transferred yet", variant: "outline" },
};

export function StateBadge({ state }: { state: string }) {
  const words = STATE_WORDS[state] ?? { label: state, variant: "outline" as const };
  return <Badge variant={words.variant}>{words.label}</Badge>;
}

/** A count tile: a number with what it means. */
export function Tile({ label, value, tone = "plain", hint, onClick, active }: { label: string; value: number; tone?: "plain" | "good" | "warn" | "bad" | "muted"; hint?: string; onClick?: () => void; active?: boolean }) {
  const body = (
    <>
      <span className={cn("font-display text-2xl font-semibold tabular-nums", tone === "good" ? "text-success-foreground" : tone === "warn" ? "text-warning-foreground" : tone === "bad" ? "text-destructive-foreground" : tone === "muted" ? "text-muted-foreground" : "text-strong")}>{value.toLocaleString()}</span>
      <span className="text-xs font-medium text-strong">{label}</span>
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </>
  );
  const cls = cn("grid content-start gap-0.5 rounded-xl border p-3 text-left", active ? "border-brand-500 bg-brand-500/[0.06]" : "border-border bg-card");
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn(cls, "hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500")}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid justify-items-center gap-1.5 rounded-xl border border-dashed border-border px-4 py-8 text-center">
      <CircleDashed className="size-5 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium text-strong">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{body}</p>
    </div>
  );
}
