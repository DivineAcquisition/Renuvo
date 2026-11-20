"use client";

/**
 * The ways into "Bring your business to Selestial": onboarding, Settings, the empty Clients list and a Home
 * banner. Every one opens the same saved migration at /app/migration, on the step it was left on.
 */
import { useQuery } from "convex/react";
import Link from "next/link";

import { useCompany } from "@/components/app/company";
import { ArrowRight, FolderOpen } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

export const MIGRATION_PATH = "/app/migration";

const WORDS: Record<string, { label: string; variant: "success" | "warning" | "info" | "outline"; action: string }> = {
  none: { label: "Not started", variant: "outline", action: "Bring your business to Selestial" },
  open: { label: "In progress", variant: "info", action: "Continue your migration" },
  importing: { label: "Importing", variant: "info", action: "See progress" },
  imported: { label: "Ready to verify", variant: "warning", action: "Review your import" },
  released: { label: "Done", variant: "success", action: "Open your migration" },
};

function useStatus() {
  const { companyId } = useCompany();
  return useQuery(api.migration.status, { companyId });
}

/** A card for Settings and onboarding. */
export function MigrationEntry({ className }: { className?: string }) {
  const status = useStatus();
  const words = WORDS[status?.status ?? "none"];
  return (
    <div className={cn("grid gap-3 rounded-xl border border-border p-4", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <FolderOpen className="size-5 text-brand-300" aria-hidden />
        <p className="text-sm font-semibold text-strong">Bring your business to Selestial</p>
        <Badge variant={words.variant}>{words.label}</Badge>
        {status?.attention ? <Badge variant="warning">{status.attention} need attention</Badge> : null}
      </div>
      <p className="text-sm text-muted-foreground">Moving from Jobber, Housecall Pro, BookingKoala or a spreadsheet? Bring your customers, properties and upcoming work in one place, and see what needs attention before anything goes live.</p>
      {status?.canOpen ? (
        <Link href={MIGRATION_PATH} className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-strong hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
          {words.action}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      ) : status ? (
        <p className="text-xs text-muted-foreground">Your Owner or a Manager brings records in.</p>
      ) : null}
    </div>
  );
}

/** Home: shown while a migration isn't finished, or to a new company with no clients yet. */
export function MigrationBanner() {
  const status = useStatus();
  if (!status?.canOpen) return null;
  if (status.status === "released") return null;
  if (!status.status && status.hasClients) return null;
  const words = WORDS[status.status ?? "none"];
  return (
    <Link href={MIGRATION_PATH} className="group flex flex-wrap items-center gap-3 rounded-2xl border border-brand-500/30 bg-gradient-to-r from-brand-500/[0.08] via-brand-500/[0.03] to-transparent px-4 py-3 focus-visible:outline-2 focus-visible:outline-brand-500">
      <span className="grid size-9 place-items-center rounded-lg bg-brand-500/15 text-brand-300">
        <FolderOpen className="size-4" aria-hidden />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="text-sm font-semibold text-strong">{status.status ? words.action : "Moving from another system?"}</span>
        <span className="text-xs text-muted-foreground">
          {status.status === "imported" ? "Your records are in. Check what moved, then release your schedule when you're ready." : status.status === "importing" ? "Your import is running in the background." : status.attention ? `${status.attention} records need your attention.` : "Bring your customers, properties and upcoming work into Selestial."}
        </span>
      </span>
      <ArrowRight className="size-4 text-brand-300 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
    </Link>
  );
}
