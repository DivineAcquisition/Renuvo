"use client";

/**
 * The Booking Experience Builder. Left: steps and settings. Center: the customer's page, drawn by the
 * same components as the live page, on a real test booking (prices from the engine, times from capacity,
 * nothing charged, nobody messaged). Right: the controls for what is selected.
 *
 * Edits are kept on screen and saved after a short pause. A save names the revision it started from; if
 * someone else (or Chat) saved meanwhile, the person chooses: load theirs, or save theirs over. Undo and
 * redo work within this visit.
 */
import { ArrowArcLeft, ArrowArcRight, ArrowLeft, ArrowSquareOut, ChartBar, CheckCircle, ClockCounterClockwise, Copy, DesktopTower, DeviceMobile, Eye, EyeSlash, Globe, ListChecks, Palette, Question, Rocket, ShareNetwork, Sparkle, Storefront, TextAa, Warning } from "@phosphor-icons/react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, messageOf, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { Notice } from "@/components/app/services/shared";
import { BookingSurface, useSessionActions } from "@/components/booking/renderer";
import { buttonVariants } from "@/components/ui/button-variants";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { STEP_LABELS, type Definition, type StepId } from "../../../../convex/lib/booking/definition";
import { signBookingAgreement } from "../../../app/b/actions";
import { Inspector, type BuilderData } from "./inspector";

const ROOT = "/app/agents/sales/booking-forms";
const STATUS_WORDS: Record<string, { label: string; variant: "success" | "outline" | "warning" | "info" }> = {
  published: { label: "Published", variant: "success" },
  draft: { label: "Draft", variant: "outline" },
  unpublished: { label: "Unpublished", variant: "warning" },
  archived: { label: "Archived", variant: "outline" },
};

type SaveState = { kind: "saved" } | { kind: "unsaved" } | { kind: "saving" } | { kind: "error"; message: string } | { kind: "conflict"; savedBy: string; savedAt: number; revision: number };

export function ExperienceBuilder({ experienceId }: { experienceId: Id<"bookingExperiences"> }) {
  const { companyId, role } = useCompany();
  const data = useQuery(api.bookingExperiences.get, { companyId, experienceId });
  const saveDraft = useMutation(api.bookingExperiences.saveDraft);
  // Local edits sit on top of the saved draft. With nothing unsaved here, a newer save from Chat or another
  // tab shows straight away; with unsaved edits, they win until saved (or the person chooses).
  const [edits, setEdits] = useState<{ draft: Definition; revision: number } | null>(null);
  const [past, setPast] = useState<Definition[]>([]);
  const [future, setFuture] = useState<Definition[]>([]);
  const [save, setSave] = useState<SaveState>({ kind: "saved" });
  const [selected, setSelected] = useState<string>("copy:location");
  const [showStep, setShowStep] = useState<{ step: StepId; n: number } | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [pane, setPane] = useState<"edit" | "preview">("edit");
  const [modal, setModal] = useState<null | "publish" | "history">(null);
  const canEdit = role === "owner" || role === "manager";
  const timer = useRef<number | null>(null);
  const latest = useRef<{ draft: Definition | null; revision: number }>({ draft: null, revision: 0 });
  const serverRevision = data?.experience.draftRevision ?? 0;
  const useLocal = edits !== null && (save.kind !== "saved" || edits.revision >= serverRevision);
  const draft: Definition | null = useLocal ? edits.draft : ((data?.draft as Definition | undefined) ?? null);
  const revision = useLocal ? edits.revision : serverRevision;
  const show = useCallback((step: StepId) => setShowStep((s) => ({ step, n: (s?.n ?? 0) + 1 })), []);

  const flush = useCallback(
    async (force = false) => {
      const current = latest.current;
      if (!current.draft) return;
      setSave({ kind: "saving" });
      try {
        const result = await saveDraft({ companyId, experienceId, expectedRevision: current.revision, definition: current.draft, force });
        if (!result.ok) {
          setSave({ kind: "conflict", savedBy: result.conflict.savedBy, savedAt: result.conflict.savedAt, revision: result.conflict.revision });
          return;
        }
        latest.current = { draft: current.draft, revision: result.revision };
        setEdits((e) => (e ? { draft: e.draft, revision: result.revision } : e));
        setSave((s) => (s.kind === "saving" ? { kind: "saved" } : s));
      } catch (error) {
        setSave({ kind: "error", message: messageOf(error) });
      }
    },
    [companyId, experienceId, saveDraft],
  );

  const commit = useCallback(
    (next: Definition, record = true) => {
      if (record && draft) {
        setPast((p) => [...p.slice(-49), draft]);
        setFuture([]);
      }
      const base = edits && (save.kind !== "saved" || edits.revision >= serverRevision) ? edits.revision : serverRevision;
      setEdits({ draft: next, revision: base });
      latest.current = { draft: next, revision: base };
      setSave({ kind: "unsaved" });
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 800);
    },
    [draft, edits, save.kind, serverRevision, flush],
  );

  const change = useCallback(
    (mutate: (d: Definition) => void) => {
      if (!draft || !canEdit) return;
      const next = structuredClone(draft);
      mutate(next);
      commit(next);
    },
    [draft, canEdit, commit],
  );

  const undo = useCallback(() => {
    if (!past.length || !draft) return;
    const previous = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [draft, ...f]);
    commit(previous, false);
  }, [past, draft, commit]);
  const redo = useCallback(() => {
    if (!future.length || !draft) return;
    const [nextDraft, ...rest] = future;
    setFuture(rest);
    setPast((p) => [...p, draft]);
    commit(nextDraft, false);
  }, [future, draft, commit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save.kind === "unsaved" || save.kind === "saving" || save.kind === "conflict" || save.kind === "error") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save.kind]);

  // A test booking of this draft, for the preview. It never charges, makes a visit or messages anyone.
  const startTest = useMutation(api.bookingExperiences.startTest);
  const [token, setToken] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const restartTest = useCallback(async () => {
    if (!canEdit) return null;
    try {
      const { token: fresh } = await startTest({ companyId, experienceId });
      setToken(fresh);
      show("location");
      setTestError(null);
      return fresh;
    } catch (error) {
      setTestError(messageOf(error));
      return null;
    }
  }, [canEdit, startTest, companyId, experienceId, show]);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !canEdit) return;
    started.current = true;
    // Starting the test booking talks to the server; the token arrives in its callback.
    const timerId = window.setTimeout(() => void restartTest(), 0);
    return () => window.clearTimeout(timerId);
  }, [restartTest, canEdit]);
  const view = useQuery(api.bookingSessions.view, token ? { token } : "skip");
  const server = useMemo(() => ({ start: async () => ({ ok: false as const, why: "Restart the test booking." }), sign: signBookingAgreement }), []);
  const actions = useSessionActions(token, server);

  const select = useCallback((id: string) => {
    setSelected(id);
    if (id.startsWith("copy:")) show(id.slice(5) as StepId);
    setPane("edit");
  }, [show]);

  if (data === undefined || draft === null) return <BuilderSkeleton />;
  const status = STATUS_WORDS[data.experience.status] ?? STATUS_WORDS.draft;
  const blockers = data.items.filter((i) => i.severity === "blocker");
  const warnings = data.items.filter((i) => i.severity === "warning");
  const liveView = view && !view.ended ? view : null;
  const builderData: BuilderData = {
    kind: data.experience.kind,
    services: data.services,
    settings: data.settings as BuilderData["settings"],
    inherited: data.inherited,
    canEdit,
    sizeCards: liveView?.size.area?.kind === "cards" ? [...liveView.size.area.cards.map((c) => ({ key: c.key, label: c.label })), ...(liveView.size.area.customQuoteFrom !== null ? [{ key: `area-${liveView.size.area.customQuoteFrom}-custom`, label: `${liveView.size.area.customQuoteFrom.toLocaleString()}+ (custom quote)` }] : [])] : [],
  };
  const company = liveView?.company ?? { name: data.settings.profile.displayName, phone: data.settings.profile.phone ?? null, email: data.settings.profile.email ?? null, website: data.settings.profile.website ?? null, logoUrl: data.settings.profile.logoUrl ?? null, brandColor: data.settings.profile.brandColor, accentColor: data.settings.profile.accentColor, timezone: data.inherited.timezone };

  return (
    <div className="grid gap-3">
      {/* Top bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={ROOT} aria-label="All booking experiences" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
            <ArrowLeft aria-hidden />
          </Link>
          <NameField key={data.experience.name} experienceId={experienceId} name={data.experience.name} disabled={!canEdit} />
          <Badge variant={status.variant}>{status.label}</Badge>
          {data.experience.publishedVersion ? <span className="hidden text-xs text-muted-foreground md:inline">v{data.experience.publishedVersion} live{data.experience.draftDiffers ? " · draft has changes" : ""}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <SaveStatus save={save} savedBy={data.experience.draftSavedBy} savedAt={data.experience.draftSavedAt} />
          <button type="button" onClick={undo} disabled={!past.length} aria-label="Undo" title="Undo (Ctrl+Z)" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
            <ArrowArcLeft aria-hidden />
          </button>
          <button type="button" onClick={redo} disabled={!future.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
            <ArrowArcRight aria-hidden />
          </button>
          <div role="radiogroup" aria-label="Preview size" className="hidden rounded-lg border border-border p-0.5 sm:flex">
            {(["desktop", "mobile"] as const).map((d) => (
              <button key={d} type="button" role="radio" aria-checked={device === d} aria-label={d === "desktop" ? "Desktop preview" : "Mobile preview"} onClick={() => setDevice(d)} className={cn("grid h-7 w-8 place-items-center rounded-md", device === d ? "bg-brand-500/10 text-strong" : "text-muted-foreground")}>
                {d === "desktop" ? <DesktopTower aria-hidden className="size-4" /> : <DeviceMobile aria-hidden className="size-4" />}
              </button>
            ))}
          </div>
          {canEdit ? (
            <button
              type="button"
              onClick={async () => {
                const fresh = await restartTest();
                if (fresh) window.open(`/b/resume#${fresh}`, "_blank", "noopener");
              }}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Sparkle aria-hidden /> Test booking
            </button>
          ) : null}
          <button type="button" onClick={() => setModal("history")} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ClockCounterClockwise aria-hidden /> History
          </button>
          {role === "owner" ? (
            <button type="button" onClick={() => setModal("publish")} disabled={save.kind === "saving"} className={buttonVariants({ variant: "primary", size: "sm" })}>
              <Rocket aria-hidden /> Publish{blockers.length ? ` (${blockers.length} to fix)` : ""}
            </button>
          ) : null}
        </div>
      </header>

      {save.kind === "conflict" ? (
        <Notice tone="warning" title={`${save.savedBy} saved this experience ${new Date(save.savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`}>
          Your edits are still on screen.
          <span className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => { setSave({ kind: "saved" }); setEdits(null); }}>
              Load their version
            </button>
            <button type="button" className={buttonVariants({ variant: "secondary", size: "sm" })} onClick={() => void flush(true)}>
              Save mine over theirs
            </button>
          </span>
        </Notice>
      ) : null}
      {save.kind === "error" ? <FormError message={`Not saved: ${save.message}`} /> : null}
      {!canEdit ? <Notice tone="info" title="View only">Managers and the Owner change booking experiences. You can look around.</Notice> : null}

      {/* Small screens: switch between editing and the preview. */}
      <div role="tablist" aria-label="Builder" className="flex gap-1 rounded-lg border border-border p-0.5 lg:hidden">
        {(["edit", "preview"] as const).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={pane === p} onClick={() => setPane(p)} className={cn("h-9 flex-1 rounded-md text-sm font-medium", pane === p ? "bg-brand-500/10 text-strong" : "text-muted-foreground")}>
            {p === "edit" ? "Edit" : "Preview"}
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)_340px]">
        {/* Left rail */}
        <nav aria-label="Steps and settings" className={cn("space-y-4 rounded-2xl border border-border bg-card p-3 lg:max-h-[calc(100vh-170px)] lg:overflow-y-auto", pane === "preview" && "max-lg:hidden")}>
          <RailGroup title="Steps">
            {draft.steps.map((step) => (
              <RailItem key={step.id} active={selected === `copy:${step.id}`} onClick={() => select(`copy:${step.id}`)} icon={<span className="grid size-5 place-items-center rounded-full border border-border text-[10px] tabular-nums">{draft.steps.indexOf(step) + 1}</span>} label={STEP_LABELS[step.id]} hint={step.sections.filter((s) => !s.hidden).length ? `${step.sections.filter((s) => !s.hidden).length} block${step.sections.filter((s) => !s.hidden).length === 1 ? "" : "s"}` : undefined} />
            ))}
          </RailGroup>
          <RailGroup title="Design & content">
            <RailItem active={selected === "theme"} onClick={() => select("theme")} icon={<Palette aria-hidden className="size-4" />} label="Brand & look" />
            <RailItem active={selected === "header"} onClick={() => select("header")} icon={<Globe aria-hidden className="size-4" />} label="Header" />
            <RailItem active={selected === "services"} onClick={() => { select("services"); show("service"); }} icon={<Storefront aria-hidden className="size-4" />} label="Services" hint={`${draft.services.offered.filter((o) => !o.hidden).length}`} />
            <RailItem active={selected === "sizes"} onClick={() => { select("sizes"); show("size"); }} icon={<TextAa aria-hidden className="size-4" />} label="Size step" />
            <RailItem active={selected === "questions"} onClick={() => { select("questions"); show("details"); }} icon={<Question aria-hidden className="size-4" />} label="Questions" hint={`${draft.behavior.questions.length}`} />
            <RailItem active={selected === "section:trust"} onClick={() => select("section:trust")} icon={<CheckCircle aria-hidden className="size-4" />} label="Trust statements" />
            <RailItem active={selected === "section:faq"} onClick={() => select("section:faq")} icon={<Question aria-hidden className="size-4" />} label="Questions & answers" />
            <RailItem active={selected === "section:next_steps"} onClick={() => select("section:next_steps")} icon={<ListChecks aria-hidden className="size-4" />} label="What happens next" />
            <RailItem active={selected === "content:outOfArea"} onClick={() => select("content:outOfArea")} icon={<Globe aria-hidden className="size-4" />} label="Outside the area" />
            <RailItem active={selected === "content:request"} onClick={() => select("content:request")} icon={<CheckCircle aria-hidden className="size-4" />} label="Request received" />
          </RailGroup>
          <RailGroup title="Booking">
            <RailItem active={selected === "behavior"} onClick={() => select("behavior")} icon={<Rocket aria-hidden className="size-4" />} label="Booking behavior" />
            <RailItem active={selected === "checklist"} onClick={() => select("checklist")} icon={blockers.length ? <Warning aria-hidden className="size-4 text-warning-foreground" /> : <CheckCircle aria-hidden className="size-4" />} label="Publish checklist" hint={blockers.length ? `${blockers.length} to fix` : warnings.length ? `${warnings.length} notes` : "Ready"} />
            <RailItem active={selected === "share"} onClick={() => select("share")} icon={<ShareNetwork aria-hidden className="size-4" />} label="Share & embed" />
            <RailItem active={selected === "results"} onClick={() => select("results")} icon={<ChartBar aria-hidden className="size-4" />} label="Results" />
          </RailGroup>
        </nav>

        {/* Preview */}
        <section aria-label="Customer preview" className={cn("min-w-0 rounded-2xl border border-border bg-muted/40 p-2", pane === "edit" && "max-lg:hidden")}>
          <div className="mb-2 flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Eye aria-hidden className="size-3.5" /> Test booking · nothing is charged or sent
            </span>
            <button type="button" onClick={() => void restartTest()} className="font-medium text-brand-300 hover:underline">
              Restart
            </button>
          </div>
          <div className={cn("mx-auto h-[calc(100vh-215px)] min-h-[560px] overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-white shadow-sm [transform:translateZ(0)]", device === "mobile" ? "max-w-[390px]" : "w-full")}>
            {testError ? (
              <div className="p-6">
                <Notice tone="warning" title="The preview couldn't start">{testError}</Notice>
              </div>
            ) : token && view === undefined ? (
              <div className="space-y-3 p-6" aria-busy="true">
                <div className="h-16 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
                <div className="h-64 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
              </div>
            ) : (
              <BookingSurface def={draft} company={company} heroUrl={data.heroUrl} token={token} view={liveView} actions={actions} preview editor={{ selected, onSelect: select }} showStep={showStep} className="min-h-full" />
            )}
          </div>
        </section>

        {/* Inspector */}
        <aside aria-label="Controls" className={cn("rounded-2xl border border-border bg-card p-4 lg:max-h-[calc(100vh-170px)] lg:overflow-y-auto", pane === "preview" && "max-lg:hidden")}>
          <fieldset disabled={!canEdit} className="min-w-0">
            {selected === "checklist" ? (
              <Checklist items={data.items} />
            ) : selected === "share" ? (
              <Share url={data.url} handle={data.settings.handle} status={data.experience.status} />
            ) : selected === "results" ? (
              <Results experienceId={experienceId} />
            ) : (
              <Inspector def={draft} change={change} data={builderData} selected={selected} />
            )}
          </fieldset>
        </aside>
      </div>

      <PublishModal open={modal === "publish"} onClose={() => setModal(null)} experienceId={experienceId} revision={revision} items={data.items} dirty={save.kind !== "saved"} status={data.experience.status} />
      <HistoryModal open={modal === "history"} onClose={() => setModal(null)} experienceId={experienceId} versions={data.versions} revision={revision} canPublish={role === "owner"} canDraft={canEdit} onRestored={() => { setSave({ kind: "saved" }); setEdits(null); }} />
    </div>
  );
}

function BuilderSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true">
      <div className="h-14 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
      <div className="grid gap-3 lg:grid-cols-[240px_1fr_340px]">
        <div className="h-[560px] animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
        <div className="h-[560px] animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
        <div className="h-[560px] animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
      </div>
    </div>
  );
}

function RailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function RailItem({ active, onClick, icon, label, hint }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint?: string }) {
  return (
    <li>
      <button type="button" onClick={onClick} aria-current={active ? "true" : undefined} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors", active ? "bg-brand-500/10 font-medium text-strong" : "text-muted-foreground hover:bg-muted hover:text-strong")}>
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {hint ? <span className="shrink-0 text-[11px] text-muted-foreground">{hint}</span> : null}
      </button>
    </li>
  );
}

function SaveStatus({ save, savedBy, savedAt }: { save: SaveState; savedBy: string; savedAt: number }) {
  const words = save.kind === "saving" ? "Saving…" : save.kind === "unsaved" ? "Unsaved changes" : save.kind === "conflict" ? "Not saved" : save.kind === "error" ? "Not saved" : `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${savedBy ? ` · ${savedBy}` : ""}`;
  return (
    <span role="status" aria-live="polite" className={cn("hidden max-w-[220px] truncate px-1 text-xs md:inline", save.kind === "conflict" || save.kind === "error" ? "text-destructive-foreground" : "text-muted-foreground")}>
      {words}
    </span>
  );
}

function NameField({ experienceId, name, disabled }: { experienceId: Id<"bookingExperiences">; name: string; disabled: boolean }) {
  const { companyId } = useCompany();
  const rename = useMutation(api.bookingExperiences.rename);
  const [value, setValue] = useState(name);
  return (
    <input
      aria-label="Experience name"
      value={value}
      disabled={disabled}
      maxLength={80}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value.trim() && value !== name && void rename({ companyId, experienceId, name: value }).catch(() => setValue(name))}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="min-w-0 max-w-[260px] rounded-md bg-transparent px-1.5 py-1 font-heading text-base font-medium tracking-tight text-strong outline-none hover:bg-muted focus:bg-muted focus-visible:outline-2 focus-visible:outline-brand-500/40"
    />
  );
}

function Checklist({ items }: { items: { severity: "blocker" | "warning"; message: string; link: { href: string; label: string } | null }[] }) {
  const blockers = items.filter((i) => i.severity === "blocker");
  const warnings = items.filter((i) => i.severity === "warning");
  return (
    <section className="space-y-4">
      <header>
        <h3 className="font-heading text-base tracking-tight text-strong">Publish checklist</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">Checked again on publish. Each fix lives where the rule lives.</p>
      </header>
      {blockers.length === 0 ? <Notice tone="success" title="Ready to publish">Nothing stops this experience from taking bookings.</Notice> : null}
      {[...blockers, ...warnings].map((item, i) => (
        <div key={i} className={cn("rounded-xl border px-3.5 py-3 text-sm", item.severity === "blocker" ? "border-destructive/35 bg-destructive/[0.05]" : "border-warning/40 bg-warning/10")}>
          <p className="flex items-start gap-2 text-strong">
            {item.severity === "blocker" ? <Warning aria-hidden className="mt-0.5 size-4 shrink-0" /> : <Eye aria-hidden className="mt-0.5 size-4 shrink-0" />}
            <span>
              <span className="sr-only">{item.severity === "blocker" ? "Must fix: " : "Note: "}</span>
              {item.message}
            </span>
          </p>
          {item.link ? (
            <Link href={item.link.href} className="mt-1.5 inline-flex items-center gap-1 pl-6 text-sm font-medium text-brand-300 hover:underline">
              {item.link.label} <ArrowSquareOut aria-hidden className="size-3.5" />
            </Link>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => undefined);
        setDone(true);
        window.setTimeout(() => setDone(false), 1500);
      }}
      className={buttonVariants({ variant: "outline", size: "xs" })}
    >
      <Copy aria-hidden /> {done ? "Copied" : label}
    </button>
  );
}

function Share({ url, handle, status }: { url: string | null; handle: string | null; status: string }) {
  if (!handle || !url) {
    return (
      <section className="space-y-3">
        <h3 className="font-heading text-base tracking-tight text-strong">Share & embed</h3>
        <Notice tone="warning" title="Choose a booking address first">Set your company&apos;s booking address in the booking rules.</Notice>
        <Link href={`${ROOT}?panel=rules`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Open booking rules
        </Link>
      </section>
    );
  }
  const button = `<a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#6838ef;color:#fff;font:600 15px system-ui,sans-serif;text-decoration:none">Book online</a>`;
  const frame = `<iframe src="${url}/embed" title="Book online" style="width:100%;max-width:440px;height:260px;border:0" loading="lazy"></iframe>`;
  return (
    <section className="space-y-4">
      <header>
        <h3 className="font-heading text-base tracking-tight text-strong">Share & embed</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{status === "published" ? "The page is live." : "These work once the page is published."}</p>
      </header>
      <Field label="Booking link">
        <TextInput readOnly value={url} onFocus={(e) => e.target.select()} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={url} label="Copy link" />
        {status === "published" ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "xs" })}>
            <ArrowSquareOut aria-hidden /> Open
          </a>
        ) : null}
      </div>
      <Field label="Button for your website" hint="A link styled as a button. Paste it into any page.">
        <textarea readOnly rows={4} value={button} className="block w-full rounded-lg border border-border bg-muted/40 p-2 font-mono text-[11px] text-strong" onFocus={(e) => e.target.select()} />
      </Field>
      <CopyButton value={button} label="Copy button" />
      <Field label="Embedded ZIP box" hint="A small form that opens the full booking page in a new tab. It holds no customer data.">
        <textarea readOnly rows={3} value={frame} className="block w-full rounded-lg border border-border bg-muted/40 p-2 font-mono text-[11px] text-strong" onFocus={(e) => e.target.select()} />
      </Field>
      <CopyButton value={frame} label="Copy embed" />
      <p className="text-xs text-muted-foreground">Add <code>?utm_source=…&amp;utm_campaign=…</code> to the link to see where bookings came from. Never put names or emails in a link.</p>
    </section>
  );
}

function Results({ experienceId }: { experienceId: Id<"bookingExperiences"> }) {
  const { companyId } = useCompany();
  const [days, setDays] = useState(30);
  const [test, setTest] = useState(false);
  const data = useQuery(api.bookingExperiences.analytics, { companyId, experienceId, days, test });
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-heading text-base tracking-tight text-strong">Results</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">From what customers actually did. {test ? "Test bookings only." : "Test bookings are left out."}</p>
        </div>
        <span className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={cn(buttonVariants({ variant: days === d ? "secondary" : "ghost", size: "xs" }))}>
              {d}d
            </button>
          ))}
        </span>
      </header>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" className="size-4 accent-[#6838ef]" checked={test} onChange={(e) => setTest(e.target.checked)} /> Show test bookings instead
      </label>
      {data === undefined ? (
        <div className="h-48 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      ) : data.started === 0 ? (
        <Notice tone="info" title="No bookings started yet">Results appear once customers start booking.</Notice>
      ) : (
        <>
          <ol className="space-y-2" aria-label="Where customers stopped">
            {[{ label: "Started", n: data.started }, ...data.steps.map((s) => ({ label: `Finished ${STEP_LABELS[s.step as StepId].toLowerCase()}`, n: s.completed })), { label: "Paid", n: data.paid }, { label: "Confirmed", n: data.confirmed }].map((row, i, all) => {
              const pct = data.started ? Math.round((row.n / data.started) * 100) : 0;
              const lost = i > 0 ? all[i - 1].n - row.n : 0;
              return (
                <li key={row.label}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-strong">{row.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {row.n} · {pct}%{lost > 0 ? ` · ${lost} stopped` : ""}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ol>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {[["Requests", data.requests], ["Signed", data.signed], ["Recovered", data.recovered], ["Booked value", `$${(data.revenueCents / 100).toLocaleString()}`]].map(([k, val]) => (
              <div key={String(k)} className="rounded-lg border border-border p-2.5">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="font-medium tabular-nums text-strong">{val}</dd>
              </div>
            ))}
          </dl>
          {data.sources.length ? (
            <div>
              <p className="mb-1.5 text-sm font-medium text-strong">Where they came from</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1 font-medium">Source</th>
                    <th className="py-1 text-right font-medium">Started</th>
                    <th className="py-1 text-right font-medium">Booked</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sources.map((s) => (
                    <tr key={s.source} className="border-t border-border">
                      <td className="py-1.5 text-strong">{s.source}</td>
                      <td className="py-1.5 text-right tabular-nums">{s.started}</td>
                      <td className="py-1.5 text-right tabular-nums">{s.confirmed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function PublishModal({ open, onClose, experienceId, revision, items, dirty, status }: { open: boolean; onClose: () => void; experienceId: Id<"bookingExperiences">; revision: number; items: { severity: string; message: string }[]; dirty: boolean; status: string }) {
  const { companyId } = useCompany();
  const publish = useMutation(api.bookingExperiences.publish);
  const unpublish = useMutation(api.bookingExperiences.unpublish);
  const archive = useMutation(api.bookingExperiences.archive);
  const { busy, error, run } = useRun();
  const [note, setNote] = useState("");
  const [done, setDone] = useState<number | null>(null);
  const router = useRouter();
  const blockers = items.filter((i) => i.severity === "blocker");
  return (
    <Modal open={open} onClose={onClose} title="Publish this experience" description="Customers see the published version. Bookings already under way keep their words; prices, times and rules are checked again for them.">
      <div className="space-y-4">
        {done ? <Notice tone="success" title={`Version ${done} is live.`}>New visitors see it now.</Notice> : null}
        {dirty ? <Notice tone="warning" title="Wait for your changes to save">The draft is still saving.</Notice> : null}
        {blockers.length ? (
          <Notice tone="critical" title={`${blockers.length} thing${blockers.length === 1 ? "" : "s"} to fix first`}>
            <ul className="list-disc pl-5">
              {blockers.map((b, i) => (
                <li key={i}>{b.message}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
        <Field label="What changed (optional)">
          <TextInput value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <FormError message={error} />
        <div className="flex flex-wrap justify-between gap-2">
          <span className="flex gap-2">
            {status === "published" ? (
              <button type="button" disabled={busy} onClick={() => void run(async () => { await unpublish({ companyId, experienceId }); onClose(); })} className={buttonVariants({ variant: "outline", size: "sm" })}>
                <EyeSlash aria-hidden /> Unpublish
              </button>
            ) : null}
            <button type="button" disabled={busy} onClick={() => void run(async () => { await archive({ companyId, experienceId, archived: status !== "archived" }); if (status !== "archived") router.push(ROOT); onClose(); })} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {status === "archived" ? "Restore" : "Archive"}
            </button>
          </span>
          <button type="button" disabled={busy || dirty || blockers.length > 0} onClick={() => void run(async () => { const r = await publish({ companyId, experienceId, expectedRevision: revision, note: note || undefined }); setDone(r.version); })} className={buttonVariants({ variant: "primary", size: "sm" })}>
            <Rocket aria-hidden /> {busy ? "Publishing…" : "Publish now"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function HistoryModal({ open, onClose, experienceId, versions, revision, canPublish, canDraft, onRestored }: { open: boolean; onClose: () => void; experienceId: Id<"bookingExperiences">; versions: { version: number; publishedAt: number; publishedBy: string; note: string | null; restoredFrom: number | null; current: boolean }[]; revision: number; canPublish: boolean; canDraft: boolean; onRestored: () => void }) {
  const { companyId } = useCompany();
  const rollback = useMutation(api.bookingExperiences.rollback);
  const restore = useMutation(api.bookingExperiences.restoreToDraft);
  const { busy, error, run } = useRun();
  return (
    <Modal open={open} onClose={onClose} title="Version history" description="Every published version is kept. Restoring publishes it again as a new version; payments, bookings and signed agreements are never touched.">
      <div className="space-y-3">
        {versions.length === 0 ? <p className="text-sm text-muted-foreground">Nothing has been published yet.</p> : null}
        <ol className="space-y-2">
          {versions.map((v) => (
            <li key={v.version} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-strong">
                  Version {v.version} {v.current ? <Badge variant="success" size="sm">Live</Badge> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(v.publishedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {v.publishedBy}
                </p>
              </div>
              {v.note ? <p className="mt-1 text-sm text-muted-foreground">{v.note}</p> : null}
              {!v.current ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {canDraft ? (
                    <button type="button" disabled={busy} onClick={() => void run(async () => { await restore({ companyId, experienceId, version: v.version, expectedRevision: revision }); onRestored(); onClose(); })} className={buttonVariants({ variant: "outline", size: "xs" })}>
                      Copy into the draft
                    </button>
                  ) : null}
                  {canPublish ? (
                    <button type="button" disabled={busy} onClick={() => void run(async () => { await rollback({ companyId, experienceId, version: v.version }); onClose(); })} className={buttonVariants({ variant: "secondary", size: "xs" })}>
                      Publish this again
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        <FormError message={error} />
      </div>
    </Modal>
  );
}
