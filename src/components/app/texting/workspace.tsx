"use client";

/**
 * "Set up business texting": six steps to get a cleaning company its own number and its texting
 * registration (A2P 10DLC), saved as the owner goes. Every entry point (onboarding, agent pages, settings)
 * opens this same saved setup on the step it was left on.
 *
 * Desktop: the steps on the left, the form in the middle, and Selestial's assistant on the right showing
 * only what it actually did and checked. Phone: one column, a compact progress bar, and the assistant
 * folded under the form.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError } from "@/components/app/form";
import { ArrowLeft, ArrowRight, Check, Lock, Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import { Assistant } from "./assistant";
import { SetupProvider, useSetup, type StepId, type View } from "./context";
import { ActivitiesStep } from "./step-activities";
import { BusinessStep } from "./step-business";
import { NumberStep } from "./step-number";
import { PermissionStep } from "./step-permission";
import { ProgressStep } from "./step-progress";
import { ReviewStep } from "./step-review";

export const STEPS: { id: StepId; label: string; short: string }[] = [
  { id: "business", label: "Your business", short: "Business" },
  { id: "activities", label: "What you'll send", short: "Texts" },
  { id: "permission", label: "Permission to text", short: "Permission" },
  { id: "number", label: "Your number", short: "Number" },
  { id: "review", label: "Review & submit", short: "Review" },
  { id: "progress", label: "Getting you ready", short: "Progress" },
];

export function stepDone(view: View, id: StepId): boolean {
  switch (id) {
    case "business":
      return view.issues.business.length === 0;
    case "activities":
      return view.issues.activities.length === 0;
    case "permission":
      return view.issues.permission.length === 0;
    case "number":
      return view.issues.number.length === 0;
    case "review":
      return view.request !== null && view.request.status !== "rejected" && view.request.status !== "cancelled";
    case "progress":
      return view.request?.status === "active";
  }
}

export function TextingWorkspace() {
  const { companyId, role } = useCompany();
  const open = useMutation(api.textingSetup.open);
  const view = useQuery(api.textingSetup.view, role === "owner" ? { companyId } : "skip");
  const [opened, setOpened] = useState<"idle" | "opening" | "failed">("idle");
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (role !== "owner" || view !== null || opened !== "idle") return;
    setOpened("opening");
    open({ companyId }).then(
      () => setOpened("idle"),
      () => setOpened("failed"),
    );
  }, [role, view, opened, open, companyId]);

  if (role !== "owner") {
    return <Message title="Texting setup is the Owner's" body="Your company's Owner sets up business texting, because it registers the business and authorizes its charges. You'll see texting turn on in your agents' pages when it's ready." />;
  }
  if (opened === "failed") return <Message title="Texting setup didn't open" body="Something went wrong opening your setup. Reload the page to try again." />;
  if (!view) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading your texting setup">
        <Skeleton className="h-16 w-full max-w-xl" />
        <div className="grid gap-4 xl:grid-cols-[11.5rem_minmax(0,1fr)_19rem]">
          <Skeleton className="hidden h-72 rounded-2xl xl:block" />
          <Skeleton className="h-[28rem] rounded-2xl" />
          <Skeleton className="hidden h-72 rounded-2xl xl:block" />
        </div>
      </div>
    );
  }
  const asked = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("step") : null;
  const initial = (STEPS.some((step) => step.id === asked) ? asked : view.setup.step) as StepId;
  return (
    <SetupProvider key={generation} view={view} companyId={companyId} initialStep={initial} onConflict={() => setGeneration((n) => n + 1)}>
      <TextingFrame />
    </SetupProvider>
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

export function TextingFrame() {
  const { view, step, go, saving, error, locked } = useSetup();
  const router = useRouter();
  const index = STEPS.findIndex((row) => row.id === step);
  const previous = STEPS[index - 1];
  const next = STEPS[index + 1];
  const reachable = (id: StepId) => id !== "progress" || view.request !== null;

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="font-heading text-2xl tracking-tight text-strong">Set up business texting</h1>
          <p className="mt-1 text-sm text-muted-foreground">Get a dedicated number for your cleaning company. Selestial helps prepare your registration and lets you know when your agents can start texting.</p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            US carriers ask every business that texts customers to register first. This is called A2P 10DLC (application-to-person texting on a regular 10-digit number). It shows carriers who you are and how people agree to your texts, so your messages are delivered instead of filtered.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {saving === "saving" ? "Saving…" : saving === "failed" ? "Not saved" : "Saved"}
          </p>
          <Button variant="outline" size="sm" onClick={() => router.push("/app")} className="hidden sm:inline-flex">
            Save and exit
          </Button>
        </div>
      </header>

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
            <button key={row.id} type="button" onClick={() => void go(row.id)} disabled={!reachable(row.id)} aria-current={row.id === step ? "step" : undefined} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50", row.id === step ? "border-brand-500 bg-brand-500/10 text-strong" : "border-border bg-card text-muted-foreground")}>
              {stepDone(view, row.id) ? "✓ " : ""}
              {row.short}
            </button>
          ))}
        </nav>
      </div>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[11.5rem_minmax(0,1fr)_19rem] 2xl:grid-cols-[13rem_minmax(0,1fr)_21rem]">
        <nav aria-label="Steps" className="sticky top-20 hidden xl:block">
          <ol className="grid gap-1">
            {STEPS.map((row, at) => {
              const current = row.id === step;
              const done = stepDone(view, row.id);
              return (
                <li key={row.id}>
                  <button type="button" onClick={() => void go(row.id)} disabled={!reachable(row.id)} aria-current={current ? "step" : undefined} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50", current ? "bg-brand-500/10 font-medium text-strong" : "text-muted-foreground hover:bg-muted")}>
                    <span className={cn("grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold", done ? "bg-success text-white" : current ? "bg-brand-500 text-white" : "bg-muted text-muted-foreground")} aria-hidden>
                      {done ? <Check className="size-3" /> : at + 1}
                    </span>
                    <span className="min-w-0">{row.label}</span>
                    <span className="sr-only">{done ? " (done)" : ""}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <main className="min-w-0">
          <div className="grid gap-5 rounded-2xl border border-border bg-card p-5 sm:p-7">
            {locked && step !== "progress" ? (
              <p className="flex gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
                <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  Your details are with Selestial review or the carriers, so they can&apos;t be changed right now. See <button type="button" className="font-medium text-brand-300 underline-offset-2 hover:underline" onClick={() => void go("progress")}>Getting you ready</button> for where things stand.
                </span>
              </p>
            ) : null}
            <fieldset disabled={locked && step !== "progress" && step !== "review"} className="grid min-w-0 gap-5">
              {step === "business" ? <BusinessStep /> : step === "activities" ? <ActivitiesStep /> : step === "permission" ? <PermissionStep /> : step === "number" ? <NumberStep /> : step === "review" ? <ReviewStep /> : <ProgressStep />}
            </fieldset>
            <FormError message={error} />
          </div>
          <details className="mt-4 rounded-2xl border border-border bg-card xl:hidden">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-semibold text-strong focus-visible:outline-2 focus-visible:outline-brand-500 [&::-webkit-details-marker]:hidden">
              <Sparkles className="size-4 text-brand-300" aria-hidden />
              Selestial&apos;s notes and preview
            </summary>
            <div className="border-t border-border p-4">
              <Assistant />
            </div>
          </details>
        </main>

        <aside className="sticky top-20 hidden xl:block" aria-label="Selestial's notes and preview">
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
          {next && reachable(next.id) ? (
            <Button variant="primary" size="lg" onClick={() => void go(next.id)} disabled={saving === "saving"}>
              Continue
              <ArrowRight aria-hidden />
            </Button>
          ) : step === "progress" ? (
            <Button variant="primary" size="lg" render={<Link href="/app" />}>
              Back to my workspace
            </Button>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
