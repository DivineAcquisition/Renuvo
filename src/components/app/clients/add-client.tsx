"use client";

/**
 * Adding a client: who they are, their primary contact and, if known, the first property. Clients who look
 * like one already on file are shown while typing and again before saving, with a way to open them.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";

import { AddressField } from "@/components/app/address-field";
import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextInput, useRun } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { clientPath, PROPERTY_KIND_LABELS } from "@/lib/app/clients";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type Duplicate = { customerId: Id<"customers">; name: string; reason: string; status: string };

export type AddressValue = { line1: string; line2: string; city: string; region: string; postalCode: string; place: { placeId: string; lat?: number; lng?: number } | null };
export const emptyAddress = (): AddressValue => ({ line1: "", line2: "", city: "", region: "", postalCode: "", place: null });
export const addressInput = (a: AddressValue) => ({ line1: a.line1, ...(a.line2.trim() ? { line2: a.line2 } : {}), city: a.city, region: a.region, postalCode: a.postalCode, ...(a.place ?? {}) });

/** A street with address search, and the rest of the address. Typing the street again drops a picked map location. */
export function AddressInputs({ value, onChange, label = "Address", required }: { value: AddressValue; onChange: (next: AddressValue) => void; label?: string; required?: boolean }) {
  const set = (key: "line2" | "city" | "region" | "postalCode") => (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: event.target.value });
  return (
    <div className="grid gap-3">
      <AddressField label={label} value={value.line1} required={required} onChange={(line1) => onChange({ ...value, line1, place: null })} onPick={({ placeId, lat, lng, ...picked }) => onChange({ line1: picked.line1, line2: picked.line2 ?? "", city: picked.city, region: picked.region, postalCode: picked.postalCode, place: { placeId, lat, lng } })} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Unit (optional)">
          <TextInput value={value.line2} onChange={set("line2")} autoComplete="address-line2" />
        </Field>
        <Field label="City">
          <TextInput value={value.city} onChange={set("city")} required={required} />
        </Field>
        <Field label="State">
          <TextInput value={value.region} onChange={set("region")} required={required} />
        </Field>
        <Field label="Postal code">
          <TextInput value={value.postalCode} onChange={set("postalCode")} required={required} />
        </Field>
      </div>
    </div>
  );
}

function Matches({ matches, title }: { matches: Duplicate[]; title: string }) {
  if (!matches.length) return null;
  return (
    <div role="status" className="rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm">
      <p className="font-medium text-strong">{title}</p>
      <ul className="mt-1 grid gap-1">
        {matches.map((m) => (
          <li key={m.customerId} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-strong">
              {m.name}
              <span className="text-muted-foreground">
                {" "}
                · {m.reason}
                {m.status === "archived" ? " · archived" : ""}
              </span>
            </span>
            <Link href={clientPath(m.customerId)} className="text-xs font-medium text-brand-300 underline-offset-4 hover:underline">
              Open this client
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const KINDS = [
  { id: "home", label: "Homes" },
  { id: "short_term_rental", label: "Short-term rentals" },
  { id: "commercial", label: "Commercial or office" },
  { id: "property_manager", label: "Property management" },
] as const;

export function AddClientForm({ onDone, onCreated }: { onDone: () => void; onCreated: (customerId: Id<"customers">) => void }) {
  const { companyId } = useCompany();
  const create = useMutation(api.clients.create);
  const { busy, error, run } = useRun();
  const [type, setType] = useState<"person" | "business">("person");
  const [form, setForm] = useState({ name: "", kind: "home" as (typeof KINDS)[number]["id"], contactName: "", title: "", email: "", phone: "", relationship: "active" as "active" | "prospect", propertyKind: "home", label: "" });
  const [address, setAddress] = useState<AddressValue>(emptyAddress());
  const [withProperty, setWithProperty] = useState(true);
  const [refused, setRefused] = useState<Duplicate[]>([]);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const lookup = useDeferredValue({ name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() });
  const ready = lookup.name.length >= 3 || lookup.email.includes("@") || lookup.phone.replace(/\D/g, "").length >= 10;
  const matches = useQuery(api.clients.duplicates, ready ? { companyId, ...(lookup.name ? { name: lookup.name } : {}), ...(lookup.email ? { email: lookup.email } : {}), ...(lookup.phone ? { phone: lookup.phone } : {}) } : "skip") ?? [];
  const submit = (addAnyway: boolean) =>
    run(async () => {
      const result = await create({
        companyId,
        type,
        name: form.name,
        kind: form.kind,
        relationship: form.relationship,
        contact: { name: type === "business" ? form.contactName || form.name : form.name, ...(form.title ? { title: form.title } : {}), ...(form.email ? { email: form.email } : {}), ...(form.phone ? { phone: form.phone } : {}) },
        ...(withProperty && address.line1.trim() ? { property: { address: addressInput(address), kind: form.propertyKind as "home", ...(form.label ? { label: form.label } : {}) } } : {}),
        addAnyway,
      });
      if (!result.created) return setRefused(result.duplicates);
      onCreated(result.customerId);
    });
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(refused.length > 0);
      }}
    >
      <div role="radiogroup" aria-label="Kind of client" className="grid grid-cols-2 gap-2">
        {(["person", "business"] as const).map((option) => (
          <label key={option} className={cn("cursor-pointer rounded-xl border px-3 py-2.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500/40", type === option ? "border-brand-500 bg-brand-500/[0.07]" : "border-border hover:border-brand-500/40")}>
            <input type="radio" className="sr-only" name="client-type" checked={type === option} onChange={() => setType(option)} />
            <span className="block font-medium text-strong">{option === "person" ? "A person or household" : "A business"}</span>
            <span className="block text-xs text-muted-foreground">{option === "person" ? "Homes and personal rentals" : "Offices, sites, property managers, hosts"}</span>
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={type === "business" ? "Business name" : "Name"}>
          <TextInput value={form.name} onChange={set("name")} required maxLength={160} autoComplete={type === "person" ? "name" : "organization"} />
        </Field>
        <Field label="Mainly serves">
          <SelectInput value={form.kind} onChange={set("kind")}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        {type === "business" ? (
          <>
            <Field label="Primary contact">
              <TextInput value={form.contactName} onChange={set("contactName")} maxLength={160} placeholder="Who you deal with" />
            </Field>
            <Field label="Their title (optional)">
              <TextInput value={form.title} onChange={set("title")} maxLength={80} />
            </Field>
          </>
        ) : null}
        <Field label="Email">
          <TextInput type="email" value={form.email} onChange={set("email")} autoComplete="email" />
        </Field>
        <Field label="Phone" hint="An email or a phone is needed.">
          <TextInput type="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" />
        </Field>
      </div>
      <Matches matches={refused.length ? refused : matches} title={refused.length ? "This looks like a client you already have" : "Already on file?"} />
      <fieldset className="grid gap-3 rounded-xl border border-border p-3">
        <legend className="px-1 text-sm font-medium text-strong">First property</legend>
        <label className="flex items-center gap-2 text-sm text-strong">
          <input type="checkbox" checked={withProperty} onChange={(event) => setWithProperty(event.target.checked)} className="size-4 accent-brand-500" />
          Add it now
        </label>
        {withProperty ? (
          <>
            <AddressInputs value={address} onChange={setAddress} required />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Kind of property">
                <SelectInput value={form.propertyKind} onChange={set("propertyKind")}>
                  {["home", "short_term_rental", "office", "commercial", "property_manager"].map((k) => (
                    <option key={k} value={k}>
                      {PROPERTY_KIND_LABELS[k]}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Nickname (optional)" hint="For example: Lake house, HQ, Unit 4.">
                <TextInput value={form.label} onChange={set("label")} maxLength={120} />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">Access codes are added on the property&apos;s page, by an Owner or Manager.</p>
          </>
        ) : null}
      </fieldset>
      <Field label="Relationship">
        <SelectInput value={form.relationship} onChange={set("relationship")}>
          <option value="active">A client</option>
          <option value="prospect">A prospect (not a client yet)</option>
        </SelectInput>
      </Field>
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" loading={busy}>
          {refused.length ? "Add anyway" : "Add client"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
