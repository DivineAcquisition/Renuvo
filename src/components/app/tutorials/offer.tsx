"use client";

/**
 * Where tutorials meet the migration: a card, a link or a small preview, each asking the catalog for the
 * tutorial that fits this placement and the owner's platform. Nothing opens by itself. A first-time card can
 * be dismissed; the link that reopens help stays.
 *
 * When the fitting tutorial is not published, the owner is told so plainly and given the platform's own
 * help article and migration help. When the platform has no export for the task at all, that is said too.
 */
import { useSyncExternalStore } from "react";

import { useCompany } from "@/components/app/company";
import { CircleHelp, ExternalLink, LifeBuoy, PlayCircle, X } from "@/components/icons";
import { SegmentedControl } from "@/components/ui/selection";
import { cn } from "@/lib/utils";

import { matches, NO_EXPORT, PLATFORM_WORDS, TUTORIALS, type Placement, type Platform, type Task } from "../../../../convex/lib/tutorials/catalog";
import { supportHref, useTutorials, type PublishedTutorial } from "./host";

/** The tutorial for this placement and platform, the best unpublished match, and any "no export" note. */
export function useOffer(placement: Placement, platform: Platform | null, task?: Task) {
  const { published } = useTutorials();
  const fits = (tutorial: (typeof TUTORIALS)[number]) => matches(tutorial, placement, platform) && (!task || tutorial.task === task);
  const ready = (published ?? []).filter(fits) as PublishedTutorial[];
  const pending = TUTORIALS.filter((tutorial) => fits(tutorial) && !ready.some((row) => row.id === tutorial.id));
  const taskOf = task ?? TUTORIALS.find((tutorial) => fits(tutorial))?.task;
  const noExport = platform && taskOf ? (NO_EXPORT[platform]?.[taskOf] ?? null) : null;
  return { loading: published === undefined, tutorial: ready[0] ?? null, pending: pending[0] ?? null, noExport };
}

// ── Dismissal, kept on this device per company ───────────────────────────────────────────────────

const listeners = new Set<() => void>();
const storageKey = (companyId: string, key: string) => `selestial:tutorial-dismissed:${companyId}:${key}`;

function useDismissed(key: string): [boolean, () => void] {
  const { companyId } = useCompany();
  const name = storageKey(companyId, key);
  const dismissed = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => {
      try {
        return window.localStorage.getItem(name) === "1";
      } catch {
        return false;
      }
    },
    () => false,
  );
  return [
    dismissed,
    () => {
      try {
        window.localStorage.setItem(name, "1");
      } catch {
        // Private mode: the card simply comes back next time.
      }
      listeners.forEach((listener) => listener());
    },
  ];
}

// ── The fallback when no tutorial is published ───────────────────────────────────────────────────

function Fallback({ placement, pending, noExport, compact = false }: { placement: Placement; platform?: Platform | null; pending: (typeof TUTORIALS)[number] | null; noExport: string | null; compact?: boolean }) {
  const source = pending?.sources.find((row) => row.url.startsWith("https://"));
  // Named only when the waiting tutorial is that system's own export, never for Selestial's general help.
  const words = pending && pending.platform !== "spreadsheet" ? PLATFORM_WORDS[pending.platform] : null;
  return (
    <div className={cn("grid gap-1.5 text-sm", compact ? "" : "rounded-xl border border-border bg-muted/30 px-3.5 py-3")}>
      <p className="text-strong">
        {noExport ?? (words ? `A Selestial walkthrough for ${words} isn't ready yet.` : "A walkthrough for this isn't ready yet.")}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {!noExport && source ? (
          <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-300 underline-offset-4 hover:underline">
            {words ? `${words}'s own instructions` : source.title}
            <ExternalLink className="size-3.5" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
        <a href={supportHref(pending, placement)} className="inline-flex items-center gap-1 font-medium text-strong underline-offset-4 hover:underline">
          <LifeBuoy className="size-3.5" aria-hidden />
          Get migration help
        </a>
      </div>
    </div>
  );
}

// ── Presentations ───────────────────────────────────────────────────────────────────────────────

/** "See how to export from Jobber": an inline card, dismissible when `dismissKey` is given. */
export function TutorialCard({ placement, platform, task, title, onUpload, dismissKey }: { placement: Placement; platform: Platform | null; task?: Task; title?: string; onUpload?: () => void; dismissKey?: string }) {
  const { open, track } = useTutorials();
  const offer = useOffer(placement, platform, task);
  const [dismissed, dismiss] = useDismissed(dismissKey ?? "");
  if (offer.loading) return null;
  if (!offer.tutorial) return <Fallback placement={placement} platform={platform} pending={offer.pending} noExport={offer.noExport} />;
  const tutorial = offer.tutorial;
  if (dismissKey && dismissed) return <TutorialLink placement={placement} platform={platform} task={task} onUpload={onUpload} />;
  const words = platform && platform !== "spreadsheet" ? PLATFORM_WORDS[platform] : null;
  return (
    <div className="relative flex items-start gap-3 rounded-xl border border-brand-500/25 bg-brand-500/5 px-3.5 py-3 text-sm">
      <PlayCircle className="mt-0.5 size-5 shrink-0 text-brand-300" aria-hidden />
      <div className="grid min-w-0 flex-1 gap-1 pr-6">
        <p className="font-medium text-strong">{title ?? (words ? `See how to export from ${words}` : tutorial.title)}</p>
        <p className="text-muted-foreground">{tutorial.purpose}</p>
        <button type="button" onClick={() => open(tutorial.id, placement, { onUpload })} className="justify-self-start rounded-md font-medium text-brand-300 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
          {tutorial.media ? `Watch the ${Math.max(1, Math.round(tutorial.media.durationSeconds / 60))}-minute walkthrough` : "Read the steps"}
        </button>
      </div>
      {dismissKey ? (
        <button
          type="button"
          onClick={() => {
            track(tutorial.id, "suggestion_dismissed", placement);
            dismiss();
          }}
          className="absolute top-2 right-2 grid size-8 place-items-center rounded-md text-muted-foreground hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500"
          aria-label="Hide this suggestion"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** "Where do I find this file?": a quiet link. Shows the fallback inline when nothing is published. */
export function TutorialLink({ placement, platform, task, label = "Where do I find this file?", onUpload }: { placement: Placement; platform: Platform | null; task?: Task; label?: string; onUpload?: () => void }) {
  const { open } = useTutorials();
  const offer = useOffer(placement, platform, task);
  if (offer.loading) return null;
  if (!offer.tutorial) return <Fallback compact placement={placement} platform={platform} pending={offer.pending} noExport={offer.noExport} />;
  const tutorial = offer.tutorial;
  return (
    <button type="button" onClick={() => open(tutorial.id, placement, { onUpload })} className="inline-flex min-h-8 items-center gap-1.5 justify-self-start rounded-md text-sm font-medium text-brand-300 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
      <CircleHelp className="size-4" aria-hidden />
      {label}
    </button>
  );
}

/** A small preview card beside empty upload guidance: poster, title and length. Nothing when none fits. */
export function TutorialPreview({ placement, platform, onUpload }: { placement: Placement; platform: Platform | null; onUpload?: () => void }) {
  const { open } = useTutorials();
  const offer = useOffer(placement, platform);
  if (!offer.tutorial) return null;
  const tutorial = offer.tutorial;
  return (
    <button type="button" onClick={() => open(tutorial.id, placement, { onUpload })} className="group flex w-full items-center gap-3 rounded-xl border border-border bg-card p-2 text-left text-sm hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500">
      <span className="relative grid aspect-video w-24 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
        {tutorial.media ? (
          // eslint-disable-next-line @next/next/no-img-element -- a remote poster, loaded lazily
          <img src={tutorial.media.poster} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
        ) : null}
        <PlayCircle className="relative size-6 text-white drop-shadow" aria-hidden />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="font-medium text-strong group-hover:text-brand-300">{tutorial.title}</span>
        <span className="text-xs text-muted-foreground">{tutorial.media ? `${Math.max(1, Math.round(tutorial.media.durationSeconds / 60))} min video` : "Written steps"}</span>
      </span>
    </button>
  );
}

// ── Where the owner's records are now ───────────────────────────────────────────────────────────

const SOURCE_CHOICES: { id: Platform; label: string }[] = [
  { id: "jobber", label: "Jobber" },
  { id: "housecall_pro", label: "Housecall Pro" },
  { id: "bookingkoala", label: "BookingKoala" },
  { id: "spreadsheet", label: "A spreadsheet" },
];

/** Remembered on this device per company, so it survives leaving and coming back to setup. */
export function useSource(): [Platform | null, (next: Platform) => void] {
  const { companyId } = useCompany();
  const name = `selestial:migration-source:${companyId}`;
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => {
      try {
        return window.localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const platform = SOURCE_CHOICES.some((choice) => choice.id === value) ? (value as Platform) : null;
  return [
    platform,
    (next) => {
      try {
        window.localStorage.setItem(name, next);
      } catch {
        // Kept for this visit only.
      }
      listeners.forEach((listener) => listener());
    },
  ];
}

export function SourcePicker({ value, onChange }: { value: Platform | null; onChange: (next: Platform) => void }) {
  return <SegmentedControl label="Where are your records now?" value={value} onChange={onChange} options={SOURCE_CHOICES} />;
}
