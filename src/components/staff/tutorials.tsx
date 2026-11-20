"use client";

/**
 * Migration tutorials, for Selestial staff: each tutorial's state, verification and media version, open
 * reports that a workflow changed, and how tutorials are used. Content (steps, transcript, sources) is in
 * convex/lib/tutorials/catalog.ts and changes through review like code; what changes here needs no release.
 */
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { messageOf } from "@/components/app/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PLATFORM_WORDS, STATE_WORDS, STATES, type Media, type State } from "../../../convex/lib/tutorials/catalog";

type Row = NonNullable<ReturnType<typeof useQuery<typeof api.tutorials.staffList>>>[number];

const STATE_BADGE: Record<State, "outline" | "info" | "success" | "warning" | "secondary"> = {
  draft: "outline",
  ready_for_review: "info",
  published: "success",
  needs_update: "warning",
  retired: "secondary",
};

const EVENT_WORDS: Record<string, string> = {
  opened: "Opened",
  play_started: "Played",
  play_completed: "Watched to end",
  steps_expanded: "Read steps",
  action_selected: "Next step",
  play_failed: "Failed to play",
  reported_outdated: "Reported",
};

export function TutorialsAdmin() {
  const rows = useQuery(api.tutorials.staffList, {});
  return (
    <div className="grid gap-8">
      <section className="grid gap-4" aria-labelledby="tutorials-heading">
        <div>
          <h1 id="tutorials-heading" className="font-heading text-xl text-strong">
            Migration tutorials
          </h1>
          <p className="text-sm text-muted-foreground">Only Published tutorials are shown to owners. Publishing needs the steps followed in a real account; a video also needs its reviewed transcript.</p>
        </div>
        {!rows ? (
          <Skeleton className="h-96 rounded-2xl" />
        ) : (
          <ul className="grid gap-3">
            {rows.map((row) => (
              <TutorialRow key={row.id} row={row} />
            ))}
          </ul>
        )}
      </section>
      <Metrics />
    </div>
  );
}

function TutorialRow({ row }: { row: Row }) {
  const setState = useMutation(api.tutorials.setState);
  const setMedia = useMutation(api.tutorials.setMedia);
  const resolve = useMutation(api.tutorials.resolveReport);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [media, setDraft] = useState<Media>(row.media ?? { version: 1, video: "", poster: "", captions: "", durationSeconds: 90 });
  const run = (work: Promise<unknown>) => {
    setError(null);
    work.catch((caught) => setError(messageOf(caught)));
  };

  return (
    <li className="grid gap-3 rounded-2xl border border-border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-strong">{row.title}</span>
            <Badge variant={STATE_BADGE[row.state]}>{STATE_WORDS[row.state]}</Badge>
            {row.reports.length ? <Badge variant="warning">{row.reports.length} reported changed</Badge> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            <code>{row.id}</code> · {PLATFORM_WORDS[row.platform]} · content v{row.contentVersion} · docs checked {row.docsCheckedOn} · interface {row.interfaceVerifiedOn ? `verified ${row.interfaceVerifiedOn}` : "not verified"} · transcript {row.hasTranscript ? "reviewed" : "missing"} · media {row.media ? `v${row.media.version}${row.mediaOverridden ? " (set here)" : ""}` : "none"}
          </p>
          <p className="flex flex-wrap gap-x-3 text-xs">
            {row.sources.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="text-brand-300 underline-offset-4 hover:underline">
                {source.title}
              </a>
            ))}
          </p>
          {row.note ? <p className="text-xs text-muted-foreground">Note: {row.note}{row.updatedBy ? ` (${row.updatedBy})` : ""}</p> : null}
        </div>
        <label className="grid gap-1 text-xs text-muted-foreground">
          State
          <select
            value={row.state}
            onChange={(event) => run(setState({ tutorialId: row.id, state: event.target.value as State }))}
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-strong"
          >
            {STATES.map((state) => (
              <option key={state} value={state}>
                {STATE_WORDS[state]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {row.reports.length ? (
        <ul className="grid gap-1.5 rounded-xl bg-amber-500/5 p-3" aria-label="Reports">
          {row.reports.map((report) => (
            <li key={report.id} className="flex flex-wrap items-center gap-2">
              <span className="flex-1 text-strong">
                {new Date(report.at).toLocaleDateString()} {report.mediaVersion ? `(media v${report.mediaVersion})` : ""}: {report.note ?? "No note."}
              </span>
              <Button size="xs" variant="outline" onClick={() => run(setState({ tutorialId: row.id, state: "needs_update", note: "Reported as changed; written fallback shown until reviewed." }))}>
                Mark needs update
              </Button>
              <Button size="xs" variant="ghost" onClick={() => run(resolve({ reportId: report.id as Id<"tutorialReports"> }))}>
                Reviewed
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {editing ? (
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(setMedia({ tutorialId: row.id, media }).then(() => setEditing(false)));
          }}
        >
          {(["video", "poster", "captions"] as const).map((key) => (
            <label key={key} className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
              {key === "video" ? "Video (MP4)" : key === "poster" ? "Poster (JPG)" : "Captions (WebVTT)"}
              <input value={media[key]} onChange={(event) => setDraft({ ...media, [key]: event.target.value })} required className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-strong" />
            </label>
          ))}
          <label className="grid gap-1 text-xs text-muted-foreground">
            Version
            <input type="number" min={1} value={media.version} onChange={(event) => setDraft({ ...media, version: Number(event.target.value) })} className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-strong" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Duration (seconds)
            <input type="number" min={1} max={600} step={0.1} value={media.durationSeconds} onChange={(event) => setDraft({ ...media, durationSeconds: Number(event.target.value) })} className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-strong" />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" type="submit">
              Save media version
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="xs" variant="outline" onClick={() => setEditing(true)}>
            {row.media ? "Replace media version" : "Add media"}
          </Button>
          {row.mediaOverridden ? (
            <Button size="xs" variant="ghost" onClick={() => run(setMedia({ tutorialId: row.id, media: null }))}>
              Use the release&apos;s media
            </Button>
          ) : null}
          {row.media ? (
            <a href={row.media.video} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center text-xs text-brand-300 underline-offset-4 hover:underline">
              Open current video
            </a>
          ) : null}
        </div>
      )}
      {error ? (
        <p className="text-sm text-destructive-foreground" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

const WINDOWS = [7, 30, 90] as const;

function Metrics() {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const metrics = useQuery(api.tutorials.metrics, { days });
  return (
    <section className="grid gap-4" aria-labelledby="tutorial-metrics">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="tutorial-metrics" className="font-heading text-lg text-strong">
            Use
          </h2>
          <p className="text-sm text-muted-foreground">Counts only. A finished video is not evidence that anyone exported anything.</p>
        </div>
        <div className="flex gap-1" role="group" aria-label="Window">
          {WINDOWS.map((value) => (
            <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)} className={days === value ? "rounded-lg bg-brand-500/10 px-3 py-1.5 text-sm font-semibold text-brand-700" : "rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:text-strong"}>
              {value} days
            </button>
          ))}
        </div>
      </div>
      {!metrics ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">Tutorial events in the last {metrics.days} days</caption>
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 font-medium">
                    Tutorial
                  </th>
                  {Object.keys(EVENT_WORDS).map((kind) => (
                    <th key={kind} scope="col" className="py-2 text-right font-medium">
                      {EVENT_WORDS[kind]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {metrics.tutorials.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" className="py-2 text-left font-medium text-strong">
                      {row.title}
                    </th>
                    {Object.keys(EVENT_WORDS).map((kind) => (
                      <td key={kind} className="py-2 text-right tabular-nums">
                        {row.counts[kind] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-2 rounded-2xl border border-border bg-card p-4 text-sm">
            <p className="font-medium text-strong">Setups started in the window</p>
            {(["openedTutorial", "didNot"] as const).map((key) => {
              const group = metrics.comparison[key];
              const share = (n: number) => (group.companies ? `${Math.round((n / group.companies) * 100)}%` : "—");
              return (
                <p key={key} className="text-muted-foreground">
                  <span className="text-strong">{key === "openedTutorial" ? "Opened a tutorial" : "Did not"}:</span> {group.companies} companies · imported clients {share(group.importedClients)} · entered the workspace {share(group.enteredWorkspace)}
                </p>
              );
            })}
            <p className="text-xs text-muted-foreground">Owners who look for help differ from those who don&apos;t in other ways too. Read this as a comparison, not as what tutorials caused.</p>
          </div>
        </>
      )}
    </section>
  );
}
