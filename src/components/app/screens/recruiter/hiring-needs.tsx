"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/app/format";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { ProgressRing } from "./shared";

type Need = NonNullable<ReturnType<typeof useQuery<typeof api.hiringNeeds.list>>>[number];

const payWords = (need: Need) => {
  const pay = need.compensation?.pay;
  if (!pay) return "Pay not approved yet";
  return pay.kind === "hourly" ? `${money(pay.hourlyCents)} an hour` : `${pay.shareBps / 100}% of each job`;
};

/** Hiring Needs: each open role, how far it is filled, and the pipeline behind it. */
export function HiringNeedsScreen() {
  const { companyId, role } = useCompany();
  const needs = useQuery(api.hiringNeeds.list, { companyId });
  const [creating, setCreating] = useState(false);
  if (!needs) {
    return (
      <>
        <PageHeader title="Hiring Needs" lead="The roles you are hiring for, and what each one needs." />
        <Skeleton className="h-80 rounded-2xl" />
      </>
    );
  }
  const order = { open: 0, paused: 1, closed: 2 } as const;
  return (
    <>
      <PageHeader
        title="Hiring Needs"
        lead="The roles you are hiring for, and what each one needs."
        actions={
          role === "owner" && !creating ? (
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              New role
            </Button>
          ) : null
        }
      />
      {creating ? <NewRole onDone={() => setCreating(false)} /> : null}
      {needs.length === 0 && !creating ? (
        <Panel>
          <p className="py-8 text-center text-sm text-muted-foreground">No roles yet. Add the role you are hiring for, and Recruiter matches applications to it.</p>
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {[...needs].sort((a, b) => order[a.status] - order[b.status]).map((need) => (
            <RoleCard key={need._id} need={need} />
          ))}
        </div>
      )}
    </>
  );
}

function RoleCard({ need }: { need: Need }) {
  const { companyId, role } = useCompany();
  const setStatus = useMutation(api.hiringNeeds.setStatus);
  const { busy, error, run } = useRun();
  const filled = Math.min(need.hired, need.openings);
  return (
    <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-lg tracking-tight text-strong">{need.title}</h2>
          <p className="text-sm text-muted-foreground">
            {need.location} · {need.engagement === "employee" ? "Employee" : "Contractor"} · {payWords(need)}
          </p>
        </div>
        <ProgressRing done={filled} total={need.openings} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={need.status === "open" ? "success" : need.status === "paused" ? "warning" : "outline"} size="sm">
          {need.status === "open" ? "Open" : need.status === "paused" ? "Paused" : "Closed"}
        </Badge>
        {need.fromTaskId ? <Badge variant="info" size="sm">Requested by Dispatch</Badge> : null}
        {need.targetStartAt ? <span className="text-xs text-muted-foreground">Start by {new Date(need.targetStartAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span> : null}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ["Applied", need.applications],
          ["In progress", need.active],
          ["Hired", need.hired],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl bg-muted/50 px-2 py-2">
            <p className="font-heading text-xl tabular-nums text-strong">{value}</p>
            <p className="text-[11px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <p className="line-clamp-3 text-sm text-muted-foreground">{need.responsibilities}</p>
      <div className="flex flex-wrap gap-1">
        {need.criteria.map((criterion) => (
          <Badge key={criterion.key} variant="outline" size="sm" title={criterion.fixed ? "A fixed requirement" : "Considered, not required"}>
            {criterion.fixed ? "Required: " : ""}
            {criterion.label}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button size="xs" variant="outline" render={<Link href={`/app/agents/recruiter/applicants`} />}>
          Applicants
        </Button>
        {role === "owner" ? (
          <SelectInput aria-label="Status" value={need.status} disabled={busy} onChange={(event) => void run(() => setStatus({ companyId, needId: need._id as Id<"hiringNeeds">, status: event.target.value as Need["status"] }))} className="h-8 w-auto">
            <option value="open">Open</option>
            <option value="paused">Paused</option>
            <option value="closed">Closed</option>
          </SelectInput>
        ) : null}
      </div>
      <FormError message={error} />
    </section>
  );
}

function NewRole({ onDone }: { onDone: () => void }) {
  const { companyId } = useCompany();
  const create = useMutation(api.hiringNeeds.create);
  const { busy, error, run } = useRun();
  const [form, setForm] = useState({ title: "", location: "", responsibilities: "", requiredAvailability: "", engagement: "contractor" as "contractor" | "employee", openings: "1" });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Panel title="New role" className="mb-5">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await create({ companyId, title: form.title, location: form.location, responsibilities: form.responsibilities, requiredAvailability: form.requiredAvailability, engagement: form.engagement, openings: Number(form.openings) });
            onDone();
          });
        }}
      >
        <Field label="Role title">
          <TextInput value={form.title} onChange={(event) => set("title", event.target.value)} placeholder="House Cleaner" required />
        </Field>
        <Field label="Where">
          <TextInput value={form.location} onChange={(event) => set("location", event.target.value)} placeholder="Austin, TX" required />
        </Field>
        <Field label="What the work is" className="sm:col-span-2">
          <TextArea value={form.responsibilities} onChange={(event) => set("responsibilities", event.target.value)} required />
        </Field>
        <Field label="Availability needed">
          <TextInput value={form.requiredAvailability} onChange={(event) => set("requiredAvailability", event.target.value)} placeholder="Weekdays, 8am to 4pm" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Worker type">
            <SelectInput value={form.engagement} onChange={(event) => set("engagement", event.target.value)}>
              <option value="contractor">Contractor</option>
              <option value="employee">Employee</option>
            </SelectInput>
          </Field>
          <Field label="Openings">
            <TextInput inputMode="numeric" value={form.openings} onChange={(event) => set("openings", event.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">Pay, questions and screening criteria are added once the role exists. No criterion may concern a protected characteristic.</p>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" size="sm" variant="primary" loading={busy}>
            Create role
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
        <FormError message={error} />
      </form>
    </Panel>
  );
}
