"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, messageOf } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/shell";
import { CalendarIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/app/format";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Chip, fieldClass, minutesToTime } from "./kit";

const VISIT_TONE = { scheduled: "brand", skipped: "neutral", moved: "brand", exception: "danger", cancelled: "neutral" } as const;
const STAFFING_WORDS = { covered: "Crew accepted", offered: "Offered, not yet accepted", uncovered: "No crew yet" } as const;

function dayLabel(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

type OpenPanel = null | "pause" | "change" | "end";

export function PlanDetail({ planId }: { planId: Id<"recurringPlans"> }) {
  const { companyId } = useCompany();
  const data = useQuery(api.plans.get, { companyId, planId });
  const skip = useMutation(api.plans.skipVisit);
  const pause = useMutation(api.plans.pause);
  const resume = useMutation(api.plans.resume);
  const changeFuture = useMutation(api.plans.changeFuture);
  const end = useMutation(api.plans.end);
  const [panel, setPanel] = useState<OpenPanel>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [form, setForm] = useState({ from: "", until: "", reason: "", arrival: "", bedrooms: "", bathrooms: "" });
  const preview = useQuery(
    api.plans.changePreview,
    panel === "change" && /^\d{4}-\d{2}-\d{2}$/.test(form.from) && data?.current
      ? { companyId, planId, effectiveFrom: form.from, quoteInput: { ...data.current.quoteInput, ...(form.bedrooms ? { bedrooms: Number(form.bedrooms) } : {}), ...(form.bathrooms ? { bathrooms: Number(form.bathrooms) } : {}) } }
      : "skip",
  );
  if (data === undefined) return <Skeleton className="h-[60vh] rounded-2xl" />;
  const { plan, current } = data;
  const run = (work: () => Promise<string>) => {
    setError(null);
    setDone(null);
    work()
      .then((words) => {
        setDone(words);
        setPanel(null);
      })
      .catch((caught: unknown) => setError(messageOf(caught)));
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`${data.customer?.name ?? "Customer"} · recurring plan`}
        lead={`${current?.cadenceWords ?? ""}${current ? ` at ${minutesToTime(current.arrivalMinute)}` : ""} · ${data.property ? `${data.property.label ?? data.property.line1}, ${data.property.city}` : ""}`}
        actions={
          <>
            <Chip tone={plan.status === "active" ? "success" : plan.status === "paused" ? "warning" : "neutral"}>{plan.status === "active" ? (plan.pause ? "Active, pause scheduled" : "Active") : plan.status === "paused" ? "Paused" : plan.status === "ended" ? "Ended" : "Pending"}</Chip>
            {plan.status !== "ended" ? (
              <>
                {plan.status === "paused" || plan.pause ? (
                  <Button size="sm" variant="outline" onClick={() => run(async () => `Resumed. ${(await resume({ companyId, planId, from: data.today })).made} visits made.`)}>
                    Resume
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setPanel("pause")}>
                    Pause
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setPanel("change")}>
                  Change from a date
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPanel("end")}>
                  End plan
                </Button>
              </>
            ) : null}
          </>
        }
      />
      {done ? (
        <p role="status" className="mb-3 rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-sm text-success-foreground">
          {done}
        </p>
      ) : null}
      <FormError message={error} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Each visit</p>
          <p className="font-heading text-2xl text-strong tabular-nums">{current ? money(current.visitPriceCents) : "—"}</p>
          <p className="text-xs text-muted-foreground">{current?.rate}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Billing</p>
          <p className="text-sm text-strong">{data.billingWords}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Agreement</p>
          {data.agreement ? (
            <Link href={`/app/agreements/${data.agreement.id}`} className="text-sm font-medium text-brand-600 hover:underline">
              {data.agreement.title} · {data.agreement.workflow.replace(/_/g, " ")}
            </Link>
          ) : (
            <p className="text-sm text-strong">None required</p>
          )}
        </div>
      </div>
      {data.pendingVersions.length ? (
        <p className="mb-3 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-sm">
          Waiting for the Owner: {data.pendingVersions.map((v) => `${money(v.visitPriceCents)} per visit from ${v.effectiveFrom}`).join("; ")}. Visits keep the current price until it’s approved.
        </p>
      ) : null}

      {panel ? (
        <Panel title={panel === "pause" ? "Pause the plan" : panel === "change" ? "Change this and future visits" : "End the plan"} className="mb-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-strong">{panel === "end" ? "Last date of service" : panel === "pause" ? "Pause from" : "From"}</span>
              <input type="date" className={fieldClass()} value={form.from} min={data.today} onChange={(e) => setForm({ ...form, from: e.target.value })} />
            </label>
            {panel === "pause" ? (
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-strong">Until (optional)</span>
                <input type="date" className={fieldClass()} value={form.until} min={form.from} onChange={(e) => setForm({ ...form, until: e.target.value })} />
              </label>
            ) : null}
            {panel === "change" ? (
              <>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-strong">Bedrooms</span>
                  <input type="number" min={0} className={fieldClass()} placeholder={String(current?.quoteInput.bedrooms ?? "")} value={form.bedrooms} onChange={(e) => setForm({ ...form, bedrooms: e.target.value })} />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-strong">Bathrooms</span>
                  <input type="number" min={0} className={fieldClass()} placeholder={String(current?.quoteInput.bathrooms ?? "")} value={form.bathrooms} onChange={(e) => setForm({ ...form, bathrooms: e.target.value })} />
                </label>
              </>
            ) : null}
            <label className="grid gap-1.5 text-sm sm:col-span-3">
              <span className="font-medium text-strong">Reason</span>
              <input className={fieldClass()} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </label>
          </div>
          {panel === "change" && preview ? (
            <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <p className="text-strong">
                Price per visit: {money(preview.currentPriceCents)} → {preview.newPriceCents !== null ? money(preview.newPriceCents) : "can't be priced"}
                {preview.needsApproval ? " (needs the Owner's approval)" : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {preview.replaced.length} scheduled visit{preview.replaced.length === 1 ? "" : "s"} from this date will be made again
                {preview.replaced.some((r) => r.accepted) ? `; ${preview.replaced.filter((r) => r.accepted).length} already has a cleaner who accepted, who will be released` : ""}. {preview.keeps}
              </p>
            </div>
          ) : null}
          {panel === "end" ? <p className="mt-3 text-xs text-muted-foreground">Visits after this date are cancelled. Completed visits, issued invoices, deposits and payments are unchanged.</p> : null}
          <div className="mt-3 flex gap-2">
            <Button
              disabled={!form.from || !form.reason.trim()}
              onClick={() =>
                run(async () => {
                  if (panel === "pause") return `Paused. ${(await pause({ companyId, planId, from: form.from, until: form.until || undefined, reason: form.reason })).cancelled} visits cancelled.`;
                  if (panel === "end") return `${(await end({ companyId, planId, lastDate: form.from, reason: form.reason })).cancelled} later visits cancelled.`;
                  const result = await changeFuture({ companyId, planId, effectiveFrom: form.from, quoteInput: { ...current!.quoteInput, ...(form.bedrooms ? { bedrooms: Number(form.bedrooms) } : {}), ...(form.bathrooms ? { bathrooms: Number(form.bathrooms) } : {}) }, reason: form.reason });
                  return result.waitingForApproval ? "Sent to the Owner. Visits keep the current price until it's approved." : `Changed. ${result.replaced} visits made again.`;
                })
              }
            >
              Apply
            </Button>
            <Button variant="ghost" onClick={() => setPanel(null)}>
              Cancel
            </Button>
          </div>
        </Panel>
      ) : null}

      <Panel title="Upcoming visits" flush>
        {data.upcoming.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No upcoming visits.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.upcoming.map((visit) => (
              <li key={visit._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <CalendarIcon aria-hidden className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-strong">
                    {dayLabel(visit.date)}
                    {visit.first ? " · first visit" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {visit.job ? `${visit.job.service} · ${visit.job.priceCents !== null ? money(visit.job.priceCents) : ""}` : (visit.exception ?? "")}
                  </p>
                </div>
                <Chip tone={VISIT_TONE[visit.state]}>{visit.state === "exception" ? "Needs a decision" : visit.state}</Chip>
                {visit.staffing && visit.state === "scheduled" ? <Chip tone={visit.staffing === "covered" ? "success" : "warning"}>{STAFFING_WORDS[visit.staffing]}</Chip> : null}
                {visit.job && visit.state === "scheduled" ? (
                  <>
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`/app/agents/dispatch/schedule?open=job:${visit.job._id}`}>Move or change this visit</Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const reason = window.prompt("Why is this visit skipped?");
                        if (reason) run(async () => (await skip({ companyId, visitId: visit._id, reason })).effect);
                      }}
                    >
                      Skip
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Panel title="Recent visits" flush>
          <ul className="divide-y divide-border">
            {data.past.map((visit) => (
              <li key={visit._id} className="flex justify-between gap-2 px-4 py-2 text-sm">
                <span className="text-strong">{dayLabel(visit.date)}</span>
                <span className="text-muted-foreground">{visit.job?.status ?? visit.state}</span>
              </li>
            ))}
            {data.past.length === 0 ? <li className="px-4 py-3 text-sm text-muted-foreground">None yet.</li> : null}
          </ul>
        </Panel>
        <Panel title="History" flush>
          <ul className="divide-y divide-border">
            {data.history.map((event, i) => (
              <li key={i} className="flex justify-between gap-2 px-4 py-2 text-sm">
                <span className="text-strong">{event.type.replace("recurring_plan.", "").replace(/_/g, " ")}</span>
                <span className="text-muted-foreground">{new Date(event.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        To change one visit only, use Move or change this visit. To change this and future visits, use Change from a date. Holidays and closed days are never moved on their own: they show here as needing a decision and go to Dispatch.
      </p>
    </div>
  );
}
