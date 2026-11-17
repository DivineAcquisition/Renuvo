"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { ArrowLeft, ExternalLink, Plus, Trash2 } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { briefPath, centsFrom, SERVICES_ROOT, servicePath } from "@/lib/app/services";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { BASIS_LABELS } from "../../../../convex/lib/services/research";
import { Empty, formatCents, Notice, SectionTitle, Toggle, when } from "./shared";

const BASIS_TONE: Record<string, "info" | "warning" | "success" | "outline"> = { advertised_starting: "warning", estimated: "info", firm_published: "success", company_data: "success", ai_inference: "outline" };

const STATE_WORDS: Record<string, string> = { queued: "Waiting to start", running: "Researching", ready: "Ready", failed: "Did not finish", blocked: "Could not run" };

type OwnerSource = { url: string; title: string; price: string; priceKind: "advertised_starting" | "estimated" | "firm_published"; unit: string; geography: string; excerpt: string; comparable: boolean };
const blankSource = (): OwnerSource => ({ url: "", title: "", price: "", priceKind: "advertised_starting", unit: "per visit", geography: "", excerpt: "", comparable: true });

/** Research briefs, newest first, and how to start one. */
export function ResearchHome() {
  const { companyId } = useCompany();
  const data = useQuery(api.servicesResearch.briefs, { companyId });
  const [starting, setStarting] = useState(false);
  if (!data) return <Skeleton className="h-64 rounded-2xl" />;
  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle title="Research & Insights">Research answers a specific question: a new kind of service, an unfamiliar area, or where to position. It proposes; it never changes a price. If you already have reliable job data, you can skip it.</SectionTitle>
        {data.canStart && !starting ? (
          <Button variant="primary" size="sm" onClick={() => setStarting(true)}>
            <Plus aria-hidden /> New research
          </Button>
        ) : null}
      </div>
      {starting ? <NewBrief onDone={() => setStarting(false)} /> : null}
      {data.briefs.length === 0 && !starting ? <Empty title="No research yet">Start one when a decision needs it. Your own completed visits are always included, free.</Empty> : null}
      <ul className="grid grid-cols-1 gap-2">
        {data.briefs.map((b) => (
          <li key={b.id}>
            <Link href={briefPath(b.id)} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500/50">
              <span className="min-w-0">
                <span className="block font-medium text-strong">{b.question}</span>
                <span className="block text-xs text-muted-foreground">
                  {b.geography || "No area given"} · {b.mode === "web" ? "Web research" : "Your sources and records"} · {b.origin === "setup" ? "started by setup" : "started by your team"} · {when(b.createdAt)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{b.findings} findings</span>
                <Badge variant={b.state === "ready" ? "success" : b.state === "failed" ? "error" : "info"} size="sm">
                  {STATE_WORDS[b.state]}
                </Badge>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceRows({ sources, setSources }: { sources: OwnerSource[]; setSources: (s: OwnerSource[]) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2">
      {sources.map((s, i) => {
        const set = (patch: Partial<OwnerSource>) => setSources(sources.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <div key={i} className="grid grid-cols-1 gap-2 rounded-xl border border-border p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_1fr_auto] sm:items-end">
              <Field label="Business or page">
                <TextInput value={s.title} onChange={(e) => set({ title: e.target.value })} placeholder="Bright Home Cleaning" />
              </Field>
              <Field label="Link (optional)">
                <TextInput value={s.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://" />
              </Field>
              <Button size="icon-sm" variant="ghost" aria-label="Remove this source" onClick={() => setSources(sources.filter((_, j) => j !== i))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <Field label="Price shown">
                <TextInput value={s.price} inputMode="decimal" onChange={(e) => set({ price: e.target.value })} placeholder="129" />
              </Field>
              <Field label="Per">
                <TextInput value={s.unit} onChange={(e) => set({ unit: e.target.value })} />
              </Field>
              <label className="grid grid-cols-1 gap-1.5 text-sm sm:col-span-2">
                <span className="font-medium text-strong">What kind of price</span>
                <SelectInput value={s.priceKind} onChange={(e) => set({ priceKind: e.target.value as OwnerSource["priceKind"] })}>
                  <option value="advertised_starting">A “from” or starting price</option>
                  <option value="estimated">An estimate or range</option>
                  <option value="firm_published">A firm price for a stated scope</option>
                </SelectInput>
              </label>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <Field label="What it includes, in their words (optional)">
                <TextInput value={s.excerpt} onChange={(e) => set({ excerpt: e.target.value })} maxLength={300} />
              </Field>
              <Field label="Where">
                <TextInput value={s.geography} onChange={(e) => set({ geography: e.target.value })} placeholder="Austin" />
              </Field>
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={s.comparable} onChange={(e) => set({ comparable: e.target.checked })} /> The scope is comparable to ours
            </label>
          </div>
        );
      })}
      <div>
        <Button size="sm" variant="secondary" onClick={() => setSources([...sources, blankSource()])}>
          <Plus aria-hidden /> Add a source you found
        </Button>
      </div>
    </div>
  );
}

const toOwner = (s: OwnerSource) => ({ ...(s.url.trim() ? { url: s.url.trim() } : {}), title: s.title, geography: s.geography, excerpt: s.excerpt, priceCents: s.price.trim() ? centsFrom(s.price) : null, priceKind: s.price.trim() ? s.priceKind : null, unit: s.unit, comparable: s.comparable, limitation: "" });

function NewBrief({ onDone }: { onDone: () => void }) {
  const { companyId } = useCompany();
  const router = useRouter();
  const start = useMutation(api.servicesResearch.start);
  const catalog = useQuery(api.services.catalog, { companyId });
  const { busy, error, run } = useRun();
  const [question, setQuestion] = useState("");
  const [geography, setGeography] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [web, setWeb] = useState(true);
  const [sources, setSources] = useState<OwnerSource[]>([]);
  return (
    <div className="grid grid-cols-1 gap-4 rounded-2xl border border-brand-500/25 bg-gradient-to-b from-brand-500/[0.05] to-card p-4 sm:p-6">
      <Field label="What should it answer?" hint="One decision at a time works best.">
        <TextArea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What do comparable businesses in north Austin publish for move-out cleans, and do they quote by size or after a walkthrough?" />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Where">
          <TextInput value={geography} onChange={(e) => setGeography(e.target.value)} placeholder="Austin, TX (78701–78759)" />
        </Field>
        <label className="grid grid-cols-1 gap-1.5 text-sm">
          <span className="font-medium text-strong">About one of your services (optional)</span>
          <SelectInput value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">None</option>
            {catalog?.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectInput>
        </label>
      </div>
      <Toggle label="Search public web pages" description="Up to 5 searches and one written brief: 10 Selestial Credits, charged only if it finishes. Without it, the brief uses only the sources you add and your own completed visits, free." checked={web} onChange={setWeb} />
      <SourceRows sources={sources} setSources={setSources} />
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          loading={busy}
          disabled={!question.trim()}
          onClick={() =>
            void run(async () => {
              const result = await start({ companyId, question, geography, web, sources: sources.filter((s) => s.title.trim()).map(toOwner), ...(serviceId ? { serviceId: serviceId as Id<"services"> } : {}) });
              router.push(briefPath(result.briefId));
            })
          }
        >
          {web ? "Start research (10 credits)" : "Make the brief"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** A brief: what was found, what is comparable, what is uncertain, options, and every finding with its kind and sources. */
export function BriefView({ briefId }: { briefId: string }) {
  const { companyId } = useCompany();
  const brief = useQuery(api.servicesResearch.brief, { companyId, briefId: briefId as Id<"researchBriefs"> });
  const catalog = useQuery(api.services.catalog, { companyId });
  const attach = useMutation(api.servicesResearch.attachToDraft);
  const addSource = useMutation(api.servicesResearch.addSource);
  const router = useRouter();
  const { busy, error, run } = useRun();
  const [target, setTarget] = useState("");
  const [adding, setAdding] = useState<OwnerSource[]>([]);
  if (!brief) return <Skeleton className="h-96 rounded-2xl" />;
  const serviceFor = target || brief.serviceId || "";
  const attachTo = (findingId?: string) =>
    void run(async () => {
      if (!serviceFor) throw Object.assign(new Error(), { data: { message: "Choose the service to attach it to." } });
      await attach({ companyId, briefId: brief.id, serviceId: serviceFor as Id<"services">, ...(findingId ? { findingId } : {}) });
      router.push(servicePath(serviceFor));
    });
  return (
    <div className="grid grid-cols-1 gap-5">
      <div>
        <Link href={`${SERVICES_ROOT}/research`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-strong">
          <ArrowLeft aria-hidden className="size-4" /> All research
        </Link>
        <h2 className="mt-1 font-heading text-xl tracking-tight text-strong">{brief.question}</h2>
        <p className="text-sm text-muted-foreground">
          {brief.geography || "No area given"} · {brief.mode === "web" ? "Web research" : "Your sources and your records"} · {STATE_WORDS[brief.state]} · started {when(brief.createdAt)}
        </p>
      </div>
      {brief.blocked ? <Notice tone="warning" title="Limited brief">{brief.blocked}</Notice> : null}
      {brief.state === "queued" || brief.state === "running" ? <Notice>Researching now. This page updates when it is done; you can leave it.</Notice> : null}

      {brief.summary ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SummaryBlock title="What was found" items={brief.summary.found} />
          <SummaryBlock title="What is comparable" items={brief.summary.comparable} empty="Nothing was clearly comparable." />
          <SummaryBlock title="What remains uncertain" items={brief.summary.uncertain} tone="warning" />
          <div className="rounded-2xl border border-border bg-card p-4">
            <h3 className="font-heading text-base tracking-tight text-strong">Options</h3>
            {brief.summary.options.length ? (
              <ul className="mt-2 grid gap-2 text-sm">
                {brief.summary.options.map((o) => (
                  <li key={o.label}>
                    <span className="font-medium text-strong">{o.label}</span>
                    <span className="block text-muted-foreground">{o.tradeoff}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No options offered: there is not enough here to recommend one honestly.</p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">Options describe tradeoffs. None is a promise about bookings or profit.</p>
          </div>
        </div>
      ) : null}

      {brief.canEdit ? (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3">
          <label className="grid grid-cols-1 gap-1.5 text-sm">
            <span className="font-medium text-strong">Apply to a draft of</span>
            <SelectInput value={serviceFor} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose a service</option>
              {catalog?.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectInput>
          </label>
          <Button variant="secondary" size="sm" disabled={busy || !serviceFor} onClick={() => attachTo()}>
            Attach the whole brief
          </Button>
          <p className="basis-full text-xs text-muted-foreground">Attaching adds it as evidence to the draft&apos;s review. It changes no price; you decide what to change in the builder.</p>
        </div>
      ) : null}
      <FormError message={error} />

      <section>
        <SectionTitle title="Findings">Each says what kind of evidence it is. A few advertised prices are not a market average, and nothing here knows a competitor&apos;s costs or margins.</SectionTitle>
        {brief.findings.length === 0 ? <p className="text-sm text-muted-foreground">No findings yet.</p> : null}
        <ul className="grid grid-cols-1 gap-2">
          {brief.findings.map((f) => (
            <li key={f.id} className="rounded-xl border border-border bg-card p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={BASIS_TONE[f.basis]} size="sm" title={f.basisMeaning}>
                  {f.basisLabel}
                </Badge>
                {f.comparable ? (
                  <Badge variant="outline" size="sm">
                    Comparable scope
                  </Badge>
                ) : null}
                {f.sources.map((n) => (
                  <a key={n} href={`#source-${n}`} className="rounded border border-border px-1.5 text-xs text-muted-foreground hover:text-strong">
                    [{n}]
                  </a>
                ))}
              </div>
              <p className="mt-1.5 text-strong">{f.statement}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[f.geography, f.scope, f.priceCents !== null ? `${formatCents(f.priceCents)} ${f.unit}` : null].filter(Boolean).join(" · ")}
              </p>
              <p className="text-xs text-muted-foreground">Limitation: {f.limitation}</p>
              {brief.canEdit && serviceFor ? (
                <Button size="xs" variant="ghost" className="mt-1" disabled={busy} onClick={() => attachTo(f.id)}>
                  Apply to draft as evidence
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionTitle title="Sources">Where each finding came from, when it was read, and what it could not show.</SectionTitle>
        <ol className="grid grid-cols-1 gap-2">
          {brief.sources.map((s) => (
            <li key={s.id} id={`source-${s.number}`} className={cn("rounded-xl border border-border bg-card p-3 text-sm scroll-mt-20")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-strong">
                  [{s.number}] {s.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {s.origin === "web" ? "Read by Selestial" : s.origin === "owner" ? "Supplied by your team" : "Your records"} · {when(s.retrievedAt)}
                </span>
              </div>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 break-all text-xs text-brand-300 underline-offset-4 hover:underline dark:text-brand-300">
                  {s.url} <ExternalLink aria-hidden className="size-3" />
                </a>
              ) : null}
              {s.excerpt ? <blockquote className="mt-1 border-l-2 border-border pl-2 text-muted-foreground">“{s.excerpt}”</blockquote> : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {s.geography ? `${s.geography} · ` : ""}
                {s.priceCents !== null && s.priceKind ? `${BASIS_LABELS[s.priceKind].label}: ${formatCents(s.priceCents)} ${s.unit} · ` : ""}
                {s.limitation}
              </p>
            </li>
          ))}
        </ol>
        {brief.canEdit ? (
          <div className="mt-3 grid gap-2">
            <SourceRows sources={adding} setSources={setAdding} />
            {adding.length ? (
              <div>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy || !adding.some((s) => s.title.trim())}
                  onClick={() =>
                    void run(async () => {
                      for (const s of adding.filter((x) => x.title.trim())) await addSource({ companyId, briefId: brief.id, source: toOwner(s) });
                      setAdding([]);
                    })
                  }
                >
                  Save sources
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function SummaryBlock({ title, items, empty, tone }: { title: string; items: string[]; empty?: string; tone?: "warning" }) {
  return (
    <div className={cn("rounded-2xl border p-4", tone === "warning" ? "border-warning/40 bg-warning/[0.06]" : "border-border bg-card")}>
      <h3 className="font-heading text-base tracking-tight text-strong">{title}</h3>
      {items.length ? (
        <ul className="mt-2 grid gap-1 text-sm text-strong">
          {items.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{empty ?? "Nothing."}</p>
      )}
    </div>
  );
}
