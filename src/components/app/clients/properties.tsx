"use client";

/**
 * A client's properties, and each property in depth at its own address. What a property is like adapts
 * to its kind; what the client sees, what the crew is told and what stays in the office are kept apart.
 * Access instructions show only to Owners and Managers. Changing an address shows what it affects first.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { AgreementsForRecord } from "@/components/app/agreements/record";
import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { NewVisitForm } from "@/components/app/screens/forms";
import { ArrowLeft, Lock, MapPin, Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clientPath, PROPERTY_KIND_LABELS, CADENCE_LABELS } from "@/lib/app/clients";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { addressInput, AddressInputs, emptyAddress, type AddressValue } from "./add-client";
import { Card, EmptyState, money, PropertyKindIcon, StaffingLine } from "./bits";
import { ActionMenu } from "./menu";
import { AgentCard, PropertyCard, VisitRow, type PropertyRow } from "./parts";
import type { Profile } from "./profile";
import { Checkbox } from "@/components/ui/selection";

type Detail = NonNullable<ReturnType<typeof useQuery<typeof api.clientProperties.detail>>>;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function PropertiesTab({ profile, propertyId }: { profile: Profile; propertyId: string | null }) {
  const { timezone } = useCompany();
  const params = useSearchParams();
  const [adding, setAdding] = useState(params.get("add") === "1");
  if (propertyId) return <PropertyDetail profile={profile} propertyId={propertyId} />;
  const active = profile.properties.filter((p) => p.status === "active");
  const archived = profile.properties.filter((p) => p.status !== "active");
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {active.length} propert{active.length === 1 ? "y" : "ies"}
          {archived.length ? `, ${archived.length} archived` : ""}
        </p>
        <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
          <Plus aria-hidden /> Add a property
        </Button>
      </div>
      {active.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {active.map((p) => (
            <PropertyCard key={p.id} property={p} customerId={profile.id} timezone={timezone} />
          ))}
        </div>
      ) : (
        <EmptyState title="No property yet" action={<Button variant="primary" size="sm" onClick={() => setAdding(true)}><Plus aria-hidden /> Add a property</Button>}>
          Visits need a property. Add the address the client wants cleaned.
        </EmptyState>
      )}
      {archived.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-strong">{archived.length} archived</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {archived.map((p) => (
              <PropertyCard key={p.id} property={p} customerId={profile.id} timezone={timezone} />
            ))}
          </div>
        </details>
      ) : null}
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a property" description="Its address and what it is like. Access codes can be added by an Owner or Manager.">
        <PropertyForm profile={profile} property={null} onDone={() => setAdding(false)} />
      </Modal>
    </div>
  );
}

function PropertyDetail({ profile, propertyId }: { profile: Profile; propertyId: string }) {
  const { companyId, timezone } = useCompany();
  const detail = useQuery(api.clientProperties.detail, { companyId, propertyId: propertyId as Id<"properties"> });
  const [dialog, setDialog] = useState<"edit" | "address" | "book" | null>(null);
  const archive = useMutation(api.clientProperties.archive);
  const { busy, error, run } = useRun();
  const router = useRouter();
  if (detail === undefined) return <Skeleton className="h-96 rounded-2xl" />;
  const p = detail.property;
  const d = p.details as Record<string, unknown>;
  const str = p.kind === "short_term_rental";
  const site = p.kind === "office" || p.kind === "commercial";
  return (
    <div className="grid gap-5">
      <Link href={clientPath(profile.id, "properties")} className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-strong">
        <ArrowLeft aria-hidden className="size-4" /> All properties
      </Link>
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-300">
            <PropertyKindIcon kind={p.kind} className="size-6" />
          </span>
          <div className="min-w-0">
            <h2 className="font-heading text-xl tracking-tight text-strong">{p.name}</h2>
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin aria-hidden className="size-3.5" />
              {p.address.line1}
              {p.address.line2 ? `, ${p.address.line2}` : ""}, {p.address.city}, {p.address.region} {p.address.postalCode}
            </p>
            <p className="text-xs text-muted-foreground">
              {PROPERTY_KIND_LABELS[p.kind]}
              {p.status === "archived" ? " · archived" : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.status === "active" ? (
            <Button variant="primary" size="sm" onClick={() => setDialog("book")}>
              Book {str ? "a turnover" : "a visit"}
            </Button>
          ) : null}
          <ActionMenu
            label="More for this property"
            className="h-8 border border-border"
            actions={[
              { label: "Edit details", onSelect: () => setDialog("edit") },
              { label: "Change the address", onSelect: () => setDialog("address") },
              ...(detail.canManage && p.status === "active" ? [{ label: "Archive the property", danger: true, onSelect: () => window.confirm(`Archive ${p.name}? Its history is kept.`) && void run(async () => (await archive({ companyId, propertyId: p.id, expectedRevision: p.revision }), router.push(clientPath(profile.id, "properties")))) }] : []),
            ]}
          />
        </div>
      </div>
      <FormError message={error} />
      {busy ? <p className="text-sm text-muted-foreground">Archiving…</p> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid min-w-0 content-start gap-5">
          <Card title={str ? "The rental" : site ? "The site" : "The home"}>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              {str ? (
                <>
                  <Fact label="Beds to make" value={d.beds} />
                  <Fact label="Guests" value={d.maxGuests} />
                  <Fact label="Laundry" value={d.laundry === "on_site" ? "On site" : d.laundry === "off_site" ? "Off site" : d.laundry === "none" ? "None" : undefined} />
                  <Fact label="Checkout" value={d.checkoutTime} />
                  <Fact label="Check-in" value={d.checkinTime} />
                  <Fact label="Turnover window" value={d.checkoutTime && d.checkinTime ? `${d.checkoutTime}–${d.checkinTime}` : undefined} />
                  <Fact label="Supplies and restocking" value={d.supplies} wide />
                </>
              ) : site ? (
                <>
                  <Fact label="Size" value={d.squareFeet ? `${Number(d.squareFeet).toLocaleString()} sq ft` : undefined} />
                  <Fact label="Floors" value={d.floors} />
                  <Fact label="People on site" value={d.occupants} />
                  <Fact label="Service days" value={Array.isArray(d.serviceDays) && d.serviceDays.length ? (d.serviceDays as number[]).map((x) => DAYS[x]).join(", ") : undefined} />
                  <Fact label="Service window" value={d.serviceWindow ? `${(d.serviceWindow as { from: string }).from}–${(d.serviceWindow as { to: string }).to}` : undefined} />
                </>
              ) : (
                <>
                  <Fact label="Bedrooms" value={d.bedrooms} />
                  <Fact label="Bathrooms" value={d.bathrooms !== undefined ? `${d.bathrooms}${d.halfBaths ? ` + ${d.halfBaths} half` : ""}` : undefined} />
                  <Fact label="Size" value={d.squareFeet ? `${Number(d.squareFeet).toLocaleString()} sq ft` : undefined} />
                  <Fact label="Floors" value={d.floors} />
                  <Fact label="Pets" value={d.pets} />
                </>
              )}
            </dl>
            {site && Array.isArray(d.taskSchedule) && d.taskSchedule.length ? (
              <div className="mt-4">
                <p className="text-xs text-muted-foreground">Task schedule</p>
                <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
                  {(d.taskSchedule as { task: string; frequency: string }[]).map((row) => (
                    <li key={row.task} className="flex justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5">
                      <span className="text-strong">{row.task}</span>
                      <span className="text-muted-foreground">{row.frequency}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
          <Card title="Upcoming">
            {detail.upcoming.length ? (
              <ul className="grid gap-2">
                {detail.upcoming.map((v) => (
                  <VisitRow key={v.id} visit={v} timezone={timezone} showProperty={false} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing booked here.</p>
            )}
          </Card>
          <Card title="Recent visits">
            {detail.history.length ? (
              <ul className="grid gap-2">
                {detail.history.map((v) => (
                  <VisitRow key={v.id} visit={v} timezone={timezone} showProperty={false} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No visits yet.</p>
            )}
          </Card>
          {detail.work.length ? (
            <Card title="Open work here">
              <ul className="grid gap-2">
                {detail.work.map((card) => (
                  <AgentCard key={card.id} card={card} timezone={timezone} />
                ))}
              </ul>
            </Card>
          ) : null}
          <Card>
            <AgreementsForRecord table="properties" id={p.id} title="Agreements for this property" />
          </Card>
        </div>
        <div className="grid min-w-0 content-start gap-5">
          <Card title="Getting in">
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock aria-hidden className="size-3" /> Access instructions
                </dt>
                <dd className="whitespace-pre-line text-strong">{p.accessInstructions ?? (p.hasAccessInstructions ? "On file. Owners and Managers can see them; a cleaner sees them on an accepted visit." : "None recorded")}</dd>
              </div>
              <Fact label="Parking and where to go" value={p.parking} />
              <div>
                <dt className="text-xs text-muted-foreground">Site contact</dt>
                <dd className="text-strong">{detail.siteContacts.length ? detail.siteContacts.map((c) => `${c.name}${c.phone ? ` · ${c.phone}` : ""}`).join("; ") : "None. The primary contact is used."}</dd>
              </div>
            </dl>
          </Card>
          <Card title="Notes">
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">For the crew</dt>
                <dd className="whitespace-pre-line text-strong">{p.crewNotes ?? "None"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">What the client asked for</dt>
                <dd className="whitespace-pre-line text-strong">{p.clientNotes ?? "None"}</dd>
              </div>
              {detail.canManage ? (
                <div className="rounded-lg bg-muted/50 px-2.5 py-2">
                  <dt className="text-xs text-muted-foreground">Office only (Owners and Managers)</dt>
                  <dd className="whitespace-pre-line text-strong">{p.officeNotes ?? "None"}</dd>
                </div>
              ) : null}
            </dl>
          </Card>
          <Card title="Service here">
            {detail.plans.length ? (
              <ul className="grid gap-2 text-sm">
                {detail.plans.map((plan) => (
                  <li key={plan.id} className="rounded-xl border border-border px-3 py-2">
                    <p className="font-medium text-strong">{plan.service}</p>
                    <p className="text-xs text-muted-foreground">
                      {plan.kind === "standing" ? "Standing arrangement" : plan.cadence ? CADENCE_LABELS[plan.cadence] : "Recurring"} · {plan.state === "active" ? "running" : plan.state === "setup" ? "being set up" : plan.state}
                      {plan.priceCents !== null ? ` · ${money(plan.priceCents)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No plan here.</p>
            )}
            {detail.prices.length ? (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground">This property&apos;s own prices</p>
                <ul className="mt-1 grid gap-1 text-sm">
                  {detail.prices.map((row) => (
                    <li key={row.id}>
                      <Link href={`/app/services/${row.serviceId}`} className="text-strong underline-offset-4 hover:underline">
                        {row.service}: {money(row.baseCents)} base
                      </Link>
                      {row.untilWords ? <span className="text-xs text-muted-foreground"> · {row.untilWords}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
      <Modal open={dialog === "edit"} onClose={() => setDialog(null)} title={`Edit ${p.name}`} description="What the client sees, what the crew is told, and what stays in the office are kept apart.">
        <PropertyForm profile={profile} property={p} onDone={() => setDialog(null)} />
      </Modal>
      <Modal open={dialog === "address"} onClose={() => setDialog(null)} title="Change the address" description="Booked visits go to the new address. See what is affected before you save.">
        <AddressChange detail={detail} onDone={() => setDialog(null)} />
      </Modal>
      <Modal open={dialog === "book"} onClose={() => setDialog(null)} title={str ? "Book a turnover" : "Book a visit"} description="Priced from Services & Pricing, with this property's own price if it has one.">
        <NewVisitForm initial={{ customerId: profile.id, propertyId: p.id }} onDone={() => setDialog(null)} />
      </Modal>
    </div>
  );
}

function Fact({ label, value, wide }: { label: string; value: unknown; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-3" : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-strong">{value === undefined || value === null || value === "" ? <span className="text-muted-foreground">Not recorded</span> : String(value)}</dd>
    </div>
  );
}

const num = (value: string) => (value.trim() === "" ? undefined : Number(value));

/** Adds a property, or edits everything about one but its address. */
function PropertyForm({ profile, property, onDone }: { profile: Profile; property: PropertyRow | null; onDone: () => void }) {
  const { companyId } = useCompany();
  const save = useMutation(api.clientProperties.save);
  const { busy, error, run } = useRun();
  const d = (property?.details ?? {}) as Record<string, unknown>;
  const s = (value: unknown) => (value === undefined || value === null ? "" : String(value));
  const [kind, setKind] = useState(property?.kind ?? "home");
  const [address, setAddress] = useState<AddressValue>(emptyAddress());
  const [form, setForm] = useState({
    label: property?.label ?? "",
    bedrooms: s(d.bedrooms),
    bathrooms: s(d.bathrooms),
    halfBaths: s(d.halfBaths),
    squareFeet: s(d.squareFeet),
    floors: s(d.floors),
    pets: s(d.pets),
    beds: s(d.beds),
    maxGuests: s(d.maxGuests),
    laundry: s(d.laundry),
    supplies: s(d.supplies),
    checkoutTime: s(d.checkoutTime),
    checkinTime: s(d.checkinTime),
    occupants: s(d.occupants),
    windowFrom: s((d.serviceWindow as { from?: string } | undefined)?.from),
    windowTo: s((d.serviceWindow as { to?: string } | undefined)?.to),
    tasks: Array.isArray(d.taskSchedule) ? (d.taskSchedule as { task: string; frequency: string }[]).map((r) => `${r.task} | ${r.frequency}`).join("\n") : "",
    parking: property?.parking ?? "",
    crewNotes: property?.crewNotes ?? "",
    clientNotes: property?.clientNotes ?? "",
    officeNotes: property?.officeNotes ?? "",
    accessInstructions: property?.accessInstructions ?? "",
  });
  const [days, setDays] = useState<number[]>(Array.isArray(d.serviceDays) ? (d.serviceDays as number[]) : []);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const str = kind === "short_term_rental";
  const site = kind === "office" || kind === "commercial";
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const details = str
            ? { beds: num(form.beds), maxGuests: num(form.maxGuests), laundry: (form.laundry || undefined) as "on_site" | undefined, supplies: form.supplies || undefined, checkoutTime: form.checkoutTime || undefined, checkinTime: form.checkinTime || undefined }
            : site
              ? { squareFeet: num(form.squareFeet), floors: num(form.floors), occupants: num(form.occupants), serviceDays: days, ...(form.windowFrom && form.windowTo ? { serviceWindow: { from: form.windowFrom, to: form.windowTo } } : {}), taskSchedule: form.tasks.split("\n").filter((l) => l.trim()).map((line) => ({ task: line.split("|")[0].trim(), frequency: (line.split("|")[1] ?? "Every visit").trim() })) }
              : { bedrooms: num(form.bedrooms), bathrooms: num(form.bathrooms), halfBaths: num(form.halfBaths), squareFeet: num(form.squareFeet), floors: num(form.floors), pets: form.pets || undefined };
          await save({
            companyId,
            customerId: profile.id,
            ...(property ? { propertyId: property.id, expectedRevision: property.revision } : { address: addressInput(address) }),
            kind: kind as "home",
            label: form.label,
            details,
            parking: form.parking,
            crewNotes: form.crewNotes,
            clientNotes: form.clientNotes,
            ...(profile.canManage ? { officeNotes: form.officeNotes, accessInstructions: form.accessInstructions } : {}),
          });
          onDone();
        });
      }}
    >
      {!property ? <AddressInputs value={address} onChange={setAddress} required /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind of property">
          <SelectInput value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            {["home", "short_term_rental", "office", "commercial", "property_manager"].map((k) => (
              <option key={k} value={k}>
                {PROPERTY_KIND_LABELS[k]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Nickname (optional)">
          <TextInput value={form.label} onChange={set("label")} maxLength={120} placeholder="Lake house, HQ, Unit 4" />
        </Field>
      </div>
      <fieldset className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-3">
        <legend className="px-1 text-sm font-medium text-strong">{str ? "The rental" : site ? "The site" : "The home"}</legend>
        {str ? (
          <>
            <Field label="Beds to make"><TextInput inputMode="numeric" value={form.beds} onChange={set("beds")} /></Field>
            <Field label="Guests"><TextInput inputMode="numeric" value={form.maxGuests} onChange={set("maxGuests")} /></Field>
            <Field label="Laundry">
              <SelectInput value={form.laundry} onChange={set("laundry")}>
                <option value="">Not recorded</option>
                <option value="on_site">On site</option>
                <option value="off_site">Off site</option>
                <option value="none">None</option>
              </SelectInput>
            </Field>
            <Field label="Checkout"><TextInput type="time" value={form.checkoutTime} onChange={set("checkoutTime")} /></Field>
            <Field label="Check-in"><TextInput type="time" value={form.checkinTime} onChange={set("checkinTime")} /></Field>
            <Field label="Supplies and restocking" className="sm:col-span-3"><TextInput value={form.supplies} onChange={set("supplies")} maxLength={500} /></Field>
          </>
        ) : site ? (
          <>
            <Field label="Size, sq ft"><TextInput inputMode="numeric" value={form.squareFeet} onChange={set("squareFeet")} /></Field>
            <Field label="Floors"><TextInput inputMode="numeric" value={form.floors} onChange={set("floors")} /></Field>
            <Field label="People on site"><TextInput inputMode="numeric" value={form.occupants} onChange={set("occupants")} /></Field>
            <div className="grid gap-1.5 text-sm sm:col-span-3">
              <span className="font-medium text-strong">Service days</span>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((label, i) => (
                  <label key={label} className="cursor-pointer rounded-lg border border-border px-2.5 py-1 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-500/[0.08]">
                    <Checkbox className="sr-only" checked={days.includes(i)} onCheckedChange={(checked) => setDays((current) => (checked ? [...current, i] : current.filter((x) => x !== i)))} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <Field label="Service window from"><TextInput type="time" value={form.windowFrom} onChange={set("windowFrom")} /></Field>
            <Field label="to"><TextInput type="time" value={form.windowTo} onChange={set("windowTo")} /></Field>
            <Field label="Task schedule" hint="One task per line: task | how often" className="sm:col-span-3">
              <TextArea rows={3} value={form.tasks} onChange={set("tasks")} placeholder={"Empty bins | Every visit\nWindows | Monthly"} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Bedrooms"><TextInput inputMode="numeric" value={form.bedrooms} onChange={set("bedrooms")} /></Field>
            <Field label="Bathrooms"><TextInput inputMode="numeric" value={form.bathrooms} onChange={set("bathrooms")} /></Field>
            <Field label="Half baths"><TextInput inputMode="numeric" value={form.halfBaths} onChange={set("halfBaths")} /></Field>
            <Field label="Size, sq ft"><TextInput inputMode="numeric" value={form.squareFeet} onChange={set("squareFeet")} /></Field>
            <Field label="Floors"><TextInput inputMode="numeric" value={form.floors} onChange={set("floors")} /></Field>
            <Field label="Pets"><TextInput value={form.pets} onChange={set("pets")} maxLength={200} /></Field>
          </>
        )}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Parking and where to go" hint="The crew sees this."><TextArea rows={2} value={form.parking} onChange={set("parking")} maxLength={500} /></Field>
        <Field label="Notes for the crew" hint="How this property is cleaned."><TextArea rows={2} value={form.crewNotes} onChange={set("crewNotes")} maxLength={2000} /></Field>
        <Field label="What the client asked for" hint="In their words; shared with the client."><TextArea rows={2} value={form.clientNotes} onChange={set("clientNotes")} maxLength={2000} /></Field>
        {profile.canManage ? (
          <Field label="Office notes" hint="Owners and Managers only."><TextArea rows={2} value={form.officeNotes} onChange={set("officeNotes")} maxLength={2000} /></Field>
        ) : null}
      </div>
      {profile.canManage ? (
        <Field label="Access instructions" hint="Gate codes, lockboxes, alarms. Owners and Managers only; a cleaner sees them on an accepted visit. Never in search or summaries.">
          <TextArea rows={2} value={form.accessInstructions} onChange={set("accessInstructions")} maxLength={2000} />
        </Field>
      ) : null}
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy}>
          {property ? "Save" : "Add property"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A new address, with what it affects shown before saving: booked visits, plans and the service area. */
function AddressChange({ detail, onDone }: { detail: Detail; onDone: () => void }) {
  const { companyId, timezone } = useCompany();
  const change = useMutation(api.clientProperties.changeAddress);
  const { busy, error, run } = useRun();
  const [address, setAddress] = useState<AddressValue>(emptyAddress());
  const [confirmOutside, setConfirmOutside] = useState(false);
  const impact = useQuery(api.clientProperties.addressImpact, address.postalCode.trim().length >= 3 ? { companyId, propertyId: detail.property.id, postalCode: address.postalCode } : "skip");
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!impact) return;
        void run(async () => {
          await change({ companyId, propertyId: detail.property.id, expectedRevision: detail.property.revision, address: addressInput(address), shown: impact.upcoming.map((v) => v.id), ...(confirmOutside ? { outsideArea: true } : {}) });
          onDone();
        });
      }}
    >
      <p className="text-sm text-muted-foreground">
        Now: {detail.property.address.line1}, {detail.property.address.city} {detail.property.address.postalCode}
      </p>
      <AddressInputs value={address} onChange={setAddress} label="New address" required />
      {impact ? (
        <div className="grid gap-2 rounded-xl border border-border bg-muted/30 p-3 text-sm">
          <p className={impact.inArea ? "text-strong" : "font-medium text-warning-foreground"}>{impact.areaWords}</p>
          <p className="text-strong">
            {impact.upcoming.length ? `${impact.upcoming.length} booked visit${impact.upcoming.length === 1 ? "" : "s"} will go to the new address, at the price ${impact.upcoming.length === 1 ? "it was" : "they were"} booked with. Dispatch is asked to recheck ${impact.upcoming.length === 1 ? "its crew" : "their crews"} and travel.` : "No booked visit is affected."}
            {impact.plans ? ` ${impact.plans} plan${impact.plans === 1 ? "" : "s"} here will book the new address from now on.` : ""}
          </p>
          {impact.upcoming.length ? (
            <ul className="grid gap-1">
              {impact.upcoming.slice(0, 6).map((v) => (
                <li key={v.id} className="flex flex-wrap justify-between gap-2 text-xs">
                  <span className="text-strong">{new Date(v.startsAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone })} · {v.service}</span>
                  <StaffingLine staffing={v.staffing} compact />
                </li>
              ))}
              {impact.upcoming.length > 6 ? <li className="text-xs text-muted-foreground">and {impact.upcoming.length - 6} more</li> : null}
            </ul>
          ) : null}
          {!impact.inArea && impact.canOverride ? (
            <label className="flex items-start gap-2 text-strong">
              <Checkbox checked={confirmOutside} onCheckedChange={(checked) => setConfirmOutside(checked)} className="mt-0.5" />
              Move it anyway: we will serve this address outside our area.
            </label>
          ) : null}
        </div>
      ) : null}
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy} disabled={!impact || (!impact.inArea && !confirmOutside)}>
          Change the address
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
