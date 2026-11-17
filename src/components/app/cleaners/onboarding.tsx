"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { AgreementsForRecord } from "@/components/app/agreements/record";
import { Submit } from "@/components/app/cleaners/forms";
import { plural, type Profile } from "@/components/app/cleaners/shared";
import { canManage, useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { useNow } from "@/components/app/use-now";
import { CheckCircle2, CircleDashed, Copy, DeviceMobileIcon, FileText, Lock, PaperPlaneIcon, Plus, Trash2, TriangleAlert, Upload, XCircle } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { localDate, zonedInstant } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type Kind = "document" | "acknowledgment" | "agreement" | "payment_setup" | "training" | "equipment" | "custom";
type Blocks = "assignments" | "payment" | "info";
type Engagement = "employee" | "contractor" | "subcontracted";

export const KIND_WORDS: Record<Kind, string> = {
  document: "Document to upload",
  acknowledgment: "Statement to agree to",
  agreement: "Signed agreement",
  payment_setup: "Payment setup",
  training: "Training",
  equipment: "Equipment or supplies",
  custom: "Other step",
};
export const BLOCK_WORDS: Record<Blocks, string> = { assignments: "Blocks work", payment: "Blocks pay", info: "Good to know" };
const TYPE_SHORT: Record<Engagement, string> = { employee: "Employees", contractor: "Contractors", subcontracted: "Subcontractor workers" };

const STATE_LOOK: Record<string, { label: string; variant: "success" | "info" | "warning" | "outline" | "error" }> = {
  not_started: { label: "Not started", variant: "outline" },
  submitted: { label: "Started", variant: "info" },
  awaiting_review: { label: "Awaiting review", variant: "warning" },
  accepted: { label: "Accepted", variant: "success" },
  needs_changes: { label: "Needs changes", variant: "error" },
  expired: { label: "Expired", variant: "error" },
};

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// ── The company's requirements ──────────────────────────────────────────────────────────────────

type Draft = { label: string; instructions: string; kind: Kind; appliesTo: Engagement[]; blocks: Blocks; needsReview: boolean; reviewBy: "manager" | "owner"; validMonths: string; statement: string; ownerOnly: boolean };
const EMPTY: Draft = { label: "", instructions: "", kind: "document", appliesTo: ["contractor", "employee"], blocks: "assignments", needsReview: true, reviewBy: "manager", validMonths: "", statement: "", ownerOnly: false };

function RequirementForm({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const { companyId } = useCompany();
  const create = useMutation(api.requirements.create);
  const { busy, error, run } = useRun();
  const [draft, setDraft] = useState(initial);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const reviewForced = draft.kind === "document" || draft.kind === "payment_setup";
  return (
    <form
      className="grid gap-3 rounded-xl border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await create({ companyId, label: draft.label, instructions: draft.instructions || undefined, kind: draft.kind, appliesTo: draft.appliesTo, blocks: draft.blocks, needsReview: draft.needsReview, reviewBy: draft.reviewBy, validMonths: draft.validMonths ? Number(draft.validMonths) : undefined, statement: draft.statement || undefined, ownerOnly: draft.ownerOnly });
          onDone();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <TextInput value={draft.label} onChange={(event) => set("label", event.target.value)} required maxLength={120} />
        </Field>
        <Field label="Kind">
          <SelectInput value={draft.kind} onChange={(event) => set("kind", event.target.value as Kind)}>
            {(Object.keys(KIND_WORDS) as Kind[]).map((kind) => (
              <option key={kind} value={kind}>
                {KIND_WORDS[kind]}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <Field label="What the cleaner is asked to do (optional)" hint="Shown to the cleaner in their portal.">
        <TextArea value={draft.instructions} onChange={(event) => set("instructions", event.target.value)} rows={2} maxLength={1000} />
      </Field>
      {draft.kind === "acknowledgment" ? (
        <Field label="The words they agree to" hint="Changing these later asks everyone to agree again.">
          <TextArea value={draft.statement} onChange={(event) => set("statement", event.target.value)} rows={3} required maxLength={4000} />
        </Field>
      ) : null}
      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-medium text-strong">Applies to</legend>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(TYPE_SHORT) as Engagement[]).map((type) => {
            const on = draft.appliesTo.includes(type);
            return (
              <button key={type} type="button" aria-pressed={on} onClick={() => set("appliesTo", on ? draft.appliesTo.filter((value) => value !== type) : [...draft.appliesTo, type])} className={cn("min-h-8 rounded-lg border px-2.5 text-xs font-medium", on ? "border-brand-500/60 bg-brand-500/10 text-strong" : "border-border text-muted-foreground")}>
                {TYPE_SHORT[type]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="If it is not done" hint="Only Blocks work stops Dispatch offering them visits.">
          <SelectInput value={draft.blocks} onChange={(event) => set("blocks", event.target.value as Blocks)}>
            <option value="assignments">Blocks work</option>
            <option value="payment">Blocks pay</option>
            <option value="info">Good to know</option>
          </SelectInput>
        </Field>
        <Field label="Reviewed by" hint="Who may accept, send back or set it aside.">
          <SelectInput value={draft.ownerOnly ? "owner" : draft.reviewBy} onChange={(event) => set("reviewBy", event.target.value as "manager" | "owner")} disabled={draft.ownerOnly}>
            <option value="manager">A manager or the Owner</option>
            <option value="owner">The Owner only</option>
          </SelectInput>
        </Field>
        {draft.kind === "document" ? (
          <Field label="Valid for (months, optional)" hint="Accepted documents expire after this.">
            <TextInput inputMode="numeric" value={draft.validMonths} onChange={(event) => set("validMonths", event.target.value.replace(/\D/g, ""))} />
          </Field>
        ) : null}
      </div>
      <label className="flex items-start gap-2 text-sm text-strong">
        <input type="checkbox" checked={reviewForced || draft.needsReview} disabled={reviewForced || draft.kind === "agreement"} onChange={(event) => set("needsReview", event.target.checked)} className="mt-1 size-4 accent-[var(--color-brand-500)]" />
        <span>
          A person reviews what they submit
          <span className="block text-xs text-muted-foreground">{reviewForced ? "Always on for files and payment setup: submitting is never the same as being accepted." : draft.kind === "agreement" ? "Met only when a linked agreement is signed in Agreements." : "Off: what the cleaner does counts as soon as they do it."}</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm text-strong">
        <input type="checkbox" checked={draft.ownerOnly} onChange={(event) => set("ownerOnly", event.target.checked)} className="mt-1 size-4 accent-[var(--color-brand-500)]" />
        <span>
          Owner only
          <span className="block text-xs text-muted-foreground">For tax and payout details: only the Owner sees the files and decides.</span>
        </span>
      </label>
      <FormError message={error} />
      <Submit busy={busy} label="Add requirement" onCancel={onDone} />
    </form>
  );
}

/** The company's onboarding requirements. The Owner sets them; everyone may read them. */
export function RequirementsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const company = useCompany();
  const rows = useQuery(api.requirements.list, open ? { companyId: company.companyId } : "skip");
  const suggestions = useQuery(api.requirements.suggestions, open && company.role === "owner" ? { companyId: company.companyId } : "skip");
  const retire = useMutation(api.requirements.retire);
  const [draft, setDraft] = useState<Draft | null>(null);
  const { error, run } = useRun();
  const owner = company.role === "owner";
  const unused = (suggestions ?? []).filter((suggestion) => !(rows ?? []).some((row) => row.label.toLowerCase() === suggestion.label.toLowerCase()));
  return (
    <Modal open={open} onClose={onClose} title="Onboarding requirements" description="What each kind of worker needs before they can work or be paid. Readiness, Dispatch and the cleaner portal all read these." wide>
      <div className="grid gap-4">
        {rows === undefined ? (
          <Skeleton className="h-24" />
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No requirements yet. Readiness counts only hours, areas and pay until you add some.</p>
        ) : (
          <ul className="grid gap-2">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-border p-3">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-strong">
                    {row.label}
                    <Badge variant={row.blocks === "assignments" ? "warning" : row.blocks === "payment" ? "info" : "outline"} size="sm">
                      {BLOCK_WORDS[row.blocks]}
                    </Badge>
                    {row.ownerOnly ? (
                      <Badge variant="outline" size="sm">
                        <Lock aria-hidden /> Owner only
                      </Badge>
                    ) : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {KIND_WORDS[row.kind]} · {row.appliesTo.map((type) => TYPE_SHORT[type]).join(", ")}
                    {row.needsReview ? " · reviewed by a person" : ""}
                    {row.validMonths ? ` · valid ${row.validMonths} months` : ""}
                  </span>
                  {row.statement ? <span className="mt-1 block text-xs text-muted-foreground">“{row.statement}”</span> : null}
                </span>
                {owner ? (
                  <Button variant="ghost" size="xs" onClick={() => void run(() => retire({ companyId: company.companyId, requirementId: row.id }))} aria-label={`Stop using ${row.label}`}>
                    <Trash2 aria-hidden /> Stop using
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <FormError message={error} />
        {owner ? (
          draft ? (
            <RequirementForm initial={draft} onDone={() => setDraft(null)} />
          ) : (
            <div className="grid gap-2">
              <div>
                <Button variant="primary" size="sm" onClick={() => setDraft(EMPTY)}>
                  <Plus aria-hidden /> New requirement
                </Button>
              </div>
              {unused.length > 0 ? (
                <div className="rounded-xl bg-muted/40 p-3">
                  <p className="text-xs font-medium text-strong">Common starting points. Nothing is added until you choose it, and you can change everything first.</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {unused.map((suggestion) => (
                      <button key={suggestion.label} type="button" onClick={() => setDraft({ ...EMPTY, ...suggestion, appliesTo: [...suggestion.appliesTo], validMonths: "validMonths" in suggestion && suggestion.validMonths ? String(suggestion.validMonths) : "", statement: "statement" in suggestion ? (suggestion.statement ?? "") : "", instructions: suggestion.instructions ?? "" })} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-strong hover:border-brand-500/50">
                        <Plus className="size-3.5" aria-hidden /> {suggestion.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )
        ) : (
          <p className="text-xs text-muted-foreground">Only the Owner changes the company&apos;s requirements.</p>
        )}
      </div>
    </Modal>
  );
}

// ── One worker ─────────────────────────────────────────────────────────────────────────────────

type Item = NonNullable<ReturnType<typeof useItems>>[number];
function useItems(cleanerId: Id<"cleaners">) {
  const company = useCompany();
  const now = useNow();
  return useQuery(api.requirements.forWorker, now ? { companyId: company.companyId, cleanerId, asOf: now } : "skip");
}

function DocumentLink({ documentId, fileName }: { documentId: Id<"workerDocuments">; fileName: string }) {
  const company = useCompany();
  const [want, setWant] = useState(false);
  const file = useQuery(api.requirements.documentUrl, want ? { companyId: company.companyId, documentId } : "skip");
  if (want && file?.url) {
    return (
      <a href={file.url} target="_blank" rel="noreferrer" className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-brand-500/40 bg-brand-500/8 px-2 text-xs font-medium text-strong">
        <FileText className="size-3.5" aria-hidden /> Open {fileName}
      </a>
    );
  }
  return (
    <button type="button" onClick={() => setWant(true)} className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-border bg-background px-2 text-xs text-strong hover:border-brand-500/50">
      <FileText className="size-3.5 text-muted-foreground" aria-hidden /> {fileName}
    </button>
  );
}

function ReviewActions({ cleanerId, item, timezone }: { cleanerId: Id<"cleaners">; item: Item; timezone: string }) {
  const company = useCompany();
  const decide = useMutation(api.requirements.decide);
  const waive = useMutation(api.requirements.waiveFor);
  const record = useMutation(api.requirements.recordFor);
  const uploadUrl = useMutation(api.requirements.uploadUrl);
  const attach = useMutation(api.requirements.attachFor);
  const { busy, error, run, setError } = useRun();
  const [mode, setMode] = useState<"back" | "aside" | "accept" | null>(null);
  const now = useNow();
  const [words, setWords] = useState("");
  const [until, setUntil] = useState("");
  const base = { companyId: company.companyId, cleanerId, requirementId: item.requirementId };
  const canAccept = item.kind !== "agreement" && item.kind !== "acknowledgment" && (item.state === "awaiting_review" || item.state === "submitted" || item.state === "expired" || item.state === "needs_changes");
  return (
    <div className="mt-2 grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        {canAccept && (item.kind !== "document" || item.documents.length > 0 || item.filesHidden) ? (
          item.kind === "document" ? (
            <Button size="xs" variant="primary" onClick={() => setMode(mode === "accept" ? null : "accept")}>
              <CheckCircle2 aria-hidden /> Accept
            </Button>
          ) : (
            <Button size="xs" variant="primary" loading={busy} onClick={() => void run(() => decide({ ...base, decision: "accept" }))}>
              <CheckCircle2 aria-hidden /> Accept
            </Button>
          )
        ) : null}
        {item.state === "awaiting_review" || item.state === "submitted" ? (
          <Button size="xs" variant="outline" onClick={() => setMode(mode === "back" ? null : "back")}>
            <XCircle aria-hidden /> Send back
          </Button>
        ) : null}
        {item.kind === "document" ? (
          <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-overlay/[0.12] px-2 text-xs font-medium text-strong hover:bg-muted/50 sm:h-6">
            <Upload className="size-3.5" aria-hidden /> Upload for them
            <input
              type="file"
              accept="application/pdf,image/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 15 * 1024 * 1024) return setError("That file is larger than 15 MB.");
                void run(async () => {
                  const url = await uploadUrl({ companyId: company.companyId });
                  const response = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
                  if (!response.ok) throw new Error("upload");
                  const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
                  await attach({ ...base, storageId, fileName: file.name, clientKey: newKey() });
                });
              }}
            />
          </label>
        ) : null}
        {(item.kind === "payment_setup" || item.kind === "training" || item.kind === "equipment" || item.kind === "custom") && item.state === "not_started" ? (
          <Button size="xs" variant="outline" loading={busy} onClick={() => void run(() => record({ ...base, step: "done" }))}>
            Record as done for them
          </Button>
        ) : null}
        {!item.met ? (
          <Button size="xs" variant="ghost" onClick={() => setMode(mode === "aside" ? null : "aside")}>
            Set aside
          </Button>
        ) : item.waived ? (
          <Button size="xs" variant="ghost" loading={busy} onClick={() => void run(() => waive({ ...base, reason: null }))}>
            Withdraw set-aside
          </Button>
        ) : null}
      </div>
      {mode === "accept" ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg bg-muted/40 p-2"
          onSubmit={(event) => {
            event.preventDefault();
            const validUntil = until ? (zonedInstant(until, "23:59", timezone) ?? undefined) : undefined;
            void run(async () => {
              await decide({ ...base, decision: "accept", validUntil });
              setMode(null);
            });
          }}
        >
          <Field label="Valid until (optional)" hint="Leave blank to use the requirement's own period, if it has one." className="min-w-48 flex-1">
            <TextInput type="date" value={until} min={now ? localDate(now, timezone) : undefined} onChange={(event) => setUntil(event.target.value)} />
          </Field>
          <Button type="submit" size="sm" variant="primary" loading={busy}>
            Accept document
          </Button>
        </form>
      ) : null}
      {mode === "back" || mode === "aside" ? (
        <form
          className="grid gap-2 rounded-lg bg-muted/40 p-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              if (mode === "back") await decide({ ...base, decision: "needs_changes", feedback: words });
              else await waive({ ...base, reason: words });
              setMode(null);
              setWords("");
            });
          }}
        >
          <Field label={mode === "back" ? "What needs to change" : "Why it is set aside"} hint={mode === "back" ? "The cleaner sees these words." : "Kept on record. It is shown as set aside, never as accepted."}>
            <TextArea value={words} onChange={(event) => setWords(event.target.value)} rows={2} required minLength={3} />
          </Field>
          <div>
            <Button type="submit" size="sm" variant="primary" loading={busy}>
              {mode === "back" ? "Send back" : "Set aside"}
            </Button>
          </div>
        </form>
      ) : null}
      <FormError message={error} />
    </div>
  );
}

function Requirements({ profile }: { profile: Profile }) {
  const items = useItems(profile.cleanerId);
  const manager = canManage(profile.viewer.role);
  if (items === undefined) return <Skeleton className="h-32 rounded-2xl" />;
  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">
        <p className="font-medium text-strong">No onboarding requirements apply to them</p>
        <p className="mt-1">The Owner sets requirements for each worker type under Cleaners › Requirements. Until then, readiness counts only hours, areas and pay.</p>
      </section>
    );
  }
  const done = items.filter((item) => item.met).length;
  return (
    <section className="rounded-2xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5">
        <h2 className="font-heading text-base tracking-tight text-strong">Requirements</h2>
        <span className="text-xs text-muted-foreground">
          {done} of {items.length} met
        </span>
      </header>
      <div className="px-4 pt-2 sm:px-5">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} aria-label="Requirements met">
          <div className="h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      </div>
      <ul className="grid gap-2 p-4 sm:p-5">
        {items.map((item) => {
          const look = item.waived ? { label: "Set aside", variant: "outline" as const } : STATE_LOOK[item.state];
          return (
            <li key={item.requirementId} className={cn("rounded-xl border p-3", item.state === "awaiting_review" ? "border-warning/40 bg-warning/5" : item.state === "needs_changes" || item.state === "expired" ? "border-destructive/30" : "border-border")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="flex min-w-0 items-start gap-2">
                  {item.met ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-foreground" aria-hidden /> : item.state === "awaiting_review" ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-strong">{item.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {KIND_WORDS[item.kind]} · {BLOCK_WORDS[item.blocks]}
                      {item.ownerOnly ? " · Owner only" : ""}
                    </span>
                  </span>
                </span>
                <Badge variant={look.variant} size="sm">
                  {look.label}
                </Badge>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
              {item.statement ? <p className="mt-1 rounded-lg bg-muted/40 px-2 py-1 text-xs text-muted-foreground">“{item.statement}”</p> : null}
              {item.documents.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.documents.map((doc) => (
                    <DocumentLink key={doc.id} documentId={doc.id} fileName={doc.fileName} />
                  ))}
                </div>
              ) : item.filesHidden ? (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="size-3.5" aria-hidden /> A file is on record. Only the Owner can open it.
                </p>
              ) : null}
              {item.note ? <p className="mt-1 text-xs text-muted-foreground">Note: {item.note}</p> : null}
              {manager && item.mayReview && item.kind !== "agreement" ? <ReviewActions cleanerId={profile.cleanerId} item={item} timezone={profile.timezone} /> : null}
              {item.kind === "agreement" && !item.met ? <p className="mt-1.5 text-xs text-muted-foreground">Signed in Agreements. Link a workforce agreement to them below; it counts once everyone has signed.</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PortalCard({ profile }: { profile: Profile }) {
  const company = useCompany();
  const now = useNow();
  const status = useQuery(api.workforce.portalStatus, now ? { companyId: company.companyId, cleanerId: profile.cleanerId, asOf: now } : "skip");
  const invite = useMutation(api.workforce.invitePortal);
  const copyLink = useMutation(api.workforce.portalLink);
  const end = useMutation(api.workforce.endPortalAccess);
  const { busy, error, run } = useRun();
  const [copied, setCopied] = useState(false);
  if (status === undefined) return <Skeleton className="h-28 rounded-2xl" />;
  const invitation = status.invitation;
  const working = invitation?.state === "active";
  const failed = invitation?.text && ["not_sent", "failed"].includes(invitation.text.status);
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 font-heading text-base tracking-tight text-strong">
          <DeviceMobileIcon className="size-4.5 text-brand-600 dark:text-brand-300" aria-hidden />
          Cleaner portal
        </h2>
        {invitation ? (
          <Badge variant={working && failed && !invitation.usedWords.startsWith("Confirmed") ? "warning" : working ? (invitation.usedWords.startsWith("Confirmed") ? "success" : "info") : "outline"} size="sm">
            {working ? (invitation.usedWords.startsWith("Confirmed") ? "In use" : failed ? "Invitation not sent" : "Invited") : invitation.state === "expired" ? "Link expired" : "Closed"}
          </Badge>
        ) : null}
      </div>
      {!status.configured ? (
        <p className="mt-2 text-sm text-muted-foreground">Links are not set up on this deployment yet, so no portal can be offered.</p>
      ) : !invitation ? (
        <p className="mt-2 text-sm text-muted-foreground">Not invited yet. The invitation is texted to {status.phone ?? "their mobile number"}; they confirm it is them with a code sent to the same phone.</p>
      ) : (
        <dl className="mt-3 grid gap-2 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">Invitation text</dt>
            <dd className={cn("font-medium", failed ? "text-destructive-foreground" : "text-strong")}>{invitation.text ? invitation.text.words : "No text planned"}</dd>
          </div>
          {invitation.text?.problem ? (
            <p className="rounded-lg bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
              {invitation.text.problem}
              {failed ? (/permission/i.test(invitation.text.problem) ? " Record the permission they gave on the Overview tab and send a new link, or copy the link and give it to them yourself." : " You can copy the link and give it to them yourself.") : ""}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">Acted on</dt>
            <dd className="text-strong">{invitation.usedWords}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">Link</dt>
            <dd className="text-strong">{working ? `Works until ${invitation.expires}` : (invitation.revokeReason ?? "No longer works")}</dd>
          </div>
        </dl>
      )}
      <FormError message={error} />
      {canManage(profile.viewer.role) && status.configured && profile.status !== "ended" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant={invitation ? "outline" : "primary"} loading={busy} onClick={() => void run(() => invite({ companyId: company.companyId, cleanerId: profile.cleanerId }))}>
            <PaperPlaneIcon aria-hidden /> {invitation ? "Send a new link" : "Invite to portal"}
          </Button>
          {working ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void run(async () => {
                  const url = await copyLink({ companyId: company.companyId, cleanerId: profile.cleanerId });
                  await navigator.clipboard?.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2500);
                })
              }
            >
              <Copy aria-hidden /> {copied ? "Link copied" : "Copy link"}
            </Button>
          ) : null}
          {working || status.activeSessions > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => void run(() => end({ companyId: company.companyId, cleanerId: profile.cleanerId, reason: "Closed by the office." }))}>
              End access
            </Button>
          ) : null}
        </div>
      ) : null}
      {invitation && status.earlierInvitations > 0 ? <p className="mt-2 text-xs text-muted-foreground">{plural(status.earlierInvitations, "earlier link")} no longer {status.earlierInvitations === 1 ? "works" : "work"}: a new invitation closes the one before.</p> : null}
    </section>
  );
}

function RemindersCard({ profile }: { profile: Profile }) {
  const company = useCompany();
  const now = useNow();
  const status = useQuery(api.workforce.reminderStatus, now ? { companyId: company.companyId, cleanerId: profile.cleanerId, asOf: now } : "skip");
  const remind = useMutation(api.workforce.remindNow);
  const { busy, error, run } = useRun();
  const [result, setResult] = useState<string | null>(null);
  if (status === undefined) return null;
  const levelWords: Record<string, string> = { off: "Off: Recruiter sends no onboarding reminders.", propose: "Recruiter proposes each reminder; a person approves it in Approvals.", execute_and_report: "Recruiter sends reminders and reports each one.", execute: "Recruiter sends reminders when they are due.", paused: "Recruiter is paused.", unknown: "Not available.", person_only: "A person sends these." };
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <h2 className="font-heading text-base tracking-tight text-strong">Onboarding reminders</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {levelWords[status.level] ?? ""} Up to {status.max}, after {status.days.join(" and ")} days without progress. Never while they have an open question, and silence is never taken as a no.
      </p>
      {status.sent.length > 0 ? (
        <ul className="mt-2 grid gap-1 text-xs">
          {status.sent.map((row) => (
            <li key={row.attempt} className="flex flex-wrap justify-between gap-2">
              <span className="text-strong">Reminder {row.attempt}</span>
              <span className={row.status === "not_sent" || row.status === "failed" ? "text-destructive-foreground" : "text-muted-foreground"}>
                {row.words}, {row.when}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">None sent yet.</p>
      )}
      {result ? <p className="mt-2 text-xs text-strong">{result}</p> : null}
      <FormError message={error} />
      {canManage(profile.viewer.role) && status.sent.length < status.max ? (
        <Button className="mt-2" size="sm" variant="outline" loading={busy} onClick={() => void run(async () => setResult((await remind({ companyId: company.companyId, cleanerId: profile.cleanerId })).detail))}>
          Remind now
        </Button>
      ) : null}
    </section>
  );
}

/** Records the permission the cleaner gave for work texts, in their own words or on a form. A person records it; nothing assumes it. */
export function TextPermissionForm({ cleanerId, onDone }: { cleanerId: Id<"cleaners">; onDone: () => void }) {
  const company = useCompany();
  const record = useMutation(api.consent.record);
  const { busy, error, run } = useRun();
  const [source, setSource] = useState<"paper_form" | "verbal" | "web_form">("paper_form");
  const [evidence, setEvidence] = useState("");
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await record({ companyId: company.companyId, recipient: { kind: "cleaner", id: cleanerId }, channel: "sms", category: "operational", status: "granted", source, evidence });
          onDone();
        });
      }}
    >
      <Field label="How they agreed">
        <SelectInput value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
          <option value="paper_form">On a signed form</option>
          <option value="verbal">They told a person</option>
          <option value="web_form">On a web form</option>
        </SelectInput>
      </Field>
      <Field label="Where the proof is kept" hint="For example: onboarding form in the office file, signed Nov 12.">
        <TextInput value={evidence} onChange={(event) => setEvidence(event.target.value)} required maxLength={500} />
      </Field>
      <FormError message={error} />
      <Submit busy={busy} label="Record permission" onCancel={onDone} />
    </form>
  );
}

/** The profile's Onboarding & Documents section. */
export function OnboardingSection({ profile }: { profile: Profile }) {
  const company = useCompany();
  const recordHandoff = useMutation(api.onboarding.record);
  const { busy, error, run } = useRun();
  const manager = canManage(company.role);
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="grid content-start gap-4">
        <Requirements profile={profile} />
        {profile.hire ? (
          <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            <h2 className="font-heading text-base tracking-tight text-strong">From their hire: {profile.hire.role}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{profile.hire.handoffStatus === "open" ? `Due ${profile.hire.dueWords}. ${profile.hire.nextAction}` : profile.hire.handoffStatus === "complete" ? "Every item from the hire was recorded as done." : "The hire was cancelled."}</p>
            <ul className="mt-3 grid gap-1.5">
              {profile.hire.requirements.map((item) => (
                <li key={item.key} className="flex items-start gap-2.5 rounded-xl border border-border px-3 py-2">
                  {item.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-foreground" aria-hidden /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-strong">{item.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {item.done ? `Recorded as done${item.at ? ` on ${item.at}` : ""}` : "Not recorded yet"}
                      {item.note ? ` · ${item.note}` : ""}
                    </span>
                  </span>
                  {manager && profile.hire!.handoffStatus === "open" ? (
                    <Button variant="ghost" size="xs" loading={busy} onClick={() => void run(() => recordHandoff({ companyId: company.companyId, handoffId: profile.hire!.handoffId, requirement: item.key, done: !item.done }))}>
                      {item.done ? "Undo" : "Record done"}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            <FormError message={error} />
          </section>
        ) : null}
      </div>
      <div className="grid content-start gap-4">
        {manager ? <PortalCard profile={profile} /> : null}
        {manager ? <RemindersCard profile={profile} /> : null}
        <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <h2 className="font-heading text-base tracking-tight text-strong">Workforce agreements</h2>
          {manager ? (
            <>
              <AgreementsForRecord table="cleaners" id={profile.cleanerId} title="Linked to this person" />
              <p className="mt-3 text-xs text-muted-foreground">Signing and versions stay in Agreements. Sent is not signed.</p>
            </>
          ) : (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden /> Workforce documents are open to managers and the Owner.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
