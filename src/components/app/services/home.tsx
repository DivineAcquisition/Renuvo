"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { ArrowRight, Check, Sparkles, TemplateIcon, Upload, Users } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SERVICES_ROOT, servicePath } from "@/lib/app/services";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import { CATEGORY_LABELS, METHOD_LABELS } from "../../../../convex/lib/services/spec";
import { ChangeBadge, Empty, Notice, when } from "./shared";

type Catalog = NonNullable<ReturnType<typeof useQuery<typeof api.services.catalog>>>;
type Row = Catalog["services"][number];

const FILTERS = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "drafts", label: "Drafts" },
  { id: "waiting", label: "Waiting for review" },
  { id: "archived", label: "Archived" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

const matches = (row: Row, filter: Filter) => (filter === "all" ? row.status !== "archived" : filter === "live" ? row.status === "active" : filter === "drafts" ? row.draft !== null : filter === "waiting" ? row.openChange !== null : row.status === "archived");

/** The catalog, or the three ways to begin when there is nothing in it yet. */
export function ServicesHome() {
  const { companyId } = useCompany();
  const catalog = useQuery(api.services.catalog, { companyId });
  const [filter, setFilter] = useState<Filter>("all");
  if (!catalog) return <Skeleton className="h-72 rounded-2xl" />;
  if (catalog.services.length === 0) return <FirstTime catalog={catalog} />;
  const shown = catalog.services.filter((row) => matches(row, filter));
  return (
    <div className="grid grid-cols-1 gap-5">
      <SetupChecklist catalog={catalog} />
      <div role="tablist" aria-label="Show" className="flex flex-wrap gap-1.5">
        {FILTERS.map((item) => {
          const count = catalog.services.filter((row) => matches(row, item.id)).length;
          return (
            <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} onClick={() => setFilter(item.id)} className={cn("rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-brand-500/40", filter === item.id ? "border-brand-500 bg-brand-500/[0.08] font-medium text-strong" : "border-border bg-card text-muted-foreground hover:text-strong")}>
              {item.label} <span className="tabular-nums text-muted-foreground">{count}</span>
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <Empty title="Nothing here">No service matches this view.</Empty>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((row) => (
            <li key={row.id}>
              <ServiceCard row={row} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ServiceCard({ row }: { row: Row }) {
  const live = row.live;
  return (
    <Link href={servicePath(row.id)} className="group flex h-full flex-col rounded-2xl border border-border bg-card p-4 transition-[border-color,box-shadow] hover:border-brand-500/40 hover:shadow-[0_10px_30px_-18px_rgba(104,56,239,0.5)] focus-visible:outline-2 focus-visible:outline-brand-500/50 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-300">{CATEGORY_LABELS[row.category]}</p>
          <h3 className="mt-0.5 truncate font-heading text-lg tracking-tight text-strong">{row.name}</h3>
        </div>
        {row.status === "archived" ? (
          <Badge variant="outline" size="sm">
            Archived
          </Badge>
        ) : live ? (
          <Badge variant="success" size="sm">
            Live · v{live.version}
          </Badge>
        ) : (
          <Badge variant="outline" size="sm">
            Not live yet
          </Badge>
        )}
      </div>
      <p className="mt-3 text-base font-semibold tabular-nums text-strong">{live?.summary ?? row.draft?.summary ?? "No price yet"}</p>
      {live ? <p className="text-xs text-muted-foreground">{METHOD_LABELS[live.method].label}</p> : null}
      {live?.description ? <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{live.description}</p> : null}
      {live ? (
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <li className="inline-flex items-center gap-1">
            <Users aria-hidden className="size-3.5" /> Crew of {live.crew}
          </li>
          <li>{live.included} included tasks</li>
          <li>{live.addOns} extras</li>
          {live.skills.length ? <li>Needs {live.skills.join(", ")}</li> : null}
        </ul>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {row.draft ? (
          <Badge variant={row.draft.blockers ? "warning" : "info"} size="sm">
            Draft · {row.draft.blockers ? `${row.draft.blockers} to fix` : "ready to submit"}
          </Badge>
        ) : null}
        {row.openChange ? <ChangeBadge state={row.openChange.state} /> : null}
        {row.draft?.illustrative ? (
          <Badge variant="warning" size="sm">
            Illustrative amounts
          </Badge>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-brand-300 group-hover:underline dark:text-brand-300">
          {row.draft ? "Continue" : "Open"} <ArrowRight aria-hidden className="size-4" />
        </span>
      </div>
      {row.draft ? <p className="mt-2 text-xs text-muted-foreground">Last edited {when(row.draft.updatedAt)} by {row.draft.by}</p> : null}
    </Link>
  );
}

/** Where a company is in getting its first service live, as four checkable steps and a ring. */
export function setupSteps(catalog: Catalog) {
  const anyLive = catalog.services.some((row) => row.live !== null);
  const anyWaiting = catalog.services.some((row) => row.openChange !== null);
  return [
    { id: "setup", label: "Tell Selestial your costs", detail: "And where you work. “I'm not sure” is fine.", done: catalog.setupDone, href: catalog.canPublish ? `${SERVICES_ROOT}/setup` : null },
    { id: "draft", label: "Draft a service", detail: "From a template, an import or Chat.", done: catalog.services.length > 0, href: `${SERVICES_ROOT}/new` },
    { id: "review", label: "Send it for review", detail: "From the builder's Review step.", done: anyWaiting || anyLive, href: null },
    { id: "live", label: "Publish it", detail: catalog.canPublish ? "Approve it under Changes." : "The Owner approves it.", done: anyLive, href: catalog.canPublish ? `${SERVICES_ROOT}/changes` : null },
  ];
}

function SetupChecklist({ catalog }: { catalog: Catalog }) {
  if (!catalog.canDraft) return null;
  const steps = setupSteps(catalog);
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const next = steps.find((s) => !s.done)!;
  const circumference = 2 * Math.PI * 16;
  return (
    <section aria-labelledby="getting-started" className="flex flex-col gap-4 rounded-2xl border border-brand-500/25 bg-brand-500/[0.04] p-4 sm:flex-row sm:items-center">
      <div className="flex items-center gap-3 sm:w-56 sm:shrink-0">
        <svg role="img" aria-label={`${done} of ${steps.length} done`} viewBox="0 0 40 40" className="size-12 shrink-0 -rotate-90">
          <circle cx="20" cy="20" r="16" fill="none" strokeWidth="4" className="stroke-brand-500/15" />
          <circle cx="20" cy="20" r="16" fill="none" strokeWidth="4" strokeLinecap="round" className="stroke-brand-500 transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - done / steps.length)} />
        </svg>
        <div>
          <h2 id="getting-started" className="text-sm font-semibold text-strong">
            Getting your first service live
          </h2>
          <p className="text-xs text-muted-foreground">
            {done} of {steps.length} done · next: {next.label.charAt(0).toLowerCase() + next.label.slice(1)}
          </p>
        </div>
      </div>
      <ol className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step) => {
          const body = (
            <>
              <span aria-hidden className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", step.done ? "bg-brand-500 text-white" : step === next ? "border-2 border-brand-500" : "border border-border")}>
                {step.done ? <Check className="size-3" /> : null}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-sm", step.done ? "text-muted-foreground line-through decoration-muted-foreground/50" : "font-medium text-strong")}>{step.label}</span>
                {!step.done ? <span className="block text-xs text-muted-foreground">{step.detail}</span> : null}
              </span>
              <span className="sr-only">{step.done ? ", done" : step === next ? ", next" : ""}</span>
            </>
          );
          return (
            <li key={step.id}>
              {step.href && !step.done ? (
                <Link href={step.href} className="flex h-full items-start gap-2 rounded-xl border border-transparent bg-card px-3 py-2 transition-colors hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500/50">
                  {body}
                </Link>
              ) : (
                <div className="flex h-full items-start gap-2 rounded-xl bg-card/60 px-3 py-2">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const STARTS = [
  { mode: "selestial", icon: Sparkles, title: "Help me build my services", body: "Answer a few questions in Chat. Selestial writes the drafts." },
  { mode: "template", icon: TemplateIcon, title: "Start with a template", body: "Pick a kind of cleaning. You set your own rates." },
  { mode: "import", icon: Upload, title: "Bring my existing pricing", body: "Upload or paste your price list. You check every row." },
] as const;

/** The first visit: three ways to begin, and setup. Nothing is live until the Owner publishes. */
function FirstTime({ catalog }: { catalog: Catalog }) {
  if (!catalog.canDraft) {
    return (
      <Empty title="No services yet">
        The Owner or a Manager adds the company&apos;s services here. Once one is published, you&apos;ll see its scope and price, and new visits can use it.
      </Empty>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-5">
      {catalog.legacyWaiting > 0 ? <Notice title="Moving your services from Settings">Your {catalog.legacyWaiting} service{catalog.legacyWaiting === 1 ? "" : "s"} from Settings will appear here once the Owner opens this page.</Notice> : null}
      <div className="rounded-2xl border border-border bg-gradient-to-b from-brand-500/[0.06] to-card px-5 py-6 sm:px-7">
        <h2 className="font-heading text-xl tracking-tight text-strong">Set up what you sell</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Pick how you&apos;d like to start. Nothing goes live until the Owner publishes it.</p>
        <ul className="mt-5 grid gap-3 md:grid-cols-3">
          {STARTS.map(({ mode, icon: Icon, title, body }) => (
            <li key={mode}>
              <Link href={`${SERVICES_ROOT}/new?mode=${mode}`} className="flex h-full flex-col rounded-2xl border border-border bg-card p-4 transition-[border-color,box-shadow] hover:border-brand-500/50 hover:shadow-[0_10px_30px_-18px_rgba(104,56,239,0.55)] focus-visible:outline-2 focus-visible:outline-brand-500/50">
                <span className="grid size-10 place-items-center rounded-xl bg-brand-500/10 text-brand-600">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span className="mt-3 text-base font-semibold text-strong">{title}</span>
                <span className="mt-1 text-sm text-muted-foreground">{body}</span>
                <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-medium text-brand-300">
                  Start <ArrowRight aria-hidden className="size-4" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">
          Or{" "}
          <Link href={`${SERVICES_ROOT}/new?mode=blank`} className="font-medium text-brand-300 underline-offset-4 hover:underline dark:text-brand-300">
            add a service by hand
          </Link>
          .
        </p>
      </div>
      <SetupChecklist catalog={catalog} />
    </div>
  );
}
