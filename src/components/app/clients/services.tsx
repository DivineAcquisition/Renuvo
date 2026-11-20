"use client";

/**
 * A client's services, as four views over the records that hold them: booked visits, past visits (opened in
 * the shared visit panel, never copied), plans, and quotes and proposals. Plans are changed through their
 * own workflow; a change that cancels visits lists them before anything happens.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { NewVisitForm } from "@/components/app/screens/forms";
import { JobInputs, defaultInput } from "@/components/app/services/preview";
import { Plus } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CADENCE_LABELS, SERVICE_VIEWS, type ServiceViewId } from "@/lib/app/clients";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { QuoteInput } from "../../../../convex/lib/services/engine";
import type { Spec } from "../../../../convex/lib/services/spec";
import { Card, day, EmptyState, money, StaffingLine, when } from "./bits";
import { ActionMenu } from "./menu";
import { VisitRow } from "./parts";
import { SalesPlans, SalesWork, useClientSales } from "./sales";
import { ImportedHistory } from "./imported";
import type { Profile } from "./profile";
import { ImportedRecords } from "@/components/app/setup/migration";

type Plan = NonNullable<ReturnType<typeof useQuery<typeof api.servicePlans.forClient>>>["plans"][number];

export function ServicesTab({ profile }: { profile: Profile }) {
  const params = useSearchParams();
  const view = (SERVICE_VIEWS.find((v) => v.id === params.get("view"))?.id ?? "upcoming") as ServiceViewId;
  const [booking, setBooking] = useState(false);
  // The view lives in the address without a navigation, so Back and a shared link keep it.
  const setView = (next: ServiceViewId) => {
    const url = new URL(window.location.href);
    if (next === "upcoming") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  };
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Show" className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
          {SERVICE_VIEWS.map((v) => (
            <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand-500/50", view === v.id ? "bg-brand-500/10 text-brand-300" : "text-muted-foreground hover:text-strong")}>
              {v.label}
            </button>
          ))}
        </div>
        <ActionMenu
          label="Create a booking or proposal"
          className="h-9 rounded-lg border border-border bg-card px-3 text-sm font-medium text-strong hover:bg-muted"
          trigger={<span>Create booking or proposal</span>}
          actions={[
            { label: "Book a visit now", onSelect: () => setBooking(true), disabled: !profile.properties.some((p) => p.status === "active") },
            { label: "Booking in Sales (quote, payment, agreement)", href: `/app/agents/sales/new?mode=booking&customer=${profile.id}` },
            { label: "Proposal in Sales", href: `/app/agents/sales/new?mode=proposal&customer=${profile.id}` },
            { label: "Agreement only", href: `/app/agreements/new?mode=selestial&customer=${profile.id}` },
          ]}
        />
      </div>
      {view === "upcoming" || view === "history" ? <Visits profile={profile} when={view} /> : view === "plans" ? <Plans profile={profile} /> : <Proposals profile={profile} />}
      {view === "plans" || view === "history" ? <ImportedRecords customerId={profile.id} /> : null}
      <Modal open={booking} onClose={() => setBooking(false)} title="Book a visit" description="Priced from Services & Pricing. Dispatch starts staffing it once it is booked.">
        <NewVisitForm initial={{ customerId: profile.id, propertyId: profile.properties.find((p) => p.status === "active")?.id }} onDone={() => setBooking(false)} />
      </Modal>
      <ImportedHistory customerId={profile.id} />
    </div>
  );
}

function Visits({ profile, when: which }: { profile: Profile; when: "upcoming" | "history" }) {
  const { companyId, timezone } = useCompany();
  const [property, setProperty] = useState("");
  const [limit, setLimit] = useState(25);
  const data = useQuery(api.clientProperties.visits, { companyId, customerId: profile.id, when: which, limit, ...(property ? { propertyId: property as Id<"properties"> } : {}) });
  return (
    <Card
      title={which === "upcoming" ? "Booked visits" : "Past visits"}
      action={
        profile.properties.length > 1 ? (
          <SelectInput aria-label="Property" className="min-h-9 w-auto py-1.5" value={property} onChange={(event) => setProperty(event.target.value)}>
            <option value="">Every property</option>
            {profile.properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectInput>
        ) : undefined
      }
    >
      {data === undefined ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : data.visits.length ? (
        <>
          <ul className="grid gap-2">
            {data.visits.map((v) => (
              <VisitRow key={v.id} visit={v} timezone={timezone} showProperty={!property && profile.properties.length > 1} />
            ))}
          </ul>
          {data.more ? (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setLimit((n) => n + 25)}>
              Show more
            </Button>
          ) : null}
          {which === "history" ? <p className="mt-3 text-xs text-muted-foreground">Open a visit for its checklist, photos and the crew&apos;s report. Skipped and cancelled visits are labelled as such.</p> : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{which === "upcoming" ? "Nothing booked." : "No past visits."}</p>
      )}
    </Card>
  );
}

const STATE_WORDS: Record<string, { label: string; tone: "success" | "warning" | "outline" | "info" }> = {
  active: { label: "Running", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  setup: { label: "Being set up", tone: "info" },
  ended: { label: "Ended", tone: "outline" },
};

function Plans({ profile }: { profile: Profile }) {
  const { companyId, timezone } = useCompany();
  const data = useQuery(api.servicePlans.forClient, { companyId, customerId: profile.id });
  const sales = useClientSales(profile);
  const params = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [changing, setChanging] = useState<{ plan: Plan; action: "pause" | "end" | "series" } | null>(null);
  const start = useMutation(api.servicePlans.start);
  const resume = useMutation(api.servicePlans.resume);
  const { busy, error, run } = useRun();
  if (data === undefined) return <Skeleton className="h-48 rounded-2xl" />;
  const focus = params.get("plan");
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">A running recurring plan keeps its visits booked {data.horizonDays} days ahead. A standing arrangement holds the terms; its visits are booked one by one.</p>
        {data.canChange ? (
          <Button variant="primary" size="sm" onClick={() => setCreating(true)} disabled={!profile.properties.some((p) => p.status === "active")}>
            <Plus aria-hidden /> Set up a plan
          </Button>
        ) : null}
      </div>
      <FormError message={error} />
      {data.plans.length ? (
        data.plans.map((plan) => (
          <section key={plan.id} aria-label={`${plan.service} at ${plan.property}`} className={cn("rounded-2xl border bg-card p-4 sm:p-5", focus === plan.id ? "border-brand-500/60" : "border-border")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-heading text-base tracking-tight text-strong">{plan.service}</h3>
                  <Badge variant={STATE_WORDS[plan.state].tone} size="sm">
                    {STATE_WORDS[plan.state].label}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {plan.property} · {plan.kind === "standing" ? "Standing arrangement" : plan.cadence ? CADENCE_LABELS[plan.cadence] : "Recurring"}
                  {plan.kind === "recurring" ? `, ${plan.startTime}` : ""}
                </p>
              </div>
              {data.canChange && plan.state !== "ended" ? (
                <div className="flex flex-wrap gap-2">
                  {plan.state === "setup" ? (
                    <Button size="sm" variant="primary" loading={busy} onClick={() => void run(() => start({ companyId, planId: plan.id, expectedRevision: plan.revision }))}>
                      Start the plan
                    </Button>
                  ) : null}
                  {plan.state === "paused" ? (
                    <Button size="sm" variant="primary" loading={busy} onClick={() => void run(() => resume({ companyId, planId: plan.id, expectedRevision: plan.revision }))}>
                      Resume
                    </Button>
                  ) : null}
                  <ActionMenu
                    label={`Change ${plan.service}`}
                    className="h-8 border border-border"
                    actions={[
                      ...(plan.kind === "recurring" && plan.state === "active" ? [{ label: "Change this and future visits", onSelect: () => setChanging({ plan, action: "series" }) }, { label: "Pause", onSelect: () => setChanging({ plan, action: "pause" }) }] : []),
                      { label: "End the plan", danger: true, onSelect: () => setChanging({ plan, action: "end" }) },
                    ]}
                  />
                </div>
              ) : null}
            </div>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Price</dt>
                <dd className="text-strong">
                  {plan.priceCents !== null ? `${money(plan.priceCents)} a ${plan.kind === "standing" ? "turnover" : "visit"}` : "Not priced"}
                  {plan.firstVisit?.priceCents != null ? <span className="block text-xs text-muted-foreground">First visit {money(plan.firstVisit.priceCents)}</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Visit</dt>
                <dd className="text-strong">
                  {Math.round(plan.durationMinutes / 6) / 10} h, {plan.crewSize} cleaner{plan.crewSize === 1 ? "" : "s"}
                  {plan.arrivalWindowMinutes ? <span className="block text-xs text-muted-foreground">Arrival window {plan.arrivalWindowMinutes} min</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Agreement</dt>
                <dd className="text-strong">{plan.agreement ? <Link href={`/app/agreements/${plan.agreement.id}`} className="underline-offset-4 hover:underline">{plan.agreement.title}</Link> : "None linked"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Next</dt>
                <dd className="text-strong">
                  {plan.next ? (
                    <>
                      {when(plan.next.startsAt, timezone)}
                      <span className="block">
                        <StaffingLine staffing={plan.next.staffing} compact />
                      </span>
                    </>
                  ) : plan.kind === "standing" ? (
                    "Booked turnover by turnover"
                  ) : plan.state === "setup" ? (
                    "Nothing booked until it is started"
                  ) : (
                    "Nothing booked"
                  )}
                </dd>
              </div>
            </dl>
            {plan.scopeNote ? <p className="mt-3 text-sm text-strong">Crew notes: {plan.scopeNote}</p> : null}
            <p className="mt-2 text-xs text-muted-foreground">
              Starts {plan.startsOn}
              {plan.kind === "recurring" && plan.bookedThrough ? ` · ${plan.booked} visit${plan.booked === 1 ? "" : "s"} booked through ${plan.bookedThrough}` : ""}
              {plan.pausedFrom ? ` · paused from ${plan.pausedFrom}${plan.pausedUntil ? ` until ${plan.pausedUntil}` : " until resumed"}` : ""}
              {plan.endsOn ? ` · ended from ${plan.endsOn}` : ""}
              {plan.skipped.length ? ` · ${plan.skipped.length} day${plan.skipped.length === 1 ? "" : "s"} skipped` : ""}
            </p>
          </section>
        ))
      ) : sales?.plans.length ? null : (
        <EmptyState title="No plans">Set up a recurring plan to keep visits booked ahead, or a standing arrangement to hold a rental&apos;s turnover terms. Plans agreed through a Sales booking or proposal show here too.</EmptyState>
      )}
      {sales ? <SalesPlans sales={sales} /> : null}
      <Modal open={creating} onClose={() => setCreating(false)} title="Set up a plan" description="Priced by Services & Pricing from the job's facts, with the property's own price if it has one.">
        <PlanForm profile={profile} onDone={() => setCreating(false)} />
      </Modal>
      <Modal open={changing !== null} onClose={() => setChanging(null)} title={changing?.action === "end" ? "End the plan" : changing?.action === "pause" ? "Pause the plan" : "Change this and future visits"} description="Visits that would be cancelled are listed before anything changes. One visit only? Open it to move it, or skip it from here.">
        {changing ? <PlanChange plan={changing.plan} action={changing.action} onDone={() => setChanging(null)} /> : null}
      </Modal>
    </div>
  );
}

function PlanForm({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const { companyId } = useCompany();
  const studio = useQuery(api.services.studio, { companyId });
  const docs = useQuery(api.clientDocuments.proposals, { companyId, customerId: profile.id });
  const create = useMutation(api.servicePlans.create);
  const sales = useClientSales(profile);
  const { busy, error, run } = useRun();
  const properties = profile.properties.filter((p) => p.status === "active");
  const live = (studio?.services ?? []).filter((s) => s.live);
  const [form, setForm] = useState({ propertyId: properties[0]?.id ?? "", serviceId: "", kind: properties[0]?.kind === "short_term_rental" ? "standing" : "recurring", cadence: "every_14_days", startsOn: "", startTime: "09:00", arrival: "30", scopeNote: "", agreementId: "", start: true });
  const [facts, setFacts] = useState<QuoteInput>({});
  const service = live.find((s) => s.id === form.serviceId);
  const spec = service?.live?.spec as Spec | undefined;
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const ready = form.propertyId && form.serviceId && /^\d{4}-\d{2}-\d{2}$/.test(form.startsOn);
  const preview = useQuery(api.servicePlans.preview, ready ? { companyId, propertyId: form.propertyId as Id<"properties">, serviceId: form.serviceId as Id<"services">, kind: form.kind as "recurring", cadence: form.kind === "recurring" ? (form.cadence as "every_7_days") : null, startsOn: form.startsOn, quoteInput: facts } : "skip");
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await create({ companyId, customerId: profile.id, propertyId: form.propertyId as Id<"properties">, serviceId: form.serviceId as Id<"services">, kind: form.kind as "recurring", cadence: form.kind === "recurring" ? (form.cadence as "every_7_days") : null, startsOn: form.startsOn, startTime: form.startTime, arrivalWindowMinutes: Number(form.arrival || "0"), quoteInput: facts, scopeNote: form.scopeNote || undefined, ...(form.agreementId ? { agreementId: form.agreementId as Id<"agreements"> } : {}), start: form.start });
          onDone();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Property">
          <SelectInput value={form.propertyId} onChange={set("propertyId")} required>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Service">
          <SelectInput
            value={form.serviceId}
            onChange={(event) => {
              const next = live.find((s) => s.id === event.target.value);
              setForm((current) => ({ ...current, serviceId: event.target.value }));
              setFacts(next?.live ? defaultInput(next.live.spec as Spec) : {});
            }}
            required
          >
            <option value="">{studio ? "Choose a live service" : "Loading…"}</option>
            {live.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium text-strong">Kind of plan</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { id: "recurring", label: "Recurring", detail: "A calendar of visits, booked ahead." },
            { id: "standing", label: "Standing arrangement", detail: "Agreed terms for a rental; turnovers booked one by one." },
          ].map((o) => (
            <label key={o.id} className="cursor-pointer rounded-xl border border-border px-3 py-2 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-500/[0.06]">
              <input type="radio" name="kind" className="sr-only" checked={form.kind === o.id} onChange={() => setForm((c) => ({ ...c, kind: o.id }))} />
              <span className="block font-medium text-strong">{o.label}</span>
              <span className="block text-xs text-muted-foreground">{o.detail}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        {form.kind === "recurring" ? (
          <Field label="How often">
            <SelectInput value={form.cadence} onChange={set("cadence")}>
              {Object.entries(CADENCE_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </SelectInput>
          </Field>
        ) : null}
        <Field label={form.kind === "recurring" ? "First visit" : "Starts"}>
          <TextInput type="date" value={form.startsOn} onChange={set("startsOn")} required />
        </Field>
        <Field label="Start time">
          <TextInput type="time" value={form.startTime} onChange={set("startTime")} required />
        </Field>
        <Field label="Arrival window, min">
          <TextInput inputMode="numeric" value={form.arrival} onChange={set("arrival")} />
        </Field>
      </div>
      {spec ? (
        <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-3">
          <p className="text-sm font-medium text-strong">The job, for its price</p>
          <JobInputs spec={spec} input={facts} onInput={setFacts} compact />
        </div>
      ) : null}
      {preview ? (
        <div role="status" className="rounded-xl border border-brand-500/25 bg-brand-500/[0.05] px-3.5 py-2.5 text-sm">
          <p className="text-strong">
            <span className="font-heading text-lg tabular-nums">{money(preview.perVisitCents)}</span> a {form.kind === "standing" ? "turnover" : "visit"}
            {preview.estimate ? " (estimate)" : ""} · about {Math.round(preview.durationMinutes / 6) / 10} h with {preview.crewSize} cleaner{preview.crewSize === 1 ? "" : "s"}
          </p>
          {preview.firstVisit ? <p className="text-muted-foreground">First visit {preview.firstVisit.priceCents !== null ? money(preview.firstVisit.priceCents) : ""}, about {Math.round(preview.firstVisit.durationMinutes / 6) / 10} h.</p> : null}
          {preview.propertyPrice !== null ? <p className="text-muted-foreground">Uses this property&apos;s own base price.</p> : null}
          {preview.firstDays.length ? <p className="text-muted-foreground">First days: {preview.firstDays.slice(0, 4).join(", ")}…</p> : null}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Notes for the crew (optional)">
          <TextArea rows={2} value={form.scopeNote} onChange={set("scopeNote")} maxLength={1000} />
        </Field>
        <Field label="Agreement (optional)" hint="The customer agreement these terms come from.">
          <SelectInput value={form.agreementId} onChange={set("agreementId")}>
            <option value="">None</option>
            {docs?.agreements
              .filter((a) => !a.archived && a.lifecycle !== "superseded" && a.lifecycle !== "terminated" && a.lifecycle !== "expired")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title} ({a.workflow.replace(/_/g, " ")})
                </option>
              ))}
          </SelectInput>
        </Field>
      </div>
      {(() => {
        // Both kinds of plan book visits on their own. Two at one property would book the same work twice.
        const clash = sales?.plans.filter((p) => p.propertyId === form.propertyId && p.status !== "ended") ?? [];
        return clash.length ? (
          <p role="alert" className="rounded-lg bg-warning/[0.08] px-3 py-2 text-sm text-warning-foreground">
            This property already has a Sales plan ({clash.map((p) => `${p.service}${p.cadence ? `, ${p.cadence.toLowerCase()}` : ""}`).join("; ")}) that books its own visits. A second plan here books more visits on top of it. Change that plan in Sales instead, unless this is extra work.
          </p>
        ) : null;
      })()}
      <label className="flex items-center gap-2 text-sm text-strong">
        <input type="checkbox" checked={form.start} onChange={(event) => setForm((c) => ({ ...c, start: event.target.checked }))} className="size-4 accent-brand-500" />
        Start now{form.kind === "recurring" ? ": book the visits for the next four weeks" : ""}
      </label>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy} disabled={!preview}>
          Set up the plan
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Pause, end or change a plan's series: pick the day, see exactly which visits are cancelled, then confirm. */
function PlanChange({ plan, action, onDone }: { plan: Plan; action: "pause" | "end" | "series"; onDone: () => void }) {
  const { companyId, timezone } = useCompany();
  const pause = useMutation(api.servicePlans.pause);
  const end = useMutation(api.servicePlans.end);
  const series = useMutation(api.servicePlans.changeSeries);
  const skip = useMutation(api.servicePlans.skipVisit);
  const { busy, error, run } = useRun();
  const today = useMemo(() => new Date().toLocaleDateString("en-CA", { timeZone: timezone }), [timezone]);
  const [form, setForm] = useState({ from: plan.next ? new Date(plan.next.startsAt).toLocaleDateString("en-CA", { timeZone: timezone }) : today, until: "", reason: "", cadence: plan.cadence ?? "every_14_days", startTime: plan.startTime, arrival: String(plan.arrivalWindowMinutes) });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const affected = useQuery(api.servicePlans.affected, /^\d{4}-\d{2}-\d{2}$/.test(form.from) ? { companyId, planId: plan.id, from: form.from, ...(action === "pause" && form.until ? { until: form.until } : {}) } : "skip");
  const shown = affected?.visits.map((v) => v.id) ?? [];
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          if (action === "pause") await pause({ companyId, planId: plan.id, expectedRevision: plan.revision, from: form.from, ...(form.until ? { until: form.until } : {}), shown, reason: form.reason || undefined });
          else if (action === "end") await end({ companyId, planId: plan.id, expectedRevision: plan.revision, from: form.from, shown, reason: form.reason });
          else await series({ companyId, planId: plan.id, expectedRevision: plan.revision, from: form.from, shown, cadence: form.cadence as "every_7_days", startTime: form.startTime, arrivalWindowMinutes: Number(form.arrival || "0") });
          onDone();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={action === "end" ? "Last day of service is before" : "From"}>
          <TextInput type="date" min={today} value={form.from} onChange={set("from")} required />
        </Field>
        {action === "pause" ? (
          <Field label="Resume on (optional)" hint="Empty: until someone resumes it.">
            <TextInput type="date" min={form.from} value={form.until} onChange={set("until")} />
          </Field>
        ) : null}
        {action === "series" ? (
          <>
            <Field label="How often">
              <SelectInput value={form.cadence} onChange={set("cadence")}>
                {Object.entries(CADENCE_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Start time">
              <TextInput type="time" value={form.startTime} onChange={set("startTime")} />
            </Field>
            <Field label="Arrival window, min">
              <TextInput inputMode="numeric" value={form.arrival} onChange={set("arrival")} />
            </Field>
          </>
        ) : null}
      </div>
      {action !== "series" ? (
        <Field label={action === "end" ? "Why it ends" : "Why (optional)"}>
          <TextInput value={form.reason} onChange={set("reason")} maxLength={300} required={action === "end"} />
        </Field>
      ) : null}
      <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
        {affected === undefined ? (
          <p className="text-muted-foreground">Checking the booked visits…</p>
        ) : affected.visits.length ? (
          <>
            <p className="font-medium text-strong">
              {affected.visits.length} booked visit{affected.visits.length === 1 ? "" : "s"} will be cancelled{action === "series" ? " and booked again on the new series" : ""}:
            </p>
            <ul className="mt-2 grid gap-1.5">
              {affected.visits.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-strong">{day(v.startsAt, timezone)}</span>
                  <span className="flex items-center gap-2">
                    <StaffingLine staffing={v.staffing} compact />
                    {action !== "series" ? (
                      <button type="button" className="text-xs font-medium text-brand-300 underline-offset-4 hover:underline" disabled={busy} onClick={() => void run(async () => (await skip({ companyId, planId: plan.id, expectedRevision: plan.revision, jobId: v.id }), onDone()))}>
                        Skip just this one
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {affected.visits.some((v) => v.staffing?.state !== "none") ? <p className="mt-2 text-xs text-warning-foreground">Cleaners who accepted are told their visit was cancelled.</p> : null}
          </>
        ) : (
          <p className="text-strong">No booked visit is affected.</p>
        )}
      </div>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" variant={action === "end" ? "destructive" : "primary"} loading={busy} disabled={affected === undefined}>
          {action === "pause" ? "Pause the plan" : action === "end" ? "End the plan" : "Change this and future visits"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const SOURCE_WORDS: Record<string, string> = { quote: "Priced by the engine", plan: "The plan's agreed price", manual: "Typed by a person", none: "No price" };

function Proposals({ profile }: { profile: Profile }) {
  const { companyId, timezone } = useCompany();
  const data = useQuery(api.clientDocuments.proposals, { companyId, customerId: profile.id });
  const sales = useClientSales(profile);
  if (data === undefined || sales === undefined) return <Skeleton className="h-48 rounded-2xl" />;
  return (
    <div className="grid gap-4">
      <SalesWork sales={sales} />
      <Card
        title="Agreements"
        action={
          <Link href={`/app/agreements/new?mode=selestial&customer=${profile.id}`} className="text-sm font-medium text-brand-300 underline-offset-4 hover:underline">
            Draft an agreement
          </Link>
        }
      >
        {data.agreements.length ? (
          <ul className="grid gap-2">
            {data.agreements.map((a) => (
              <li key={a.id} className={cn("rounded-xl border border-border px-3 py-2.5 text-sm", (a.archived || a.lifecycle === "superseded") && "opacity-70")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/app/agreements/${a.id}`} className="font-medium text-strong underline-offset-4 hover:underline">
                      {a.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {a.type} · version {a.version}
                      {a.signedVersion ? (a.signedVersion === a.version ? ", signed" : ` · version ${a.signedVersion} signed`) : ""}
                      {a.properties.length ? ` · ${a.properties.join(", ")}` : ""}
                    </p>
                  </div>
                  <Badge variant={a.workflow === "signed" ? "success" : a.workflow === "declined" || a.workflow === "expired" || a.workflow === "delivery_failed" ? "warning" : "outline"} size="sm">
                    {a.workflow.replace(/_/g, " ")}
                  </Badge>
                </div>
                <p className="mt-1 text-strong">{a.next}</p>
                <p className="text-xs text-muted-foreground">
                  {a.lifecycleWords}
                  {a.expiresOn ? ` · expires ${a.expiresOn}` : ""}
                  {a.renewalOn ? ` · renewal ${a.renewalOn}` : ""}
                  {a.archived ? " · archived" : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No customer agreement or proposal is linked to this client or its properties. Signing one never books a service by itself.</p>
        )}
      </Card>
      <Card title="Prices visits were booked at">
        {data.quotes.length ? (
          <ul className="grid gap-1.5 text-sm">
            {data.quotes.map((q) => (
              <li key={q.jobId} className="flex flex-wrap justify-between gap-x-3 rounded-lg px-1 py-1">
                <span className="text-strong">
                  {when(q.startsAt, timezone)} · {q.service}
                  <span className="text-muted-foreground"> · {q.property}</span>
                </span>
                <span className="tabular-nums text-strong">
                  {q.totalCents !== null ? money(q.totalCents) : "—"}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {q.source ? SOURCE_WORDS[q.source] : ""}
                    {q.version ? ` · version ${q.version}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No visit has been priced yet.</p>
        )}
      </Card>
    </div>
  );
}
