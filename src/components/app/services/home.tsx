"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { ArrowRight, Settings2, Sparkles, TemplateIcon, Upload, Users } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
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
      {!catalog.setupDone && catalog.canPublish ? <SetupPrompt /> : null}
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

function SetupPrompt() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-500/25 bg-brand-500/[0.05] px-4 py-3">
      <div className="flex items-start gap-3">
        <Settings2 aria-hidden className="mt-0.5 size-5 text-brand-600" />
        <div>
          <p className="text-sm font-medium text-strong">Tell Selestial about your costs and where you work</p>
          <p className="text-sm text-muted-foreground">So each price can be checked against what a visit costs you, and research can look in the right place. &ldquo;I&apos;m not sure&rdquo; is a fine answer.</p>
        </div>
      </div>
      <Link href={`${SERVICES_ROOT}/setup`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
        Set up pricing
      </Link>
    </div>
  );
}

const STARTS = [
  { mode: "selestial", icon: Sparkles, title: "Help me build my services", body: "Tell Selestial about your business in a conversation. It asks a few questions at a time and writes structured drafts you review." },
  { mode: "template", icon: TemplateIcon, title: "Start with a template", body: "Choose a kind of cleaning and shape its scope and pricing. Templates give structure, not your local rates." },
  { mode: "import", icon: Upload, title: "Bring my existing pricing", body: "Upload a spreadsheet or paste your price list. You review every row before anything becomes a draft." },
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
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Each service ties its price to exactly what is included, so customers, your team and your margins all read from the same record. Pick how you&apos;d like to start.</p>
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
      {!catalog.setupDone && catalog.canPublish ? <SetupPrompt /> : null}
    </div>
  );
}
