"use client";

import type { FunctionReturnType } from "convex/server";

import type { api } from "../../../../convex/_generated/api";
import type { DraftBody } from "../../../../convex/lib/sales/draft";
import type { DraftData, Working } from "./use-draft";

type Summary = FunctionReturnType<typeof api.sales.price>;

/** Proposal mode. Built out in the proposals phase; this keeps the switch working meanwhile. */
export function ProposalWorkspace(props: { data: DraftData; working: Working; update: (change: Partial<Working>) => void; setBody: (change: (body: DraftBody) => DraftBody) => void; summary: Summary | undefined; flush: () => Promise<void>; revision: () => number }) {
  void props;
  return <p className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">Proposal mode is being prepared.</p>;
}
