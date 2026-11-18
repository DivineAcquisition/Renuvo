"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useCompany } from "@/components/app/company";
import { messageOf } from "@/components/app/form";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const SEGMENTS = ["residential", "commercial", "office", "str"] as const;

/**
 * Opens the workspace from any entry point (Sales, a customer, Dispatch), with what that entry point
 * knows filled in. An opportunity always reopens its own draft rather than starting a second one.
 */
export function StartDraft(props: { mode: "booking" | "proposal"; segment?: string; kind?: string; customerId?: string; propertyId?: string; opportunityId?: string; jobId?: string; from?: string }) {
  const { companyId } = useCompany();
  const router = useRouter();
  const start = useMutation(api.sales.startDraft);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const segment = SEGMENTS.find((s) => s === props.segment);
    start({
      companyId,
      mode: props.mode,
      ...(segment ? { segment } : {}),
      ...(props.kind === "recurring" ? { bookingKind: "recurring" as const } : {}),
      ...(props.customerId ? { customerId: props.customerId as Id<"customers"> } : {}),
      ...(props.propertyId ? { propertyId: props.propertyId as Id<"properties"> } : {}),
      ...(props.opportunityId ? { opportunityId: props.opportunityId as Id<"salesOpportunities"> } : {}),
      ...(props.jobId ? { jobId: props.jobId as Id<"jobs"> } : {}),
      ...(props.from ? { from: props.from } : {}),
    })
      .then((draftId) => router.replace(`/app/agents/sales/book/${draftId}`))
      .catch((caught: unknown) => setError(messageOf(caught)));
  }, [companyId, props, router, start]);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive-foreground">
        {error}
      </p>
    );
  return <Skeleton className="h-[60vh] rounded-2xl" />;
}
