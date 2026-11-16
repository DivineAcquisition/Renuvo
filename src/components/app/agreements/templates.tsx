"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Empty, Notice, ReadinessBadge, ToneBadge } from "@/components/app/agreements/shared";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Panel } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { agreementPath, CATEGORY, READINESS, templatePath, when } from "@/lib/app/agreements";

import { api } from "../../../../convex/_generated/api";

const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" }> = { draft: { label: "Draft", tone: "neutral" }, in_review: { label: "In review", tone: "info" }, approved: { label: "Approved", tone: "success" }, archived: { label: "Archived", tone: "neutral" } };

export function Templates() {
  const { companyId, timezone } = useCompany();
  const router = useRouter();
  const catalog = useQuery(api.companyAgreements.catalog, { companyId });
  const create = useMutation(api.agreementTemplates.create);
  const makeAgreement = useMutation(api.companyAgreements.create);
  const { busy, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", docType: "", fromCatalog: "yes" });
  if (!catalog) return <Skeleton className="h-64 rounded-2xl" />;
  const canEdit = catalog.capabilities.includes("editTemplates");
  const families = [...catalog.types.reduce((acc, t) => acc.set(t.family, [...(acc.get(t.family) ?? []), t]), new Map<string, typeof catalog.types>())];
  return (
    <div className="grid gap-6">
      <Notice>
        Every starting text is a draft from Selestial&apos;s clause library, not legal advice, and none has recorded legal review. Your own template shows &quot;reviewed&quot; only when someone records who reviewed that exact version.
      </Notice>
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-lg tracking-tight text-strong">Your templates</h2>
          {canEdit ? <Button size="sm" variant="primary" onClick={() => setOpen((v) => !v)}>Create a company template</Button> : null}
        </div>
        {open && canEdit ? (
          <form
            className="mb-3 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const id = await create({ companyId, title: form.title, docType: form.docType, fromCatalog: form.fromCatalog === "yes" });
                router.push(templatePath(id));
              });
            }}
          >
            <Field label="Name"><TextInput value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></Field>
            <Field label="Kind of document">
              <SelectInput value={form.docType} onChange={(event) => setForm({ ...form, docType: event.target.value })} required>
                <option value="">Choose…</option>
                {catalog.types.filter((t) => t.canDraft).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </SelectInput>
            </Field>
            <Field label="Start from"><SelectInput value={form.fromCatalog} onChange={(event) => setForm({ ...form, fromCatalog: event.target.value })}><option value="yes">Selestial&apos;s text</option><option value="no">Selestial&apos;s text, then rewrite</option></SelectInput></Field>
            <Button type="submit" variant="primary" size="sm" loading={busy}>Create</Button>
            <div className="sm:col-span-4"><FormError message={error} /></div>
          </form>
        ) : null}
        {catalog.templates.length === 0 ? (
          <Empty title="No company templates yet">Start from one of Selestial&apos;s starting texts below, edit the clauses to match how you work, have it reviewed and approve it. Agreements you make from it keep their own copy.</Empty>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {catalog.templates.map((t) => (
              <li key={t.id}>
                <Link href={templatePath(t.id)} className="block rounded-xl border border-border bg-card p-3 hover:border-brand-500/40">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold text-strong">{t.title}</span><span className="text-xs text-muted-foreground">{catalog.types.find((x) => x.key === t.docType)?.label ?? t.docType} · version {t.currentVersion} · {when(t.updatedAt, timezone)}</span></span>
                    <ToneBadge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</ToneBadge>
                  </span>
                  <span className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                    {t.review ? <ToneBadge tone="success" title={`Reviewed on ${t.review.reviewedOn}`}>Reviewed by {t.review.reviewer}</ToneBadge> : <span>No recorded legal review</span>}
                    {t.defaultFor.length ? <span>Default for {t.defaultFor.join(", ")}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="grid gap-5">
        <div>
          <h2 className="font-heading text-lg tracking-tight text-strong">Selestial&apos;s starting texts</h2>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {Object.entries(READINESS).map(([key, look]) => <li key={key}><strong className="text-strong">{look.label}:</strong> {look.meaning}</li>)}
          </ul>
        </div>
        {families.map(([family, rows]) => (
          <div key={family}>
            <h3 className="mb-2 text-sm font-semibold text-strong">{family}</h3>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((t) => (
                <li key={t.key} className="flex flex-col justify-between gap-2 rounded-xl border border-border bg-card p-3">
                  <span>
                    <span className="block text-sm font-medium text-strong">{t.label}</span>
                    <span className="mt-1 flex flex-wrap gap-1.5"><ReadinessBadge readiness={t.readiness} /><ToneBadge tone="neutral">{CATEGORY[t.category]}</ToneBadge></span>
                    {t.note ? <span className="mt-1 block text-xs text-muted-foreground">{t.note}</span> : null}
                  </span>
                  {t.canDraft ? (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(async () => router.push(agreementPath(await makeAgreement({ companyId, docType: t.key }))))}>Start an agreement</Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Your role cannot start this.</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}

type Clause = { key: string; version: number; title: string; body: string; flags?: string[]; when?: string; unless?: string };
type Extra = { key: string; label: string; type: "text" | "longtext" | "money" | "date" | "int" | "bool" | "choice" | "list"; group: string; ask: string; choices?: string[] };

/** One company template: its clauses, variables, versions, approval, review evidence and defaults. */
export function TemplateEditor({ templateId }: { templateId: string }) {
  const { companyId } = useCompany();
  const template = useQuery(api.agreementTemplates.get, { companyId, templateId });
  if (!template) return <Skeleton className="h-64 rounded-2xl" />;
  // Re-keyed on the version, so a new saved version replaces the form instead of being copied into it by an effect.
  return <TemplateForm key={`${template.id}:${template.currentVersion}`} template={template} templateId={templateId} />;
}

type TemplateData = NonNullable<ReturnType<typeof useQuery<typeof api.agreementTemplates.get>>>;

function TemplateForm({ template, templateId }: { template: TemplateData; templateId: string }) {
  const { companyId, timezone } = useCompany();
  const save = useMutation(api.agreementTemplates.save);
  const approve = useMutation(api.agreementTemplates.approve);
  const archive = useMutation(api.agreementTemplates.archive);
  const defaults = useMutation(api.agreementTemplates.defaults);
  const review = useMutation(api.agreementTemplates.review);
  const { busy, error, run } = useRun();
  const [clauses, setClauses] = useState<Clause[]>(() => template.shown.clauses.map((c) => ({ ...c, flags: c.flags ?? undefined })));
  const [extra, setExtra] = useState<Extra[]>(() => template.shown.extra as Extra[]);
  const [note, setNote] = useState("");
  const [defaultFor, setDefaultFor] = useState(() => template.defaultFor.join(", "));
  const [rev, setRev] = useState({ reviewer: "", reviewedOn: "", note: "" });
  const editable = template.canEdit && template.status !== "archived";
  const dirty = JSON.stringify(clauses) !== JSON.stringify(template.shown.clauses.map((c) => ({ ...c, flags: c.flags ?? undefined }))) || JSON.stringify(extra) !== JSON.stringify(template.shown.extra);
  const edit = (index: number, patch: Partial<Clause>) => setClauses((current) => current.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  return (
    <div className="grid gap-4">
      <div>
        <Link href="/app/agreements/templates" className="text-xs text-muted-foreground hover:underline">‹ Templates</Link>
        <h2 className="mt-1 font-heading text-xl tracking-tight text-strong">{template.title}</h2>
        <p className="text-sm text-muted-foreground">{template.typeLabel} · version {template.currentVersion} · {template.agreementsMade} agreement{template.agreementsMade === 1 ? "" : "s"} made from it</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <ToneBadge tone={STATUS[template.status].tone}>{STATUS[template.status].label}</ToneBadge>
          {template.approvedVersion ? <ToneBadge tone="info">Version {template.approvedVersion} approved for use</ToneBadge> : null}
          {template.review ? <ToneBadge tone="success">Reviewed by {template.review.reviewer}, {template.review.reviewedOn}</ToneBadge> : <ToneBadge tone="neutral">No recorded legal review of this version</ToneBadge>}
        </div>
      </div>
      <Notice>Editing makes a new version and clears its approval. Agreements already made from this template keep the clauses they were made with.</Notice>
      <FormError message={error} />
      <Panel title="Clauses">
        <ol className="grid gap-4">
          {clauses.map((clause, index) => (
            <li key={clause.key} className="grid gap-2 rounded-xl border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                <Field label={`Clause ${index + 1}`}><TextInput value={clause.title} disabled={!editable} onChange={(event) => edit(index, { title: event.target.value })} /></Field>
                {editable ? (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => setClauses((c) => { const n = [...c]; [n[index - 1], n[index]] = [n[index], n[index - 1]]; return n; })}>Up</Button>
                    <Button size="sm" variant="ghost" disabled={index === clauses.length - 1} onClick={() => setClauses((c) => { const n = [...c]; [n[index + 1], n[index]] = [n[index], n[index + 1]]; return n; })}>Down</Button>
                    <Button size="sm" variant="ghost" onClick={() => setClauses((c) => c.filter((_, i) => i !== index))}>Remove</Button>
                  </div>
                ) : null}
              </div>
              <TextArea aria-label={`Text of ${clause.title}`} rows={4} value={clause.body} disabled={!editable} onChange={(event) => edit(index, { body: event.target.value })} />
              <p className="text-xs text-muted-foreground">Key {clause.key} · clause version {clause.version}{clause.when ? ` · only when ${clause.when} is set` : ""}{clause.unless ? ` · only when ${clause.unless} is no` : ""}. Use {"{{field}}"} to insert an answer.</p>
            </li>
          ))}
        </ol>
        {editable ? <div className="mt-3"><Button size="sm" variant="secondary" onClick={() => setClauses((c) => [...c, { key: `clause_${c.length + 1}_${Math.random().toString(36).slice(2, 5)}`, version: 1, title: "New clause", body: "" }])}>Add a clause</Button></div> : null}
      </Panel>
      <Panel title="Your own fields">
        <p className="mb-2 text-sm text-muted-foreground">Define a reusable question (its key starts with x_) and use it in clauses as {"{{x_name}}"}.</p>
        {extra.map((e, index) => (
          <div key={e.key} className="mb-2 grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-4">
            <Field label="Key"><TextInput value={e.key} disabled={!editable} onChange={(event) => setExtra((c) => c.map((x, i) => (i === index ? { ...x, key: event.target.value } : x)))} /></Field>
            <Field label="Label"><TextInput value={e.label} disabled={!editable} onChange={(event) => setExtra((c) => c.map((x, i) => (i === index ? { ...x, label: event.target.value } : x)))} /></Field>
            <Field label="Kind"><SelectInput value={e.type} disabled={!editable} onChange={(event) => setExtra((c) => c.map((x, i) => (i === index ? { ...x, type: event.target.value as Extra["type"] } : x)))}>{["text", "longtext", "money", "date", "int", "bool", "list"].map((t) => <option key={t} value={t}>{t}</option>)}</SelectInput></Field>
            <Field label="Question"><TextInput value={e.ask} disabled={!editable} onChange={(event) => setExtra((c) => c.map((x, i) => (i === index ? { ...x, ask: event.target.value } : x)))} /></Field>
          </div>
        ))}
        {editable ? <Button size="sm" variant="secondary" onClick={() => setExtra((c) => [...c, { key: "x_", label: "", type: "text", group: "scope", ask: "" }])}>Add a field</Button> : null}
      </Panel>
      {editable ? (
        <div className="sticky bottom-3 z-10 grid gap-2 rounded-2xl border border-border bg-card/95 p-3 shadow-sm backdrop-blur">
          <Field label="What changed (optional)"><TextInput value={note} onChange={(event) => setNote(event.target.value)} /></Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" loading={busy} disabled={!dirty} onClick={() => void run(async () => { await save({ companyId, templateId, baseVersion: template.currentVersion, clauses: clauses as never, extra: extra as never, note: note || undefined }); setNote(""); })}>Save as version {template.currentVersion + 1}</Button>
            {!dirty && template.status !== "approved" ? <Button size="sm" variant="secondary" loading={busy} onClick={() => void run(() => approve({ companyId, templateId, version: template.currentVersion }))}>Approve version {template.currentVersion} for use</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => void run(() => archive({ companyId, templateId, archived: true }))}>Archive</Button>
          </div>
        </div>
      ) : template.status === "archived" && template.canEdit ? (
        <div><Button size="sm" variant="secondary" onClick={() => void run(() => archive({ companyId, templateId, archived: false }))}>Restore this template</Button></div>
      ) : null}
      {template.canEdit ? (
        <Panel title="Defaults and review">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Field label="Default for these services or engagements" hint="Separate with commas. Only an approved template can be a default."><TextInput value={defaultFor} onChange={(event) => setDefaultFor(event.target.value)} /></Field>
              <div><Button size="sm" variant="secondary" disabled={template.status !== "approved" || busy} onClick={() => void run(() => defaults({ companyId, templateId, defaultFor: defaultFor.split(",").map((s) => s.trim()).filter(Boolean) }))}>Save defaults</Button></div>
            </div>
            <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); void run(() => review({ companyId, templateId, version: template.currentVersion, reviewer: rev.reviewer, reviewedOn: rev.reviewedOn, note: rev.note || undefined })); }}>
              <p className="text-sm font-medium text-strong">Record that this version was reviewed</p>
              <p className="text-xs text-muted-foreground">Only if a lawyer or specialist actually reviewed version {template.currentVersion}. Selestial never records this itself.</p>
              <Field label="Reviewed by"><TextInput value={rev.reviewer} onChange={(event) => setRev({ ...rev, reviewer: event.target.value })} required /></Field>
              <Field label="Date reviewed"><TextInput type="date" value={rev.reviewedOn} onChange={(event) => setRev({ ...rev, reviewedOn: event.target.value })} required /></Field>
              <Field label="Note (optional)"><TextInput value={rev.note} onChange={(event) => setRev({ ...rev, note: event.target.value })} /></Field>
              <div><Button type="submit" size="sm" variant="secondary" disabled={busy}>Record the review</Button></div>
            </form>
          </div>
        </Panel>
      ) : null}
      <Panel title="Versions">
        <ul className="divide-y divide-border text-sm">
          {template.versions.map((v) => <li key={v.version} className="py-2"><span className="font-medium text-strong">Version {v.version}</span> <span className="text-xs text-muted-foreground">{when(v.createdAt, timezone)} · {v.note ?? "No note"}</span></li>)}
        </ul>
        {template.staleReview ? <p className="mt-2 text-xs text-muted-foreground">The last recorded review ({template.staleReview.reviewer}, {template.staleReview.reviewedOn}) was of version {template.staleReview.version}, an earlier version.</p> : null}
      </Panel>
    </div>
  );
}
