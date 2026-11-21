"use client";

import { useState } from "react";

import { ChevronDown } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * An expandable section: a readable title, an optional one-line summary, a chevron that turns, and a
 * visible focus ring. Built on <details>, so the open state is announced and works without script.
 * `variant="plain"` drops the border for a disclosure inside a card.
 */
export function Disclosure({ title, summary, children, defaultOpen = false, open: controlled, onOpenChange, variant = "card", className }: { title: React.ReactNode; summary?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; variant?: "card" | "plain"; className?: string }) {
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  return (
    <details
      open={open}
      onToggle={(event) => {
        const next = (event.currentTarget as HTMLDetailsElement).open;
        if (next === open) return;
        if (controlled === undefined) setOwn(next);
        onOpenChange?.(next);
      }}
      className={cn("group", variant === "card" ? "rounded-xl border border-border bg-card" : "", className)}
    >
      <summary className={cn("flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-xl text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_srgb,var(--sel-accent,var(--brand))_55%,transparent)] [&::-webkit-details-marker]:hidden", variant === "card" ? "px-3.5 py-2.5" : "py-1.5")}>
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-strong">{title}</span>
          {summary ? <span className="block text-xs text-muted-foreground">{summary}</span> : null}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className={cn(variant === "card" ? "border-t border-border p-3.5" : "pt-2")}>{children}</div>
    </details>
  );
}
