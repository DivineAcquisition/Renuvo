"use client";

/**
 * One tutorial dialog for the whole workspace. Any screen opens it with `useTutorials().open(...)`, naming
 * the tutorial and the placement it was opened from; the dialog lives here, above the screen, so opening and
 * closing it never unmounts the form underneath and nothing typed or chosen is lost.
 *
 * Focus returns to the control that opened it, except when the owner picks "Upload": then focus moves to
 * the upload control the screen gave. No action here imports, approves or starts anything.
 */
import { useMutation, useQuery } from "convex/react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import { useCompany } from "@/components/app/company";
import { BookOpen, Check, ChevronDown, Download, ExternalLink, Flag, LifeBuoy, Upload } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import { PLATFORM_WORDS, tutorialById, type Placement, type Tutorial } from "../../../../convex/lib/tutorials/catalog";
import { TutorialPlayer, type PlayerEvent } from "./player";

export type PublishedTutorial = Tutorial & { reported: boolean };
type TrackKind = "opened" | "play_started" | "play_completed" | "steps_expanded" | "action_selected" | "play_failed" | "suggestion_dismissed";

type OpenOptions = {
  /** Called after the dialog closes when the owner picks the upload action: focus the screen's upload control here. */
  onUpload?: () => void;
};

type Tutorials = {
  /** Published tutorials, or undefined while loading. */
  published: PublishedTutorial[] | undefined;
  open: (tutorialId: string, placement: Placement, options?: OpenOptions) => void;
  track: (tutorialId: string, kind: TrackKind, placement: Placement) => void;
};

const TutorialsContext = createContext<Tutorials | null>(null);

export function useTutorials(): Tutorials {
  const value = useContext(TutorialsContext);
  if (!value) throw new Error("useTutorials needs a TutorialHost");
  return value;
}

export const SUPPORT_EMAIL = "support@selestial.io";

/** The support email, with the tutorial and screen it came from. Never the owner's records or answers. */
export function supportHref(tutorial: Pick<Tutorial, "id" | "title"> | null, placement: Placement): string {
  const subject = tutorial ? `Migration help: ${tutorial.title}` : "Migration help";
  const body = [`I need help moving my records into Selestial.`, "", tutorial ? `Tutorial: ${tutorial.id}` : null, `Screen: ${placement}`].filter((line) => line !== null).join("\n");
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function TutorialHost({ children }: { children: React.ReactNode }) {
  const { companyId } = useCompany();
  const published = useQuery(api.tutorials.published, { companyId }) as PublishedTutorial[] | undefined;
  const send = useMutation(api.tutorials.track);
  const [current, setCurrent] = useState<{ tutorialId: string; placement: Placement; options: OpenOptions } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const afterClose = useRef<(() => void) | null>(null);

  const track = useCallback(
    (tutorialId: string, kind: TrackKind, placement: Placement) => {
      // Measurement never gets in the owner's way: a failed event is dropped.
      void send({ companyId, tutorialId, kind, placement }).catch(() => undefined);
    },
    [companyId, send],
  );

  const open = useCallback(
    (tutorialId: string, placement: Placement, options: OpenOptions = {}) => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      afterClose.current = null;
      setCurrent({ tutorialId, placement, options });
      setIsOpen(true);
      track(tutorialId, "opened", placement);
    },
    [track],
  );

  const value = useMemo(() => ({ published, open, track }), [published, open, track]);
  const tutorial = current ? (published?.find((row) => row.id === current.tutorialId) ?? null) : null;

  return (
    <TutorialsContext.Provider value={value}>
      {children}
      <Dialog
        open={isOpen}
        onOpenChange={(next) => {
          if (!next) setIsOpen(false);
        }}
        onOpenChangeComplete={(next) => {
          if (next) return;
          const then = afterClose.current;
          afterClose.current = null;
          setCurrent(null);
          if (then) then();
        }}
      >
        <DialogPopup
          className="sm:max-w-3xl max-sm:max-h-[calc(100dvh-1rem)]"
          finalFocus={() => (afterClose.current ? false : (opener.current ?? true))}
          closeProps={{ "aria-label": "Close tutorial" }}
        >
          {current ? (
            tutorial ? (
              <TutorialBody
                tutorial={tutorial}
                placement={current.placement}
                track={track}
                onUpload={
                  current.options.onUpload
                    ? () => {
                        afterClose.current = current.options.onUpload ?? null;
                        setIsOpen(false);
                      }
                    : undefined
                }
              />
            ) : (
              <Unavailable tutorialId={current.tutorialId} placement={current.placement} />
            )
          ) : null}
        </DialogPopup>
      </Dialog>
    </TutorialsContext.Provider>
  );
}

/** Opened for a tutorial that is not published (or was unpublished meanwhile): say so and offer the way forward. */
function Unavailable({ tutorialId, placement }: { tutorialId: string; placement: Placement }) {
  const tutorial = tutorialById(tutorialId);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{tutorial?.title ?? "Tutorial"}</DialogTitle>
        <DialogDescription>This walkthrough isn&apos;t available right now.</DialogDescription>
      </DialogHeader>
      <DialogPanel className="grid gap-3 text-sm">
        {tutorial?.sources[0]?.url.startsWith("https://") ? (
          <a href={tutorial.sources[0].url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-brand-300 underline-offset-4 hover:underline">
            {tutorial.sources[0].title}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
        <a href={supportHref(tutorial ?? null, placement)} className="inline-flex items-center gap-1.5 font-medium text-strong underline-offset-4 hover:underline">
          <LifeBuoy className="size-4" aria-hidden />
          Get migration help
        </a>
      </DialogPanel>
    </>
  );
}

function Section({ title, defaultOpen = false, onOpen, children }: { title: string; defaultOpen?: boolean; onOpen?: () => void; children: React.ReactNode }) {
  return (
    <details
      className="group rounded-xl border border-border bg-muted/30 [&_summary::-webkit-details-marker]:hidden"
      open={defaultOpen}
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) onOpen?.();
      }}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium text-strong focus-visible:outline-2 focus-visible:outline-brand-500">
        {title}
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="px-3.5 pb-3.5 text-sm text-muted-foreground">{children}</div>
    </details>
  );
}

function TutorialBody({ tutorial, placement, track, onUpload }: { tutorial: PublishedTutorial; placement: Placement; track: Tutorials["track"]; onUpload?: () => void }) {
  const [stepsTracked, setStepsTracked] = useState(false);
  const onPlayer = useCallback((event: PlayerEvent) => track(tutorial.id, event, placement), [track, tutorial.id, placement]);
  const expanded = () => {
    if (stepsTracked) return;
    setStepsTracked(true);
    track(tutorial.id, "steps_expanded", placement);
  };
  const platform = tutorial.platform === "spreadsheet" ? null : PLATFORM_WORDS[tutorial.platform];

  return (
    <>
      <DialogHeader className="pr-12">
        <div className="flex flex-wrap items-center gap-1.5">
          {platform ? <Badge variant="outline">{platform}</Badge> : null}
          <Badge variant="outline">{tutorial.media ? `Video · ${Math.max(1, Math.round(tutorial.media.durationSeconds / 60))} min` : "Written guide"}</Badge>
        </div>
        <DialogTitle className="text-balance">{tutorial.title}</DialogTitle>
        <DialogDescription>{tutorial.purpose}</DialogDescription>
      </DialogHeader>
      <DialogPanel className="grid gap-4">
        {tutorial.reported ? (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm text-strong" role="status">
            Someone reported that {platform ?? "this screen"} may look different now. We&apos;re checking. If a step doesn&apos;t match, the written steps and migration help below still apply.
          </p>
        ) : null}

        {tutorial.media ? <TutorialPlayer media={tutorial.media} title={tutorial.title} onEvent={onPlayer} /> : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <ActionButton tutorial={tutorial} placement={placement} track={track} onUpload={onUpload} />
          {tutorial.action.kind !== "support" ? (
            <Button variant="ghost" render={<a href={supportHref(tutorial, placement)} />} onClick={() => track(tutorial.id, "action_selected", placement)}>
              <LifeBuoy aria-hidden />
              Get migration help
            </Button>
          ) : null}
        </div>

        <div className="grid gap-2">
          <Section title="Written steps" defaultOpen={!tutorial.media} onOpen={expanded}>
            <ol className="grid list-decimal gap-1.5 pl-5 text-strong marker:text-muted-foreground">
              {tutorial.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </Section>
          <Section title="Before you start" onOpen={expanded}>
            <ul className="grid list-disc gap-1 pl-5">
              {tutorial.prerequisites.map((item) => (
                <li key={item}>{item}</li>
              ))}
              <li>
                <span className="font-medium text-strong">Who can do this:</span> {tutorial.role}
              </li>
              {tutorial.plan ? (
                <li>
                  <span className="font-medium text-strong">Plans:</span> {tutorial.plan}
                </li>
              ) : null}
            </ul>
          </Section>
          <Section title="What you'll get and known limits" onOpen={expanded}>
            <p className="text-strong">{tutorial.format}</p>
            {tutorial.limitations.length ? (
              <ul className="mt-2 grid list-disc gap-1 pl-5">
                {tutorial.limitations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </Section>
          {tutorial.transcript ? (
            <Section title="Transcript" onOpen={expanded}>
              <div className="grid gap-2 whitespace-pre-line text-strong">{tutorial.transcript}</div>
            </Section>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Check className="size-3.5" aria-hidden />
            Last verified {formatDay(tutorial.interfaceVerifiedOn ?? tutorial.docsCheckedOn)}
            {tutorial.sources.filter((source) => source.url.startsWith("https://")).map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:text-strong hover:underline">
                · {source.title.replace(/^[^:]+: /, "")}
                <ExternalLink className="size-3" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ))}
          </span>
          <ReportChange tutorial={tutorial} placement={placement} />
        </footer>
      </DialogPanel>
    </>
  );
}

function ActionButton({ tutorial, placement, track, onUpload }: { tutorial: PublishedTutorial; placement: Placement; track: Tutorials["track"]; onUpload?: () => void }) {
  const action = tutorial.action;
  const picked = () => track(tutorial.id, "action_selected", placement);
  if (action.kind === "upload") {
    // Opened somewhere with no upload control (the help directory): send the owner to where the upload is.
    if (!onUpload) {
      const href = action.target === "team" ? "/app/cleaners/import" : "/app/setup?step=records";
      return (
        <Button variant="primary" render={<a href={href} />} onClick={picked}>
          <Upload aria-hidden />
          {action.target === "team" ? "Go to cleaner import" : "Go to imports"}
        </Button>
      );
    }
    return (
      <Button
        variant="primary"
        onClick={() => {
          picked();
          onUpload();
        }}
      >
        <Upload aria-hidden />
        {action.label}
      </Button>
    );
  }
  if (action.kind === "template")
    return (
      <Button variant="primary" render={<a href={action.href} download={action.filename} />} onClick={picked}>
        <Download aria-hidden />
        {action.label}
      </Button>
    );
  if (action.kind === "open")
    return (
      <Button variant="primary" render={<a href={action.href} />} onClick={picked}>
        <BookOpen aria-hidden />
        {action.label}
      </Button>
    );
  return (
    <Button variant="primary" render={<a href={supportHref(tutorial, placement)} />} onClick={picked}>
      <LifeBuoy aria-hidden />
      {action.label}
    </Button>
  );
}

function ReportChange({ tutorial, placement }: { tutorial: PublishedTutorial; placement: Placement }) {
  const { companyId } = useCompany();
  const report = useMutation(api.tutorials.reportOutdated);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  if (state === "sent")
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-strong">
        <Check className="size-3.5" aria-hidden />
        Thanks. We&apos;ll check this tutorial.
      </span>
    );
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-8 items-center gap-1.5 rounded-md underline-offset-4 hover:text-strong hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
        <Flag className="size-3.5" aria-hidden />
        Something looks different?
      </button>
    );
  return (
    <form
      className="grid w-full gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setState("sending");
        report({ companyId, tutorialId: tutorial.id, placement, note: note.trim() || undefined })
          .then(() => setState("sent"))
          .catch(() => setState("failed"));
      }}
    >
      <label htmlFor={`report-${tutorial.id}`} className="text-strong">
        What looked different? <span className="text-muted-foreground">(optional, don&apos;t include client details)</span>
      </label>
      <textarea id={`report-${tutorial.id}`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={2} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-strong focus-visible:outline-2 focus-visible:outline-brand-500" />
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={state === "sending"}>
          Send report
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {state === "failed" ? <p className={cn("text-destructive-foreground")} role="alert">That didn&apos;t send. Try again, or email {SUPPORT_EMAIL}.</p> : null}
    </form>
  );
}
