"use client";

/**
 * The help directory: every published migration tutorial, searchable and filterable by system. Opening one
 * uses the same dialog as everywhere else. Unpublished tutorials are not listed; the platforms' own help
 * centers and migration help are offered beside the list instead.
 */
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/app/shell";
import { ExternalLink, LifeBuoy, PlayCircle, Search } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { PLATFORM_WORDS, TASK_WORDS, type Platform } from "../../../../convex/lib/tutorials/catalog";
import { supportHref, useTutorials } from "./host";

const FILTERS: { id: Platform | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "jobber", label: "Jobber" },
  { id: "housecall_pro", label: "Housecall Pro" },
  { id: "bookingkoala", label: "BookingKoala" },
  { id: "spreadsheet", label: "Spreadsheets & Selestial" },
];

const HELP_CENTERS = [
  { label: "Jobber Help Center", url: "https://help.getjobber.com/" },
  { label: "Housecall Pro Help Center", url: "https://help.housecallpro.com/" },
  { label: "BookingKoala Help Center", url: "https://help.bookingkoala.com/" },
];

export function TutorialDirectory() {
  const { published, open } = useTutorials();
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<Platform | "all">("all");
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return (published ?? []).filter((tutorial) => {
      if (platform !== "all" && tutorial.platform !== platform) return false;
      if (!words) return true;
      return [tutorial.title, tutorial.purpose, TASK_WORDS[tutorial.task], PLATFORM_WORDS[tutorial.platform], ...tutorial.steps].join(" ").toLowerCase().includes(words);
    });
  }, [published, query, platform]);

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-5">
      <PageHeader title="Moving your records" lead="Short walkthroughs for getting your records out of another system and into Selestial." />
      <div className="grid gap-3">
        <label className="relative block">
          <span className="sr-only">Search tutorials</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search, for example “recurring” or “Jobber clients”" className="h-11 w-full rounded-xl border border-border bg-card pr-3 pl-9 text-sm text-strong placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-brand-500" />
        </label>
        <div role="group" aria-label="System" className="flex flex-wrap gap-1.5">
          {FILTERS.map((filter) => (
            <button key={filter.id} type="button" aria-pressed={platform === filter.id} onClick={() => setPlatform(filter.id)} className={cn("min-h-9 rounded-full border px-3 text-sm focus-visible:outline-2 focus-visible:outline-brand-500", platform === filter.id ? "border-brand-500 bg-brand-500/10 font-medium text-strong" : "border-border text-muted-foreground hover:text-strong")}>
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {published === undefined ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : shown.length ? (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Tutorials">
          {shown.map((tutorial) => (
            <li key={tutorial.id}>
              <button type="button" onClick={() => open(tutorial.id, "help")} className="flex h-full w-full items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500">
                <PlayCircle className="mt-0.5 size-5 shrink-0 text-brand-300" aria-hidden />
                <span className="grid gap-1">
                  <span className="text-xs text-muted-foreground">
                    {tutorial.platform === "spreadsheet" ? "Selestial" : PLATFORM_WORDS[tutorial.platform]} · {TASK_WORDS[tutorial.task]}
                  </span>
                  <span className="font-medium text-strong">{tutorial.title}</span>
                  <span className="text-sm text-muted-foreground">{tutorial.purpose}</span>
                  <span className="text-xs text-muted-foreground">{tutorial.media ? `${Math.max(1, Math.round(tutorial.media.durationSeconds / 60))} min video` : "Written steps"}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground" role="status">
          {(published ?? []).length ? "No tutorial matches that. Try another word, or choose All." : "Walkthroughs are being checked against each system and will appear here once verified. Until then, each system's own help center and migration help are below."}
        </p>
      )}

      <section className="grid gap-2 rounded-2xl border border-border bg-card p-4 text-sm" aria-labelledby="more-help">
        <h2 id="more-help" className="font-semibold text-strong">
          Other help
        </h2>
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
          {HELP_CENTERS.map((center) => (
            <li key={center.url}>
              <a href={center.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-300 underline-offset-4 hover:underline">
                {center.label}
                <ExternalLink className="size-3.5" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
          ))}
          <li>
            <a href={supportHref(null, "help")} className="inline-flex items-center gap-1 font-medium text-strong underline-offset-4 hover:underline">
              <LifeBuoy className="size-3.5" aria-hidden />
              Get migration help
            </a>
          </li>
        </ul>
      </section>
    </div>
  );
}
