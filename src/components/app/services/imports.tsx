"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextInput, useRun } from "@/components/app/form";
import { Disclosure, FileDetails, MoneyField, NumberField } from "@/components/ui/fields";
import { ArrowLeft } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { centsFrom, dollarsText, SERVICES_ROOT, servicePath } from "@/lib/app/services";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "../../../../convex/lib/services/spec";
import { formatCents, Notice, SectionTitle } from "./shared";
import { useConfirm } from "@/components/ui/fields/confirm";

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
  const { ask, element: confirmDialog } = useConfirm();
  const [category, setCategory] = useState<Category>("residential");
  const [edits, setEdits] = useState<Record<string, { name?: string; price?: string; method?: Method }>>({});
  if (!data) return <Skeleton className="h-96 rounded-2xl" />;
  const pending = data.rows.filter((r) => r.decision === "pending").length;
  return (
    <div className="grid grid-cols-1 gap-5">
      {confirmDialog}
      <div>
        <Link href={SERVICES_ROOT} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-strong">
          <ArrowLeft aria-hidden className="size-4" /> All services
        </Link>
        <SectionTitle title={`Review: ${data.name}`}>
          {data.rows.length} row{data.rows.length === 1 ? "" : "s"} read, {pending} waiting for you. Correct anything unclear, then make each a draft or skip it. Drafts are reviewed before anything goes live.
        </SectionTitle>
      </div>
      <FileDetails
        name={data.name}
        type={data.kind === "csv" ? "text/csv" : "text/plain"}
        size={new Blob([data.source]).size}
        state={data.state === "failed" ? "failed" : data.state === "review" ? "ready" : "processed"}
        error={data.state === "failed" ? `${data.error ?? "It could not be read."} Nothing was imported.` : null}
        counts={
          data.state === "failed"
            ? []
            : [
                { label: "Rows read", value: data.rows.length },
                { label: "Waiting for you", value: pending },
                { label: "Drafted", value: data.rows.filter((r) => r.decision === "drafted").length },
                { label: "Skipped", value: data.rows.filter((r) => r.decision === "skipped").length },
              ]
        }
      />
      {data.state === "discarded" ? <Notice>This import was set aside.</Notice> : null}
      {data.state === "review" ? (
        <label className="grid max-w-xs gap-1.5 text-sm">
          <span className="font-medium text-strong">Kind of cleaning for new drafts</span>
          <SelectInput value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </SelectInput>
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
                  <p className="text-sm font-medium text-strong">{edit.name ?? row.name}</p>
                  <p className="text-xs text-muted-foreground">Read from {row.sourceRef}</p>
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
                    <Field label="Name">
                      <TextInput value={edit.name ?? row.name} onChange={(e) => set({ name: e.target.value })} />
                    </Field>
                    <Field label="Price" hint={price === "" ? "Not stated in the file. Leave it empty to set it in the builder." : undefined}>
                      {method === "per_area" ? <NumberField value={price} onChange={(text) => set({ price: text })} precision={5} min={0} prefix="$" suffix="per sq ft" placeholder="Not stated" /> : <MoneyField value={price} onChange={(text) => set({ price: text })} placeholder="Not stated" />}
                    </Field>
                    <label className="grid grid-cols-1 gap-1.5 text-sm">
                      <span className="font-medium text-strong">Unit {row.unitRaw ? <span className="font-normal text-muted-foreground">(read “{row.unitRaw}”)</span> : null}</span>
                      <SelectInput value={method} onChange={(e) => set({ method: e.target.value as Method })}>
                        <option value="">Unclear: choose one</option>
                        {UNITS.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.label}
                          </option>
                        ))}
                      </SelectInput>
                    </label>
                  </div>
                  {row.scope ? <p className="text-sm text-muted-foreground">Scope read: {row.scope}</p> : null}
                  <Disclosure variant="plain" title={<span className="text-xs font-normal text-muted-foreground">Show the line as it was in the file</span>}>
                    <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap text-strong">{row.raw}</p>
                  </Disclosure>
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
          <Button variant="ghost" size="sm" disabled={busy} onClick={() =>
              void ask({
                title: "Set the remaining import aside?",
                body: "Service drafts already created will remain. The remaining rows will not be imported.",
                confirmLabel: "Set remaining rows aside",
                cancelLabel: "Continue reviewing",
                action: () => discard({ companyId, importId: data.id }),
              })
            }>
            Set the rest aside
          </Button>
        </div>
      ) : null}
      <Disclosure title="The original, as it was given" summary={`${data.source.split("\n").length.toLocaleString("en-US")} lines, kept for review. Shown as plain text.`}>
        <pre className="max-h-80 overflow-auto rounded-lg bg-muted/30 p-3 text-xs whitespace-pre-wrap text-strong">{data.source}</pre>
      </Disclosure>
    </div>
  );
}
