"use client";

import { useQuery } from "convex/react";
import Link from "next/link";

import { useCompany } from "@/components/app/company";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

/**
 * Selestial Credits, compactly: how many are left and how many are held for work in progress. Shown in
 * Chat and next to AI work. It says why AI work is paused when it is, and never shows prices.
 */
export function CreditIndicator({ className }: { className?: string }) {
  const { companyId, role } = useCompany();
  const credits = useQuery(api.billing.creditIndicator, { companyId });
  if (!credits) return null;
  const where = role === "owner" ? (
    <Link href="/app/settings/billing" className="underline underline-offset-2">
      Plan &amp; Usage
    </Link>
  ) : (
    "the Owner"
  );
  if (credits.state === "ok") {
    return (
      <span className={cn("tabular-nums", credits.low && "text-warning-foreground", className)}>
        {credits.available?.toLocaleString("en-US")} credits left{credits.reserved > 0 ? `, ${credits.reserved.toLocaleString("en-US")} held for work in progress` : ""}.
      </span>
    );
  }
  if (credits.state === "unknown") return <span className={className}>{credits.message}</span>;
  return (
    <span className={cn("text-warning-foreground", className)}>
      {credits.message} {credits.state === "empty" || credits.state === "no_plan" ? <>See {where}.</> : null}
    </span>
  );
}
