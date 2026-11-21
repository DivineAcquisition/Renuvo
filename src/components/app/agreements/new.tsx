"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Empty, Notice, ReadinessBadge, ToneBadge } from "@/components/app/agreements/shared";
import type { Catalog } from "@/components/app/agreements/types";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { agreementPath, AGREEMENTS_ROOT, CATEGORY } from "@/lib/app/agreements";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Checkbox } from "@/components/ui/selection";

type Mode = "selestial" | "template" | "upload";
const MODES: { id: Mode; label: string; blurb: string }[] = [
  { id: "selestial", label: "Build with Selestial", blurb: "Describe what you need. Selestial asks a few questions at a time and writes a draft you review." },
  { id: "template", label: "Use a Template", blurb: "Start from Selestial's starting text or one of your own approved templates." },
  { id: "upload", label: "Upload Agreement", blurb: "Bring in an agreement you already use. The original is kept as it is." },
];

const EXAMPLES = ["Build a recurring cleaning agreement for a customer", "Create an STR turnover agreement for these properties", "Help me update my contractor agreement"];

export function NewAgreement() {
  const params = useSearchParams();
  const router = useRouter();
  const mode = (MODES.find((m) => m.id === params.get("mode"))?.id ?? "selestial") as Mode;
  const { companyId } = useCompany();
  const catalog = useQuery(api.companyAgreements.catalog, { companyId });
  return (
    <div className="grid gap-5">
      <div role="tablist" aria-label="How to start" className="grid gap-2 sm:grid-cols-3">
        {MODES.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={mode === item.id} onClick={() => router.replace(`${AGREEMENTS_ROOT}/new?mode=${item.id}`)} className={cn("rounded-2xl border p-4 text-left transition-colors", mode === item.id ? "border-brand-500 bg-brand-500/[0.06]" : "border-border bg-card hover:border-brand-500/40")}>
            <span className="block text-sm font-semibold text-strong">{item.label}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{item.blurb}</span>
          </button>
        ))}
      </div>
      {!catalog ? <Skeleton className="h-64 rounded-2xl" /> : !catalog.capabilities.includes("draft") ? <Notice>Your role can read agreements but not start them.</Notice> : mode === "selestial" ? <BuildWithSelestial catalog={catalog} /> : mode === "template" ? <FromTemplate catalog={catalog} /> : <UploadAgreement catalog={catalog} />}
    </div>
  );
}

/** Starts a Chat conversation that builds the agreement, so Chat and Agreements show the one record. */
function BuildWithSelestial({ catalog }: { catalog: Catalog }) {
  const { companyId } = useCompany();
  const router = useRouter();
  const send = useMutation(api.chat.send);
  const { busy, error, run } = useRun();
  const [text, setText] = useState("");
  const [type, setType] = useState("");
  const customers = useQuery(api.customers.list, { companyId });
  const [customerId, setCustomerId] = useState(useSearchParams().get("customer") ?? "");
  const label = catalog.types.find((t) => t.key === type)?.label;
  const start = () =>
    run(async () => {
      const customer = customers?.find((c) => c._id === customerId);
      const message = [text.trim() || (label ? `Build a ${label} agreement.` : "Help me build an agreement."), label ? `Use the "${label}" type (${type}).` : "", customer ? `It is for the customer ${customer.name} (customer id ${customer._id}).` : ""].filter(Boolean).join(" ");
      const sent = await send({ companyId, text: message, clientKey: `new-agreement-${Date.now()}`, page: AGREEMENTS_ROOT, context: customer ? [{ table: "customers", id: customer._id }] : undefined });
      router.push(`/app/chat/${sent.conversationId}`);
    });
  return (
    <div className="grid gap-4 rounded-2xl border border-brand-500/25 bg-gradient-to-b from-brand-500/[0.06] to-card p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-brand-500/15 text-brand-600" aria-hidden>
          <Sparkles className="size-5" />
        </span>
        <div>
          <h2 className="font-heading text-lg tracking-tight text-strong">What do you need?</h2>
          <p className="text-sm text-muted-foreground">Selestial uses your company details and approved templates, asks only what is missing, and saves a draft you can open here.</p>
        </div>
      </div>
      <Field label="In your own words">
        <TextArea value={text} rows={3} onChange={(event) => setText(event.target.value)} placeholder={EXAMPLES[0]} />
      </Field>
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button key={example} type="button" className="rounded-full border border-border bg-card px-3 py-1 text-xs text-strong hover:border-brand-500/50" onClick={() => setText(example)}>
            {example}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind of agreement (optional)" hint="Leave blank and Selestial will work out which fits.">
          <SelectInput value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">Let Selestial choose</option>
            {catalog.types.filter((t) => t.canDraft).map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="For a customer (optional)" hint="Their details are filled in from your records.">
          <SelectInput value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
            <option value="">No one yet</option>
            {customers?.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <FormError message={error} />
      <div>
        <Button variant="primary" loading={busy} onClick={() => void start()}>
          <Sparkles aria-hidden /> Start building
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Selestial&apos;s drafts are built from your information and a starting template. They are not legal advice, and sensitive points are flagged for review where they come up.</p>
    </div>
  );
}

function FromTemplate({ catalog }: { catalog: Catalog }) {
  const { companyId } = useCompany();
  const router = useRouter();
  const create = useMutation(api.companyAgreements.create);
  const { busy, error, run } = useRun();
  const [category, setCategory] = useState("customer");
  const customers = useQuery(api.customers.list, { companyId });
  const [customerId, setCustomerId] = useState(useSearchParams().get("customer") ?? "");
  const types = catalog.types.filter((t) => t.category === category && t.canDraft);
  const grouped = useMemo(() => [...types.reduce((acc, t) => acc.set(t.family, [...(acc.get(t.family) ?? []), t]), new Map<string, typeof types>())], [types]);
  const start = (docType: string, templateId?: string) =>
    run(async () => {
      const id = await create({ companyId, docType, templateId, links: customerId ? [{ table: "customers", id: customerId }] : undefined });
      router.push(agreementPath(id));
    });
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        <Field label="Kind of document">
          <SelectInput value={category} onChange={(event) => setCategory(event.target.value)}>
            {Object.entries(CATEGORY).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="For a customer (optional)" hint="Fills in their details from your records.">
          <SelectInput value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
            <option value="">No one yet</option>
            {customers?.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <FormError message={error} />
      {catalog.templates.filter((t) => t.status === "approved" && types.some((type) => type.key === t.docType)).length ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-strong">Your approved templates</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {catalog.templates.filter((t) => t.status === "approved" && types.some((type) => type.key === t.docType)).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-strong">{t.title}</span>
                  <span className="text-xs text-muted-foreground">Version {t.approvedVersion}{t.review ? ` · reviewed by ${t.review.reviewer}` : " · no recorded legal review"}</span>
                </span>
                <Button size="sm" variant="primary" disabled={busy} onClick={() => void start(t.docType, t.id)}>Use</Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {grouped.map(([family, rows]) => (
        <section key={family}>
          <h3 className="mb-2 text-sm font-semibold text-strong">{family}</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {rows.map((t) => (
              <li key={t.key} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-strong">{t.label}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <ReadinessBadge readiness={t.readiness} />
                    {t.access !== "company" ? <ToneBadge tone="neutral">{t.access === "restricted" ? "Owner only" : "Owners & Managers"}</ToneBadge> : null}
                  </span>
                  {t.note ? <span className="mt-1 block text-xs text-muted-foreground">{t.note}</span> : null}
                </span>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void start(t.key)}>Start</Button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {types.length === 0 ? <Empty title="Nothing here for your role">Your role cannot start this kind of document.</Empty> : null}
    </div>
  );
}

const STEP = { received: "Received", checking: "Checking the file…", ready: "Ready to file" } as const;

/** Three steps: the file is kept as received, checked, then a person says what it is. Nothing is called an agreement until then. */
function UploadAgreement({ catalog }: { catalog: Catalog }) {
  const { companyId } = useCompany();
  const router = useRouter();
  const getUrl = useMutation(api.agreementFiles.uploadUrl);
  const register = useMutation(api.agreementFiles.register);
  const finalize = useMutation(api.agreementFiles.finalize);
  const { busy, error, run } = useRun();
  const [fileId, setFileId] = useState<Id<"agreementFiles"> | null>(null);
  const status = useQuery(api.agreementFiles.status, fileId ? { companyId, fileId } : "skip");
  const input = useRef<HTMLInputElement>(null);
  const prefill = useSearchParams().get("customer") ?? "";
  const [form, setForm] = useState({ classification: "agreement", docType: "", supportingKind: "other_record", expiresOn: "", customerId: prefill, workerId: "", signedElsewhere: false, signedOn: "", signers: "", how: "" });
  const customers = useQuery(api.customers.list, { companyId });
  const cleaners = useQuery(api.cleaners.list, { companyId });
  const suggestion = status?.suggestion;
  const [suggestedFor, setSuggestedFor] = useState<string | null>(null);
  if (suggestion && fileId && suggestedFor !== fileId) {
    setSuggestedFor(fileId);
    setForm((f) => ({ ...f, classification: suggestion.classification === "supporting" ? "supporting" : "agreement", docType: f.docType || suggestion.docType || "", supportingKind: suggestion.supportingKind ?? f.supportingKind }));
  }
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: event.target.type === "checkbox" ? (event.target as HTMLInputElement).checked : event.target.value }));
  const canVerify = catalog.capabilities.includes("approve");

  const upload = (file: File) =>
    run(async () => {
      const url = await getUrl({ companyId });
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!response.ok) throw Object.assign(new Error(), { data: { message: "The upload did not go through. Try again." } });
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
      setFileId(await register({ companyId, storageId, name: file.name }));
    });

  const file = () =>
    run(async () => {
      const links = [...(form.customerId ? [{ table: "customers" as const, id: form.customerId }] : []), ...(form.workerId ? [{ table: "cleaners" as const, id: form.workerId }] : [])];
      const done = await finalize({
        companyId,
        fileId: fileId!,
        classification: form.classification as "agreement" | "supporting",
        docType: form.classification === "agreement" ? form.docType || undefined : undefined,
        supportingKind: form.classification === "supporting" ? form.supportingKind : undefined,
        expiresOn: form.expiresOn || undefined,
        links,
        externallySigned: form.classification === "agreement" && form.signedElsewhere ? { signedOn: form.signedOn || undefined, signers: form.signers.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean), note: form.how } : undefined,
      });
      router.push(done.agreementId ? agreementPath(done.agreementId) : `${AGREEMENTS_ROOT}/all`);
    });

  const step = !fileId ? null : !status ? "received" : status.ready ? "ready" : status.extraction.state === "rejected" ? "rejected" : "checking";
  return (
    <div className="grid max-w-3xl gap-4">
      <div className="rounded-2xl border border-dashed border-border bg-card p-5">
        <h2 className="font-heading text-lg tracking-tight text-strong">Upload an agreement or a supporting record</h2>
        <p className="mt-1 text-sm text-muted-foreground">PDF, Word, plain text or an image, up to 15 MB. The original is kept exactly as you send it. Plain text is read into the document; other files are kept and you add the key terms by hand. Selestial does not scan files for viruses, and it never opens or runs them.</p>
        <input ref={input} type="file" accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg" className="sr-only" aria-label="Choose a file" onChange={(event) => { const f = event.target.files?.[0]; if (f) void upload(f); event.target.value = ""; }} />
        <div className="mt-3"><Button variant="secondary" loading={busy && !fileId} onClick={() => input.current?.click()}>{fileId ? "Choose a different file" : "Choose a file"}</Button></div>
      </div>
      <FormError message={error} />
      {step === "checking" || step === "received" ? <Notice>{STEP.checking}</Notice> : null}
      {step === "rejected" ? <Notice tone="error">{status?.extraction.note ?? "This file was not accepted."} It was removed. Choose another file.</Notice> : null}
      {step === "ready" && status ? (
        <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <p className="text-sm font-medium text-strong">{status.name}</p>
          {status.extraction.state !== "read" ? <Notice tone="warning">{status.extraction.note}</Notice> : <Notice>The text was read from the file.</Notice>}
          {suggestion ? <p className="text-xs text-muted-foreground">Selestial&apos;s guess: {suggestion.reasons.join(" ")} ({suggestion.confidence} confidence). You decide.</p> : null}
          <Field label="What is this?">
            <SelectInput value={form.classification} onChange={set("classification")}>
              <option value="agreement">An agreement</option>
              <option value="supporting">A supporting record (insurance, license, official form)</option>
            </SelectInput>
          </Field>
          {form.classification === "agreement" ? (
            <>
              <Field label="Kind of agreement">
                <SelectInput value={form.docType} onChange={set("docType")}>
                  <option value="">Choose…</option>
                  {catalog.types.filter((t) => t.canDraft).map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              {canVerify ? (
                <div className="grid gap-2 rounded-xl border border-border p-3">
                  <label className="flex items-start gap-2 text-sm text-strong">
                    <Checkbox className="mt-1" checked={form.signedElsewhere} onCheckedChange={(checked) => set("signedElsewhere")({ target: { type: "checkbox", checked } } as unknown as React.ChangeEvent<HTMLInputElement>)} />
                    <span>This copy was already signed outside Selestial, and I checked it<span className="block text-xs text-muted-foreground">Selestial did not collect these signatures. Your name and what you checked are recorded as the verification. Leave this off and the upload is just a document that has not been signed.</span></span>
                  </label>
                  {form.signedElsewhere ? (
                    <>
                      <Field label="Who signed (names, separated by commas)"><TextInput value={form.signers} onChange={set("signers")} /></Field>
                      <Field label="Date signed"><TextInput type="date" value={form.signedOn} onChange={set("signedOn")} /></Field>
                      <Field label="How you checked it"><TextInput value={form.how} onChange={set("how")} placeholder="For example: compared the signed PDF to the original and confirmed with the customer" /></Field>
                    </>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <Field label="Kind of record">
                <SelectInput value={form.supportingKind} onChange={set("supportingKind")}>
                  {catalog.supportingKinds.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.label}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Expires (optional)"><TextInput type="date" value={form.expiresOn} onChange={set("expiresOn")} /></Field>
              <Notice>Official forms are kept as you uploaded them. Selestial never writes or replaces one.</Notice>
            </>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Link to a customer (optional)"><SelectInput value={form.customerId} onChange={set("customerId")}><option value="">None</option>{customers?.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</SelectInput></Field>
            <Field label="Link to a worker (optional)"><SelectInput value={form.workerId} onChange={set("workerId")}><option value="">None</option>{cleaners?.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</SelectInput></Field>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" loading={busy} disabled={form.classification === "agreement" && !form.docType} onClick={() => void file()}>File it</Button>
            <Link href={AGREEMENTS_ROOT} className="inline-flex h-9 items-center px-3 text-sm text-muted-foreground hover:underline">Cancel</Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
