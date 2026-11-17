"use client";

/**
 * The company's onboarding checklist: what each kind of worker needs, what an unmet item holds up, who
 * reviews it and how long it stays valid. The Owner changes it; everyone can read it. Nothing here is a
 * universal rule: it starts from Selestial's suggestion and becomes the company's own on the first change.
 */
import { useConvex, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { PageHeader } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { ArrowLeft, PenLine, Plus, RotateCcw } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EFFECT_WORDS, ENGAGEMENT_SHORT, type Engagement } from "./bits";
import { CLEANERS_PATH } from "./state";

type Definition = FunctionReturnType<typeof api.requirements.template>["definitions"][number];

const KIND_WORDS: Record<Definition["kind"], string> = {
  contact: "Contact details",
  agreement: "Agreement",
  document: "Document",
  payment: "Payment setup",
  availability: "Availability",
  service_areas: "Service areas",
  skills: "Skills",
  equipment: "Equipment",
  training: "Training",
  acknowledgment: "Acknowledgment",
  custom: "Other",
};
const EFFECT_TONE = { blocks_assignments: "error", blocks_payment: "warning", informational: "outline" } as const;
const TABS: (Engagement | "all")[] = ["all", "employee", "contractor", "subcontractor"];

export function TemplateScreen() {
  const { companyId, role } = useCompany();
  const data = useQuery(api.requirements.template, { companyId });
  const restore = useMutation(api.requirements.restoreDefaults);
  const { busy, error, run } = useRun();
  const [tab, setTab] = useState<Engagement | "all">("all");
  const [editing, setEditing] = useState<Definition | "new" | null>(null);
  const owner = role === "owner";
  const shown = data?.definitions.filter((def) => tab === "all" || def.appliesTo.includes(tab)) ?? [];
  return (
    <>
      <Link href={CLEANERS_PATH} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-strong">
        <ArrowLeft className="size-4" aria-hidden />
        Cleaners
      </Link>
      <PageHeader
        title="Onboarding checklist"
        lead="What each kind of worker needs, and what an unmet item holds up. Only what is needed before work stops someone being offered jobs; nothing else does."
        actions={
          owner ? (
            <>
              {data?.saved ? (
                <Button variant="ghost" size="sm" loading={busy} onClick={() => void run(() => restore({ companyId }))}>
                  <RotateCcw aria-hidden />
                  Restore Selestial&apos;s suggestions
                </Button>
              ) : null}
              <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
                <Plus aria-hidden />
                Add a requirement
              </Button>
            </>
          ) : null
        }
      />
      <FormError message={error} />
      {!data ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <div className="grid gap-4">
          {!data.saved ? <p className="rounded-xl border border-info/30 bg-info/5 px-4 py-3 text-sm text-strong">This is Selestial&apos;s suggested starting checklist. {owner ? "Change anything and it becomes your company's own." : "The Owner can change it."}</p> : null}
          <div role="tablist" aria-label="Worker type" className="flex flex-wrap gap-1.5">
            {TABS.map((value) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={cn("h-9 rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-500", tab === value ? "border-brand-500 bg-brand-500/10 text-brand-300" : "border-border bg-card text-muted-foreground hover:text-strong")}>
                {value === "all" ? "Everyone" : `${ENGAGEMENT_SHORT[value]}s`}
              </button>
            ))}
          </div>
          <ul className="grid gap-2">
            {shown.map((def) => (
              <li key={def.key} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-strong">{def.label}</span>
                    <Badge variant={EFFECT_TONE[def.effect]} size="sm">
                      {EFFECT_WORDS[def.effect]}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{KIND_WORDS[def.kind]}</span>
                  </p>
                  {def.description ? <p className="mt-0.5 text-sm text-muted-foreground">{def.description}</p> : null}
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    For {def.appliesTo.map((value) => `${ENGAGEMENT_SHORT[value].toLowerCase()}s`).join(", ")} · reviewed by {def.reviewer === "owner" ? "the Owner" : "Owners and Managers"} · {def.cleanerCompletes ? "they do it from their portal" : "the office records it"}
                    {def.validForDays ? ` · valid ${def.validForDays} days` : ""}
                    {def.forServices.length ? ` · only for ${def.forServices.join(", ")}` : ""}
                    {def.providedBy ? ` · provided by the ${def.providedBy}` : ""}
                    {` · given to ${def.assignedTo} ${def.assignedTo === 1 ? "person" : "people"}`}
                  </p>
                </div>
                {owner ? (
                  <Button variant="ghost" size="xs" onClick={() => setEditing(def)}>
                    <PenLine aria-hidden />
                    Change
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {editing ? <EditDialog definition={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function EditDialog({ definition, onClose }: { definition: Definition | null; onClose: () => void }) {
  const { companyId } = useCompany();
  const now = useNow();
  const convex = useConvex();
  const save = useMutation(api.requirements.saveDefinition);
  const retire = useMutation(api.requirements.retireDefinition);
  const apply = useMutation(api.workforce.applyTemplateTo);
  const { busy, error, run } = useRun();
  const [form, setForm] = useState({
    label: definition?.label ?? "",
    description: definition?.description ?? "",
    kind: definition?.kind ?? ("document" as Definition["kind"]),
    effect: definition?.effect ?? ("blocks_assignments" as Definition["effect"]),
    appliesTo: definition?.appliesTo ?? (["employee", "contractor"] as Engagement[]),
    reviewer: definition?.reviewer ?? ("manager" as "manager" | "owner"),
    validForDays: definition?.validForDays?.toString() ?? "",
    providedBy: definition?.providedBy ?? "",
    forServices: definition?.forServices.join(", ") ?? "",
    cleanerCompletes: definition?.cleanerCompletes ?? true,
  });
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm({ ...form, [key]: value });
  return (
    <Modal open onClose={onClose} title={definition ? `Change: ${definition.label}` : "Add a requirement"} description="A change applies to everyone who has this requirement. A new one applies to people added from now on; you can give it to people already here.">
      {savedKey && !definition ? (
        <div className="grid gap-3">
          <p className="text-sm text-strong" role="status">
            Added. New people of these types get it from now on. Give it to the people already here too?
          </p>
          {applied ? <p className="text-sm text-muted-foreground">{applied}</p> : null}
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Not now
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={Boolean(applied)}
              onClick={() =>
                void run(async () => {
                  const directory = await convex.query(api.workforce.directory, { companyId, asOf: now || Date.now() });
                  const ids = directory.rows.filter((row) => form.appliesTo.includes(row.engagement)).map((row) => row.cleanerId as Id<"cleaners">);
                  let added = 0;
                  for (let i = 0; i < ids.length; i += 200) added += (await apply({ companyId, cleanerIds: ids.slice(i, i + 200), keys: [savedKey] })).added;
                  setApplied(`Given to ${added} ${added === 1 ? "person" : "people"}.`);
                })
              }
            >
              Give it to everyone it applies to
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const key = await save({
                companyId,
                key: definition?.key,
                label: form.label,
                description: form.description || undefined,
                kind: form.kind,
                effect: form.effect,
                appliesTo: form.appliesTo,
                reviewer: form.reviewer,
                validForDays: form.validForDays.trim() ? Number(form.validForDays) : null,
                providedBy: form.kind === "equipment" ? ((form.providedBy || "cleaner") as "company" | "cleaner" | "crew") : null,
                forServices: form.forServices.split(",").map((part) => part.trim()).filter(Boolean),
                cleanerCompletes: form.cleanerCompletes,
              });
              if (definition) onClose();
              else setSavedKey(key);
            });
          }}
        >
          <Field label="Name">
            <TextInput value={form.label} onChange={(event) => set("label", event.target.value)} required placeholder="For example: Insurance certificate" />
          </Field>
          <Field label="What the worker is asked to do (optional)">
            <TextArea value={form.description} onChange={(event) => set("description", event.target.value)} rows={2} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kind">
              <SelectInput value={form.kind} onChange={(event) => set("kind", event.target.value as Definition["kind"])} disabled={Boolean(definition && ["availability", "service_areas", "contact"].includes(definition.kind))}>
                {Object.entries(KIND_WORDS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="If it is not met">
              <SelectInput value={form.effect} onChange={(event) => set("effect", event.target.value as Definition["effect"])}>
                <option value="blocks_assignments">No work is offered</option>
                <option value="blocks_payment">No payment until it is</option>
                <option value="informational">Nothing is held up</option>
              </SelectInput>
            </Field>
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-sm font-medium text-strong">Who it applies to</legend>
            <div className="flex flex-wrap gap-3">
              {(["employee", "contractor", "subcontractor"] as Engagement[]).map((value) => (
                <label key={value} className="flex items-center gap-2 text-sm text-strong">
                  <input type="checkbox" className="size-4 accent-[#6838ef]" checked={form.appliesTo.includes(value)} onChange={(event) => set("appliesTo", event.target.checked ? [...form.appliesTo, value] : form.appliesTo.filter((item) => item !== value))} />
                  {ENGAGEMENT_SHORT[value]}s
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Who reviews it">
              <SelectInput value={form.reviewer} onChange={(event) => set("reviewer", event.target.value as "manager" | "owner")}>
                <option value="manager">Owners and Managers</option>
                <option value="owner">The Owner only</option>
              </SelectInput>
            </Field>
            <Field label="Valid for (days)" hint="Leave empty if it does not expire.">
              <TextInput value={form.validForDays} onChange={(event) => set("validForDays", event.target.value)} inputMode="numeric" />
            </Field>
          </div>
          {form.kind === "equipment" ? (
            <Field label="Who provides it" hint="Equipment the crew brings is checked on the crew, never held against one person.">
              <SelectInput value={form.providedBy || "cleaner"} onChange={(event) => set("providedBy", event.target.value)}>
                <option value="cleaner">The cleaner</option>
                <option value="company">The company</option>
                <option value="crew">The crew</option>
              </SelectInput>
            </Field>
          ) : null}
          <Field label="Only for these services (optional)" hint="Service names or skills, separated by commas. Empty means every job.">
            <TextInput value={form.forServices} onChange={(event) => set("forServices", event.target.value)} placeholder="commercial, post-construction" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-strong">
            <input type="checkbox" className="size-4 accent-[#6838ef]" checked={form.cleanerCompletes} onChange={(event) => set("cleanerCompletes", event.target.checked)} />
            They do it from their portal (otherwise the office records it)
          </label>
          <FormError message={error} />
          <div className="flex flex-wrap justify-between gap-2">
            {definition && !["contact", "availability", "service_areas"].includes(definition.kind) ? (
              <Button variant="ghost" loading={busy} onClick={() => void run(async () => { await retire({ companyId, key: definition.key }); onClose(); })}>
                Remove from the checklist
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                Save
              </Button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
