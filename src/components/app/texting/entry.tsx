"use client";

/**
 * The way into "Set up business texting" from anywhere it's needed (settings, agent pages, onboarding).
 * Every entry opens the same saved setup at /app/texting, on the step it was left on.
 */
import { useQuery } from "convex/react";
import Link from "next/link";

import { useCompany } from "@/components/app/company";
import { ArrowRight, MessageSquareText } from "@/components/icons";
import { Badge } from "@/components/ui/badge";

import { api } from "../../../../convex/_generated/api";
import { formatPhone } from "./context";

export const TEXTING_PATH = "/app/texting";

const WORDS: Record<string, { label: string; variant: "success" | "warning" | "info" | "error" | "outline"; action: string }> = {
  none: { label: "Not set up", variant: "outline", action: "Set up business texting" },
  requested: { label: "With Selestial review", variant: "info", action: "See progress" },
  approved: { label: "Filing with carriers", variant: "info", action: "See progress" },
  provisioning: { label: "In progress", variant: "info", action: "See progress" },
  waiting_on_carriers: { label: "With the carriers", variant: "info", action: "See progress" },
  needs_you: { label: "Needs you", variant: "warning", action: "See what's needed" },
  active: { label: "Ready", variant: "success", action: "Open texting setup" },
  interrupted: { label: "Paused by carriers", variant: "error", action: "See what's happening" },
  failed: { label: "Selestial is looking into it", variant: "warning", action: "See progress" },
  rejected: { label: "Not approved", variant: "warning", action: "Review and submit again" },
  cancelled: { label: "Withdrawn", variant: "outline", action: "Continue setup" },
};

export function TextingEntry() {
  const { companyId, role } = useCompany();
  const status = useQuery(api.texting.status, { companyId });
  const words = WORDS[status?.status ?? "none"] ?? WORDS.none;
  return (
    <div className="grid gap-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <MessageSquareText className="size-5 text-brand-300" aria-hidden />
        <p className="text-sm font-semibold text-strong">Business texting</p>
        <Badge variant={words.variant}>{words.label}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {status?.status === "active" && status.phoneNumber
          ? `Texts go out from ${formatPhone(status.phoneNumber)}, under your business's own registration.`
          : status?.step ?? "Get a dedicated number for your cleaning company. Selestial prepares your carrier registration (A2P 10DLC) and tells you when your agents can start texting."}
      </p>
      {role === "owner" ? (
        <Link href={TEXTING_PATH} className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-strong hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
          {words.action}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <p className="text-xs text-muted-foreground">Your company&apos;s Owner sets this up.</p>
      )}
    </div>
  );
}
