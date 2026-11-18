"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, TextArea, TextInput, useRun } from "@/components/app/form";
import { ArrowLeft, ArrowRight, Check, RollbackIcon, Sparkles } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import { BUILDER_STEPS, changePath, SERVICES_ROOT, stepOf, type BuilderStep } from "@/lib/app/services";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { checkSpec, priceSummary } from "../../../../convex/lib/services/engine";
import { CATEGORY_LABELS, type Spec } from "../../../../convex/lib/services/spec";
import { canonical, describeChanges, keptTemplateAmounts, type KeptAmount } from "../../../../convex/lib/services/store";
import { TEMPLATES } from "../../../../convex/lib/services/templates";
import { ServicePreview } from "./preview";
import { PropertyPrices } from "./property-prices";
import { ChangeBadge, day, Empty, Notice, SectionTitle, Toggle, when } from "./shared";
import { BasicsStep, ExtrasStep, PricingStep, ScopeStep, TeamStep, type StepProps } from "./steps";

type View = NonNullable<ReturnType<typeof useQuery<typeof api.services.service>>>;

/** One service: the guided builder for its draft, or its live version with its history. */
export function ServiceBuilder({ serviceId }: { serviceId: string }) {
  const { companyId } = useCompany();
  const view = useQuery(api.services.service, { companyId, serviceId: serviceId as Id<"services"> });
  const profile = useQuery(api.services.profile, { companyId });
  if (view === undefined) return <Skeleton className="h-[32rem] rounded-2xl" />;
  const main = view.draft && view.canDraft ? <DraftEditor key={`${view.service.id}`} view={view} costs={profile?.costs ?? null} canSeeCosts={view.canPublish} /> : <LiveService view={view} costs={profile?.costs ?? null} />;
  // A property's own price follows the live version, whether or not a draft is open.
  if (!view.live) return main;
  return (
    <div className="grid grid-cols-1 gap-5">
      {main}
      <PropertyPrices serviceId={view.service.id} spec={view.live.spec} />
    </div>
  );
}

// ── The draft editor ────────────────────────────────────────────────────────────────────────────────

type SaveState = { kind: "saved"; at: number } | { kind: "saving" } | { kind: "unsaved" } | { kind: "conflict"; by: string; at: number; revision: number } | { kind: "error"; message: string };

/**
 * Edits are applied here at once and saved after a short pause, naming the revision they started from.
 * If someone (a person, or Selestial in Chat) saved first, the save is refused and both versions are
 * kept: this screen's edits stay on screen until the person chooses. A newer draft from elsewhere is
 * adopted automatically only when this screen has nothing unsaved.
 */
function DraftEditor({ view, costs, canSeeCosts }: { view: View; costs: Parameters<typeof ServicePreview>[0]["costs"]; canSeeCosts: boolean }) {
  const { companyId } = useCompany();
  const draft = view.draft!;
  const save = useMutation(api.services.saveDraft);
  const [spec, setSpec] = useState<Spec>(draft.spec);
  const [base, setBase] = useState({ revision: draft.revision, spec: draft.spec });
  const [seen, setSeen] = useState(draft.revision);
  const [step, setStep] = useState<BuilderStep>(stepOf(draft.step));
  const [state, setState] = useState<SaveState>({ kind: "saved", at: draft.updatedAt });
  const [pane, setPane] = useState<"edit" | "preview">("edit");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ spec: draft.spec, step: stepOf(draft.step), revision: draft.revision });
  const dirty = canonical(spec) !== canonical(base.spec);

  // Someone else saved (Chat, another tab, a teammate). With nothing unsaved here, show theirs at once.
  if (draft.revision !== seen) {
    setSeen(draft.revision);
    if (!dirty) {
      setBase({ revision: draft.revision, spec: draft.spec });
      setSpec(draft.spec);
      setState({ kind: "saved", at: draft.updatedAt });
    }
  }
  useEffect(() => {
    latest.current = { ...latest.current, revision: base.revision };
  }, [base.revision]);

  const flush = useCallback(
    async (next: Spec, nextStep: BuilderStep, revision: number) => {
      setState({ kind: "saving" });
      try {
        const result = await save({ companyId, serviceId: view.service.id, expectedRevision: revision, spec: next, step: nextStep });
        if (!result.ok) setState({ kind: "conflict", by: result.conflict.by, at: result.conflict.at, revision: result.conflict.revision });
        else {
          latest.current = { ...latest.current, revision: result.revision };
          setBase({ revision: result.revision, spec: next });
          setState({ kind: "saved", at: Date.now() });
        }
      } catch (error) {
        setState({ kind: "error", message: (error as { data?: { message?: string } }).data?.message ?? "That could not be saved. Your edits are still here." });
      }
    },
    [companyId, save, view.service.id],
  );

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const stop = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [dirty]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /** Every edit lands on screen at once and is saved after a short pause, against the revision it started from. */
  const edit = (change: (current: Spec) => Spec) => {
    if (state.kind === "conflict") return;
    const next = change(latest.current.spec);
    latest.current = { ...latest.current, spec: next };
    setSpec(next);
    setState((s) => (s.kind === "error" || s.kind === "saving" ? s : { kind: "unsaved" }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(latest.current.spec, latest.current.step, latest.current.revision), 900);
  };
  const goTo = (next: BuilderStep) => {
    setStep(next);
    latest.current = { ...latest.current, step: next };
    if (timer.current) clearTimeout(timer.current);
    if (!dirty) void save({ companyId, serviceId: view.service.id, expectedRevision: base.revision, spec, step: next }).catch(() => undefined);
    else void flush(spec, next, base.revision);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const problems = useMemo(() => checkSpec(spec), [spec]);
  const blockers = problems.filter((p) => p.severity === "blocker");
  const template = useMemo(() => TEMPLATES.find((t) => t.id === view.service.templateId)?.spec ?? null, [view.service.templateId]);
  const kept = useMemo(() => (spec.illustrative && template ? keptTemplateAmounts(spec, template) : []), [spec, template]);
  const index = BUILDER_STEPS.findIndex((s) => s.id === step);
  const props: StepProps = { spec, edit, disabled: state.kind === "conflict" };

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href={SERVICES_ROOT} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-strong">
            <ArrowLeft aria-hidden className="size-4" /> All services
          </Link>
          <h2 className="mt-1 truncate font-heading text-xl tracking-tight text-strong">{spec.name || "New service"}</h2>
          <p className="text-sm text-muted-foreground">
            {CATEGORY_LABELS[spec.category]} · {priceSummary(spec)} · {view.live ? `editing a draft of live version ${view.live.version}` : "not live yet"}
            {draft.rollbackOf ? ` · rolling back to version ${draft.rollbackOf}` : ""}
          </p>
        </div>
        <SaveStatus state={state} />
      </div>

      {state.kind === "conflict" ? (
        <ConflictBanner
          by={state.by}
          at={state.at}
          onLoadLatest={() => {
            latest.current = { spec: draft.spec, step, revision: draft.revision };
            setSpec(draft.spec);
            setBase({ revision: draft.revision, spec: draft.spec });
            setState({ kind: "saved", at: draft.updatedAt });
          }}
          onKeepMine={() => {
            latest.current = { ...latest.current, revision: state.revision };
            void flush(spec, step, state.revision);
          }}
        />
      ) : null}
      {spec.illustrative ? (
        <Notice tone="warning" title="Illustrative amounts">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>{kept.length ? `${kept.length} price${kept.length === 1 ? " is" : "s are"} still the template's example.` : "Some amounts came from a template or an import."} Check them for your market before review.</span>
            {step !== "review" ? (
              <Button size="xs" variant="secondary" onClick={() => goTo("review")}>
                See which
              </Button>
            ) : null}
          </span>
        </Notice>
      ) : null}

      {/* On a phone: one column, with a switch between editing and the preview. */}
      <div role="tablist" aria-label="Builder view" className="flex rounded-lg border border-border bg-card p-1 lg:hidden">
        {(["edit", "preview"] as const).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={pane === p} onClick={() => setPane(p)} className={cn("flex-1 rounded-md py-1.5 text-sm", pane === p ? "bg-brand-500/10 font-medium text-strong" : "text-muted-foreground")}>
            {p === "edit" ? "Edit" : "Preview"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[10.5rem_minmax(0,1fr)_minmax(0,20rem)] xl:grid-cols-[11rem_minmax(0,1fr)_minmax(0,22rem)] 2xl:grid-cols-[12rem_minmax(0,1fr)_minmax(0,26rem)]">
        <nav aria-label="Builder steps" className={cn("lg:sticky lg:top-4 lg:self-start", pane === "preview" && "hidden lg:block")}>
          <div className="mb-2 grid grid-cols-1 gap-1.5 lg:hidden">
            <p className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Step {index + 1} of {BUILDER_STEPS.length} · <span className="font-medium text-strong">{BUILDER_STEPS[index].label}</span>
              </span>
              <span>{blockers.length ? `${blockers.length} to fix` : "Nothing to fix"}</span>
            </p>
            <div role="progressbar" aria-label="Builder progress" aria-valuemin={1} aria-valuemax={BUILDER_STEPS.length} aria-valuenow={index + 1} aria-valuetext={`Step ${index + 1} of ${BUILDER_STEPS.length}: ${BUILDER_STEPS[index].label}`} className="h-1.5 w-full rounded-full bg-brand-500/15">
              <span className="block h-full rounded-full bg-brand-500 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${((index + 1) / BUILDER_STEPS.length) * 100}%` }} />
            </div>
          </div>
          <ol className="flex gap-1 overflow-x-auto pb-1 lg:grid lg:gap-0.5 lg:overflow-visible">
            {BUILDER_STEPS.map((s, i) => {
              const issues = problems.filter((p) => p.severity === "blocker" && fieldStep(p.field) === s.id).length;
              const current = step === s.id;
              return (
                <li key={s.id} className="shrink-0">
                  <button type="button" aria-current={current ? "step" : undefined} onClick={() => goTo(s.id)} className={cn("relative flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-brand-500/40", current ? "bg-brand-500/[0.08] font-medium text-strong" : "text-muted-foreground hover:bg-overlay/[0.04] hover:text-strong")}>
                    <span aria-hidden className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs tabular-nums", current ? "bg-brand-500 text-white" : issues ? "bg-destructive/10 text-destructive-foreground ring-1 ring-destructive/30" : s.id === "review" ? "bg-muted text-strong" : "bg-success/10 text-success-foreground")}>
                      {current || issues || s.id === "review" ? i + 1 : <Check className="size-3.5" />}
                    </span>
                    <span className="whitespace-nowrap">{s.label}</span>
                    <span className="sr-only">{issues ? `, ${issues} to fix` : s.id === "review" ? "" : ", nothing to fix"}</span>
                    {issues ? (
                      <span aria-hidden className="ml-auto rounded-full bg-destructive/10 px-1.5 text-[11px] text-destructive-foreground">
                        {issues}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 hidden text-xs text-muted-foreground lg:block">{BUILDER_STEPS[index].blurb}</p>
          <AssistantCard serviceId={view.service.id} name={spec.name} />
        </nav>

        <section aria-label={BUILDER_STEPS[index].label} className={cn("min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-6", pane === "preview" && "hidden lg:block")}>
          {step === "basics" ? <BasicsStep {...props} /> : step === "scope" ? <ScopeStep {...props} /> : step === "pricing" ? <PricingStep {...props} /> : step === "team" ? <TeamStep {...props} /> : step === "extras" ? <ExtrasStep {...props} /> : <ReviewStep view={view} spec={spec} edit={edit} kept={kept} revision={base.revision} dirty={dirty} blockers={blockers.map((b) => ({ message: b.message, step: fieldStep(b.field) }))} warnings={problems.filter((p) => p.severity === "warning").map((p) => p.message)} goTo={goTo} />}
          <div className="mt-6 flex items-center justify-between gap-2 border-t border-border pt-4">
            <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => goTo(BUILDER_STEPS[index - 1].id)}>
              <ArrowLeft aria-hidden /> Back
            </Button>
            {index < BUILDER_STEPS.length - 1 ? (
              <Button variant="secondary" size="sm" onClick={() => goTo(BUILDER_STEPS[index + 1].id)}>
                Next: {BUILDER_STEPS[index + 1].label} <ArrowRight aria-hidden />
              </Button>
            ) : null}
          </div>
        </section>

        <aside aria-label="Preview" className={cn("min-w-0 lg:sticky lg:top-4 lg:self-start", pane === "edit" && "hidden lg:block")}>
          <ServicePreview spec={spec} costs={costs} canSeeCosts={canSeeCosts} />
        </aside>
      </div>
    </div>
  );
}

function fieldStep(field: string): BuilderStep {
  if (field === "name" || field === "summary") return "basics";
  if (field.startsWith("included") || field.startsWith("excluded")) return "scope";
  if (field.startsWith("pricing")) return "pricing";
  if (field.startsWith("requirements") || field.startsWith("str") || field.startsWith("team")) return "team";
  if (field.startsWith("addOns") || field.startsWith("modifiers")) return "extras";
  return "review";
}

function SaveStatus({ state }: { state: SaveState }) {
  const text = state.kind === "saving" ? "Saving…" : state.kind === "unsaved" ? "Unsaved changes" : state.kind === "saved" ? `Draft saved ${when(state.at)}` : state.kind === "conflict" ? "Not saved: a newer version exists" : "Not saved";
  return (
    <p role="status" aria-live="polite" className={cn("rounded-full border px-3 py-1 text-xs", state.kind === "saved" ? "border-border text-muted-foreground" : state.kind === "saving" || state.kind === "unsaved" ? "border-brand-500/30 text-strong" : "border-destructive/40 text-destructive-foreground")}>
      {text}
      {state.kind === "error" ? `: ${state.message}` : ""}
    </p>
  );
}

function ConflictBanner({ by, at, onLoadLatest, onKeepMine }: { by: string; at: number; onLoadLatest: () => void; onKeepMine: () => void }) {
  return (
    <div role="alert" className="grid grid-cols-1 gap-2 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 text-sm">
      <p className="font-medium text-strong">
        {by} saved this draft at {when(at)}, after you opened it.
      </p>
      <p className="text-muted-foreground">Nothing was overwritten. Your edits are still on screen. Load theirs to continue from it, or save yours over it on purpose.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onLoadLatest}>
          Load the latest (drop my edits)
        </Button>
        <Button size="sm" variant="ghost" onClick={onKeepMine}>
          Save my version over theirs
        </Button>
      </div>
    </div>
  );
}

/** Selestial in Chat, on this same draft. It edits through the same tools; this screen picks the change up. */
function AssistantCard({ serviceId, name }: { serviceId: string; name: string }) {
  const { companyId } = useCompany();
  const send = useMutation(api.chat.send);
  const [sent, setSent] = useState<string | null>(null);
  const { busy, run } = useRun();
  const ask = (text: string) =>
    run(async () => {
      const result = await send({ companyId, text: `${text}\n\nThe service is "${name || "this new service"}" (service id ${serviceId}) in Services & Pricing. Read it with read_service. Make changes with edit_service_draft only with amounts I give; ask me for any amount you'd need.`, clientKey: `builder-${serviceId}-${Date.now()}`, page: `${SERVICES_ROOT}/${serviceId}` });
      setSent(result.conversationId as string);
    });
  return (
    <div className="mt-4 hidden rounded-xl border border-brand-500/20 bg-brand-500/[0.04] p-3 lg:block">
      <p className="flex items-center gap-1.5 text-sm font-medium text-strong">
        <Sparkles aria-hidden className="size-4 text-brand-600" /> Selestial
      </p>
      <p className="mt-1 text-xs text-muted-foreground">Ask for help on this draft. Changes it makes appear here.</p>
      <div className="mt-2 grid gap-1">
        {["Suggest included tasks and exclusions", "Write the customer description", "Check my price against my costs"].map((prompt) => (
          <button key={prompt} type="button" disabled={busy} onClick={() => void ask(prompt)} className="rounded-lg border border-border bg-card px-2 py-1.5 text-left text-xs text-strong hover:border-brand-500/40 disabled:opacity-60">
            {prompt}
          </button>
        ))}
      </div>
      {sent ? (
        <Link href={`/app/chat/${sent}`} className="mt-2 inline-block text-xs font-medium text-brand-300 underline-offset-4 hover:underline dark:text-brand-300">
          Open the conversation
        </Link>
      ) : null}
    </div>
  );
}

// ── Review ──────────────────────────────────────────────────────────────────────────────────────────

function ReviewStep({ view, spec, edit, kept, revision, dirty, blockers, warnings, goTo }: { view: View; spec: Spec; edit: StepProps["edit"]; kept: KeptAmount[]; revision: number; dirty: boolean; blockers: { message: string; step: BuilderStep }[]; warnings: string[]; goTo: (step: BuilderStep) => void }) {
  const { companyId } = useCompany();
  const router = useRouter();
  const submit = useMutation(api.services.submit);
  const discard = useMutation(api.services.discardDraft);
  const { busy, error, run } = useRun();
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState({ required: false, note: "" });
  const [contracts, setContracts] = useState({ required: false, note: "" });
  const [startsOn, setStartsOn] = useState("");
  const changes = describeChanges(view.live?.spec ?? null, spec);
  const unconfirmed = spec.requirements.filter((r) => !r.confirmed);
  const onlyConfirmations = blockers.every((b) => b.step === "review" || /Confirm/.test(b.message));
  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionTitle title="Review" tip="Check what changes, confirm what only you can, and send it for review. Nothing is live until the Owner publishes it." />
      <div>
        <p className="text-sm font-medium text-strong">{view.live ? `What changes from live version ${view.live.version}` : "What this adds"}</p>
        <ul className="mt-1 grid gap-0.5 text-sm text-muted-foreground">
          {changes.length ? changes.map((c) => <li key={c}>• {c}</li>) : <li>Nothing yet: this draft matches the live version.</li>}
        </ul>
      </div>
      {spec.illustrative || unconfirmed.length ? (
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-warning/40 bg-warning/[0.07] p-4">
          <p className="text-sm font-medium text-strong">Only you can confirm these</p>
          {kept.length ? (
            <div className="grid grid-cols-1 gap-2">
              <p className="text-xs text-muted-foreground">Still the template&apos;s example prices:</p>
              <ul aria-label="Prices still from the template" className="grid grid-cols-1 gap-2">
                {(["pricing", "extras"] as const).map((group) => {
                  const items = kept.filter((k) => k.step === group);
                  if (!items.length) return null;
                  const label = BUILDER_STEPS.find((b) => b.id === group)?.label ?? group;
                  return (
                    <li key={group} className="rounded-lg border border-warning/30 bg-card p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {label} · {items.length}
                        </span>
                        <Button size="xs" variant="ghost" onClick={() => goTo(group)}>
                          Change in {label}
                        </Button>
                      </div>
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {items.map((k) => (
                          <li key={k.key} className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs text-strong">
                            {k.label} <span className="tabular-nums text-muted-foreground">{k.value}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {spec.illustrative ? <Toggle label={kept.length ? "These prices are right for my market" : "I've replaced or confirmed every amount for my market"} tip="Template and imported amounts are examples until you say otherwise. Confirming is recorded with this version." checked={false} onChange={(on) => on && edit((s) => ({ ...s, illustrative: false }))} /> : null}
          {unconfirmed.map((r) => (
            <Toggle key={r.id} label={`My company has: ${r.label}`} description="Confirm only what is true today. It is recorded with this version." checked={false} onChange={(on) => on && edit((s) => ({ ...s, requirements: s.requirements.map((x) => (x.id === r.id ? { ...x, confirmed: true } : x)) }))} />
          ))}
        </div>
      ) : null}
      {blockers.length ? (
        <div>
          <p className="text-sm font-medium text-strong">To fix before it can be reviewed</p>
          <ul className="mt-1 grid gap-1">
            {blockers.map((b, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.05] px-3 py-1.5 text-sm text-strong">
                {b.message}
                {b.step !== "review" ? (
                  <Button size="xs" variant="ghost" onClick={() => goTo(b.step)}>
                    Go to {BUILDER_STEPS.find((s) => s.id === b.step)?.label}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {warnings.length ? (
        <div>
          <p className="text-sm font-medium text-strong">Worth a look</p>
          <ul className="mt-1 grid gap-0.5 text-sm text-muted-foreground">
            {warnings.map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 rounded-xl border border-border p-4">
        <Field label="Why this change" hint="The reviewer reads this first.">
          <TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Our supply and labor costs went up this year." />
        </Field>
        <Toggle label="Customers need to be told" description="Booked visits keep their price either way. Use this when what customers see changes." checked={notice.required} onChange={(required) => setNotice({ ...notice, required })} />
        {notice.required ? <TextInput aria-label="What customers should be told" value={notice.note} onChange={(e) => setNotice({ ...notice, note: e.target.value })} placeholder="New price applies to bookings from March 1" /> : null}
        <Toggle label="Agreements need review" description="Signed agreements keep their terms until amended. Name the ones to look at." checked={contracts.required} onChange={(required) => setContracts({ ...contracts, required })} />
        {contracts.required ? <TextInput aria-label="Which agreements" value={contracts.note} onChange={(e) => setContracts({ ...contracts, note: e.target.value })} placeholder="Recurring service agreements" /> : null}
        <Field label="Takes effect" hint="Leave empty to take effect when published.">
          <TextInput type="date" value={startsOn} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            loading={busy}
            disabled={blockers.length > 0 || !reason.trim() || dirty || changes.length === 0}
            onClick={() =>
              void run(async () => {
                const effectiveAt = startsOn ? new Date(`${startsOn}T00:00:00`).getTime() : undefined;
                const { changeId } = await submit({ companyId, serviceId: view.service.id, expectedRevision: revision, reason, customerNotice: notice, contractReview: contracts, ...(effectiveAt && effectiveAt > Date.now() ? { effectiveAt } : {}) });
                router.push(changePath(changeId));
              })
            }
          >
            Submit for review
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(view.live ? "Throw away this draft? The live version is not affected." : "Throw away this draft? This service has never been live, so it will be removed.")) return;
              void run(async () => {
                const { removed } = await discard({ companyId, serviceId: view.service.id });
                router.push(removed ? SERVICES_ROOT : `${SERVICES_ROOT}/${view.service.id}`);
              });
            }}
          >
            Discard draft
          </Button>
        </div>
        {dirty ? <p className="text-xs text-muted-foreground">Saving your last edits…</p> : null}
        {!onlyConfirmations && blockers.length ? <p className="text-xs text-muted-foreground">Fix the items above first.</p> : null}
      </div>
    </div>
  );
}

// ── A live service ──────────────────────────────────────────────────────────────────────────────────

function LiveService({ view, costs }: { view: View; costs: Parameters<typeof ServicePreview>[0]["costs"] }) {
  const { companyId } = useCompany();
  const editLive = useMutation(api.services.editLive);
  const rollback = useMutation(api.services.startRollback);
  const archive = useMutation(api.services.requestArchive);
  const router = useRouter();
  const { busy, error, run } = useRun();
  if (!view.live) {
    return (
      <Empty title="Nothing to show yet" action={<Link href={SERVICES_ROOT} className={buttonVariants({ variant: "secondary", size: "sm" })}>All services</Link>}>
        This service has no live version{view.draft ? ", and its draft is open to Owners and Managers" : ""}.
      </Empty>
    );
  }
  const spec = view.live.spec;
  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={SERVICES_ROOT} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-strong">
            <ArrowLeft aria-hidden className="size-4" /> All services
          </Link>
          <h2 className="mt-1 font-heading text-xl tracking-tight text-strong">{spec.name}</h2>
          <p className="text-sm text-muted-foreground">
            {CATEGORY_LABELS[spec.category]} · live version {view.live.version}
            {view.service.publishedAt ? ` since ${day(view.service.publishedAt)}` : ""} · {view.service.status === "archived" ? "archived: new visits cannot use it" : "used for new quotes and visits"}
          </p>
        </div>
        {view.canDraft ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" loading={busy} onClick={() => void run(async () => editLive({ companyId, serviceId: view.service.id }))}>
              Edit this service
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt(view.service.status === "archived" ? "Why restore it?" : "Why stop offering it? Booked visits keep it.");
                if (!reason) return;
                void run(async () => {
                  const { changeId } = await archive({ companyId, serviceId: view.service.id, reason, restore: view.service.status === "archived" });
                  router.push(changePath(changeId));
                });
              }}
            >
              {view.service.status === "archived" ? "Ask to restore" : "Ask to archive"}
            </Button>
          </div>
        ) : null}
      </div>
      <FormError message={error} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="grid grid-cols-1 gap-5">
          <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            <SectionTitle title="Versions" tip="Every published version is kept exactly as it was. Rolling back writes a new version from an old one, so history is never rewritten." />
            <ol aria-label="Version history" className="relative grid grid-cols-1 gap-3 before:absolute before:top-2 before:bottom-2 before:left-[0.6875rem] before:w-px before:bg-border">
              {view.versions.map((v) => (
                <li key={v.version} className="relative flex items-start gap-3">
                  <span aria-hidden className={cn("relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums ring-4 ring-card", v.live ? "bg-brand-500 text-white" : "border border-border bg-card text-muted-foreground")}>
                    {v.version}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium text-strong">Version {v.version}</span>
                        {v.live ? (
                          <Badge variant="success" size="sm">
                            Live
                          </Badge>
                        ) : null}
                        {v.source === "rollback" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            <RollbackIcon aria-hidden className="size-3" /> from version {v.basedOn}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-sm text-muted-foreground">{v.summary}</p>
                      <p className="text-xs text-muted-foreground">
                        {when(v.createdAt)} · {v.by}
                        {v.source === "settings" ? " · moved from Settings" : v.source !== "rollback" && v.basedOn ? ` · based on version ${v.basedOn}` : ""}
                      </p>
                    </div>
                    {!v.live && view.canDraft ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`Start a draft from version ${v.version}? It goes through review like any change.`)) return;
                          void run(async () => rollback({ companyId, serviceId: view.service.id, version: v.version, replaceDraft: false }));
                        }}
                      >
                        <RollbackIcon aria-hidden /> Roll back to this
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>
          {view.changes.length ? (
            <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <SectionTitle title="Changes" />
              <ul className="grid grid-cols-1 gap-1.5">
                {view.changes.map((c) => (
                  <li key={c.id}>
                    <Link href={changePath(c.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-brand-500/40">
                      <span>
                        <span className="text-strong">{c.title}</span>
                        <span className="block text-xs text-muted-foreground">Submitted {when(c.submittedAt)}{c.publishedAt ? ` · live ${when(c.publishedAt)}` : ""}</span>
                      </span>
                      <ChangeBadge state={c.state} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <ServicePreview spec={spec} costs={costs} canSeeCosts={view.canPublish} />
      </div>
    </div>
  );
}
