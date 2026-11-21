"use client";

/**
 * Editing a client. Each save names the revision it was opened at: if someone saved in between, the save
 * is refused with a plain explanation and nothing is overwritten.
 */
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Button } from "@/components/ui/button";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { ContactRow, PropertyRow } from "./parts";
import { Checkbox } from "@/components/ui/selection";
import { useConfirm } from "@/components/ui/fields/confirm";
import { EmailInput, PhoneInput } from "@/components/ui/fields";

type Profile = NonNullable<ReturnType<typeof useQuery<typeof api.clients.profile>>>;

function Actions({ busy, label, onCancel, danger }: { busy: boolean; label: string; onCancel: () => void; danger?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" variant={danger ? "destructive" : "primary"} loading={busy}>
        {label}
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

export function EditClientForm({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const { companyId } = useCompany();
  const update = useMutation(api.clients.update);
  const overview = useQuery(api.clients.overview, { companyId });
  const { busy, error, run } = useRun();
  const [form, setForm] = useState({
    name: profile.name,
    type: profile.type,
    kind: profile.kind,
    preferences: profile.preferences ?? "",
    channel: profile.communication.preferredChannel ?? "",
    bestTime: profile.communication.bestTime ?? "",
    language: profile.communication.language ?? "",
    privateNotes: profile.privateNotes ?? "",
    owner: profile.owner?.id ?? "",
  });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await update({
            companyId,
            customerId: profile.id,
            expectedRevision: profile.revision,
            name: form.name,
            type: form.type,
            kind: form.kind,
            preferences: form.preferences,
            communication: { preferredChannel: (form.channel || null) as "sms" | null, bestTime: form.bestTime, language: form.language },
            ...(profile.canManage ? { privateNotes: form.privateNotes } : {}),
            accountOwnerId: form.owner ? (form.owner as Id<"members">) : null,
          });
          onDone();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={form.type === "business" ? "Business name" : "Name"}>
          <TextInput value={form.name} onChange={set("name")} required maxLength={160} />
        </Field>
        <Field label="Kind of client">
          <SelectInput value={form.type} onChange={set("type")}>
            <option value="person">A person or household</option>
            <option value="business">A business</option>
          </SelectInput>
        </Field>
        <Field label="Mainly serves">
          <SelectInput value={form.kind} onChange={set("kind")}>
            <option value="home">Homes</option>
            <option value="short_term_rental">Short-term rentals</option>
            <option value="commercial">Commercial or office</option>
            <option value="property_manager">Property management</option>
          </SelectInput>
        </Field>
        <Field label="Account owner" hint="The team member responsible for the relationship.">
          <SelectInput value={form.owner} onChange={set("owner")}>
            <option value="">No account owner</option>
            {overview?.owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <Field label="Service preferences" hint="What every crew should know about how this client likes things done. Cleaners see it with their visits.">
        <TextArea value={form.preferences} onChange={set("preferences")} rows={3} maxLength={2000} />
      </Field>
      <fieldset className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-3">
        <legend className="px-1 text-sm font-medium text-strong">Communication</legend>
        <Field label="Prefers">
          <SelectInput value={form.channel} onChange={set("channel")}>
            <option value="">No preference</option>
            <option value="sms">Text</option>
            <option value="email">Email</option>
            <option value="phone">Phone call</option>
          </SelectInput>
        </Field>
        <Field label="Best time">
          <TextInput value={form.bestTime} onChange={set("bestTime")} maxLength={120} placeholder="Weekday mornings" />
        </Field>
        <Field label="Language">
          <TextInput value={form.language} onChange={set("language")} maxLength={60} />
        </Field>
        <p className="text-xs text-muted-foreground sm:col-span-3">Preferences guide people. Whether a text or email may be sent is decided by the client&apos;s consent and opt-outs, which are kept separately.</p>
      </fieldset>
      {profile.canManage ? (
        <Field label="Private notes" hint="Owners and Managers only. Never shown to cleaners, the client, search, or agent summaries.">
          <TextArea value={form.privateNotes} onChange={set("privateNotes")} rows={3} maxLength={4000} />
        </Field>
      ) : null}
      <FormError message={error} />
      <Actions busy={busy} label="Save" onCancel={onDone} />
    </form>
  );
}

const RELATIONSHIP_HELP: Record<string, string> = {
  prospect: "Not a client yet.",
  active: "A current client.",
  paused: "A current client taking a break. Plans and visits are not changed by this; pause a plan on its own.",
  former: "No longer a client. Kept with its history.",
};

export function RelationshipForm({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const { companyId } = useCompany();
  const set = useMutation(api.clients.setRelationship);
  const { busy, error, run } = useRun();
  const options = profile.canManage ? (["prospect", "active", "paused", "former"] as const) : profile.relationship === "prospect" ? (["prospect", "active"] as const) : ([profile.relationship] as const);
  const [value, setValue] = useState<string>(profile.relationship === "prospect" ? "active" : profile.relationship);
  const [note, setNote] = useState("");
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await set({ companyId, customerId: profile.id, expectedRevision: profile.revision, relationship: value as "active", note: note || undefined });
          onDone();
        });
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="sr-only">Relationship</legend>
        {options.map((option) => (
          <label key={option} className="flex cursor-pointer items-start gap-2 rounded-xl border border-border px-3 py-2 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-500/[0.06]">
            <input type="radio" name="relationship" value={option} checked={value === option} onChange={() => setValue(option)} className="mt-1 accent-brand-500" />
            <span>
              <span className="block font-medium capitalize text-strong">{option === "active" ? "Active client" : option}</span>
              <span className="block text-xs text-muted-foreground">{RELATIONSHIP_HELP[option]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {!profile.canManage && profile.relationship !== "prospect" ? <p className="text-sm text-muted-foreground">Only an Owner or Manager can pause or end a relationship.</p> : null}
      <Field label="Note (optional)">
        <TextInput value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Why, in a few words" />
      </Field>
      <FormError message={error} />
      <Actions busy={busy} label="Save" onCancel={onDone} />
    </form>
  );
}

const ROLES = [
  { id: "primary", label: "Primary contact", detail: "Their email and phone are the client's." },
  { id: "billing", label: "Billing contact", detail: "Receives invoices and receipts." },
  { id: "signer", label: "Signer", detail: "Signs agreements for the client." },
  { id: "site", label: "Site contact", detail: "Meets the crew at a property." },
] as const;

export function ContactForm({ customerId, contact, properties, onDone }: { customerId: Id<"customers">; contact: ContactRow | null; properties: PropertyRow[]; onDone: () => void }) {
  const { companyId } = useCompany();
  const save = useMutation(api.clients.saveContact);
  const remove = useMutation(api.clients.removeContact);
  const { busy, error, run } = useRun();
  const { ask, element: confirmDialog } = useConfirm();
  const [form, setForm] = useState({ name: contact?.name ?? "", title: contact?.title ?? "", email: contact?.email ?? "", phone: contact?.phone ?? "" });
  const [roles, setRoles] = useState<string[]>(contact?.roles ?? []);
  const [sites, setSites] = useState<string[]>(contact?.propertyIds ?? []);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await save({ companyId, customerId, ...(contact ? { contactId: contact.id } : {}), name: form.name, title: form.title || undefined, email: form.email || undefined, phone: form.phone || undefined, roles: roles as "primary"[], propertyIds: roles.includes("site") ? (sites as Id<"properties">[]) : [] });
          onDone();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <TextInput value={form.name} onChange={set("name")} required maxLength={160} />
        </Field>
        <Field label="Title (optional)">
          <TextInput value={form.title} onChange={set("title")} maxLength={80} />
        </Field>
        <Field label="Email">
          <EmailInput value={form.email} onChange={(text) => set("email")({ target: { type: "text", value: text } } as unknown as React.ChangeEvent<HTMLInputElement>)} />
        </Field>
        <Field label="Phone">
          <PhoneInput value={form.phone} onChange={(text) => set("phone")({ target: { type: "text", value: text } } as unknown as React.ChangeEvent<HTMLInputElement>)} />
        </Field>
      </div>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium text-strong">Roles</legend>
        {ROLES.map((role) => (
          <label key={role.id} className="flex cursor-pointer items-start gap-2 rounded-xl border border-border px-3 py-2 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-500/[0.06]">
            <Checkbox checked={roles.includes(role.id)} onCheckedChange={(checked) => setRoles((current) => (checked ? [...current, role.id] : current.filter((r) => r !== role.id)))} className="mt-1" />
            <span>
              <span className="block font-medium text-strong">{role.label}</span>
              <span className="block text-xs text-muted-foreground">{role.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {roles.includes("site") && properties.length > 1 ? (
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-sm font-medium text-strong">Site contact for</legend>
          {properties
            .filter((p) => p.status === "active")
            .map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm text-strong">
                <Checkbox checked={sites.includes(p.id)} onCheckedChange={(checked) => setSites((current) => (checked ? [...current, p.id] : current.filter((id) => id !== p.id)))} />
                {p.name}
              </label>
            ))}
          <p className="text-xs text-muted-foreground">None ticked: every property.</p>
        </fieldset>
      ) : null}
      <FormError message={error} />
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Actions busy={busy} label={contact ? "Save contact" : "Add contact"} onCancel={onDone} />
        {contact && !contact.roles.includes("primary") ? (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() =>
              void ask({
                title: `Remove ${contact.name} from this client?`,
                body: "They are taken off this client's contacts.",
                confirmLabel: "Remove contact",
                cancelLabel: "Keep contact",
                tone: "danger",
                action: async () => {
                  await remove({ companyId, contactId: contact.id as Id<"clientContacts"> });
                  onDone();
                },
              })
            }>
            Remove contact
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Archiving shows what still depends on the client first. Visits and plans are never cancelled by it. */
export function ArchiveForm({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const { companyId } = useCompany();
  const preview = useQuery(api.clients.archivePreview, { companyId, customerId: profile.id });
  const archive = useMutation(api.clients.archive);
  const { busy, error, run } = useRun();
  const [reason, setReason] = useState("");
  if (!preview) return <p className="text-sm text-muted-foreground">Checking what depends on this client…</p>;
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await archive({ companyId, customerId: profile.id, expectedRevision: profile.revision, reason });
          onDone();
        });
      }}
    >
      {preview.blockers.length ? (
        <div role="alert" className="rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm">
          <p className="font-medium text-strong">Not yet: something is still to come</p>
          <ul className="mt-1 grid gap-0.5 text-strong">
            {preview.blockers.map((b) => (
              <li key={b}>• {b}</li>
            ))}
          </ul>
          <p className="mt-1 text-muted-foreground">Archiving never cancels visits or ends plans on its own, so nothing stops without someone deciding it.</p>
        </div>
      ) : null}
      <ul className="grid gap-0.5 text-sm text-muted-foreground">
        {preview.notes.map((n) => (
          <li key={n}>• {n}</li>
        ))}
      </ul>
      <Field label="Why">
        <TextInput value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={500} disabled={preview.blockers.length > 0} />
      </Field>
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" loading={busy} disabled={preview.blockers.length > 0}>
          Archive client
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
