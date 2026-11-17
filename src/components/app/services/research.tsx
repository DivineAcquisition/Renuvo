"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, messageOf, SelectInput, TextInput, useRun } from "@/components/app/form";
import { CreditIndicator } from "@/components/app/billing/credit-indicator";
import { ArrowLeft, ArrowRight, ArrowUp, Check, ExternalLink, Globe, MapPin, Paperclip, Plus, PriceTagIcon, Search, Sparkles, Trash2, X } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
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

/**
 * Research starts the way Chat does: a box to ask one question in. Sending it starts a research brief and
 * opens it while it runs. Earlier briefs are listed underneath.
 */
export function ResearchHome() {
  const { companyId } = useCompany();
  const data = useQuery(api.servicesResearch.briefs, { companyId });
  const profile = useQuery(api.services.profile, { companyId });
  const [seed, setSeed] = useState("");
  if (!data) return <Skeleton className="h-64 rounded-2xl" />;
  const area = profile?.context.serviceAreas.trim() ?? "";
  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-8">
      {data.canStart ? (
        <section aria-labelledby="research-ask" className="grid grid-cols-1 gap-5 pt-2">
          <div className="flex items-center gap-3">
            <span aria-hidden className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-brand-500/30 bg-card shadow-[0_12px_32px_-14px_rgba(104,56,239,0.8)]">
              <Search className="size-5 text-brand-300" />
            </span>
            <div className="min-w-0">
              <h2 id="research-ask" className="flex items-center gap-0.5 font-heading text-2xl tracking-tight text-strong">
                What do you want to find out?
                <InfoTip label="Research & Insights">Research answers one question: a new kind of service, an unfamiliar area, or where to position. It proposes; it never changes a price. If you already have reliable job data, you can skip it.</InfoTip>
              </h2>
              <p className="text-sm text-muted-foreground">Ask one question about prices, demand or your area. Selestial researches it and writes a brief.</p>
            </div>
          </div>
          <ResearchComposer seed={seed} defaultArea={area} />
          <ul aria-label="Ideas to start from" className="grid gap-2 sm:grid-cols-2">
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

      <section aria-labelledby="research-list" className="grid grid-cols-1 gap-2">
        <h2 id="research-list" className="font-heading text-base tracking-tight text-strong">
          Your research {data.briefs.length ? <span className="text-sm font-normal text-muted-foreground">· {data.briefs.length}</span> : null}
        </h2>
        {data.briefs.length === 0 ? <Empty title="No research yet">{data.canStart ? "Ask a question above when a decision needs it. Your own completed visits are always included, free." : "Briefs appear here once someone starts one."}</Empty> : null}
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
      </section>
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

const chip = "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500";

/**
 * The research box, built like Chat's composer: type a question and press Enter. The chips under it set
 * where to look, which service it is about, and whether to search the web (10 credits, charged only if
 * it finishes). The company's own completed visits are always included, free. Sources the person found
 * themselves are added from the + menu.
 */
function ResearchComposer({ seed, defaultArea }: { seed: string; defaultArea: string }) {
  const { companyId } = useCompany();
  const router = useRouter();
  const start = useMutation(api.servicesResearch.start);
  const catalog = useQuery(api.services.catalog, { companyId });
  const [text, setText] = useState(seed);
  const [area, setArea] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [web, setWeb] = useState(true);
  const [sources, setSources] = useState<OwnerSource[]>([]);
  const [menu, setMenu] = useState<"none" | "plus" | "service" | "area">("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const label = useId();
  const where = area ?? defaultArea;
  const service = catalog?.services.find((row) => row.id === serviceId) ?? null;

  // A picked idea fills the box; the person still sends it.
  const [seenSeed, setSeenSeed] = useState(seed);
  if (seed !== seenSeed) {
    setSeenSeed(seed);
    if (seed) setText(seed);
  }
  useEffect(() => {
    if (seed) box.current?.focus();
  }, [seed]);
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 220)}px`;
  }, [text]);

  const canSend = text.trim().length > 0 && !busy;
  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      const result = await start({ companyId, question: text.trim(), geography: where, web, sources: sources.filter((s) => s.title.trim()).map(toOwner), ...(serviceId ? { serviceId: serviceId as Id<"services"> } : {}) });
      router.push(briefPath(result.briefId));
    } catch (caught) {
      setError(messageOf(caught));
      setBusy(false);
    }
  };
  const close = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      setMenu("none");
    }
  };

  return (
    <div className="grid grid-cols-1 gap-3">
      <div>
        <form
          className="relative rounded-2xl border border-border bg-card p-2.5 shadow-[0_18px_50px_-30px_rgba(104,56,239,0.55)] transition-colors focus-within:border-brand-500/50"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-wrap items-center gap-1.5 px-1.5 pt-1 pb-1.5">
            <span className="text-[11px] text-muted-foreground">This research will use:</span>
            {where ? (
              <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-strong">
                <MapPin className="size-3 text-brand-300" aria-hidden /> {where}
                <button type="button" onClick={() => setArea("")} aria-label="Remove the area" className="ml-0.5 rounded text-muted-foreground hover:text-strong">
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ) : null}
            {service ? (
              <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-strong">
                <PriceTagIcon className="size-3 text-brand-300" aria-hidden /> {service.name}
                <button type="button" onClick={() => setServiceId("")} aria-label={`Not about ${service.name}`} className="ml-0.5 rounded text-muted-foreground hover:text-strong">
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ) : null}
            {sources.length ? (
              <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-strong">
                <Paperclip className="size-3 text-brand-300" aria-hidden /> {sources.length} source{sources.length === 1 ? "" : "s"} you found
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
              <Check className="size-3 text-success-foreground" aria-hidden /> Your completed visits · free
            </span>
          </div>
          <label htmlFor={label} className="sr-only">
            Ask a research question
          </label>
          <textarea
            id={label}
            ref={box}
            value={text}
            rows={3}
            maxLength={500}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="Ask a pricing or market question… for example, what do businesses near me charge for move-out cleans?"
            className="block w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-strong outline-none placeholder:text-muted-foreground/80"
          />
          <div className="flex flex-wrap items-center gap-1.5 px-0.5 pt-1">
            <div className="relative">
              <button type="button" onClick={() => setMenu((m) => (m === "none" ? "plus" : "none"))} aria-haspopup="menu" aria-expanded={menu === "plus" || menu === "service"} aria-label="Add a source or a service" className={cn(chip, "w-8 justify-center px-0", menu === "plus" || menu === "service" ? "border-brand-500/30 bg-brand-500/10 text-brand-300" : "border-border text-muted-foreground hover:text-strong")}>
                <Plus className="size-4" aria-hidden />
              </button>
              {menu === "plus" ? (
                <ul role="menu" aria-label="Add" onKeyDown={close} className="live-enter absolute top-full left-0 z-30 mt-2 grid w-64 gap-0.5 rounded-xl border border-border bg-card p-1 shadow-xl">
                  <li role="none">
                    <button
                      type="button"
                      role="menuitem"
                      autoFocus
                      onClick={() => {
                        setSources((list) => [...list, blankSource()]);
                        setMenu("none");
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-strong hover:bg-muted"
                    >
                      <Paperclip className="size-4 text-muted-foreground" aria-hidden />
                      <span className="flex-1">Add a source you found</span>
                    </button>
                  </li>
                  <li role="none">
                    <button type="button" role="menuitem" onClick={() => setMenu("service")} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-strong hover:bg-muted">
                      <PriceTagIcon className="size-4 text-muted-foreground" aria-hidden />
                      <span className="flex-1">About one of your services</span>
                    </button>
                  </li>
                </ul>
              ) : null}
              {menu === "service" ? (
                <ul role="listbox" aria-label="Your services" onKeyDown={close} className="live-enter absolute top-full left-0 z-30 mt-2 grid max-h-64 w-64 gap-0.5 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-xl">
                  {(catalog?.services ?? []).length === 0 ? <li className="px-2.5 py-2 text-xs text-muted-foreground">No services yet.</li> : null}
                  {(catalog?.services ?? []).map((row, i) => (
                    <li key={row.id} role="option" aria-selected={row.id === serviceId}>
                      <button
                        type="button"
                        autoFocus={i === 0}
                        onClick={() => {
                          setServiceId(row.id);
                          setMenu("none");
                          box.current?.focus();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-strong hover:bg-muted"
                      >
                        <span className="min-w-0 flex-1 truncate">{row.name}</span>
                        {row.id === serviceId ? <Check className="size-4 text-brand-300" aria-hidden /> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="relative">
              <button type="button" onClick={() => setMenu((m) => (m === "area" ? "none" : "area"))} aria-haspopup="dialog" aria-expanded={menu === "area"} className={cn(chip, menu === "area" ? "border-brand-500/30 bg-brand-500/10 text-brand-300" : "border-border text-muted-foreground hover:text-strong")}>
                <MapPin className="size-3.5" aria-hidden /> {where ? "Change area" : "Add an area"}
              </button>
              {menu === "area" ? (
                <div role="dialog" aria-label="Where to look" onKeyDown={close} className="live-enter absolute top-full left-0 z-30 mt-2 w-[min(18rem,calc(100vw-3rem))] rounded-xl border border-border bg-card p-2 shadow-xl">
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    Where to look
                    <input
                      autoFocus
                      value={where}
                      onChange={(event) => setArea(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          setMenu("none");
                          box.current?.focus();
                        }
                      }}
                      placeholder="Austin, TX (78701–78759)"
                      maxLength={200}
                      className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm text-strong outline-none focus-visible:border-brand-500/60"
                    />
                  </label>
                </div>
              ) : null}
            </div>
            <button type="button" aria-pressed={web} onClick={() => setWeb((on) => !on)} className={cn(chip, web ? "border-brand-500/30 bg-brand-500/10 text-brand-300" : "border-border text-muted-foreground hover:text-strong")}>
              <Globe className="size-3.5" aria-hidden /> {web ? "Web research · 10 credits" : "No web search · free"}
            </button>
            <div className="ml-auto">
              <button type="submit" disabled={!canSend} aria-label={web ? "Start research (10 credits)" : "Make the brief (free)"} className="inline-flex size-9 items-center justify-center rounded-full bg-gradient-to-b from-brand-400 via-brand-500 to-brand-700 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_20px_-10px_rgba(104,56,239,0.9)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-40 disabled:shadow-none">
                {busy ? <Spinner className="size-4" /> : <ArrowUp className="size-4" aria-hidden />}
              </button>
            </div>
          </div>
        </form>
        {error ? (
          <p role="alert" className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
            {error}
          </p>
        ) : null}
        <p className="mt-1.5 px-1 text-[11px] leading-relaxed text-muted-foreground">
          {web ? "Web research uses up to 5 searches and costs 10 Selestial Credits, charged only if it finishes." : "Without web research, the brief uses only your sources and your completed visits, free."} Research proposes; it never changes a price. {web ? <CreditIndicator /> : null}
        </p>
      </div>
      {sources.length ? (
        <div className="grid grid-cols-1 gap-2">
          <p className="text-sm font-medium text-strong">Sources you found</p>
          <SourceRows sources={sources} setSources={setSources} />
        </div>
      ) : null}
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
