"use client";

/**
 * A person adds an inquiry by hand: a call that came in, a referral, someone who walked up. It becomes
 * the same opportunity a form or a text would. Sales may only write to the person if the member says
 * how they agreed to be contacted; otherwise the opportunity waits on a person.
 */
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { clientKey } from "@/lib/app/finance";

import { api } from "../../../../../convex/_generated/api";

type Kind = "residential" | "commercial" | "short_term_rental";
const CONSENT = [
  { value: "", label: "Not recorded (Sales will not message them)" },
  { value: "verbal", label: "They said so, in person or on a call" },
  { value: "paper_form", label: "They signed a paper form" },
  { value: "staff", label: "They asked a team member to follow up" },
] as const;

function InquiryForm({ onDone }: { onDone: (id: string) => void }) {
  const { companyId } = useCompany();
  const playbook = useQuery(api.sales.playbook, { companyId });
  const create = useMutation(api.sales.create);
  const { busy, error, run, setError } = useRun();
  const [key] = useState(() => clientKey());
  const [form, setForm] = useState({ name: "", phone: "", email: "", kind: "residential" as Kind, serviceKey: "", inquiry: "", channel: "sms" as "sms" | "email", consent: "" as (typeof CONSENT)[number]["value"], consentNote: "" });
  const set = <K extends keyof typeof form>(name: K, value: (typeof form)[K]) => setForm((before) => ({ ...before, [name]: value }));
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          if (!form.phone.trim() && !form.email.trim()) return setError("Add a phone number or an email address so there is a way to reply.");
          if (form.consent && form.consentNote.trim().length < 3) return setError("Say in a few words how they agreed, for the record.");
          const channel = form.channel === "sms" && !form.phone.trim() ? "email" : form.channel === "email" && !form.email.trim() ? "sms" : form.channel;
          const result = await create({
            companyId,
            name: form.name,
            ...(form.phone.trim() ? { phone: form.phone } : {}),
            ...(form.email.trim() ? { email: form.email } : {}),
            kind: form.kind,
            ...(form.serviceKey ? { serviceKey: form.serviceKey } : {}),
            inquiry: form.inquiry,
            channel,
            ...(form.consent ? { consent: { source: form.consent, note: form.consentNote } } : {}),
            clientKey: key,
          });
          onDone(result.opportunityId);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <TextInput required value={form.name} onChange={(event) => set("name", event.target.value)} autoComplete="off" />
        </Field>
        <Field label="Phone">
          <TextInput type="tel" value={form.phone} onChange={(event) => set("phone", event.target.value)} autoComplete="off" />
        </Field>
        <Field label="Email">
          <TextInput type="email" value={form.email} onChange={(event) => set("email", event.target.value)} autoComplete="off" />
        </Field>
        <Field label="Kind of work">
          <SelectInput value={form.kind} onChange={(event) => set("kind", event.target.value as Kind)}>
            <option value="residential">Home</option>
            <option value="commercial">Commercial</option>
            <option value="short_term_rental">Short-term rental</option>
          </SelectInput>
        </Field>
        <Field label="Service" hint={playbook && playbook.services.length === 0 ? "No service is published yet." : undefined}>
          <SelectInput value={form.serviceKey} onChange={(event) => set("serviceKey", event.target.value)}>
            <option value="">Not sure yet</option>
            {(playbook?.services ?? []).map((service) => (
              <option key={service.key} value={service.key}>
                {service.name}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <Field label="What they asked for">
        <TextArea required value={form.inquiry} onChange={(event) => set("inquiry", event.target.value)} rows={3} placeholder="In their words, as far as you remember them" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Reply by">
          <SelectInput value={form.channel} onChange={(event) => set("channel", event.target.value as "sms" | "email")}>
            <option value="sms">Text</option>
            <option value="email">Email</option>
          </SelectInput>
        </Field>
        <Field label="How they agreed to be contacted">
          <SelectInput value={form.consent} onChange={(event) => set("consent", event.target.value as typeof form.consent)}>
            {CONSENT.map((row) => (
              <option key={row.value} value={row.value}>
                {row.label}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      {form.consent ? (
        <Field label="In a few words, what they said" hint="Kept as the record of their permission.">
          <TextInput value={form.consentNote} onChange={(event) => set("consentNote", event.target.value)} placeholder="Asked us to text her a price on the call today" />
        </Field>
      ) : (
        <p className="text-xs text-muted-foreground">Without a record of how they agreed, the inquiry is filed and waits on you. A phone number or an address alone is not permission to message someone.</p>
      )}
      <FormError message={error} />
      <div>
        <Button type="submit" variant="primary" loading={busy}>
          Add the inquiry
        </Button>
      </div>
    </form>
  );
}

export function NewInquiryButton({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        Add an inquiry
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add an inquiry" description="For a request that reached you outside Selestial. Texts to your business number and form submissions are filed automatically.">
        <InquiryForm
          onDone={(id) => {
            setOpen(false);
            onCreated(id);
          }}
        />
      </Modal>
    </>
  );
}
