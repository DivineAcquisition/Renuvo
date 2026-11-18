"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Home, Plus } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { changePath } from "@/lib/app/services";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { quote as runQuote, type PropertyExtra } from "../../../../convex/lib/services/engine";
import type { Spec } from "../../../../convex/lib/services/spec";
import { addOnWord, lowerFirst, minutesWords } from "../../../../convex/lib/services/words";
import { defaultInput } from "./preview";
import { ChangeBadge, day, formatCents, LabeledField, MoneyInput, NumberInput, SectionTitle, Segmented, when } from "./shared";
import { AnimatedMoney } from "./visuals";

type Data = NonNullable<ReturnType<typeof useQuery<typeof api.propertyPrices.forService>>>;
type Start = { customerId?: string; propertyId?: string; property?: string; baseCents?: number; laborMinutes?: number | null; addedTasks?: string[]; extras?: PropertyExtra[] };

const TIP = "A property's own base price for this service, for example after a walkthrough or for a rental listing. Extras, rush, discounts, the minimum and rounding still come from the service. The Owner approves each one, and it keeps its price when the service's price changes.";

/**
 * The properties that have their own price for this service: those in force, those waiting for the
 * Owner, and those that ended. Owners and Managers propose; only the Owner approves (in Changes) or ends.
 */
export function PropertyPrices({ serviceId, spec }: { serviceId: Id<"services">; spec: Spec }) {
  const { companyId } = useCompany();
  const data = useQuery(api.propertyPrices.forService, { companyId, serviceId });
  const [editing, setEditing] = useState<Start | null>(null);
  if (data === undefined) return <Skeleton className="h-40 rounded-2xl" />;
  const per = spec.pricing.method === "recurring_package" ? "month" : spec.visitWord;
  const nothing = data.active.length === 0 && data.waiting.length === 0;
  return (
    <section aria-label="Property prices" className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <SectionTitle
        title="Property prices"
        tip={TIP}
        action={
          data.canPropose && data.live && !editing ? (
            <Button size="sm" variant="secondary" onClick={() => setEditing({})}>
              <Plus aria-hidden /> Add a property price
            </Button>
          ) : null
        }
      />
      {editing ? <ProposeForm key={editing.propertyId ?? "new"} serviceId={serviceId} spec={spec} start={editing} today={data.today} onCancel={() => setEditing(null)} /> : null}
      {nothing && !editing ? <p className="text-sm text-muted-foreground">No property has its own price. Every visit uses the service&apos;s price.</p> : null}
      {data.active.length ? (
        <ul aria-label="Properties with their own price" className="grid grid-cols-1 gap-2">
          {data.active.map((row) => (
            <ActiveRow key={row.id} row={row} per={per} canPropose={data.canPropose} canEnd={data.canEnd} onChange={() => setEditing({ customerId: row.customerId, propertyId: row.propertyId, property: row.property, baseCents: row.baseCents, laborMinutes: row.laborMinutes, addedTasks: row.addedTasks, extras: row.extras.map((e) => ({ id: e.id, included: e.included, priceCents: e.priceCents })) })} />
          ))}
        </ul>
      ) : null}
      {data.waiting.length ? (
        <div className={cn(data.active.length && "mt-4")}>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Waiting for the Owner</p>
          <ul aria-label="Property prices waiting for the Owner" className="grid grid-cols-1 gap-1.5">
            {data.waiting.map((row) => (
              <li key={row.changeId}>
                <Link href={changePath(row.changeId)} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm transition-colors hover:border-brand-500/40">
                  <span className="min-w-0">
                    <span className="block font-medium text-strong">{row.property}</span>
                    <span className="block text-xs text-muted-foreground">
                      {row.customer} · proposed {when(row.submittedAt)}
                      {row.untilWords ? ` · ${lowerFirst(row.untilWords)}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-medium tabular-nums text-strong">{formatCents(row.baseCents)}</span>
                    <ChangeBadge state={row.state} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {data.past.length ? <Past rows={data.past} /> : null}
    </section>
  );
}

function ActiveRow({ row, per, canPropose, canEnd, onChange }: { row: Data["active"][number]; per: string; canPropose: boolean; canEnd: boolean; onChange: () => void }) {
  const { companyId } = useCompany();
  const end = useMutation(api.propertyPrices.end);
  const { busy, error, run } = useRun();
  return (
    <li className="rounded-xl border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-300">
            <Home className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-strong">{row.property}</p>
            <p className="text-xs text-muted-foreground">
              {row.customer} · approved {day(row.approvedAt)} by {row.approvedBy}
            </p>
            {row.untilWords || row.catalogMoved || row.laborMinutes || row.addedTasks.length || row.extras.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {row.untilWords ? (
                  <Badge variant={row.dueSoon ? "warning" : "outline"} size="sm">
                    {row.untilWords}
                  </Badge>
                ) : null}
                {row.laborMinutes ? (
                  <Badge variant="outline" size="sm">
                    {minutesWords(row.laborMinutes)} of cleaner time
                  </Badge>
                ) : null}
                {row.addedTasks.length ? (
                  <Badge variant="outline" size="sm" title={row.addedTasks.join("; ")}>
                    +{row.addedTasks.length} task{row.addedTasks.length === 1 ? "" : "s"} here
                  </Badge>
                ) : null}
                {row.extras.map((extra) => (
                  <Badge key={extra.id} variant="outline" size="sm">
                    {extra.label}: {extra.included ? "included" : `${formatCents(extra.priceCents ?? 0)} ${extra.unit}`}
                  </Badge>
                ))}
                {row.catalogMoved ? (
                  <Badge variant="info" size="sm">
                    Kept its price through a service change
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex w-full items-center justify-between gap-3 pl-[2.625rem] sm:w-auto sm:justify-end sm:pl-0">
          <p className="sm:text-right">
            <span className="block font-heading text-lg leading-tight tabular-nums text-strong">{formatCents(row.baseCents)}</span>
            <span className="block text-[11px] text-muted-foreground">base per {per}</span>
          </p>
          {canPropose || canEnd ? (
            <div className="flex gap-1 sm:flex-col">
              {canPropose ? (
                <Button size="xs" variant="ghost" disabled={busy} onClick={onChange} aria-label={`Change the price for ${row.property}`}>
                  Change
                </Button>
              ) : null}
              {canEnd ? (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`End the price for ${row.property}`}
                  onClick={() => {
                    const reason = window.prompt(`End ${row.property}'s own price now? Its next visits pay the service's price; booked visits keep theirs. Why?`);
                    if (!reason?.trim()) return;
                    void run(async () => end({ companyId, priceId: row.id, reason }));
                  }}
                >
                  End
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <FormError message={error} />
    </li>
  );
}

function Past({ rows }: { rows: Data["past"] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground hover:text-strong">
        {rows.length} ended or replaced
      </summary>
      <ul className="mt-1.5 grid grid-cols-1 gap-1">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap justify-between gap-x-3 px-1 text-muted-foreground">
            <span>
              {row.property} · {row.state === "replaced" ? "replaced" : "ended"}
              {row.endedAt ? ` ${day(row.endedAt)}` : ""}
              {row.endedReason && row.state === "ended" ? `: ${row.endedReason}` : ""}
            </span>
            <span className="tabular-nums">{formatCents(row.baseCents)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

type DateKind = "none" | "review" | "end";
const DATE_OPTIONS = [
  { id: "none", label: "No date" },
  { id: "review", label: "Review date" },
  { id: "end", label: "End date" },
] as const;

function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Proposes a property's own base price. It goes to the Owner in Changes; nothing prices a visit until it is approved. */
function ProposeForm({ serviceId, spec, start, today, onCancel }: { serviceId: Id<"services">; spec: Spec; start: Start; today: string; onCancel: () => void }) {
  const { companyId } = useCompany();
  const router = useRouter();
  const propose = useMutation(api.propertyPrices.propose);
  const customers = useQuery(api.customers.list, { companyId });
  const [customerId, setCustomerId] = useState(start.customerId ?? "");
  const [propertyId, setPropertyId] = useState(start.propertyId ?? "");
  const [baseCents, setBaseCents] = useState<number | null>(start.baseCents ?? null);
  const [minutes, setMinutes] = useState<number | null>(start.laborMinutes ?? null);
  const [dateKind, setDateKind] = useState<DateKind>("none");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [tasks, setTasks] = useState((start.addedTasks ?? []).join("\n"));
  const [extras, setExtras] = useState<PropertyExtra[]>(start.extras ?? []);
  const sellable = spec.addOns.filter((a) => !a.coversItemId || !spec.included.some((item) => item.id === a.coversItemId));
  const addedTasks = tasks.split("\n").map((t) => t.trim()).filter(Boolean);
  const { busy, error, run, setError } = useRun();
  const per = spec.pricing.method === "recurring_package" ? "month" : spec.visitWord;

  // The service's example job, priced both ways by the same engine visits use.
  const sample = useMemo(() => defaultInput(spec), [spec]);
  const usual = useMemo(() => runQuote(spec, sample), [spec, sample]);
  const mine = useMemo(() => (baseCents ? runQuote(spec, { ...sample, propertyPrice: { baseCents, laborMinutes: minutes, extras } }) : null), [spec, sample, baseCents, minutes, extras]);
  const usualTotal = usual.outcome === "firm" || usual.outcome === "estimate" ? usual.totalCents : null;

  return (
    <form
      aria-label="Propose a property price"
      className="mb-4 grid grid-cols-1 gap-4 rounded-xl border border-brand-500/25 bg-brand-500/[0.04] p-3 sm:p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!propertyId) return setError("Choose the property.");
        if (!baseCents) return setError("Enter the property's base price.");
        if (dateKind !== "none" && !date) return setError(dateKind === "end" ? "Choose the end date, or no date." : "Choose the review date, or no date.");
        if (!reason.trim()) return setError("Say why this property has its own price. The Owner reads it first.");
        const unpriced = extras.find((e) => !e.included && e.priceCents === null);
        if (unpriced) return setError(`Give "${spec.addOns.find((a) => a.id === unpriced.id)?.label ?? "the extra"}" a price here, or set it back to the service's.`);
        void run(async () => {
          const { changeId } = await propose({ companyId, serviceId, propertyId: propertyId as Id<"properties">, baseCents, laborMinutes: minutes === null ? null : Math.round(minutes), until: dateKind === "none" ? null : { kind: dateKind, date }, reason, addedTasks, extras });
          router.push(changePath(changeId));
        });
      }}
    >
      {start.property ? (
        <p className="text-sm text-strong">
          New price for <span className="font-medium">{start.property}</span>
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LabeledField label="Customer">
            {(id) => (
              <SelectInput
                id={id}
                value={customerId}
                onChange={(event) => {
                  setCustomerId(event.target.value);
                  setPropertyId("");
                }}
                required
              >
                <option value="">{customers ? "Choose a customer" : "Loading…"}</option>
                {customers?.map((customer) => (
                  <option key={customer._id} value={customer._id}>
                    {customer.name}
                  </option>
                ))}
              </SelectInput>
            )}
          </LabeledField>
          <LabeledField label="Property">
            {(id) =>
              customerId ? (
                <PropertyChoice id={id} customerId={customerId as Id<"customers">} value={propertyId} onChange={setPropertyId} />
              ) : (
                <SelectInput id={id} disabled>
                  <option>Choose a customer first</option>
                </SelectInput>
              )
            }
          </LabeledField>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MoneyInput label="Base price here" cents={baseCents} onCents={setBaseCents} unit={`per ${per}`} tip="Replaces only the service's base price at this property. Extras, rush, discounts, the minimum and rounding still apply." />
        <NumberInput label="Cleaner time here (optional)" value={minutes} onValue={setMinutes} unit="minutes" min={15} step={15} tip="Leave empty to plan visits with the service's own time. This changes how long visits here are planned, not the price." />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Segmented label="Review or end" value={dateKind} options={DATE_OPTIONS} onChange={setDateKind} tip="A review date only reminds the Owner, two weeks before. After an end date the property pays the service's price again; the Owner is reminded two weeks before that too." />
        {dateKind !== "none" ? <TextInput type="date" className="w-full sm:w-48" aria-label={dateKind === "end" ? "Last day at this price" : "Day to review it"} min={nextDay(today)} value={date} onChange={(event) => setDate(event.target.value)} required /> : null}
      </div>
      <details className="group rounded-lg border border-border bg-card px-3 py-2" open={addedTasks.length > 0 || extras.length > 0 || undefined}>
        <summary className="cursor-pointer text-sm font-medium text-strong">
          What&apos;s different here <span className="font-normal text-muted-foreground">(optional)</span>
          {addedTasks.length || extras.length ? <span className="ml-2 text-xs font-normal text-muted-foreground">{[addedTasks.length ? `${addedTasks.length} task${addedTasks.length === 1 ? "" : "s"}` : null, extras.length ? `${extras.length} extra${extras.length === 1 ? "" : "s"}` : null].filter(Boolean).join(", ")}</span> : null}
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-4 pb-1">
          <LabeledField label="Also done here" tip="One task per line. They are added to each visit's scope and checklist at this property, after the service's own." hint="For example: water the plants">
            {(id) => <TextArea id={id} rows={3} value={tasks} onChange={(event) => setTasks(event.target.value)} maxLength={1000} />}
          </LabeledField>
          {sellable.length ? (
            <fieldset className="grid grid-cols-1 gap-2 text-sm">
              <legend className="mb-1.5 font-medium text-strong">Extras here</legend>
              {sellable.map((addOn) => {
                const here = extras.find((e) => e.id === addOn.id);
                const mode = !here ? "usual" : here.included ? "included" : "own";
                const set = (next: PropertyExtra | null) => setExtras((current) => [...current.filter((e) => e.id !== addOn.id), ...(next ? [next] : [])]);
                return (
                  <div key={addOn.id} className="grid grid-cols-1 items-center gap-2 rounded-lg border border-border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,12rem)]">
                    <span className="min-w-0 text-strong">
                      {addOn.label} <span className="text-xs text-muted-foreground">{formatCents(addOn.priceCents)} {addOnWord(addOn)}</span>
                    </span>
                    <SelectInput aria-label={`${addOn.label} at this property`} value={mode} onChange={(event) => set(event.target.value === "usual" ? null : event.target.value === "included" ? { id: addOn.id, included: true, priceCents: null } : { id: addOn.id, included: false, priceCents: here?.priceCents ?? null })}>
                      <option value="usual">The service&apos;s price</option>
                      <option value="included">Included here</option>
                      <option value="own">Its own price here</option>
                    </SelectInput>
                    {mode === "own" ? <MoneyInput label={`Price for ${addOn.label} here`} className="[&>span:first-child]:sr-only" cents={here?.priceCents ?? null} onCents={(cents) => set({ id: addOn.id, included: false, priceCents: cents })} unit={addOnWord(addOn)} /> : <span className="hidden sm:block" />}
                  </div>
                );
              })}
            </fieldset>
          ) : null}
        </div>
      </details>
      <LabeledField label="Why" tip="The Owner reads this first, for example: walkthrough on March 3, large open-plan home.">
        {(id) => <TextArea id={id} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} placeholder="After a walkthrough on…" />}
      </LabeledField>
      {mine && mine.totalCents !== null ? (
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
          <div>
            <p className="text-xs text-muted-foreground">The service&apos;s example job, at this property</p>
            <AnimatedMoney cents={mine.totalCents} className="font-heading text-2xl tracking-tight text-strong" />
          </div>
          {usualTotal !== null ? (
            <p className="text-sm text-muted-foreground">
              Elsewhere <span className="tabular-nums text-strong">{formatCents(usualTotal)}</span>
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">Goes to the Owner in Changes. Visits use it only once it is approved{minutes ? `, planned at ${minutesWords(minutes)} of cleaner time` : ""}.</p>
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          Send for approval
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function PropertyChoice({ id, customerId, value, onChange }: { id: string; customerId: Id<"customers">; value: string; onChange: (value: string) => void }) {
  const { companyId } = useCompany();
  const found = useQuery(api.customers.get, { companyId, customerId });
  const active = found?.properties.filter((property) => property.status === "active") ?? [];
  return (
    <SelectInput id={id} value={value} onChange={(event) => onChange(event.target.value)} required disabled={!found}>
      <option value="">{found ? (active.length ? "Choose a property" : "No active property") : "Loading…"}</option>
      {active.map((property) => (
        <option key={property._id} value={property._id}>
          {property.label ?? `${property.address.line1}, ${property.address.city}`}
        </option>
      ))}
    </SelectInput>
  );
}
