"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { useChat } from "@/components/app/chat/chat-context";
import { Composer, type Outgoing } from "@/components/app/chat/composer";
import { Field, FormError, SelectInput, TextInput, useRun } from "@/components/app/form";
import { ArrowLeft, ArrowRight, ChatIcon, ExternalLink, Plus, Search, Sparkles, Trash2 } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { briefPath, centsFrom, SERVICES_ROOT, servicePath } from "@/lib/app/services";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { startingCents } from "../../../../convex/lib/services/engine";
import { BASIS_LABELS, comparableRange } from "../../../../convex/lib/services/research";
import { Empty, formatCents, InfoTip, Notice, SectionTitle, when } from "./shared";
import { PriceStrip } from "./visuals";

const BASIS_TONE: Record<string, "info" | "warning" | "success" | "outline"> = { advertised_starting: "warning", estimated: "info", firm_published: "success", company_data: "success", ai_inference: "outline" };

const STATE_WORDS: Record<string, string> = { queued: "Waiting to start", running: "Researching", ready: "Ready", failed: "Did not finish", blocked: "Could not run" };

type OwnerSource = { url: string; title: string; price: string; priceKind: "advertised_starting" | "estimated" | "firm_published"; unit: string; geography: string; excerpt: string; comparable: boolean };
const blankSource = (): OwnerSource => ({ url: "", title: "", price: "", priceKind: "advertised_starting", unit: "per visit", geography: "", excerpt: "", comparable: true });

/** Ideas to start from, using the company's own area when setup gave one. Picking one fills the box; the person still sends it. */
function researchStarters(area: string): string[] {
  const near = area && area.length <= 40 ? ` near ${area}` : " near me";
  return [
    `What do cleaning businesses${near} publish for a standard home clean?`,
    "Do companies near me price deep cleans by size, or by bedrooms and bathrooms?",
    `Is there demand for short-term rental turnovers${near}, and how are they priced?`,
    "What do commercial cleaners publish for small office cleaning?",
  ];
}

const BRIEF_ORIGIN: Record<string, string> = { setup: "started by setup", chat: "started in Chat", member: "started by your team" };

/**
 * Research starts as a real Chat conversation: Chat's own box, centered on the page. Sending opens the
 * conversation in Chat, which knows the business and the person for every reply and can start a research
 * brief when one is worth running. Earlier research chats and briefs are listed underneath.
 */
export function ResearchHome() {
  const { companyId } = useCompany();
  const data = useQuery(api.servicesResearch.briefs, { companyId });
  const profile = useQuery(api.services.profile, { companyId });
  const chats = useQuery(api.chat.researchChats, { companyId });
  const send = useMutation(api.chat.send);
  const router = useRouter();
  const { page, setConversationId } = useChat();
  const [seed, setSeed] = useState("");
  const [model, setModel] = useState<string | null>(null);
  if (!data) return <Skeleton className="h-64 rounded-2xl" />;
  const area = profile?.context.serviceAreas.trim() ?? "";

  const start = async (outgoing: Outgoing) => {
    const result = await send({
      companyId,
      text: outgoing.text,
      clientKey: outgoing.clientKey,
      page: outgoing.includePage && page ? page.path : undefined,
      context: outgoing.records.map((record) => ({ table: record.table, id: record.id })),
      attachments: outgoing.files.map((file) => ({ storageId: file.storageId as Id<"_storage">, name: file.name })),
      model: model ?? undefined,
      origin: { kind: "research" },
    });
    setConversationId(result.conversationId);
    router.push(`/app/chat/${result.conversationId}`);
  };

  return (
    <div className="grid grid-cols-1 gap-10">
      {data.canStart ? (
        <section aria-labelledby="research-ask" className="mx-auto flex min-h-[min(36rem,calc(100dvh-18rem))] w-full max-w-3xl flex-col items-center justify-center gap-6 py-6 text-center">
          <span aria-hidden className="inline-flex size-12 items-center justify-center rounded-full border border-brand-500/30 bg-card shadow-[0_12px_32px_-14px_rgba(104,56,239,0.8)]">
            <Search className="size-5 text-brand-300" />
          </span>
          <div className="grid gap-1.5">
            <h2 id="research-ask" className="flex items-center justify-center gap-0.5 font-heading text-2xl tracking-tight text-strong sm:text-3xl">
              What do you want to find out?
              <InfoTip label="Research & Insights">This opens a Chat conversation that already knows your business: where you work, what you sell and how your team works. Chat can start a research brief that searches public web pages (10 Selestial Credits, with your approval) and tells the conversation when it is ready. Research proposes; it never changes a price.</InfoTip>
            </h2>
            <p className="text-sm text-muted-foreground">Ask about prices, demand or your area. Selestial answers in Chat and can research it for you.</p>
          </div>
          <div className="w-full text-left">
            <Composer working={false} stopping={false} seed={seed} autoFocus placeholder="Ask a pricing or market question…" onSend={start} onStop={async () => undefined} model={model} onModel={async (key) => setModel(key)} />
          </div>
          <ul aria-label="Ideas to start from" className="grid w-full gap-2 text-left sm:grid-cols-2">
            {researchStarters(area).map((starter) => (
              <li key={starter}>
                <button type="button" onClick={() => setSeed(starter)} className="group flex h-full w-full items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3 text-left text-sm text-strong hover:border-brand-500/50 hover:bg-brand-500/[0.04] focus-visible:outline-2 focus-visible:outline-brand-500">
                  <Sparkles className="size-4 shrink-0 text-brand-300" aria-hidden />
                  <span className="flex-1">{starter}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <SectionTitle title="Research & Insights" tip="Research answers one question: a new kind of service, an unfamiliar area, or where to position. It proposes; it never changes a price.">Briefs your Owner and Managers started.</SectionTitle>
      )}

      <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-8">
        {chats && chats.length ? (
          <section aria-labelledby="research-chats" className="grid grid-cols-1 gap-2">
            <h2 id="research-chats" className="font-heading text-base tracking-tight text-strong">
              Your research chats <span className="text-sm font-normal text-muted-foreground">· {chats.length}</span>
            </h2>
            <ul className="grid grid-cols-1 gap-2">
              {chats.map((chat) => (
                <li key={chat.id}>
                  <Link href={`/app/chat/${chat.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500/50">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ChatIcon aria-hidden className="size-4 shrink-0 text-brand-300" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-strong">{chat.title}</span>
                        <span className="block text-xs text-muted-foreground">{chat.state === "working" ? "Answering now" : `Updated ${when(chat.updatedAt)}`}</span>
                      </span>
                    </span>
                    <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="research-list" className="grid grid-cols-1 gap-2">
          <h2 id="research-list" className="font-heading text-base tracking-tight text-strong">
            Research briefs {data.briefs.length ? <span className="text-sm font-normal text-muted-foreground">· {data.briefs.length}</span> : null}
          </h2>
          {data.briefs.length === 0 ? <Empty title="No briefs yet">{data.canStart ? "Ask in the box above. When a question needs current prices from the web, Chat offers to start a brief." : "Briefs appear here once someone starts one."}</Empty> : null}
          <ul className="grid grid-cols-1 gap-2">
            {data.briefs.map((b) => (
              <li key={b.id}>
                <Link href={briefPath(b.id)} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500/50">
                  <span className="min-w-0">
                    <span className="block font-medium text-strong">{b.question}</span>
                    <span className="block text-xs text-muted-foreground">
                      {b.geography || "No area given"} · {b.mode === "web" ? "Web research" : "Your sources and records"} · {BRIEF_ORIGIN[b.origin] ?? BRIEF_ORIGIN.member} · {when(b.createdAt)}
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
        </section>
      </div>
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href={`${SERVICES_ROOT}/research`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-strong">
            <ArrowLeft aria-hidden className="size-4" /> All research
          </Link>
          {brief.conversationId ? (
            <Link href={`/app/chat/${brief.conversationId}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-300 hover:underline">
              <ChatIcon aria-hidden className="size-4" /> Back to the conversation
            </Link>
          ) : null}
        </div>
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

      <ComparablePrices findings={brief.findings} serviceId={serviceFor} />

      <section>
        <SectionTitle title="Findings" tip="Each finding says what kind of evidence it is. A few advertised prices are not a market average, and nothing here knows a competitor's costs or margins." />
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
        <SectionTitle title="Sources" tip="Where each finding came from, when it was read, and what it could not show." />
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

type Finding = NonNullable<ReturnType<typeof useQuery<typeof api.servicesResearch.brief>>>["findings"][number];

/**
 * The comparable prices behind the brief's typical range, drawn on one line. The company's own starting
 * price is marked only when the range is of starting prices per visit, so like is compared with like.
 */
function ComparablePrices({ findings, serviceId }: { findings: Finding[]; serviceId: string }) {
  const { companyId } = useCompany();
  const view = useQuery(api.services.service, serviceId ? { companyId, serviceId: serviceId as Id<"services"> } : "skip");
  const range = comparableRange(findings);
  if (!range) return null;
  const points = findings
    .filter((f) => f.comparable && f.priceCents !== null && f.unit.toLowerCase() === range.unit.toLowerCase() && f.basis !== "ai_inference" && f.basis !== "company_data")
    .map((f) => ({ key: f.id, cents: f.priceCents!, label: [f.geography, f.scope].filter(Boolean).join(" · ") || f.basisLabel }));
  const spec = view?.live?.spec ?? null;
  const ownStart = spec ? startingCents(spec) : null;
  const sameKind = range.basis === "advertised_starting" && /visit|clean|job|turnover/.test(range.unit.toLowerCase());
  const kind = range.basis === "advertised_starting" ? "Advertised starting prices" : range.basis === "estimated" ? "Published estimates" : "Published prices";
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <SectionTitle title="Comparable prices" tip="What comparable businesses publish, drawn on one line. Not what customers paid, and not a market average." />
      <PriceStrip points={points} low={range.low} high={range.high} unit={range.unit} kind={kind} mine={ownStart !== null && sameKind && spec ? { cents: ownStart, label: `Your starting price (${spec.name})` } : null} />
    </section>
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
