"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, useRun } from "@/components/app/form";
import { ArrowLeft } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { centsFrom, dollarsText, SERVICES_ROOT, servicePath } from "@/lib/app/services";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "../../../../convex/lib/services/spec";
import { formatCents, Notice, SectionTitle } from "./shared";

type Method = "fixed" | "hourly_per_cleaner" | "hourly_per_crew" | "per_area" | "per_unit" | "recurring_package";
const UNITS: { id: Method; label: string }[] = [
  { id: "fixed", label: "Per visit" },
  { id: "hourly_per_cleaner", label: "Per cleaner per hour" },
  { id: "hourly_per_crew", label: "Per hour for the crew" },
  { id: "per_area", label: "Per square foot" },
  { id: "per_unit", label: "Per unit (room, window…)" },
  { id: "recurring_package", label: "Per calendar month" },
];

/** Every row read from the file, with where it came from and what is unclear. Each becomes a draft only when a person says so. */
export function ImportReview({ importId }: { importId: string }) {
  const { companyId } = useCompany();
  const data = useQuery(api.servicesImports.get, { companyId, importId: importId as Id<"serviceImports"> });
  const decide = useMutation(api.servicesImports.decide);
  const discard = useMutation(api.servicesImports.discard);
  const { busy, error, run } = useRun();
  const [category, setCategory] = useState<Category>("residential");
  const [edits, setEdits] = useState<Record<string, { name?: string; price?: string; method?: Method }>>({});
  if (!data) return <Skeleton className="h-96 rounded-2xl" />;
  const pending = data.rows.filter((r) => r.decision === "pending").length;
  return (
    <div className="grid grid-cols-1 gap-5">
      <div>
        <Link href={SERVICES_ROOT} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-strong">
          <ArrowLeft aria-hidden className="size-4" /> All services
        </Link>
        <SectionTitle title={`Review: ${data.name}`}>
          {data.rows.length} row{data.rows.length === 1 ? "" : "s"} read, {pending} waiting for you. Correct anything unclear, then make each a draft or skip it. Drafts are reviewed before anything goes live.
        </SectionTitle>
      </div>
      {data.state === "failed" ? <Notice tone="critical" title="This import could not be read">{data.error}</Notice> : null}
      {data.state === "discarded" ? <Notice>This import was set aside.</Notice> : null}
      {data.state === "review" ? (
        <label className="grid max-w-xs gap-1.5 text-sm">
          <span className="font-medium text-strong">Kind of cleaning for new drafts</span>
          <select className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <ul className="grid grid-cols-1 gap-3">
        {data.rows.map((row) => {
          const edit = edits[row.id] ?? {};
          const price = edit.price ?? (row.priceCents === null ? "" : row.method === "per_area" ? (row.priceCents / 100_000).toString() : dollarsText(row.priceCents));
          const method = edit.method ?? row.method ?? "";
          const set = (patch: typeof edit) => setEdits({ ...edits, [row.id]: { ...edit, ...patch } });
          return (
            <li key={row.id} className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{row.sourceRef}</p>
                  <p className="break-words font-mono text-xs text-muted-foreground">“{row.raw}”</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {row.flagWords.map((f) => (
                    <Badge key={f} variant="warning" size="sm">
                      {f}
                    </Badge>
                  ))}
                  {row.decision !== "pending" ? (
                    <Badge variant={row.decision === "drafted" ? "success" : "outline"} size="sm">
                      {row.decision === "drafted" ? "Drafted" : "Skipped"}
                    </Badge>
                  ) : null}
                </div>
              </div>
              {row.decision === "pending" && data.canEdit ? (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="grid grid-cols-1 gap-1.5 text-sm">
                      <span className="font-medium text-strong">Name</span>
                      <input className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm" value={edit.name ?? row.name} onChange={(e) => set({ name: e.target.value })} />
                    </label>
                    <label className="grid grid-cols-1 gap-1.5 text-sm">
                      <span className="font-medium text-strong">Price</span>
                      <input className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm tabular-nums" inputMode="decimal" value={price} onChange={(e) => set({ price: e.target.value })} placeholder="Not stated" />
                    </label>
                    <label className="grid grid-cols-1 gap-1.5 text-sm">
                      <span className="font-medium text-strong">Unit {row.unitRaw ? <span className="font-normal text-muted-foreground">(read “{row.unitRaw}”)</span> : null}</span>
                      <select className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm" value={method} onChange={(e) => set({ method: e.target.value as Method })}>
                        <option value="">Unclear: choose one</option>
                        {UNITS.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {row.scope ? <p className="text-sm text-muted-foreground">Scope read: {row.scope}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const methodChosen = (edit.method ?? row.method ?? null) as Method | null;
                          const cents = price.trim() === "" ? null : methodChosen === "per_area" ? Math.round(Number(price) * 100_000) : centsFrom(price);
                          await decide({ companyId, importId: data.id, rowId: row.id, decision: "draft", category, ...(edit.name ? { name: edit.name } : {}), ...(edit.price !== undefined ? { priceCents: cents } : {}), ...(edit.method ? { method: edit.method } : {}) });
                        })
                      }
                    >
                      Make it a draft
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => decide({ companyId, importId: data.id, rowId: row.id, decision: "skip" }))}>
                      Skip
                    </Button>
                  </div>
                  {method === "" && price ? <p className="text-xs text-muted-foreground">If you draft it with an unclear unit, the amount is held as illustrative until you confirm it in the builder.</p> : null}
                </>
              ) : (
                <p className="text-sm text-strong">
                  {row.name} · {row.priceCents === null ? "no price" : row.method === "per_area" ? `$${(row.priceCents / 100_000).toString()} per sq ft` : formatCents(row.priceCents)}
                  {row.serviceId ? (
                    <>
                      {" "}
                      ·{" "}
                      <Link href={servicePath(row.serviceId)} className="text-brand-300 underline-offset-4 hover:underline dark:text-brand-300">
                        open the draft
                      </Link>
                    </>
                  ) : null}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <FormError message={error} />
      {data.state === "review" && data.canEdit ? (
        <div>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => window.confirm("Set this import aside? Drafts already made stay.") && void run(async () => discard({ companyId, importId: data.id }))}>
            Set the rest aside
          </Button>
        </div>
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">The original, as it was given</summary>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 text-xs text-strong">{data.source}</pre>
      </details>
    </div>
  );
}
