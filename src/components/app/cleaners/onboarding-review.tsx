"use client";

/**
 * Phase 2 of a profile: reviewing what a cleaner submitted, their portal access and the messages behind it,
 * the routine follow-ups Selestial is running, and skills waiting for a person. Each state is shown in words
 * and kept apart: prepared, sent, delivered and acted on are four different facts.
 */
import { useConvex, useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { canManage, useCompany } from "@/components/app/company";
import { Field, FormError, TextArea, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { useNow } from "@/components/app/use-now";
import { Check, Copy, ExternalLink, FileText, LinkIcon, MessageSquareText, Sparkles, X } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ago, dayName, localDate, whenLabel, zonedInstant } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { Profile } from "./profile";
import { Checkbox } from "@/components/ui/selection";

type Requirement = Profile["requirements"][number];

// ── Reviewing one requirement ────────────────────────────────────────────────────────────────────

export function RequirementActions({ profile, row }: { profile: Profile; row: Requirement }) {
  const [open, setOpen] = useState<null | "accept" | "needs_changes" | "waive" | "reopen" | "submit">(null);
  if (!row.mayReview || profile.status === "ended") return null;
  const readFromRecord = row.kind === "availability" || row.kind === "service_areas";
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
      {!row.met && !readFromRecord ? (
        <Button variant={row.state === "awaiting_review" ? "primary" : "outline"} size="xs" onClick={() => setOpen("accept")}>
          <Check aria-hidden />
          {row.state === "awaiting_review" ? "Review and accept" : row.kind === "agreement" ? "Record a signed copy" : "Mark as done"}
        </Button>
      ) : null}
      {(row.state === "awaiting_review" || row.state === "submitted") && !readFromRecord ? (
        <Button variant="outline" size="xs" onClick={() => setOpen("needs_changes")}>
          Ask for changes
        </Button>
      ) : null}
      {!row.met && row.kind !== "agreement" && !readFromRecord ? (
        <Button variant="ghost" size="xs" onClick={() => setOpen("submit")}>
          Add a file for them
        </Button>
      ) : null}
      {!row.met ? (
        <Button variant="ghost" size="xs" onClick={() => setOpen("waive")}>
          Waive
        </Button>
      ) : null}
      {row.met && !row.fromRecord ? (
        <Button variant="ghost" size="xs" onClick={() => setOpen("reopen")}>
          Reopen
        </Button>
      ) : null}
      {open === "submit" ? <SubmitForDialog profile={profile} row={row} onClose={() => setOpen(null)} /> : open ? <ReviewDialog profile={profile} row={row} decision={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

const DECISION_COPY = {
  accept: { title: "Accept", button: "Accept", note: "What you checked (optional)", required: false },
  needs_changes: { title: "Ask for changes", button: "Send back", note: "What needs to change. They read this.", required: true },
  waive: { title: "Waive", button: "Waive", note: "Why it is waived. It stays on their record.", required: true },
  reopen: { title: "Reopen", button: "Reopen", note: "Why (optional)", required: false },
} as const;

function ReviewDialog({ profile, row, decision, onClose }: { profile: Profile; row: Requirement; decision: "accept" | "needs_changes" | "waive" | "reopen"; onClose: () => void }) {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const review = useMutation(api.requirements.review);
  const { busy, error, run } = useRun();
  const [note, setNote] = useState("");
  const [expires, setExpires] = useState("");
  const copy = DECISION_COPY[decision];
  const agreement = decision === "accept" && row.kind === "agreement";
  return (
    <Modal open onClose={onClose} title={`${copy.title}: ${row.label}`} description={`For ${profile.name}. ${decision === "accept" ? "Accepting says a person checked it." : ""}`}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const expiresAt = expires ? (zonedInstant(expires, "23:59", timezone) ?? undefined) : undefined;
            await review({ companyId, cleanerId: profile.cleanerId, key: row.key, decision, note: note || undefined, expiresAt });
            onClose();
          });
        }}
      >
        {decision === "accept" && row.filesCount > 0 ? <Files profile={profile} row={row} /> : null}
        {row.text ? <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-strong">They wrote: “{row.text}”</p> : null}
        <Field label={agreement ? "How it was signed" : copy.note} hint={agreement ? "For example: a paper copy signed on the first day, kept in the office file. An agreement signed in Agreements counts by itself." : undefined}>
          <TextArea value={note} onChange={(event) => setNote(event.target.value)} rows={3} required={copy.required || agreement} />
        </Field>
        {decision === "accept" && (row.kind === "document" || row.kind === "training") ? (
          <Field label="Valid until (optional)" hint="For a document with its own expiry date. Otherwise the template's validity applies.">
            <TextInput type="date" value={expires} min={now ? localDate(now, timezone) : undefined} onChange={(event) => setExpires(event.target.value)} />
          </Field>
        ) : null}
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant={decision === "waive" ? "outline" : "primary"} loading={busy}>
            {copy.button}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Files({ profile, row }: { profile: Profile; row: Requirement }) {
  const { companyId } = useCompany();
  const convex = useConvex();
  const { error, run } = useRun();
  return (
    <div className="grid gap-1.5">
      <p className="text-sm font-medium text-strong">What they sent</p>
      <ul className="grid gap-1">
        {(row.files ?? []).map((file, index) => (
          <li key={`${file.name}-${index}`}>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm text-strong hover:border-brand-500/50"
              onClick={() =>
                void run(async () => {
                  const found = await convex.query(api.requirements.fileUrl, { companyId, cleanerId: profile.cleanerId, key: row.key, index });
                  if (found?.url) window.open(found.url, "_blank", "noopener,noreferrer");
                })
              }
            >
              <FileText className="size-4 text-muted-foreground" aria-hidden />
              {file.name}
              <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <FormError message={error} />
    </div>
  );
}

function SubmitForDialog({ profile, row, onClose }: { profile: Profile; row: Requirement; onClose: () => void }) {
  const { companyId } = useCompany();
  const uploadUrl = useMutation(api.requirements.uploadUrl);
  const submit = useMutation(api.requirements.submitFor);
  const { busy, error, run } = useRun();
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  return (
    <Modal open onClose={onClose} title={`Add for ${profile.name}: ${row.label}`} description="For something handed in at the office. It is kept as submitted and still needs a review.">
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const storageIds = [];
            for (const file of files) {
              const response = await fetch(await uploadUrl({ companyId }), { method: "POST", headers: { "Content-Type": file.type }, body: file });
              storageIds.push(((await response.json()) as { storageId: Id<"_storage"> }).storageId);
            }
            await submit({ companyId, cleanerId: profile.cleanerId, key: row.key, text: note || undefined, storageIds });
            onClose();
          });
        }}
      >
        <Field label="Files (PDF or photos, up to 10 MB each)">
          <input type="file" multiple accept="application/pdf,image/*" onChange={(event) => setFiles([...(event.target.files ?? [])].slice(0, 5))} className="text-sm" />
        </Field>
        <Field label="A note (optional)">
          <TextInput value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={files.length === 0 && !note.trim()}>
            Add
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Portal access ────────────────────────────────────────────────────────────────────────────────

const LINK_STATE = { active: { label: "Active", variant: "success" }, expired: { label: "Expired", variant: "outline" }, revoked: { label: "Ended", variant: "outline" } } as const;
const MESSAGE_TONE: Record<string, string> = { delivered: "text-success-foreground", sent: "text-strong", queued: "text-muted-foreground", held: "text-warning-foreground", sending: "text-muted-foreground", failed: "text-destructive-foreground", not_sent: "text-destructive-foreground", unconfirmed: "text-warning-foreground" };

export function PortalAccessCard({ profile }: { profile: Profile }) {
  const { companyId, role, timezone } = useCompany();
  const now = useNow();
  const data = useQuery(api.portalAccess.access, canManage(role) ? { companyId, cleanerId: profile.cleanerId } : "skip");
  const invite = useMutation(api.portalAccess.invite);
  const reveal = useMutation(api.portalAccess.reveal);
  const revoke = useMutation(api.portalAccess.revoke);
  const { busy, error, run } = useRun();
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  if (!canManage(role) || !data) return null;
  const live = data.links.find((link) => link.purpose === "portal" && link.state === "active") ?? null;
  return (
    <section className="rounded-2xl border border-border bg-card" aria-label="Portal access">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="font-heading text-base tracking-tight text-strong">Portal and messages</h2>
        {profile.status !== "ended" ? (
          <Button variant={live ? "outline" : "primary"} size="sm" loading={busy} disabled={!data.configured} onClick={() => void run(async () => setResult((await invite({ companyId, cleanerId: profile.cleanerId })).words))}>
            <MessageSquareText aria-hidden />
            {live ? "Send a new link" : "Invite to portal"}
          </Button>
        ) : null}
      </header>
      <div className="grid gap-3 p-4 sm:p-5">
        {!data.configured ? <p className="text-sm text-muted-foreground">Portal links are not set up on this deployment yet, so nothing can be sent or opened.</p> : null}
        {data.channels.length === 0 ? <p className="text-sm text-muted-foreground">There is no mobile number or email on file, so nothing can be sent to them.</p> : null}
        {result ? (
          <p className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-strong" role="status">
            {result}
          </p>
        ) : null}
        {live ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5">
            <span className="text-sm">
              <span className="font-medium text-strong">Portal link</span>
              <span className="block text-xs text-muted-foreground">
                Works until {dayName(live.expiresAt, timezone)} · {live.lastActionAt ? `last used ${ago(live.lastActionAt, now, timezone)}` : "not used yet (opening it is not recorded)"}
              </span>
            </span>
            <span className="flex gap-1.5">
              <Button
                variant="outline"
                size="xs"
                onClick={() =>
                  void run(async () => {
                    const { url } = await reveal({ companyId, linkId: live.linkId });
                    await navigator.clipboard?.writeText(url);
                    setCopied(live.linkId);
                    window.setTimeout(() => setCopied(null), 2500);
                  })
                }
              >
                {copied === live.linkId ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied === live.linkId ? "Copied" : "Copy link"}
              </Button>
              <Button variant="ghost" size="xs" onClick={() => void run(() => revoke({ companyId, linkId: live.linkId }))}>
                <X aria-hidden />
                End access
              </Button>
            </span>
          </div>
        ) : null}
        {data.messages.length > 0 ? (
          <ul className="grid gap-1.5">
            {data.messages.slice(0, 6).map((message) => (
              <li key={message.messageId} className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="text-strong">
                    {message.what} {message.channel}
                  </span>
                  <span className={cn("ml-1.5 text-xs font-medium", MESSAGE_TONE[message.status])}>{message.words}</span>
                  {message.problem ? <span className="block text-xs text-muted-foreground">{message.problem}</span> : null}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{ago(message.at, now, timezone)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing has been sent to them from here yet.</p>
        )}
        {data.links.filter((link) => link.purpose !== "portal" || link.state !== "active").length > 0 ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium">Earlier links</summary>
            <ul className="mt-1.5 grid gap-1">
              {data.links
                .filter((link) => link !== live)
                .map((link) => (
                  <li key={link.linkId} className="flex items-center gap-2">
                    <LinkIcon className="size-3" aria-hidden />
                    {link.label} from {link.by}, {dayName(link.issuedAt, timezone)}
                    <Badge variant={LINK_STATE[link.state].variant} size="sm">
                      {LINK_STATE[link.state].label}
                    </Badge>
                    {link.revokeReason ? <span>{link.revokeReason}</span> : null}
                  </li>
                ))}
            </ul>
          </details>
        ) : null}
        <FormError message={error} />
      </div>
    </section>
  );
}

// ── What Selestial is doing ──────────────────────────────────────────────────────────────────────

const FOLLOW_UP_TONE: Record<string, "info" | "success" | "warning" | "outline" | "error"> = { scheduled: "info", awaiting_approval: "warning", sent: "info", answered: "success", resolved: "success", stopped: "outline", not_sent: "error" };

export function FollowUpsCard({ profile }: { profile: Profile }) {
  const { companyId, role, timezone } = useCompany();
  const now = useNow();
  const rows = useQuery(api.cleanerFollowUps.forCleaner, { companyId, cleanerId: profile.cleanerId });
  const sendNow = useMutation(api.cleanerFollowUps.sendNow);
  const stop = useMutation(api.cleanerFollowUps.stop);
  const { busy, error, run } = useRun();
  const [result, setResult] = useState<string | null>(null);
  if (!rows || rows.length === 0) return null;
  const open = rows.filter((row) => row.status === "scheduled" || row.status === "awaiting_approval" || row.status === "sent");
  const shown = open.length > 0 ? open : rows.slice(0, 2);
  return (
    <section className="rounded-2xl border border-brand-500/25 bg-brand-500/[0.03]" aria-label="What Selestial is doing">
      <header className="flex items-center gap-2 border-b border-brand-500/15 px-4 py-3 sm:px-5">
        <Sparkles className="size-4 text-brand-300" aria-hidden />
        <h2 className="font-heading text-base tracking-tight text-strong">What Selestial is doing</h2>
      </header>
      <ul className="divide-y divide-border">
        {shown.map((row) => (
          <li key={row.followUpId} className="grid gap-1.5 px-4 py-3 sm:px-5">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-strong">{row.agent}</span>
              <span className="text-muted-foreground">{row.topic === "onboarding" ? "onboarding reminders" : row.topic === "availability" ? "availability check" : "check-in"}</span>
              <Badge variant={FOLLOW_UP_TONE[row.status]} size="sm">
                {row.statusWords}
              </Badge>
            </p>
            <p className="text-sm text-strong">{row.summary}</p>
            <p className="text-xs text-muted-foreground">
              {row.status === "scheduled" ? `Next: ${whenLabel(row.dueAt, now, timezone)}, only if still needed then.` : null}
              {row.status === "awaiting_approval" ? "Prepared. Nothing goes out until you approve it in Approvals." : null}
              {row.status === "sent" && row.message ? `Reminder ${row.attempt} by ${row.message.channel}: ${row.message.words}${row.actedAt ? `, and they acted on it ${ago(row.actedAt, now, timezone)}` : ""}. Next check ${whenLabel(row.dueAt, now, timezone)}.` : null}
              {row.stopReason ? row.stopReason : null}
            </p>
            {row.message?.problem ? <p className="text-xs text-destructive-foreground">{row.message.problem}</p> : null}
            {canManage(role) && (row.status === "scheduled" || row.status === "sent" || row.status === "awaiting_approval") ? (
              <div className="flex flex-wrap gap-1.5">
                {row.status !== "awaiting_approval" ? (
                  <Button variant="outline" size="xs" loading={busy} onClick={() => void run(async () => setResult((await sendNow({ companyId, cleanerId: profile.cleanerId, topic: row.topic })).detail))}>
                    Send it now
                  </Button>
                ) : null}
                <Button variant="ghost" size="xs" loading={busy} onClick={() => void run(() => stop({ companyId, followUpId: row.followUpId, reason: "Handling it personally" }))}>
                  I will handle it
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {result ? (
        <p className="border-t border-border px-4 py-2 text-xs text-strong sm:px-5" role="status">
          {result}
        </p>
      ) : null}
      <div className="px-4 sm:px-5">
        <FormError message={error} />
      </div>
    </section>
  );
}

// ── Skills a cleaner claimed ─────────────────────────────────────────────────────────────────────

export function SkillClaims({ profile }: { profile: Profile }) {
  const { companyId, role } = useCompany();
  const decide = useMutation(api.cleanerProfile.decideSkill);
  const { busy, error, run } = useRun();
  if (profile.skillClaims.length === 0) return null;
  return (
    <div className="grid gap-2 rounded-xl border border-warning/50 bg-warning/5 p-3">
      <p className="text-sm font-medium text-strong">They told us about {profile.skillClaims.length === 1 ? "a skill" : "skills"} to confirm</p>
      <ul className="grid gap-1.5">
        {profile.skillClaims.map((claim) => (
          <li key={claim.claimId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              <span className="font-medium text-strong">{claim.skill}</span>
              {claim.note ? <span className="text-muted-foreground"> · “{claim.note}”</span> : null}
            </span>
            {canManage(role) ? (
              <span className="flex gap-1.5">
                <Button variant="outline" size="xs" loading={busy} onClick={() => void run(() => decide({ companyId, claimId: claim.claimId, confirm: true }))}>
                  Confirm
                </Button>
                <Button variant="ghost" size="xs" loading={busy} onClick={() => void run(() => decide({ companyId, claimId: claim.claimId, confirm: false }))}>
                  Not confirmed
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <FormError message={error} />
    </div>
  );
}

// ── Inviting several people from the directory ───────────────────────────────────────────────────

export function InviteManyDialog({ people, onClose }: { people: { cleanerId: string; name: string; status: string; hasPhone: boolean }[]; onClose: () => void }) {
  const { companyId } = useCompany();
  const invite = useMutation(api.portalAccess.invite);
  const { busy, error, run } = useRun();
  const candidates = people.filter((person) => person.status === "onboarding" || person.status === "ready");
  const [chosen, setChosen] = useState<string[]>(candidates.filter((person) => person.status === "onboarding").map((person) => person.cleanerId));
  const [results, setResults] = useState<{ name: string; words: string; ok: boolean }[] | null>(null);
  return (
    <Modal open onClose={onClose} title="Invite to portal" description="Each person gets their own link by text or email: their jobs, availability and onboarding steps on their phone. Each send is checked for permission first.">
      {results ? (
        <div className="grid gap-3">
          <ul className="grid gap-1.5 text-sm" role="status">
            {results.map((row) => (
              <li key={row.name} className="flex gap-2">
                {row.ok ? <Check className="mt-0.5 size-4 shrink-0 text-success-foreground" aria-hidden /> : <X className="mt-0.5 size-4 shrink-0 text-destructive-foreground" aria-hidden />}
                <span>
                  <span className="font-medium text-strong">{row.name}</span> <span className="text-muted-foreground">{row.words}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const out = [];
              for (const id of chosen) {
                const person = candidates.find((row) => row.cleanerId === id)!;
                try {
                  const answer = await invite({ companyId, cleanerId: id as Id<"cleaners"> });
                  out.push({ name: person.name, words: answer.words, ok: answer.status !== "not_sent" });
                } catch (caught) {
                  out.push({ name: person.name, words: (caught as { data?: { message?: string } }).data?.message ?? "Not sent.", ok: false });
                }
              }
              setResults(out);
            });
          }}
        >
          <ul className="grid max-h-80 gap-1 overflow-y-auto">
            {candidates.map((person) => (
              <li key={person.cleanerId}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50">
                  <Checkbox checked={chosen.includes(person.cleanerId)} onCheckedChange={(checked) => setChosen(checked ? [...chosen, person.cleanerId] : chosen.filter((id) => id !== person.cleanerId))} />
                  <span className="font-medium text-strong">{person.name}</span>
                  <span className="text-xs text-muted-foreground">{person.status === "onboarding" ? "Onboarding" : "Active"}</span>
                </label>
              </li>
            ))}
          </ul>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={chosen.length === 0}>
              Invite {chosen.length}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
