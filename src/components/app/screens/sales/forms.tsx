"use client";

/**
 * Booking forms: the list, and the builder for one. A form has a working draft and, once published, a
 * live copy at a public address. Editing the draft never changes what is live; publishing does, and it
 * is refused while the form would mislead: no question, no word that it is a request and not a booking,
 * or texting permission that does not say how to stop.
 *
 * The preview on the right is the same component the public page renders.
 */
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ChevronUpIcon, Copy, DesktopIcon, DeviceMobileIcon, ExternalLink, Plus, Trash2 } from "@/components/icons";
import { BookingFormBody, EMPTY_VALUES, type FormDefinition, type FormField, type FormValues } from "@/components/sales/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ago } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Empty, SALES_PATH } from "./shared";

type FormView = NonNullable<FunctionReturnType<typeof api.salesForms.get>>;
type Kind = FormDefinition["kind"];

const KIND_WORDS: Record<Kind, string> = { residential: "Home cleaning", commercial: "Commercial", short_term_rental: "Short-term rental" };
const FIELD_KIND_WORDS: Record<FormField["kind"], string> = { text: "Short answer", longtext: "Long answer", number: "Number", choice: "Choice", yes_no: "Yes or no", date: "Date", email: "Email address", phone: "Phone number", postal_code: "ZIP or postal code" };
const FACT_WORDS: Record<string, string> = {
  postalCode: "Postal code",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  area: "Size (square feet)",
  units: "Number of units",
  beds: "Beds to make",
  schedule: "How often",
  timing: "Preferred timing",
  access: "Access",
  pets: "Pets",
  operatingHours: "When the space can be cleaned",
  facilityType: "Type of facility",
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="xs"
      variant="outline"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? <CheckCircle2 aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}

// ── The list ────────────────────────────────────────────────────────────────────────────────────────

function FormsList({ onOpen }: { onOpen: (id: string) => void }) {
  const { companyId, timezone, role } = useCompany();
  const now = useNow();
  const forms = useQuery(api.salesForms.list, { companyId });
  const templates = useQuery(api.salesForms.templates, { companyId });
  const create = useMutation(api.salesForms.create);
  const { busy, error, run } = useRun();
  const canEdit = role !== "office";

  return (
    <>
      <PageHeader title="Booking Forms" lead="Forms people fill in to ask for a price or a time. Each submission becomes an opportunity, and what was typed on the form is never asked again." />
      <div className="grid gap-5">
        <Panel title="Start a form">
          {templates === undefined ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : (
            <ul className="grid gap-2.5 md:grid-cols-3">
              {templates.map((template) => (
                <li key={template.kind} className="grid content-between gap-3 rounded-xl border border-border bg-background p-3.5">
                  <div>
                    <p className="text-sm font-semibold text-strong">{template.name}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{template.blurb}</p>
                    <p className="mt-1.5 text-xs text-muted-foreground">{template.questions} questions to start from. Change any of them.</p>
                  </div>
                  {canEdit ? (
                    <div>
                      <Button size="sm" variant="outline" loading={busy} onClick={() => void run(async () => onOpen(await create({ companyId, kind: template.kind as Kind })))}>
                        <Plus aria-hidden />
                        Use this
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <FormError message={error} />
          {!canEdit ? <p className="mt-3 text-xs text-muted-foreground">Owners and Managers create and publish forms.</p> : null}
        </Panel>

        {forms === undefined ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : forms.length === 0 ? (
          <Empty title="No form yet" body="Start from one of the templates above. A form is a draft until you publish it; only then does it have a public link." />
        ) : (
          <Panel title="Your forms">
            <ul className="grid gap-2.5">
              {forms.map((form) => (
                <li key={form.formId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => onOpen(form.formId)} className="text-sm font-semibold text-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
                        {form.name}
                      </button>
                      <Badge variant={form.status === "published" ? "success" : "outline"} size="sm">
                        {form.status === "published" ? "Live" : form.status === "archived" ? "Archived" : "Draft"}
                      </Badge>
                      {form.unpublishedChanges ? (
                        <Badge variant="warning" size="sm">
                          Unpublished changes
                        </Badge>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {KIND_WORDS[form.kind]} · {form.intent === "booking_request" ? "Booking request" : "Estimate request"} · {form.questions} questions · {form.submissions} {form.submissions === 1 ? "submission" : "submissions"}
                      {form.lastSubmissionAt ? `, the last ${ago(form.lastSubmissionAt, now, timezone)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {form.url ? <CopyButton text={form.url} label="Copy link" /> : null}
                    <Button size="xs" variant="outline" onClick={() => onOpen(form.formId)}>
                      {canEdit ? "Edit" : "Open"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </>
  );
}

// ── The builder ─────────────────────────────────────────────────────────────────────────────────────

function newId(fields: FormField[]): string {
  let index = fields.length + 1;
  while (fields.some((field) => field.id === `q${index}`)) index += 1;
  return `q${index}`;
}

function QuestionEditor({ field, index, fields, disabled, onChange, onMove, onRemove }: { field: FormField; index: number; fields: FormField[]; disabled: boolean; onChange: (next: FormField) => void; onMove: (by: -1 | 1) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const parents = fields.slice(0, index).filter((other) => other.kind === "choice" || other.kind === "yes_no");
  const parent = field.showIf ? parents.find((other) => other.id === field.showIf!.fieldId) : undefined;
  const usedFacts = new Set(fields.filter((other) => other.id !== field.id && other.factKey).map((other) => other.factKey!));
  return (
    <li className="rounded-xl border border-border bg-background">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-brand-500">
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", open ? "" : "-rotate-90")} aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-strong">{field.label || "Untitled question"}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {FIELD_KIND_WORDS[field.kind]}
              {field.required ? " · required" : ""}
              {field.factKey ? ` · feeds ${FACT_WORDS[field.factKey] ?? field.factKey}` : ""}
              {parent ? ` · only if “${parent.label}” is ${field.showIf!.equals}` : ""}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center">
          <button type="button" disabled={disabled || index === 0} onClick={() => onMove(-1)} aria-label={`Move “${field.label}” up`} className="rounded-md p-1.5 text-muted-foreground hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-30">
            <ChevronUpIcon className="size-4" aria-hidden />
          </button>
          <button type="button" disabled={disabled || index === fields.length - 1} onClick={() => onMove(1)} aria-label={`Move “${field.label}” down`} className="rounded-md p-1.5 text-muted-foreground hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-30">
            <ChevronDown className="size-4" aria-hidden />
          </button>
          <button type="button" disabled={disabled} onClick={onRemove} aria-label={`Remove “${field.label}”`} className="rounded-md p-1.5 text-muted-foreground hover:text-destructive-foreground focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-30">
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      {open ? (
        <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
          <Field label="Question" className="sm:col-span-2">
            <TextInput value={field.label} disabled={disabled} onChange={(event) => onChange({ ...field, label: event.target.value })} />
          </Field>
          <Field label="Kind of answer">
            <SelectInput value={field.kind} disabled={disabled} onChange={(event) => onChange({ ...field, kind: event.target.value as FormField["kind"], options: event.target.value === "choice" ? (field.options.length >= 2 ? field.options : ["Option 1", "Option 2"]) : [] })}>
              {Object.entries(FIELD_KIND_WORDS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Sales uses this answer as" hint="So it is never asked again in conversation.">
            <SelectInput value={field.factKey ?? ""} disabled={disabled} onChange={(event) => onChange({ ...field, factKey: event.target.value || undefined })}>
              <option value="">A note on the opportunity</option>
              {Object.entries(FACT_WORDS).map(([value, label]) => (
                <option key={value} value={value} disabled={usedFacts.has(value)}>
                  {label}
                </option>
              ))}
            </SelectInput>
          </Field>
          {field.kind === "choice" ? (
            <Field label="Options" hint="One per line, 2 to 12." className="sm:col-span-2">
              <TextArea value={field.options.join("\n")} disabled={disabled} rows={Math.min(8, Math.max(3, field.options.length + 1))} onChange={(event) => onChange({ ...field, options: event.target.value.split("\n") })} />
            </Field>
          ) : null}
          <Field label="Help text (optional)" className="sm:col-span-2">
            <TextInput value={field.help ?? ""} disabled={disabled} onChange={(event) => onChange({ ...field, help: event.target.value || undefined })} />
          </Field>
          <Field label="Show this question" hint={parents.length === 0 ? "To make it conditional, put a choice or yes/no question before it." : undefined}>
            <SelectInput
              value={field.showIf?.fieldId ?? ""}
              disabled={disabled || parents.length === 0}
              onChange={(event) => {
                const chosen = parents.find((other) => other.id === event.target.value);
                onChange(chosen ? { ...field, required: false, showIf: { fieldId: chosen.id, equals: chosen.kind === "yes_no" ? "Yes" : (chosen.options[0] ?? "") } } : { ...field, showIf: undefined });
              }}
            >
              <option value="">Always</option>
              {parents.map((other) => (
                <option key={other.id} value={other.id}>
                  Only when “{other.label}” is…
                </option>
              ))}
            </SelectInput>
          </Field>
          {parent ? (
            <Field label="…this answer">
              <SelectInput value={field.showIf!.equals} disabled={disabled} onChange={(event) => onChange({ ...field, showIf: { fieldId: parent.id, equals: event.target.value } })}>
                {(parent.kind === "yes_no" ? ["Yes", "No"] : parent.options).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </SelectInput>
            </Field>
          ) : (
            <span />
          )}
          <label className={cn("flex items-center gap-2 text-sm text-strong sm:col-span-2", field.showIf ? "opacity-60" : "")}>
            <input type="checkbox" checked={field.required} disabled={disabled || Boolean(field.showIf)} onChange={(event) => onChange({ ...field, required: event.target.checked })} className="size-4 accent-[var(--color-brand-500)]" />
            Required
            {field.showIf ? <span className="text-xs text-muted-foreground">(a question shown only sometimes cannot be required)</span> : null}
          </label>
        </div>
      ) : null}
    </li>
  );
}

function Builder({ form, onBack }: { form: FormView; onBack: () => void }) {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const saveDraft = useMutation(api.salesForms.saveDraft);
  const publish = useMutation(api.salesForms.publish);
  const setStatus = useMutation(api.salesForms.setStatus);
  const { busy, error, run } = useRun();
  const [name, setName] = useState(form.name);
  const [draft, setDraft] = useState<FormDefinition>(form.draft);
  const [revision, setRevision] = useState(form.revision);
  const [problems, setProblems] = useState<string[]>(form.problems);
  const [device, setDevice] = useState<"phone" | "desktop">("phone");
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [saved, setSaved] = useState<string | null>(null);
  const canEdit = form.canEdit;
  const dirty = name !== form.name || JSON.stringify(draft) !== JSON.stringify(form.draft);
  const patch = (changes: Partial<FormDefinition>) => setDraft((before) => ({ ...before, ...changes }));
  const setField = (index: number, next: FormField) => patch({ fields: draft.fields.map((field, at) => (at === index ? next : field)) });
  const cleaned = (): FormDefinition => ({ ...draft, fields: draft.fields.map((field) => ({ ...field, options: field.options.map((option) => option.trim()).filter(Boolean) })) });

  const save = async () => {
    const result = await saveDraft({ companyId, formId: form.formId, expectedRevision: revision, name, draft: cleaned() });
    setRevision(result.revision);
    setProblems(result.problems);
    setSaved("Draft saved. The live form has not changed.");
    return result.revision;
  };

  return (
    <>
      <PageHeader
        title={form.name}
        lead="Edit the draft on the left and try it on the right. The live form changes only when you publish."
        actions={
          <Button size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeft aria-hidden />
            All forms
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant={form.status === "published" ? "success" : "outline"} size="sm">
          {form.status === "published" ? `Live · version ${form.publishedVersion}` : form.status === "archived" ? "Archived" : "Draft · not public"}
        </Badge>
        {form.unpublishedChanges || dirty ? (
          <Badge variant="warning" size="sm">
            {dirty ? "Unsaved changes" : "Saved changes not published"}
          </Badge>
        ) : null}
        {canEdit ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" loading={busy} disabled={!dirty} onClick={() => void run(save)}>
              Save draft
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              disabled={problems.length > 0 && !dirty}
              onClick={() =>
                void run(async () => {
                  const current = dirty ? await save() : revision;
                  const result = await publish({ companyId, formId: form.formId, expectedRevision: current });
                  setRevision(result.revision);
                  setSaved("Published. The link below now shows this version.");
                })
              }
            >
              {form.status === "published" ? "Publish changes" : "Publish"}
            </Button>
            {form.status === "published" ? (
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void run(async () => setRevision((await setStatus({ companyId, formId: form.formId, status: "draft" })).revision))}>
                Take offline
              </Button>
            ) : null}
          </div>
        ) : (
          <span className="ml-auto text-xs text-muted-foreground">Owners and Managers edit and publish forms.</span>
        )}
      </div>
      <FormError message={error} />
      {saved && !error ? (
        <p className="mb-3 text-sm text-success-foreground" role="status">
          {saved}
        </p>
      ) : null}
      {problems.length > 0 ? (
        <ul className="mb-4 grid gap-1 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm text-warning-foreground">
          <li className="flex items-center gap-2 font-semibold text-strong">
            <AlertTriangle className="size-4 text-warning" aria-hidden />
            Before this can be published
          </li>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="grid gap-5">
          {form.url ? (
            <Panel title="Share it">
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 text-xs text-strong">{form.url}</code>
                  <CopyButton text={form.url} label="Copy link" />
                  <Button size="xs" variant="outline" render={<a href={form.url} target="_blank" rel="noreferrer" />}>
                    <ExternalLink aria-hidden />
                    Open
                  </Button>
                </div>
                {form.embed ? (
                  <div className="grid gap-1.5">
                    <p className="text-xs text-muted-foreground">To put the form on your own website, paste this where it should appear:</p>
                    <div className="flex flex-wrap items-start gap-2">
                      <code className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs break-all text-strong">{form.embed}</code>
                      <CopyButton text={form.embed} label="Copy embed code" />
                    </div>
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">Each submission is checked for spam and limited per visitor. Add <code>?utm_campaign=name</code> to the link to see which campaign an inquiry came from.</p>
              </div>
            </Panel>
          ) : null}

          <Panel title="Basics">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" hint="For your own list. Customers do not see it.">
                <TextInput value={name} disabled={!canEdit} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field label="What the person is asking for" hint="Shown on the form. Neither is a confirmed booking.">
                <SelectInput value={draft.intent} disabled={!canEdit} onChange={(event) => patch({ intent: event.target.value as FormDefinition["intent"] })}>
                  <option value="estimate">A price (estimate request)</option>
                  <option value="booking_request">A time (booking request)</option>
                </SelectInput>
              </Field>
              <Field label="Title" className="sm:col-span-2">
                <TextInput value={draft.title} disabled={!canEdit} onChange={(event) => patch({ title: event.target.value })} />
              </Field>
              <Field label="Introduction" className="sm:col-span-2">
                <TextArea value={draft.intro} disabled={!canEdit} rows={2} onChange={(event) => patch({ intro: event.target.value })} />
              </Field>
              <Field label="Kind of work">
                <SelectInput value={draft.kind} disabled={!canEdit} onChange={(event) => patch({ kind: event.target.value as Kind })}>
                  {Object.entries(KIND_WORDS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Button label">
                <TextInput value={draft.submitLabel} disabled={!canEdit} onChange={(event) => patch({ submitLabel: event.target.value })} />
              </Field>
            </div>
          </Panel>

          <Panel title="Services on the form">
            {form.services.length === 0 ? (
              <p className="text-sm text-muted-foreground">No service is published yet, so the form asks the person to describe what they need.</p>
            ) : (
              <div className="grid gap-2">
                <p className="text-xs text-muted-foreground">Tick the services a person may choose. With none ticked, the form does not ask.</p>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {form.services.map((service) => (
                    <li key={service.key}>
                      <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-strong">
                        <input type="checkbox" disabled={!canEdit} checked={draft.serviceKeys.includes(service.key)} onChange={(event) => patch({ serviceKeys: event.target.checked ? [...draft.serviceKeys, service.key] : draft.serviceKeys.filter((key) => key !== service.key) })} className="size-4 accent-[var(--color-brand-500)]" />
                        {service.name}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          <Panel
            title={`Questions · ${draft.fields.length}`}
            action={
              canEdit ? (
                <Button size="xs" variant="outline" onClick={() => patch({ fields: [...draft.fields, { id: newId(draft.fields), label: "New question", kind: "text", required: false, options: [] }] })}>
                  <Plus aria-hidden />
                  Add a question
                </Button>
              ) : null
            }
          >
            <p className="mb-3 text-xs text-muted-foreground">Every form already asks for a name and a way to reply. Add what your price and schedule depend on.</p>
            {draft.fields.length === 0 ? (
              <p className="text-sm text-muted-foreground">No question yet.</p>
            ) : (
              <ul className="grid gap-2">
                {draft.fields.map((field, index) => (
                  <QuestionEditor
                    key={field.id}
                    field={field}
                    index={index}
                    fields={draft.fields}
                    disabled={!canEdit}
                    onChange={(next) => setField(index, next)}
                    onMove={(by) => {
                      const next = [...draft.fields];
                      [next[index], next[index + by]] = [next[index + by], next[index]];
                      patch({ fields: next });
                    }}
                    onRemove={() => patch({ fields: draft.fields.filter((_, at) => at !== index).map((other) => (other.showIf?.fieldId === field.id ? { ...other, showIf: undefined } : other)) })}
                  />
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Permission to text">
            <div className="grid gap-3">
              <label className="flex items-center gap-2 text-sm text-strong">
                <input type="checkbox" disabled={!canEdit} checked={draft.consent.sms} onChange={(event) => patch({ consent: { ...draft.consent, sms: event.target.checked } })} className="size-4 accent-[var(--color-brand-500)]" />
                Ask, in a separate unticked box, whether you may text about this request
              </label>
              {draft.consent.sms ? (
                <Field label="The exact words beside the box" hint="Kept with every permission it produces. It must say how to stop (reply STOP).">
                  <TextArea value={draft.consent.smsText} disabled={!canEdit} rows={2} onChange={(event) => patch({ consent: { ...draft.consent, smsText: event.target.value } })} />
                </Field>
              ) : (
                <p className="text-xs text-muted-foreground">Without this box Sales replies by email only. A phone number alone is not permission to text.</p>
              )}
            </div>
          </Panel>

          <Panel title="After it is sent">
            <div className="grid gap-3">
              <Field label="Confirmation title">
                <TextInput value={draft.confirmation.title} disabled={!canEdit} onChange={(event) => patch({ confirmation: { ...draft.confirmation, title: event.target.value } })} />
              </Field>
              <Field label="Confirmation message" hint="Say that nothing is booked yet.">
                <TextArea value={draft.confirmation.body} disabled={!canEdit} rows={2} onChange={(event) => patch({ confirmation: { ...draft.confirmation, body: event.target.value } })} />
              </Field>
            </div>
          </Panel>

          {form.submissions.length > 0 ? (
            <Panel title="Recent submissions">
              <ul className="divide-y divide-border text-sm">
                {form.submissions.map((row) => (
                  <li key={row.submissionId} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                    <span className="text-strong">
                      {row.name}
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        · {ago(row.receivedAt, now, timezone)}
                        {row.source ? ` · ${row.source}` : ""}
                        {row.smsConsent ? " · agreed to texts" : ""}
                      </span>
                    </span>
                    {row.opportunityId ? (
                      <a href={`${SALES_PATH}/pipeline?opp=${row.opportunityId}`} className="text-xs font-medium text-brand-300 underline-offset-4 hover:underline">
                        Open the opportunity
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {canEdit && form.status !== "archived" ? (
            <div>
              <Button size="xs" variant="ghost" loading={busy} onClick={() => void run(async () => (await setStatus({ companyId, formId: form.formId, status: "archived" }), onBack()))}>
                Archive this form
              </Button>
            </div>
          ) : null}
        </div>

        <div className="xl:sticky xl:top-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-strong">Preview</p>
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Preview size">
              {(["phone", "desktop"] as const).map((value) => (
                <button key={value} type="button" aria-pressed={device === value} onClick={() => setDevice(value)} className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500", device === value ? "bg-brand-500/10 text-strong" : "text-muted-foreground hover:text-strong")}>
                  {value === "phone" ? <DeviceMobileIcon className="size-3.5" aria-hidden /> : <DesktopIcon className="size-3.5" aria-hidden />}
                  {value === "phone" ? "Phone" : "Wide"}
                </button>
              ))}
            </div>
          </div>
          <div className={cn("mx-auto overflow-hidden border border-border bg-muted/50 shadow-[0_24px_60px_-32px_rgba(27,14,69,0.35)]", device === "phone" ? "max-w-[23rem] rounded-[2rem] p-2.5" : "rounded-2xl p-3")}>
            <div className={cn("max-h-[42rem] overflow-y-auto bg-card p-4", device === "phone" ? "rounded-[1.5rem]" : "rounded-xl")}>
              <BookingFormBody definition={cleaned()} company={form.companyName} services={form.services.filter((service) => draft.serviceKeys.includes(service.key))} values={values} onChange={setValues} problems={{}} preview />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function SalesFormsScreen() {
  const { companyId } = useCompany();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const formId = params.get("form");
  const form = useQuery(api.salesForms.get, formId ? { companyId, formId: formId as Id<"salesForms"> } : "skip");
  const go = (id: string | null) => router.replace(id ? `${pathname}?form=${id}` : pathname, { scroll: false });

  if (!formId) return <FormsList onOpen={go} />;
  if (form === undefined) {
    return (
      <>
        <PageHeader title="Booking Forms" />
        <Skeleton className="h-96 rounded-2xl" />
      </>
    );
  }
  if (form === null) {
    return (
      <>
        <PageHeader title="Booking Forms" />
        <Empty
          title="This form can’t be found"
          body="It may have been removed."
          action={
            <Button variant="outline" size="sm" onClick={() => go(null)}>
              All forms
            </Button>
          }
        />
      </>
    );
  }
  return <Builder key={form.formId} form={form} onBack={() => go(null)} />;
}
