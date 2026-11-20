"use client";

/**
 * "Bring your business to Selestial": six steps to move customers, properties and upcoming work in from
 * Jobber, Housecall Pro, BookingKoala, a spreadsheet or another system. Saved as the owner goes; every entry
 * point (onboarding, Settings, Customers, Home) opens this same migration on the step it was left on.
 *
 * Desktop: steps on the left, the work in the middle, Selestial's guide and findings on the right. Phone:
 * one column, a compact progress bar, and the guide folded under the work.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError } from "@/components/app/form";
import { ArrowLeft, ArrowRight, Check, Loader2, Lock, Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import { IMPORTABLE } from "../../../../convex/lib/migration/rules";
import { reachable, stepDone, STEPS } from "./steps";

const importable = (kind: string) => (IMPORTABLE as readonly string[]).includes(kind);
import { Assistant } from "./assistant";
import { MigrationProvider, useMigration, type StepId } from "./context";
import { FilesStep } from "./step-files";
import { ImportStep } from "./step-import";
import { OrganizeStep } from "./step-organize";
import { ReviewStep } from "./step-review";
import { SourceStep } from "./step-source";
import { VerifyStep } from "./step-verify";

export function MigrationWorkspace() {
  const { companyId, role } = useCompany();
  const allowed = role === "owner" || role === "manager";
  const open = useMutation(api.migration.open);
  const view = useQuery(api.migration.view, allowed ? { companyId } : "skip");
  const [failed, setFailed] = useState(false);
  const opening = useRef(false);
  const asked = useSearchParams().get("step");

  // The first visit makes the saved migration; every later visit, from any entry point, opens the same one.
  useEffect(() => {
    if (!allowed || view !== null || opening.current) return;
    opening.current = true;
    open({ companyId }).then(
      () => {
        opening.current = false;
      },
      () => setFailed(true),
    );
  }, [allowed, view, open, companyId]);

  if (!allowed) return <Message title="Your Owner or a Manager brings records in" body="Moving customers and schedules into Selestial changes company records, so Owners and Managers do it. You'll see the records here once they're imported." />;
  if (failed) return <Message title="Your migration didn't open" body="Something went wrong opening it. Reload the page to try again." />;
  if (!view) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading your migration">
        <Skeleton className="h-16 w-full max-w-xl" />
        <div className="grid gap-4 xl:grid-cols-[12rem_minmax(0,1fr)_20rem]">
          <Skeleton className="hidden h-72 rounded-2xl xl:block" />
          <Skeleton className="h-[30rem] rounded-2xl" />
          <Skeleton className="hidden h-72 rounded-2xl xl:block" />
        </div>
      </div>
    );
  }
  const initial = (STEPS.some((s) => s.id === asked) ? asked : view.migration.step) as StepId;
  return (
    <MigrationProvider view={view} companyId={companyId} initialStep={reachable(view, initial) ? initial : "source"}>
      <Frame />
    </MigrationProvider>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto grid max-w-lg gap-3 py-16 text-center">
      <h1 className="font-display text-2xl font-semibold text-strong">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function Frame() {
  const { view, step, go, busy, error, locked } = useMigration();
  const router = useRouter();
  const index = STEPS.findIndex((row) => row.id === step);
  const previous = STEPS[index - 1];
  const next = STEPS[index + 1];
  const checking = view.migration.checking;

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="font-heading text-2xl tracking-tight text-strong">Bring your business to Selestial</h1>
          <p className="mt-1 text-sm text-muted-foreground">Move your customers, team, and upcoming work into one place. We&apos;ll help organize your records and show you what needs attention before anything goes live.</p>
        </div>
        <div className="flex items-center gap-2">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
            {checking ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            {checking ? "Checking your records…" : busy ? "Saving…" : "Saved"}
          </p>
          <Button variant="outline" size="sm" onClick={() => router.push("/app")} className="hidden sm:inline-flex">
            Save and exit
          </Button>
        </div>
      </header>

      {view.inSupport ? (
        <p className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-strong">
          <Sparkles className="size-3.5 text-warning" aria-hidden />
          You&apos;re preparing this migration in a support session. Your changes are recorded as yours and shown to the company as Selestial Support. Leave questions on records you can&apos;t settle; the company&apos;s Owner or a Manager starts the import, and only the Owner releases it.
        </p>
      ) : view.migration.assisted.length ? (
        <p className="flex items-center gap-2 rounded-xl border border-brand-500/30 bg-brand-500/5 px-3 py-2 text-xs text-strong">
          <Sparkles className="size-3.5 text-brand-300" aria-hidden />
          Selestial Support is helping with this migration. Their changes are marked &ldquo;By Selestial Support&rdquo;, questions for you are under &ldquo;Questions for you&rdquo; in Review &amp; fix, and you start the import and release it.
        </p>
      ) : null}

      {/* Phone and tablet: compact progress. */}
      <div className="min-w-0 xl:hidden">
        <p className="mb-1 text-xs text-muted-foreground">
          Step {index + 1} of {STEPS.length} · {STEPS[index].label}
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={index + 1} aria-label={`Step ${index + 1} of ${STEPS.length}`}>
          <div className="h-full rounded-full bg-brand-500 transition-[width] motion-reduce:transition-none" style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
        </div>
        <nav aria-label="Steps" className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-1 pb-1">
          {STEPS.map((row) => (
            <button key={row.id} type="button" onClick={() => void go(row.id)} disabled={!reachable(view, row.id)} aria-current={row.id === step ? "step" : undefined} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50", row.id === step ? "border-brand-500 bg-brand-500/10 text-strong" : "border-border bg-card text-muted-foreground")}>
              {stepDone(view, row.id) ? "✓ " : ""}
              {row.short}
            </button>
          ))}
        </nav>
      </div>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[12rem_minmax(0,1fr)_20rem] 2xl:grid-cols-[13.5rem_minmax(0,1fr)_22rem]">
        <nav aria-label="Steps" className="sticky top-20 hidden xl:block">
          <ol className="grid gap-1">
            {STEPS.map((row, at) => {
              const current = row.id === step;
              const done = stepDone(view, row.id);
              return (
                <li key={row.id}>
                  <button type="button" onClick={() => void go(row.id)} disabled={!reachable(view, row.id)} aria-current={current ? "step" : undefined} className={cn("flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50", current ? "bg-brand-500/10 font-medium text-strong" : "text-muted-foreground hover:bg-muted")}>
                    <span className={cn("mt-px grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold", done ? "bg-success text-white" : current ? "bg-brand-500 text-white" : "bg-muted text-muted-foreground")} aria-hidden>
                      {done ? <Check className="size-3" /> : at + 1}
                    </span>
                    <span className="min-w-0">{row.label}</span>
                    <span className="sr-only">{done ? " (done)" : ""}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <Progress />
        </nav>

        <main className="min-w-0">
          <div className="grid min-w-0 gap-5 rounded-2xl border border-border bg-card p-5 sm:p-7 [&>*]:min-w-0">
            {locked && step !== "import" ? (
              <p className="flex gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
                <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  Your import is running in the background, so records can&apos;t be changed right now. You can leave this page; it keeps going. See{" "}
                  <button type="button" className="font-medium text-brand-300 underline-offset-2 hover:underline" onClick={() => void go("import")}>
                    Import
                  </button>{" "}
                  for progress.
                </span>
              </p>
            ) : null}
            {step === "source" ? <SourceStep /> : step === "files" ? <FilesStep /> : step === "organize" ? <OrganizeStep /> : step === "review" ? <ReviewStep /> : step === "import" ? <ImportStep /> : <VerifyStep />}
            <FormError message={error} />
          </div>
          <details className="mt-4 rounded-2xl border border-border bg-card xl:hidden">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-semibold text-strong focus-visible:outline-2 focus-visible:outline-brand-500 [&::-webkit-details-marker]:hidden">
              <Sparkles className="size-4 text-brand-300" aria-hidden />
              Selestial&apos;s guide and findings
            </summary>
            <div className="border-t border-border p-4">
              <Assistant />
            </div>
          </details>
        </main>

        <aside className="sticky top-20 hidden xl:block" aria-label="Selestial's guide and findings">
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-strong">
              <Sparkles className="size-4 text-brand-300" aria-hidden />
              Selestial
            </p>
            <Assistant />
          </div>
        </aside>
      </div>

      <footer className="sticky bottom-0 z-10 -mx-3 border-t border-border bg-card/95 backdrop-blur sm:-mx-6">
        <div className="flex flex-wrap items-center gap-2 px-3 py-3 sm:px-6">
          {previous ? (
            <Button variant="ghost" onClick={() => void go(previous.id)}>
              <ArrowLeft aria-hidden />
              Back
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button variant="outline" onClick={() => router.push("/app")} className="sm:hidden">
            Save and exit
          </Button>
          {next && step !== "review" && step !== "import" ? (
            <Button variant="primary" size="lg" onClick={() => void go(next.id)} disabled={!reachable(view, next.id) || (step === "source" && !view.migration.source)}>
              Continue
              <ArrowRight aria-hidden />
            </Button>
          ) : step === "review" ? (
            <Button variant="primary" size="lg" onClick={() => void go("import")}>
              Continue to import
              <ArrowRight aria-hidden />
            </Button>
          ) : step === "import" && view.run?.status === "done" ? (
            <Button variant="primary" size="lg" onClick={() => void go("verify")}>
              Verify the results
              <ArrowRight aria-hidden />
            </Button>
          ) : step === "verify" ? (
            <Button variant="primary" size="lg" render={<Link href="/app/clients" />}>
              Open Clients & Properties
            </Button>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

/** Real progress: records in the files, how many are ready, and how many are imported. */
function Progress() {
  const { view } = useMigration();
  const kinds = Object.entries(view.migration.summary).filter(([kind]) => importable(kind));
  const total = kinds.reduce((n, [, s]) => n + (s.total ?? 0), 0);
  if (!total) return null;
  const written = kinds.reduce((n, [, s]) => n + (s.written ?? 0), 0);
  const attention = kinds.reduce((n, [, s]) => n + (s.awaiting ?? 0) + (s.error ?? 0), 0);
  return (
    <div className="mt-5 grid gap-1.5 rounded-xl border border-border p-3 text-xs">
      <p className="font-semibold text-strong">{total.toLocaleString()} records in your files</p>
      <p className="text-muted-foreground">{attention ? `${attention.toLocaleString()} need your attention` : "Nothing needs your attention"}</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={written} aria-label="Records imported">
        <div className="h-full rounded-full bg-success transition-[width] motion-reduce:transition-none" style={{ width: `${(written / total) * 100}%` }} />
      </div>
      <p className="text-muted-foreground">{written.toLocaleString()} imported</p>
    </div>
  );
}
