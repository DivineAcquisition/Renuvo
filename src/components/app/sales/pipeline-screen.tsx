"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, messageOf } from "@/components/app/form";
import { PageHeader } from "@/components/app/shell";
import { Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Chip, fieldClass } from "./kit";

const STAGES = [
  { id: "new", label: "New" },
  { id: "qualifying", label: "Qualifying" },
  { id: "quoting", label: "Quoting" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
] as const;
const SEGMENTS = { residential: "Residential", commercial: "Commercial", office: "Office", str: "Short-term rental" } as const;

function due(at: number | null) {
  if (!at) return null;
  const late = at < Date.now();
  return { late, words: `${late ? "Overdue since" : "Due"} ${new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` };
}

export function PipelineScreen() {
  const { companyId } = useCompany();
  const data = useQuery(api.pipeline.list, { companyId });
  const create = useMutation(api.pipeline.create);
  const update = useMutation(api.pipeline.update);
  const takeOver = useMutation(api.pipeline.takeOver);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", segment: "residential" as keyof typeof SEGMENTS, source: "" });
  const [error, setError] = useState<string | null>(null);
  const run = (work: () => Promise<unknown>) => {
    setError(null);
    work().catch((caught: unknown) => setError(messageOf(caught)));
  };
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  /** Moves a deal by the menu or by dragging. Losing a deal asks why first. */
  const moveTo = (opportunityId: string, next: (typeof STAGES)[number]["id"]) => {
    const closedReason = next === "lost" ? (window.prompt("Why was the deal lost?") ?? "") : undefined;
    if (next === "lost" && !closedReason) return;
    run(() => update({ companyId, opportunityId: opportunityId as Id<"salesOpportunities">, stage: next, ...(closedReason ? { closedReason } : {}) }));
  };
  if (data === undefined) return <Skeleton className="h-[60vh] rounded-2xl" />;
  const stats = data.last30;
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Pipeline"
        lead="Every deal, where it is, who has it, and what happens next. Reminders go to your team; nothing is sent to customers on its own."
        actions={
          <Button onClick={() => setAdding((v) => !v)}>
            <Plus aria-hidden className="size-4" /> New deal
          </Button>
        }
      />
      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Quotes saved", stats.quotes],
          ["Proposals sent", stats.proposalsSent],
          ["Proposals accepted", stats.proposalsAccepted],
          ["Bookings confirmed", stats.bookingsConfirmed],
          ["Bookings waiting", stats.bookingsWaiting],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-2xl border border-border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">{label} · 30 days</dt>
            <dd className="font-heading text-2xl text-strong tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {adding ? (
        <form
          className="mb-4 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-[2fr_1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await create({ companyId, title: form.title, segment: form.segment, ...(form.source ? { source: form.source } : {}) });
              setAdding(false);
              setForm({ title: "", segment: "residential", source: "" });
            });
          }}
        >
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-strong">Deal</span>
            <input className={fieldClass()} value={form.title} placeholder="For example: Northwind Offices, 3 floors" onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-strong">Kind</span>
            <select className={fieldClass()} value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value as keyof typeof SEGMENTS })}>
              {Object.entries(SEGMENTS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-strong">Source</span>
            <input className={fieldClass()} value={form.source} placeholder="Phone, website, referral" onChange={(e) => setForm({ ...form, source: e.target.value })} />
          </label>
          <div className="self-end">
            <Button type="submit" disabled={form.title.trim().length < 2}>
              Add
            </Button>
          </div>
        </form>
      ) : null}
      <FormError message={error} />
      <div className="grid gap-3 overflow-x-auto pb-2 lg:grid-cols-5">
        {STAGES.map((stage) => {
          const rows = data.opportunities.filter((o) => o.stage === stage.id);
          return (
            <section
              key={stage.id}
              aria-labelledby={`stage-${stage.id}`}
              onDragOver={(event) => {
                if (!dragging) return;
                event.preventDefault();
                setOver(stage.id);
              }}
              onDragLeave={() => setOver((current) => (current === stage.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                const id = dragging;
                setDragging(null);
                setOver(null);
                const row = data.opportunities.find((o) => o._id === id);
                // The server checks the stage's condition whoever moves the card; a refusal is shown above.
                if (row && row.stage !== stage.id) moveTo(row._id, stage.id);
              }}
              className={cn("flex min-w-64 flex-col gap-2 rounded-2xl border p-2.5 transition-colors", over === stage.id ? "border-brand-500 bg-brand-500/5" : "border-border bg-muted/30")}
            >
              <h2 id={`stage-${stage.id}`} className="flex items-center justify-between px-1 text-sm font-semibold text-strong">
                {stage.label} <span className="text-xs font-normal text-muted-foreground tabular-nums">{rows.length}</span>
              </h2>
              {rows.map((row) => {
                const when = due(row.nextActionAt);
                return (
                  <article
                    key={row._id}
                    draggable={stage.id !== "won" && stage.id !== "lost"}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      setDragging(row._id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className={cn("grid gap-2 rounded-xl border border-border bg-card p-3 text-sm shadow-xs", dragging === row._id ? "opacity-50" : "")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-strong">{row.title}</p>
                      {row.estimateCents ? <span className="text-xs text-muted-foreground tabular-nums">{money(row.estimateCents)}</span> : null}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Chip>{SEGMENTS[row.segment]}</Chip>
                      {row.milestoneWords ? <Chip tone={row.milestone === "declined" || row.milestone === "expired" ? "danger" : row.milestone === "service_activated" ? "success" : "brand"}>{row.milestoneWords}</Chip> : null}
                      {row.agent ? <Chip tone="brand">Sales agent</Chip> : null}
                      {row.followUps === "paused" ? <Chip tone="warning">Taken over</Chip> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {row.customer ?? "No customer yet"} · {row.owner ?? "Nobody responsible"}
                    </p>
                    {row.nextAction ? (
                      <p className="text-xs">
                        <span className="font-medium text-strong">Next:</span> {row.nextAction}
                        {when ? <span className={cn("block", when.late ? "text-destructive-foreground" : "text-muted-foreground")}>{when.words}</span> : null}
                      </p>
                    ) : null}
                    {stage.id !== "won" && stage.id !== "lost" ? (
                      <div className="flex flex-wrap gap-1.5">
                        {row.agent ? (
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/app/agents/sales?opp=${row._id}`}>Open conversation</Link>
                          </Button>
                        ) : null}
                        {row.draftId ? (
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/app/agents/sales/book/${row.draftId}`}>Open workspace</Link>
                          </Button>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/app/agents/sales/new?mode=booking&opportunity=${row._id}&from=pipeline`}>Book</Link>
                            </Button>
                            {row.segment !== "residential" ? (
                              <Button size="sm" variant="outline" asChild>
                                <Link href={`/app/agents/sales/new?mode=proposal&opportunity=${row._id}&from=pipeline`}>Proposal</Link>
                              </Button>
                            ) : null}
                          </>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => run(() => takeOver({ companyId, opportunityId: row._id as Id<"salesOpportunities">, resume: row.followUps === "paused" }))}>
                          {row.followUps === "paused" ? (row.agent ? "Hand back to the agent" : "Resume reminders") : "Take over"}
                        </Button>
                        <label className="sr-only" htmlFor={`stage-of-${row._id}`}>
                          Move to stage
                        </label>
                        <select
                          id={`stage-of-${row._id}`}
                          className="min-h-8 rounded-lg border border-border bg-card px-2 text-xs"
                          value=""
                          onChange={(e) => {
                            const next = e.target.value as (typeof STAGES)[number]["id"];
                            if (next) moveTo(row._id, next);
                          }}
                        >
                          <option value="">Move…</option>
                          {STAGES.filter((s) => s.id !== stage.id).map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </article>
                );
              })}
              {rows.length === 0 ? <p className="px-1 py-3 text-xs text-muted-foreground">Nothing here.</p> : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
