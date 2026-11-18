"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

import { AddressField } from "@/components/app/address-field";
import { FormError, messageOf } from "@/components/app/form";
import { MapPin, Plus, Search, TriangleAlert, User, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/app/format";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { DraftBody } from "../../../../convex/lib/sales/draft";
import { Chip, fieldClass, FormSection } from "./kit";
import type { DraftData, Working } from "./use-draft";

type Address = { line1: string; line2?: string; city: string; region: string; postalCode: string; placeId?: string; lat?: number; lng?: number };
const EMPTY_ADDRESS: Address = { line1: "", city: "", region: "", postalCode: "" };

function AddressInputs({ value, onChange }: { value: Address; onChange: (value: Address) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-6">
      <AddressField
        className="sm:col-span-6"
        label="Street address"
        value={value.line1}
        required
        onChange={(line1) => onChange({ ...value, line1, placeId: undefined, lat: undefined, lng: undefined })}
        onPick={(picked) => onChange({ line1: picked.line1, line2: picked.line2, city: picked.city, region: picked.region, postalCode: picked.postalCode, placeId: picked.placeId, lat: picked.lat, lng: picked.lng })}
      />
      <label className="grid gap-1.5 text-sm sm:col-span-3">
        <span className="font-medium text-strong">City</span>
        <input className={fieldClass()} value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} autoComplete="address-level2" />
      </label>
      <label className="grid gap-1.5 text-sm sm:col-span-1">
        <span className="font-medium text-strong">State</span>
        <input className={fieldClass()} value={value.region} onChange={(e) => onChange({ ...value, region: e.target.value })} autoComplete="address-level1" />
      </label>
      <label className="grid gap-1.5 text-sm sm:col-span-2">
        <span className="font-medium text-strong">ZIP / postal code</span>
        <input className={fieldClass()} value={value.postalCode} onChange={(e) => onChange({ ...value, postalCode: e.target.value })} autoComplete="postal-code" />
      </label>
    </div>
  );
}

function inArea(areas: string[], postal: string): boolean | null {
  if (!postal.trim()) return null;
  if (areas.length === 0) return true;
  return areas.includes(postal.trim().toUpperCase());
}

/** Find an existing customer, or add one without leaving the workspace. Duplicates are shown, never merged. */
function FindOrAdd({ companyId, draftId, onPick }: { companyId: Id<"companies">; draftId: Id<"salesDrafts">; onPick: (customerId: Id<"customers">, propertyId: Id<"properties"> | null) => void }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [person, setPerson] = useState({ name: "", email: "", phone: "" });
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dupes, setDupes] = useState<{ customerId: Id<"customers">; name: string; why: string }[] | null>(null);
  const quickCreate = useMutation(api.sales.quickCreate);
  useEffect(() => {
    const id = setTimeout(() => setQuery(q), 200);
    return () => clearTimeout(id);
  }, [q]);
  const results = useQuery(api.sales.findCustomers, query.trim().length >= 2 ? { companyId, q: query } : "skip");
  const possible = useQuery(api.sales.duplicates, adding && (person.name.trim().length >= 2 || person.email || person.phone) ? { companyId, name: person.name, email: person.email || undefined, phone: person.phone || undefined } : "skip");

  const create = (confirmedNew: boolean) => {
    setError(null);
    setBusy(true);
    const hasAddress = address.line1.trim() && address.city.trim() && address.region.trim() && address.postalCode.trim();
    quickCreate({ companyId, draftId, customer: { name: person.name, email: person.email || undefined, phone: person.phone || undefined }, property: hasAddress ? { address } : undefined, confirmedNew })
      .then((result) => {
        if (!result.created) setDupes(result.duplicates);
        else onPick(result.customerId, result.propertyId);
      })
      .catch((caught: unknown) => setError(messageOf(caught)))
      .finally(() => setBusy(false));
  };

  if (adding) {
    return (
      <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-strong">New customer</p>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Back to search
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-strong">Name</span>
            <input className={fieldClass()} value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} autoComplete="name" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-strong">Email</span>
            <input className={fieldClass()} type="email" value={person.email} onChange={(e) => setPerson({ ...person, email: e.target.value })} autoComplete="email" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-strong">Mobile</span>
            <input className={fieldClass()} type="tel" value={person.phone} onChange={(e) => setPerson({ ...person, phone: e.target.value })} autoComplete="tel" />
          </label>
        </div>
        {possible && possible.length ? (
          <div role="status" className="rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm">
            <p className="flex items-center gap-1.5 font-medium text-warning-foreground">
              <TriangleAlert aria-hidden className="size-4" /> Possibly already a customer
            </p>
            <ul className="mt-2 grid gap-1.5">
              {possible.map((match) => (
                <li key={match.customerId} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-medium text-strong">{match.name}</span> <span className="text-xs text-muted-foreground">({match.why})</span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => onPick(match.customerId, null)}>
                    Use this customer
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <AddressInputs value={address} onChange={setAddress} />
        {dupes ? (
          <div role="alert" className="rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm text-strong">
            {dupes.map((d) => d.name).join(", ")} has the same {dupes[0]?.why}. Choose them above, or confirm this is a different customer.
            <div className="mt-2">
              <Button size="sm" onClick={() => create(true)} disabled={busy}>
                It’s a different customer, add them
              </Button>
            </div>
          </div>
        ) : null}
        <FormError message={error} />
        <div>
          <Button onClick={() => create(false)} disabled={busy || person.name.trim().length < 2}>
            <Plus aria-hidden className="size-4" /> Add customer
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-60 flex-1">
          <span className="sr-only">Search customers by name, email, phone or address</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input className={fieldClass("pl-9")} placeholder="Search by name, email, phone or address" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </label>
        <Button variant="outline" onClick={() => setAdding(true)}>
          <Plus aria-hidden className="size-4" /> Quick add
        </Button>
      </div>
      {results && results.length === 0 ? <p className="text-sm text-muted-foreground">No customer matches “{query}”. Use Quick add.</p> : null}
      {results && results.length ? (
        <ul className="grid gap-2" aria-label="Matching customers">
          {results.map((customer) => (
            <li key={customer._id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-strong">{customer.name}</p>
                  <p className="text-xs text-muted-foreground">{[customer.email, customer.phone].filter(Boolean).join(" · ") || "No contact details"}</p>
                </div>
                {customer.properties.length === 0 ? (
                  <Button size="sm" variant="outline" onClick={() => onPick(customer._id, null)}>
                    Choose
                  </Button>
                ) : null}
              </div>
              {customer.properties.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {customer.properties.map((p) => (
                    <button key={p._id} type="button" onClick={() => onPick(customer._id, p._id)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-strong hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
                      <MapPin aria-hidden className="size-3.5 text-muted-foreground" />
                      {p.label ? `${p.label} · ` : ""}
                      {p.line1}, {p.city}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CustomerSection({ n, data, working, update, setBody, done, companyId }: { n: number; data: DraftData; working: Working; update: (change: Partial<Working>) => void; setBody: (change: (body: DraftBody) => DraftBody) => void; done: boolean; companyId: Id<"companies"> }) {
  const draftId = data.draft._id;
  const customer = data.customer && data.customer._id === working.customerId ? data.customer : null;
  const context = useQuery(api.sales.customerContext, working.customerId ? { companyId, customerId: working.customerId } : "skip");
  const addProperty = useMutation(api.sales.addProperty);
  const [newAddress, setNewAddress] = useState<Address | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notes = working.body.notes ?? {};
  const contacts = working.body.contacts ?? {};
  const chosen = data.properties.find((p) => p._id === working.propertyId) ?? null;
  const area = chosen ? inArea(data.serviceAreas, chosen.address.postalCode) : null;
  const proposal = working.mode === "proposal";

  return (
    <FormSection n={n} id="customer" title={proposal ? "Client & sites" : "Customer & property"} lead={proposal ? "Who the proposal is for and who decides." : "Who the service is for and where."} done={done}>
      {!customer ? (
        <FindOrAdd companyId={companyId} draftId={draftId} onPick={(customerId, propertyId) => update({ customerId, propertyId })} />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3">
            <div className="flex items-start gap-3">
              <span aria-hidden className="grid size-9 place-content-center rounded-full bg-brand-500/10 text-brand-600 ring-1 ring-brand-500/20">
                <User className="size-4.5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-strong">{customer.name}</p>
                <p className="text-xs text-muted-foreground">{[customer.email, customer.phone].filter(Boolean).join(" · ") || "No email or phone yet"}</p>
                {context ? (
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {context.visits.length ? <Chip>{context.visits.length === 6 ? "6+" : context.visits.length} past visit{context.visits.length === 1 ? "" : "s"}</Chip> : <Chip tone="brand">New customer</Chip>}
                    {context.plans.some((p) => p.status === "active") ? <Chip tone="success">Recurring plan active</Chip> : null}
                    {context.quotes.some((q) => q.status === "saved" || q.status === "sent") ? <Chip tone="warning">Open quote</Chip> : null}
                  </p>
                ) : null}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => update({ customerId: null, propertyId: null })}>
              <X aria-hidden className="size-4" /> Change
            </Button>
          </div>
          {context && context.visits.length ? (
            <details className="rounded-xl border border-border px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium text-strong">Recent service</summary>
              <ul className="mt-2 grid gap-1">
                {context.visits.map((visit) => (
                  <li key={visit._id} className="flex justify-between gap-2 text-xs">
                    <span className="text-strong">
                      {visit.service} · {new Date(visit.startsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {visit.priceCents !== null ? money(visit.priceCents) : ""} {visit.status}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {!proposal ? (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium text-strong">Service address</legend>
              {data.properties.length === 0 ? <p className="text-sm text-muted-foreground">No address on file yet.</p> : null}
              <div className="grid gap-2 sm:grid-cols-2">
                {data.properties.map((p) => {
                  const ok = inArea(data.serviceAreas, p.address.postalCode);
                  return (
                    <label key={p._id} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm focus-within:outline-2 focus-within:outline-brand-500 ${working.propertyId === p._id ? "border-brand-500 bg-brand-500/6" : "border-border"}`}>
                      <input type="radio" name="property" className="mt-1 accent-brand-500" checked={working.propertyId === p._id} onChange={() => update({ propertyId: p._id })} />
                      <span className="min-w-0">
                        <span className="block font-medium text-strong">{p.label ?? p.address.line1}</span>
                        <span className="block text-xs text-muted-foreground">
                          {p.address.line1}, {p.address.city} {p.address.postalCode}
                        </span>
                        {ok === false ? <Chip tone="danger">Outside service area</Chip> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
              {newAddress ? (
                <div className="grid gap-3 rounded-xl border border-border p-3">
                  <AddressInputs value={newAddress} onChange={setNewAddress} />
                  {inArea(data.serviceAreas, newAddress.postalCode) === false ? <p className="text-sm text-destructive-foreground">The company doesn’t serve {newAddress.postalCode}. You can still save the address.</p> : null}
                  <FormError message={error} />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        setError(null);
                        addProperty({ companyId, draftId, address: newAddress })
                          .then((propertyId) => {
                            update({ propertyId });
                            setNewAddress(null);
                          })
                          .catch((caught: unknown) => setError(messageOf(caught)));
                      }}
                    >
                      Save address
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setNewAddress(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <Button size="sm" variant="outline" onClick={() => setNewAddress(EMPTY_ADDRESS)}>
                    <Plus aria-hidden className="size-4" /> Add an address
                  </Button>
                </div>
              )}
              {area === true && data.serviceAreas.length ? <p className="text-xs text-success-foreground">In the company’s service area.</p> : null}
              {area === false ? <p className="text-sm text-destructive-foreground">This address is outside the company’s service area. It can’t be booked until the area is added under Business & hours.</p> : null}
            </fieldset>
          ) : null}
          <details className="rounded-xl border border-border px-3 py-2" open={Boolean(contacts.billing?.name || contacts.site?.name)}>
            <summary className="cursor-pointer text-sm font-medium text-strong">Billing and site contacts</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <fieldset className="grid gap-2">
                <legend className="text-xs font-medium text-muted-foreground">Billing contact (if not the customer)</legend>
                <input className={fieldClass()} placeholder="Name" value={contacts.billing?.name ?? ""} onChange={(e) => setBody((b) => ({ ...b, contacts: { ...b.contacts, billing: { ...b.contacts?.billing, name: e.target.value } } }))} />
                <input className={fieldClass()} placeholder="Email" type="email" value={contacts.billing?.email ?? ""} onChange={(e) => setBody((b) => ({ ...b, contacts: { ...b.contacts, billing: { ...b.contacts?.billing, email: e.target.value } } }))} />
              </fieldset>
              <fieldset className="grid gap-2">
                <legend className="text-xs font-medium text-muted-foreground">Site contact (who lets the crew in)</legend>
                <input className={fieldClass()} placeholder="Name" value={contacts.site?.name ?? ""} onChange={(e) => setBody((b) => ({ ...b, contacts: { ...b.contacts, site: { ...b.contacts?.site, name: e.target.value } } }))} />
                <input className={fieldClass()} placeholder="Phone" type="tel" value={contacts.site?.phone ?? ""} onChange={(e) => setBody((b) => ({ ...b, contacts: { ...b.contacts, site: { ...b.contacts?.site, phone: e.target.value } } }))} />
              </fieldset>
            </div>
          </details>
          <div className="grid gap-3 lg:grid-cols-3">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-strong">For the customer</span>
              <textarea className={fieldClass("min-h-20 py-2")} placeholder="Shown on what the customer receives" value={notes.customer ?? ""} onChange={(e) => setBody((b) => ({ ...b, notes: { ...b.notes, customer: e.target.value } }))} />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-strong">Access notes for cleaners</span>
              <textarea className={fieldClass("min-h-20 py-2")} placeholder="Parking, entry, pets. Shown to the crew only" value={notes.cleaner ?? ""} onChange={(e) => setBody((b) => ({ ...b, notes: { ...b.notes, cleaner: e.target.value } }))} />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-strong">Office notes (private)</span>
              <textarea className={fieldClass("min-h-20 py-2")} placeholder="Never shown to the customer or crew" value={notes.office ?? ""} onChange={(e) => setBody((b) => ({ ...b, notes: { ...b.notes, office: e.target.value } }))} />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">Never type card numbers in notes. Card details are taken only on the secure payment page.</p>
        </>
      )}
    </FormSection>
  );
}
