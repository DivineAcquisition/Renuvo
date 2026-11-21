"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextInput, useRun } from "@/components/app/form";
import { Notice } from "@/components/app/agreements/shared";
import { QuestionField, shown, type Q } from "@/components/app/agreements/question";
import type { Detail } from "@/components/app/agreements/types";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/shell";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Checkbox } from "@/components/ui/selection";
import { EmailInput } from "@/components/ui/fields";

type Section = { group: string; label: string; answered: number; total: number; questions: Q[] };

/** Every term, by topic, each with where it came from. Changing one rebuilds only the clauses that use it. */
export function KeyTerms({ detail, editable }: { detail: Detail; editable: boolean }) {
  const { companyId } = useCompany();
  const answer = useMutation(api.companyAgreements.answer);
  const skip = useMutation(api.companyAgreements.skipTerm);
  const assume = useMutation(api.companyAgreements.assume);
  const { busy, error, run } = useRun();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [held, setHeld] = useState<string | null>(null);
  const [assumption, setAssumption] = useState("");
  const [seenVersion, setSeenVersion] = useState(detail.currentVersion);
  if (seenVersion !== detail.currentVersion) {
    setSeenVersion(detail.currentVersion);
    setDrafts({});
  }
  const sections = detail.sections as Section[];
  const changed = Object.entries(drafts).filter(([key, value]) => {
    const q = sections.flatMap((s) => s.questions).find((x) => x.key === key);
    return q && value !== shown(q);
  });
  const save = (regenerate = false) =>
    run(async () => {
      const answers = Object.fromEntries(changed.map(([key, value]) => [key, value]).filter(([, value]) => String(value).trim() !== ""));
      const clear = changed.filter(([, value]) => !String(value).trim()).map(([key]) => key);
      const result = await answer({ companyId, agreementId: detail.id as Id<"agreements">, baseVersion: detail.currentVersion, answers, clear, regenerate });
      if (!result.ok) {
        if (result.reason === "edited") setHeld(result.message);
        else throw Object.assign(new Error(), { data: { message: result.message } });
      } else setHeld(null);
    });

  if (detail.origin === "upload" && sections.length === 0) return <Notice>This is an uploaded document, so it has no structured terms of its own. Its text is the document. Set its dates under Review &amp; Signatures.</Notice>;
  return (
    <div className="grid gap-4">
      {sections.map((section) => (
        <Panel key={section.group} title={`${section.label} · ${section.answered} of ${section.total}`}>
          <div className="grid gap-4 sm:grid-cols-2">
            {section.questions.map((q) => (
              <div key={q.key} className={q.type === "longtext" || q.type === "list" ? "sm:col-span-2" : undefined}>
                <QuestionField q={q} draft={drafts[q.key] ?? shown(q)} disabled={!editable} onChange={(value) => setDrafts((current) => ({ ...current, [q.key]: value }))} />
                {editable ? (
                  <button type="button" className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => void run(() => skip({ companyId, agreementId: detail.id as Id<"agreements">, key: q.key, skipped: !q.skipped }))}>
                    {q.skipped ? "Marked for review. Undo" : "Not decided yet: leave for review"}
                  </button>
                ) : q.skipped ? (
                  <span className="mt-1 block text-xs text-muted-foreground">Marked for review</span>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>
      ))}
      {editable ? (
        <div className="sticky bottom-3 z-10 grid gap-2 rounded-2xl border border-border bg-card/95 p-3 shadow-sm backdrop-blur">
          <FormError message={error} />
          {held ? (
            <Notice tone="warning">
              {held}{" "}
              <button type="button" className="font-medium underline" onClick={() => void save(true)}>
                Regenerate those clauses
              </button>
            </Notice>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" loading={busy} disabled={changed.length === 0} onClick={() => void save()}>
              Save {changed.length || ""} change{changed.length === 1 ? "" : "s"}
            </Button>
            <span className="text-xs text-muted-foreground">Each save is a new version. Earlier versions are kept and can be compared.</span>
          </div>
        </div>
      ) : null}
      <Panel title="Assumptions you confirmed">
        {detail.assumptions.length ? (
          <ul className="grid gap-1.5 text-sm text-strong">
            {detail.assumptions.map((a, index) => (
              <li key={index}>• {a.text}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No assumptions recorded. When Selestial relies on something you told it, such as how the property is used, it can be recorded here with your name and the time.</p>
        )}
        {editable ? (
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (assumption.trim()) void run(async () => { await assume({ companyId, agreementId: detail.id as Id<"agreements">, text: assumption }); setAssumption(""); });
            }}
          >
            <TextInput aria-label="An assumption to confirm" value={assumption} onChange={(event) => setAssumption(event.target.value)} placeholder="For example: all rooms are standard height and finishes" className="min-w-0 flex-1" />
            <Button type="submit" size="sm" variant="secondary">
              Confirm assumption
            </Button>
          </form>
        ) : null}
      </Panel>
    </div>
  );
}

const KINDS = [
  { id: "customers", label: "Customer" },
  { id: "properties", label: "Property" },
  { id: "cleaners", label: "Worker" },
] as const;

/** Who the agreement is between, who signs (and in what order), and the records it is about. */
export function PartiesAndLinks({ detail, editable }: { detail: Detail; editable: boolean }) {
  const { companyId } = useCompany();
  const setParties = useMutation(api.companyAgreements.setParties);
  const link = useMutation(api.companyAgreements.linkRecord);
  const unlink = useMutation(api.companyAgreements.unlinkRecord);
  const { busy, error, run } = useRun();
  const [parties, setLocal] = useState(detail.parties);
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("customers");
  const [customerId, setCustomerId] = useState("");
  const [recordId, setRecordId] = useState("");
  const partiesKey = JSON.stringify(detail.parties);
  const [seenParties, setSeenParties] = useState(partiesKey);
  if (seenParties !== partiesKey) {
    setSeenParties(partiesKey);
    setLocal(detail.parties);
  }
  const customers = useQuery(api.customers.list, { companyId });
  const cleaners = useQuery(api.cleaners.list, { companyId });
  const property = useQuery(api.customers.get, kind === "properties" && customerId ? { companyId, customerId: customerId as Id<"customers"> } : "skip");
  const dirty = JSON.stringify(parties) !== JSON.stringify(detail.parties);
  const edit = (index: number, patch: Partial<(typeof parties)[number]>) => setLocal((current) => current.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  return (
    <div className="grid gap-4">
      <Panel title="Parties and signers">
        <p className="mb-3 text-sm text-muted-foreground">Everyone marked as a signer must sign before the agreement counts as signed. Signing order applies where the signing service supports it. Email addresses are used only to send the signing request.</p>
        <ul className="grid gap-3">
          {parties.map((party, index) => (
            <li key={index} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1fr_1fr_6rem_auto] sm:items-end">
              <Field label={`${party.role === "company" ? "Your company" : party.role === "worker" ? "Worker" : party.role === "customer" ? "Customer" : party.role}`}>
                <TextInput value={party.name} disabled={!editable} onChange={(event) => edit(index, { name: event.target.value })} />
              </Field>
              <Field label="Email for signing">
                <EmailInput value={party.email ?? ""} disabled={!editable} onChange={(text) => edit(index, { email: text })} />
              </Field>
              <Field label="Order">
                <TextInput inputMode="numeric" value={String(party.order ?? index + 1)} disabled={!editable} onChange={(event) => edit(index, { order: Number(event.target.value) || undefined })} />
              </Field>
              <label className="flex items-center gap-2 pb-2 text-sm text-strong">
                <Checkbox checked={party.signer} disabled={!editable} onCheckedChange={(checked) => edit(index, { signer: checked })} />
                Signs
              </label>
              {editable ? (
                <button type="button" className="text-xs text-muted-foreground underline sm:col-span-4 sm:justify-self-start" onClick={() => setLocal((current) => current.filter((_, i) => i !== index))}>
                  Remove this party
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {editable ? (
          <div className="mt-3 grid gap-2">
            <FormError message={error} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setLocal((current) => [...current, { role: "other", name: "", signer: false }])}>
                Add a party
              </Button>
              <Button size="sm" variant="primary" loading={busy} disabled={!dirty} onClick={() => void run(() => setParties({ companyId, agreementId: detail.id as Id<"agreements">, parties: parties as never }))}>
                Save parties
              </Button>
            </div>
            {detail.workflow === "approved" ? <p className="text-xs text-muted-foreground">Changing a signer clears the approval, because the people who sign are part of what was approved.</p> : null}
          </div>
        ) : null}
      </Panel>

      <Panel title="Linked records">
        <p className="mb-3 text-sm text-muted-foreground">The agreement appears on each linked record. Linking does not give anyone access to it: people see it only if their role may read this kind of document.</p>
        {detail.links.length === 0 ? <p className="text-sm text-muted-foreground">Not linked to any record yet.</p> : null}
        <ul className="divide-y divide-border">
          {detail.links.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                <span className="text-xs capitalize text-muted-foreground">{row.table === "cleaners" ? "worker" : row.table.replace(/s$/, "")}</span> <span className="font-medium text-strong">{row.label}</span>
              </span>
              {editable ? (
                <Button size="sm" variant="ghost" onClick={() => void run(() => unlink({ companyId, agreementId: detail.id as Id<"agreements">, linkId: row.id as Id<"agreementLinks"> }))}>
                  Unlink
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {editable ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr_1fr_auto] sm:items-end">
            <Field label="Link a">
              <SelectInput value={kind} onChange={(event) => (setKind(event.target.value as never), setRecordId(""), setCustomerId(""))}>
                {KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </SelectInput>
            </Field>
            {kind === "properties" ? (
              <Field label="Customer">
                <SelectInput value={customerId} onChange={(event) => (setCustomerId(event.target.value), setRecordId(""))}>
                  <option value="">Choose…</option>
                  {customers?.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            ) : (
              <span className="hidden sm:block" />
            )}
            <Field label={KINDS.find((k) => k.id === kind)!.label}>
              <SelectInput value={recordId} onChange={(event) => setRecordId(event.target.value)}>
                <option value="">Choose…</option>
                {kind === "customers" ? customers?.map((c) => <option key={c._id} value={c._id}>{c.name}</option>) : null}
                {kind === "cleaners" ? cleaners?.map((c) => <option key={c._id} value={c._id}>{c.name}</option>) : null}
                {kind === "properties" ? property?.properties.map((p) => <option key={p._id} value={p._id}>{p.label ?? `${p.address.line1}, ${p.address.city}`}</option>) : null}
              </SelectInput>
            </Field>
            <Button size="sm" variant="secondary" disabled={!recordId} onClick={() => void run(async () => { await link({ companyId, agreementId: detail.id as Id<"agreements">, link: { table: kind, id: recordId } }); setRecordId(""); })}>
              Link
            </Button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
