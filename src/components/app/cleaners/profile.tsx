"use client";

/**
 * A worker's profile, used whole on its own page and in part in the directory's drawer. The header says who
 * they are, how they are engaged, whether they are ready and why not, and offers only the actions the
 * viewer's role allows. Each section reads the shared records; none keeps a copy.
 */
import { useMutation, useQuery } from "convex/react";

import { useStableQuery } from "@/lib/app/stable-query";
import Link from "next/link";
import { useState } from "react";

import { canManage, useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { useNow } from "@/components/app/use-now";
import { type LucideIcon, ArrowRight, CalendarIcon, Check, ChevronDown, Clock, Hand, HistoryIcon, Mail, MapPin, MessageSquareText, PenLine, Plus, Sparkles, TriangleAlert, User, Users } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ago, clock, dayName, longDay, money } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Avatar, Chips, EFFECT_WORDS, ENGAGEMENT_WORDS, Progress, ReadinessLine, RequirementBadge, StatusBadge, type EngagementStatus } from "./bits";
import { ConfirmHoursDialog, ExceptionDialog, RemoveButton, TimeAwayDialog, WeekDialog } from "./availability-edit";
import { PerformanceSection } from "./performance";
import { FollowUpsCard, PortalAccessCard, RequirementActions, SkillClaims } from "./onboarding-review";
import { profilePath, SECTIONS, type SectionId } from "./state";

export type Profile = FunctionReturnType<typeof api.cleanerProfile.profile>;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const minuteWords = (minute: number) => {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
};

export function useProfile(cleanerId: string | null) {
  const { companyId } = useCompany();
  const now = useNow();
  return useStableQuery(api.cleanerProfile.profile, cleanerId && now ? { companyId, cleanerId: cleanerId as Id<"cleaners">, asOf: now } : "skip");
}

// ── Header ─────────────────────────────────────────────────────────────────────────────────────────

export function ProfileHeader({ profile, compact = false }: { profile: Profile; compact?: boolean }) {
  return (
    <div className="flex items-start gap-4">
      <Avatar name={profile.name} initials={profile.initials} photoUrl={profile.photoUrl} size={compact ? "lg" : "xl"} />
      <div className="min-w-0 flex-1">
        <h1 className={cn("font-heading tracking-tight text-strong", compact ? "text-xl" : "text-2xl")}>{profile.name}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {ENGAGEMENT_WORDS[profile.engagement]}
          {profile.subcontractor ? (
            <>
              {" "}
              through <span className="font-medium text-strong">{profile.subcontractor.name}</span>
            </>
          ) : null}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={profile.status as EngagementStatus} size="default" />
          {profile.crews
            .filter((crew) => crew.current && crew.kind === "permanent")
            .map((crew) => (
              <Badge key={crew.crewId} variant="outline">
                <Users aria-hidden />
                {crew.name}
                {crew.role === "lead" ? " · lead" : ""}
              </Badge>
            ))}
          {profile.rehireRestricted ? <Badge variant="warning">Rehire restricted</Badge> : null}
        </div>
      </div>
    </div>
  );
}

/** Readiness at a glance: the state, the exact unmet requirements, and onboarding progress. */
export function ReadinessCard({ profile, onSection }: { profile: Profile; onSection?: (section: SectionId) => void }) {
  const r = profile.readiness;
  const tone = r.state === "ready" ? "border-success/40 bg-success/5" : r.state === "blocked" ? "border-destructive/30 bg-destructive/5" : r.state === "onboarding" ? "border-info/30 bg-info/5" : "border-border bg-muted/30";
  return (
    <section className={cn("rounded-2xl border p-4 sm:p-5", tone)} aria-label="Readiness">
      <ReadinessLine state={r.state} detail={r.summary} />
      {r.progress.total > 0 ? (
        <div className="mt-3 max-w-sm">
          <Progress met={r.progress.met} total={r.progress.total} />
        </div>
      ) : null}
      {r.blockers.length > 0 ? (
        <ul className="mt-3 grid gap-1.5">
          {r.blockers.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-2 rounded-lg bg-card px-3 py-2 text-sm">
              <span className="font-medium text-strong">{row.label}</span>
              <RequirementBadge state={row.state} />
            </li>
          ))}
        </ul>
      ) : null}
      {r.serviceBlockers.length > 0 ? <p className="mt-2 text-xs text-muted-foreground">Only for some services: {r.serviceBlockers.map((row) => `${row.label} (${row.forServices.join(", ")})`).join("; ")}.</p> : null}
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{r.payoutReady ? "Ready to be paid" : `Not ready to be paid: ${r.paymentBlockers.map((row) => row.label.toLowerCase()).join(", ")}`}</span>
        {onSection && r.progress.total > 0 ? (
          <button type="button" onClick={() => onSection("onboarding")} className="font-medium text-brand-300 underline-offset-4 hover:underline">
            See every requirement
          </button>
        ) : null}
      </p>
    </section>
  );
}

// ── Actions ────────────────────────────────────────────────────────────────────────────────────────

export function ProfileActions({ profile }: { profile: Profile }) {
  const { companyId } = useCompany();
  const setStatus = useMutation(api.cleanerProfile.setEngagementStatus);
  const { busy, error, run } = useRun();
  const [editing, setEditing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  if (!profile.viewer.manager) return null;
  const status = profile.status;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {status === "onboarding" ? (
          <Button variant={profile.readiness.blockers.length === 0 ? "primary" : "outline"} size="sm" loading={busy} onClick={() => void run(() => setStatus({ companyId, cleanerId: profile.cleanerId, status: "ready" }))}>
            <Check aria-hidden />
            Make active
          </Button>
        ) : null}
        {status === "ready" ? (
          <Button variant="outline" size="sm" loading={busy} onClick={() => void run(() => setStatus({ companyId, cleanerId: profile.cleanerId, status: "paused" }))}>
            Pause
          </Button>
        ) : null}
        {status === "paused" ? (
          <Button variant="outline" size="sm" loading={busy} onClick={() => void run(() => setStatus({ companyId, cleanerId: profile.cleanerId, status: "ready" }))}>
            Resume
          </Button>
        ) : null}
        {status !== "ended" ? (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <PenLine aria-hidden />
            Edit details
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => setRequesting(true)}>
          <Hand aria-hidden />
          Request a change
        </Button>
      </div>
      {status === "onboarding" && profile.readiness.blockers.length > 0 ? <p className="text-xs text-muted-foreground">Making them active does not make them ready: Dispatch still waits for every requirement for work.</p> : null}
      <FormError message={error} />
      {editing ? <EditDetailsDialog profile={profile} onClose={() => setEditing(false)} /> : null}
      {requesting ? <PersonnelDialog profile={profile} onClose={() => setRequesting(false)} /> : null}
    </div>
  );
}

const list = (value: string) => value.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);

function EditDetailsDialog({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const { companyId } = useCompany();
  const update = useMutation(api.cleanerProfile.updateDetails);
  const { busy, error, run } = useRun();
  const [form, setForm] = useState({
    name: profile.name,
    phone: profile.phone ?? "",
    email: profile.email ?? "",
    areas: profile.areas.serviceAreas.join(", "),
    preferred: profile.areas.preferredAreas.join(", "),
    travel: profile.areas.maxTravelMinutes?.toString() ?? "",
    skills: profile.skills.join(", "),
  });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });
  return (
    <Modal open onClose={onClose} title={`Edit ${profile.name}`} description="Contact details, areas and confirmed skills. Pay and engagement changes are requests that an authorized person decides.">
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await update({ companyId, cleanerId: profile.cleanerId, name: form.name, phone: form.phone, email: form.email, serviceAreas: list(form.areas), preferredAreas: list(form.preferred), maxTravelMinutes: form.travel.trim() ? Number(form.travel) : null, skills: list(form.skills) });
            onClose();
          });
        }}
      >
        <Field label="Name">
          <TextInput value={form.name} onChange={set("name")} required autoComplete="off" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mobile phone">
            <TextInput value={form.phone} onChange={set("phone")} inputMode="tel" autoComplete="off" />
          </Field>
          <Field label="Email">
            <TextInput type="email" value={form.email} onChange={set("email")} autoComplete="off" />
          </Field>
        </div>
        <Field label="Service areas" hint="Postal codes, separated by commas. Dispatch offers work only inside these.">
          <TextInput value={form.areas} onChange={set("areas")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Preferred areas" hint="A few of the service areas they like most.">
            <TextInput value={form.preferred} onChange={set("preferred")} />
          </Field>
          <Field label="Travel limit (minutes)" hint="Shown to Dispatch; not enforced, since there are no drive times yet.">
            <TextInput value={form.travel} onChange={set("travel")} inputMode="numeric" />
          </Field>
        </div>
        <Field label="Confirmed skills" hint="Skills a person confirmed. Dispatch matches jobs against these.">
          <TextInput value={form.skills} onChange={set("skills")} />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const REQUEST_KINDS: Record<string, { label: string; help: string }> = {
  suspend: { label: "Suspend", help: "No new work is offered. Jobs they accepted stay as they are and go to a person to decide." },
  reinstate: { label: "Reinstate", help: "Makes the engagement active again. Their requirements still decide whether work is offered." },
  end_engagement: { label: "End the engagement", help: "Their record and history are kept. Portal access follows your company's rule. Accepted jobs go to a person to decide." },
  disciplinary: { label: "Record a disciplinary action", help: "Recorded on their file. It changes nothing else: not pay, not status, not any score." },
  rehire_restriction: { label: "Restrict rehiring", help: "Shown if they apply again. It does not change anything today." },
  remove_record: { label: "Remove personal details", help: "Only after the engagement has ended. Job history is kept without their name and contact details." },
};

/** Requests about what happened can rest on job records; pay and record removal do not. */
const EVIDENCED = ["disciplinary", "suspend", "end_engagement", "rehire_restriction"];

/**
 * The records a request can rest on: their own records of concern from the performance view, each with what
 * it shows. A record corrected after a dispute cannot be chosen; one still in dispute can, and blocks approval.
 */
function EvidencePicker({ cleanerId, selected, onChange }: { cleanerId: Id<"cleaners">; selected: string[]; onChange: (next: string[]) => void }) {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const data = useStableQuery(api.cleanerPerformance.forCleaner, now ? { companyId, cleanerId, asOf: now } : "skip");
  if (!data) return <Skeleton className="h-16 rounded-xl" />;
  const seen = new Set<string>();
  const rows = data.measures
    .flatMap((measure) => measure.records)
    .filter((row) => row.tone === "concern" && !seen.has(row.assignmentId) && seen.add(row.assignmentId))
    .sort((a, b) => b.at - a.at);
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No records of concern in the last {data.periodDays} days to attach.</p>;
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1 text-sm font-medium text-strong">Records this rests on (optional)</legend>
      {rows.map((row) => {
        const corrected = row.dispute?.status === "corrected";
        const checked = selected.includes(row.assignmentId);
        return (
          <label key={row.assignmentId} className={cn("flex items-start gap-2 rounded-lg border border-border px-2.5 py-2 text-sm", corrected && "opacity-60")}>
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-[#6838ef]"
              disabled={corrected}
              checked={checked}
              onChange={() => onChange(checked ? selected.filter((id) => id !== row.assignmentId) : [...selected, row.assignmentId])}
            />
            <span className="min-w-0">
              <span className="block text-strong">{row.label}</span>
              <span className="block text-xs text-muted-foreground">
                {longDay(row.at, timezone)} · {row.outcome}
                {row.dispute?.status === "open" ? " · Disputed: it must be decided before this can be approved" : corrected ? " · Corrected after a dispute" : ""}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function PersonnelDialog({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const { companyId } = useCompany();
  const request = useMutation(api.personnel.request);
  const { busy, error, run } = useRun();
  const kinds = Object.keys(REQUEST_KINDS).filter((kind) => {
    if (kind === "reinstate") return profile.status === "suspended";
    if (kind === "suspend") return profile.status !== "suspended" && profile.status !== "ended";
    if (kind === "end_engagement") return profile.status !== "ended";
    if (kind === "remove_record") return profile.status === "ended";
    return true;
  });
  const [kind, setKind] = useState(kinds[0]);
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState("");
  const [evidence, setEvidence] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const impact = useQuery(api.personnel.impact, kind === "suspend" || kind === "end_engagement" ? { companyId, cleanerId: profile.cleanerId } : "skip");
  return (
    <Modal open onClose={onClose} title="Request a change" description="These need an authorized person. Nothing changes until it is approved, and no agent can ask for one.">
      {done ? (
        <div className="grid gap-3">
          <p className="rounded-xl border border-success/40 bg-success/5 px-3 py-2.5 text-sm text-strong" role="status">
            Requested. It waits for an authorized person; you will see the decision on this profile.
          </p>
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
              await request({ companyId, cleanerId: profile.cleanerId, kind: kind as "suspend", reason, summary: summary || undefined, evidence: EVIDENCED.includes(kind) && evidence.length ? (evidence as Id<"assignments">[]) : undefined });
              setDone(true);
            });
          }}
        >
          <Field label="What should change">
            <SelectInput value={kind} onChange={(event) => setKind(event.target.value)}>
              {kinds.map((value) => (
                <option key={value} value={value}>
                  {REQUEST_KINDS[value].label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <p className="text-xs text-muted-foreground">{REQUEST_KINDS[kind].help}</p>
          {impact && (impact.accepted.length > 0 || impact.offered > 0) ? (
            <div className="rounded-xl border border-warning/50 bg-warning/5 px-3 py-2.5 text-sm">
              <p className="font-medium text-strong">What this would touch</p>
              <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                {impact.accepted.map((row) => (
                  <li key={row.jobId}>Accepted: {row.label} (kept until a person decides)</li>
                ))}
                {impact.offered > 0 ? <li>{plural(impact.offered, "open offer")} could no longer be accepted.</li> : null}
              </ul>
            </div>
          ) : null}
          {kind === "disciplinary" ? (
            <Field label="What happened, as documented" hint="Facts with dates. This is kept on their file.">
              <TextArea value={summary} onChange={(event) => setSummary(event.target.value)} required />
            </Field>
          ) : null}
          {EVIDENCED.includes(kind) ? <EvidencePicker cleanerId={profile.cleanerId} selected={evidence} onChange={setEvidence} /> : null}
          <Field label="Why" hint="The person deciding reads this.">
            <TextArea value={reason} onChange={(event) => setReason(event.target.value)} required />
          </Field>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Send for a decision
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Requests waiting on this person, with the decision for whoever is authorized. */
export function PendingRequests({ cleanerId }: { cleanerId: Id<"cleaners"> }) {
  const { companyId, role } = useCompany();
  // Personnel requests are for Owners and Managers; Office never asks for them.
  const rows = useQuery(api.personnel.list, canManage(role) ? { companyId, cleanerId } : "skip");
  const decide = useMutation(api.personnel.decide);
  const withdraw = useMutation(api.personnel.withdraw);
  const { busy, error, run } = useRun();
  const [note, setNote] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const pending = rows?.filter((row) => row.status === "pending") ?? [];
  const decided = rows?.filter((row) => row.status !== "pending").slice(0, 3) ?? [];
  if (!rows || (pending.length === 0 && decided.length === 0 && !result)) return null;
  return (
    <section className="rounded-2xl border border-border bg-card" aria-label="Personnel requests">
      <header className="border-b border-border px-4 py-3 sm:px-5">
        <h2 className="font-heading text-base tracking-tight text-strong">Requests for a decision</h2>
      </header>
      <ul className="divide-y divide-border">
        {pending.map((row) => (
          <li key={row.requestId} className="grid gap-2 px-4 py-3 sm:px-5">
            <p className="text-sm">
              <span className="font-semibold text-strong">{row.kindWords}</span>
              {row.pay ? <span className="text-strong"> to {row.pay}</span> : null}
              <span className="text-muted-foreground"> · asked by {row.requestedBy}</span>
            </p>
            {row.summary ? <p className="text-sm text-strong">{row.summary}</p> : null}
            <p className="text-xs text-muted-foreground">Why: {row.reason}</p>
            {row.evidence.length > 0 ? (
              <ul className="grid gap-0.5 text-xs text-muted-foreground" aria-label="Records it rests on">
                {row.evidence.map((item) => (
                  <li key={item.assignmentId}>
                    Rests on: <span className="text-strong">{item.label}</span>
                    {item.dispute === "open" ? <Badge variant="warning" className="ml-1.5">Disputed, not decided</Badge> : item.dispute === "corrected" ? <Badge variant="outline" className="ml-1.5">Corrected after a dispute</Badge> : item.dispute === "upheld" ? " · dispute decided: the record stands" : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {row.evidence.some((item) => item.dispute === "open" || item.dispute === "corrected") ? (
              <p className="rounded-lg bg-warning/8 px-2.5 py-1.5 text-xs text-strong">
                {row.evidence.some((item) => item.dispute === "open") ? "A record this rests on is disputed. Decide the dispute in Performance & Coaching before approving." : "A record this rests on was corrected. It can be declined, or asked for again without that record."}
              </p>
            ) : null}
            {row.youMayDecide ? (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                <Field label="Note (needed to decline)">
                  <TextInput value={note} onChange={(event) => setNote(event.target.value)} />
                </Field>
                <Button variant="primary" size="sm" loading={busy} disabled={row.evidence.some((item) => item.dispute === "open" || item.dispute === "corrected")} onClick={() => void run(async () => setResult((await decide({ companyId, requestId: row.requestId, decision: "approved", note: note || undefined })).carriedOut?.detail ?? null))}>
                  Approve
                </Button>
                <Button variant="outline" size="sm" loading={busy} onClick={() => void run(async () => { await decide({ companyId, requestId: row.requestId, decision: "declined", note }); setResult("Declined."); })}>
                  Decline
                </Button>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="size-3.5" aria-hidden /> Waiting for an authorized person.
                <button type="button" className="font-medium text-brand-300 underline-offset-4 hover:underline" onClick={() => void run(() => withdraw({ companyId, requestId: row.requestId }))}>
                  Withdraw
                </button>
              </p>
            )}
          </li>
        ))}
        {decided.map((row) => (
          <li key={row.requestId} className="px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
            {row.kindWords} {row.status} by {row.decidedBy ?? "a person"}
            {row.carriedOut ? ` · ${row.carriedOut.detail}` : ""}
          </li>
        ))}
      </ul>
      {result ? (
        <p className="border-t border-border px-4 py-2.5 text-sm text-strong sm:px-5" role="status">
          {result}
        </p>
      ) : null}
      <div className="px-4 pb-3 sm:px-5">
        <FormError message={error} />
      </div>
    </section>
  );
}

// ── Sections ───────────────────────────────────────────────────────────────────────────────────────

function Card({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-2xl border border-border bg-card", className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="font-heading text-base tracking-tight text-strong">{title}</h2>
        {action}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function Fact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-strong">{children}</div>
      </div>
    </div>
  );
}

function AttentionList({ profile, onSection }: { profile: Profile; onSection?: (section: SectionId) => void }) {
  const openJob = useDetail();
  if (profile.attention.length === 0) return null;
  return (
    <ul className="grid gap-2">
      {profile.attention.map((item) => (
        <li key={item.id} className={cn("rounded-xl border px-3 py-2.5", item.severity === "urgent" ? "border-destructive/30 bg-destructive/5" : item.severity === "decide" ? "border-warning/50 bg-warning/5" : "border-border bg-muted/30")}>
          <p className="flex items-center gap-2 text-sm font-medium text-strong">
            <TriangleAlert className="size-4 shrink-0 text-warning-foreground" aria-hidden />
            {item.title}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
          {item.selestial ? (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-strong">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand-300" aria-hidden />
              {item.selestial}
            </p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {item.evidence
              .filter((row) => row.jobId)
              .map((row) => (
                <button key={row.jobId} type="button" onClick={() => openJob({ kind: "job", id: row.jobId as Id<"jobs"> })} className="rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-strong hover:border-brand-500/50">
                  {row.label}
                </button>
              ))}
            {onSection && item.section !== "overview" ? (
              <button type="button" onClick={() => onSection(item.section as SectionId)} className="text-[11px] font-medium text-brand-300 underline-offset-4 hover:underline">
                Go to {SECTIONS.find((section) => section.id === item.section)?.label}
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function OverviewSection({ profile, onSection }: { profile: Profile; onSection?: (section: SectionId) => void }) {
  const { timezone } = useCompany();
  const now = useNow();
  const openJob = useDetail();
  return (
    <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <ReadinessCard profile={profile} onSection={onSection} />
        {profile.attention.length > 0 ? (
          <Card title="Needs attention">
            <AttentionList profile={profile} onSection={onSection} />
          </Card>
        ) : null}
        <Card title="Coming up" action={onSection ? <SectionLink onClick={() => onSection("availability")}>Availability & jobs</SectionLink> : null}>
          {profile.upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No offers or accepted jobs in the next three weeks.</p>
          ) : (
            <ul className="grid gap-2">
              {profile.upcoming.slice(0, 4).map((row) => (
                <li key={row.assignmentId}>
                  <button type="button" onClick={() => openJob({ kind: "job", id: row.jobId as Id<"jobs"> })} className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2 text-left hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500">
                    <span className="grid w-12 shrink-0 text-center">
                      <span className="text-[11px] font-medium text-muted-foreground uppercase">{new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(new Date(row.startsAt))}</span>
                      <span className="font-heading text-lg leading-tight text-strong">{new Intl.DateTimeFormat("en-US", { timeZone: timezone, day: "numeric" }).format(new Date(row.startsAt))}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-strong">{row.label.split(",")[0]}</span>
                      <span className="block text-xs text-muted-foreground">
                        {clock(row.startsAt, timezone)} – {clock(row.endsAt, timezone)} · {row.status === "accepted" ? "Accepted" : "Offered, waiting for an answer"}
                      </span>
                      {row.conflict ? <span className="mt-0.5 block text-xs font-medium text-destructive-foreground">Conflict: {row.conflict}</span> : null}
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="grid content-start gap-4">
        <FollowUpsCard profile={profile} />
        <Card title="Details">
          <div className="grid gap-3">
            <Fact icon={MessageSquareText} label="Mobile">{profile.phone ?? <span className="text-muted-foreground">Not on file</span>}</Fact>
            <Fact icon={Mail} label="Email">{profile.email ? <span className="break-all">{profile.email}</span> : <span className="text-muted-foreground">Not on file</span>}</Fact>
            <Fact icon={MapPin} label="Service areas">
              {profile.areas.serviceAreas.length > 0 ? <Chips items={profile.areas.serviceAreas} max={8} label="Service areas" /> : <span className="text-muted-foreground">None set: no work can be offered</span>}
              {profile.areas.maxTravelMinutes ? <span className="mt-1 block text-xs text-muted-foreground">Travels up to {profile.areas.maxTravelMinutes} minutes</span> : null}
            </Fact>
            <Fact icon={Sparkles} label="Confirmed skills">{profile.skills.length > 0 ? <Chips items={profile.skills} max={8} tone="brand" label="Skills" /> : <span className="text-muted-foreground">None confirmed</span>}</Fact>
            <Fact icon={CalendarIcon} label="Weekly hours">
              {profile.availability.summary}
              <span className="block text-xs text-muted-foreground">{profile.availability.confirmedAt ? `Confirmed ${ago(profile.availability.confirmedAt, now, timezone)}` : "Never confirmed with them"}</span>
            </Fact>
            <Fact icon={User} label="With the company since">
              {longDay(profile.createdAt, timezone)}
              {profile.hiredFrom ? (
                <Link href={`/app/agents/recruiter/applicants?open=${profile.hiredFrom.applicationId}`} className="block text-xs font-medium text-brand-300 underline-offset-4 hover:underline">
                  Hired through Recruiter{profile.hiredFrom.role ? ` as ${profile.hiredFrom.role}` : ""}
                </Link>
              ) : null}
            </Fact>
          </div>
        </Card>
        {profile.subcontractor ? (
          <Card title="Subcontractor company">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-strong">
              {profile.subcontractor.name}
              {profile.subcontractor.status !== "active" ? <Badge variant={profile.subcontractor.status === "ended" ? "outline" : "warning"}>{profile.subcontractor.status === "ended" ? "Relationship ended" : "Paused"}</Badge> : null}
            </p>
            <p className="text-xs text-muted-foreground">
              Authorized contact: {profile.subcontractor.contact.name}
              {"email" in profile.subcontractor.contact && profile.subcontractor.contact.email ? ` · ${profile.subcontractor.contact.email}` : ""}
            </p>
            {profile.affiliations.length > 1 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Before: {profile.affiliations.filter((row) => row.to !== null).map((row) => `${row.name} until ${dayName(row.to!, timezone)}`).join("; ")}
              </p>
            ) : null}
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function SectionLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs font-medium text-brand-300 underline-offset-4 hover:underline">
      {children}
      <ArrowRight className="size-3.5" aria-hidden />
    </button>
  );
}

/** The weekly pattern drawn as a week of bars from 6 AM to 10 PM. */
function WeekBars({ windows }: { windows: Profile["availability"]["windows"] }) {
  const start = 6 * 60;
  const end = 22 * 60;
  const span = end - start;
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="grid gap-1.5" role="img" aria-label={windows.length ? `Weekly hours: ${order.filter((day) => windows.some((w) => w.weekday === day)).map((day) => `${DAYS[day]} ${windows.filter((w) => w.weekday === day).map((w) => `${minuteWords(w.startMinute)} to ${minuteWords(w.endMinute)}`).join(" and ")}`).join("; ")}` : "No weekly hours given"}>
      {order.map((day) => {
        const rows = windows.filter((w) => w.weekday === day);
        return (
          <div key={day} className="grid grid-cols-[2.5rem_1fr] items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{DAYS[day].slice(0, 3)}</span>
            <span className="relative h-5 rounded-md bg-muted">
              {rows.map((w) => (
                <span key={`${w.startMinute}-${w.endMinute}`} className="absolute inset-y-0 rounded-md bg-brand-500/80" style={{ left: `${(Math.max(0, w.startMinute - start) / span) * 100}%`, width: `${((Math.min(end, w.endMinute) - Math.max(start, w.startMinute)) / span) * 100}%` }} title={`${minuteWords(w.startMinute)} – ${minuteWords(w.endMinute)}`} />
              ))}
            </span>
          </div>
        );
      })}
      <div className="grid grid-cols-[2.5rem_1fr] gap-2 text-[10px] text-muted-foreground">
        <span />
        <span className="flex justify-between">
          <span>6 AM</span>
          <span>12 PM</span>
          <span>6 PM</span>
          <span>10 PM</span>
        </span>
      </div>
    </div>
  );
}

const ASSIGNMENT_WORDS: Record<string, string> = { accepted: "Accepted", offered: "Offered", declined: "Declined", expired: "No answer", cancelled: "Ended" };
const END_WORDS: Record<string, string> = { released: "released by a person", job_covered: "job was covered", job_cancelled: "job was cancelled", job_moved: "job moved", dropped: "they said they could not attend", no_show: "no-show declared by a person", undelivered: "offer was not delivered" };

type AvailabilityDialog = "week" | "away" | "date" | "confirm" | null;
const SOURCE_WORDS: Record<string, string> = { cleaner: "From them", subcontractor: "From their company", member: "Recorded" };

export function AvailabilitySection({ profile }: { profile: Profile }) {
  const { timezone, role } = useCompany();
  const now = useNow();
  const past = profile.history.filter((row) => row.startsAt < now);
  const openJob = useDetail();
  const [dialog, setDialog] = useState<AvailabilityDialog>(null);
  const manager = canManage(role) && profile.status !== "ended";
  const firstName = profile.name.trim().split(/\s+/)[0];
  const close = () => setDialog(null);
  return (
    <div className="grid gap-4 @3xl:grid-cols-2">
      {dialog === "week" ? <WeekDialog cleanerId={profile.cleanerId} firstName={firstName} windows={profile.availability.windows} onClose={close} /> : null}
      {dialog === "away" ? <TimeAwayDialog cleanerId={profile.cleanerId} firstName={firstName} onClose={close} /> : null}
      {dialog === "date" ? <ExceptionDialog cleanerId={profile.cleanerId} firstName={firstName} onClose={close} /> : null}
      {dialog === "confirm" ? <ConfirmHoursDialog cleanerId={profile.cleanerId} firstName={firstName} onClose={close} /> : null}
      <Card
        title="Weekly hours"
        action={
          manager ? (
            <Button variant="ghost" size="xs" onClick={() => setDialog("week")}>
              <PenLine aria-hidden />
              Change
            </Button>
          ) : null
        }
      >
        <WeekBars windows={profile.availability.windows} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{profile.availability.confirmedAt ? `Last confirmed ${longDay(profile.availability.confirmedAt, timezone)}.` : "Never confirmed with them."} Dispatch never offers a time outside these hours.</p>
          {manager && profile.availability.windows.length > 0 ? (
            <Button variant="outline" size="xs" onClick={() => setDialog("confirm")}>
              <Check aria-hidden />
              Still right
            </Button>
          ) : null}
        </div>
      </Card>
      <Card
        title="Time away and single dates"
        action={
          manager ? (
            <span className="flex gap-1">
              <Button variant="ghost" size="xs" onClick={() => setDialog("away")}>
                <Plus aria-hidden />
                Time away
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setDialog("date")}>
                <Plus aria-hidden />
                One date
              </Button>
            </span>
          ) : null
        }
      >
        {profile.availability.timeOff.length === 0 && profile.availability.exceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No time away or single dates ahead.</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {profile.availability.timeOff.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-2 rounded-xl border border-border px-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-strong">
                    Away {dayName(row.startsAt, timezone)} {clock(row.startsAt, timezone)} – {dayName(row.endsAt, timezone)} {clock(row.endsAt, timezone)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {SOURCE_WORDS[row.source ?? "member"]}
                    {row.note ? ` · ${row.note}` : ""}
                  </span>
                </span>
                {manager ? <RemoveButton what={{ timeOffId: row.id }} label={`Remove time away from ${dayName(row.startsAt, timezone)}`} /> : null}
              </li>
            ))}
            {profile.availability.exceptions.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-2 rounded-xl border border-border px-3 py-2">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 font-medium text-strong">
                    <Badge variant={row.kind === "available" ? "success" : "warning"} size="sm">
                      {row.kind === "available" ? "Can work" : "Cannot work"}
                    </Badge>
                    {longDay(Date.parse(`${row.date}T12:00:00Z`), "UTC")}
                    {row.startMinute !== null && row.endMinute !== null ? `, ${minuteWords(row.startMinute)} – ${minuteWords(row.endMinute)}` : ", all day"}
                  </span>
                  {row.note ? <span className="block text-xs text-muted-foreground">{row.note}</span> : null}
                </span>
                {manager ? <RemoveButton what={{ exceptionId: row.id }} label={`Remove the date ${row.date}`} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Upcoming work" className="@3xl:col-span-2">
        {profile.upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">No offers or accepted jobs in the next three weeks.</p>
        ) : (
          <ul className="grid gap-2">
            {profile.upcoming.map((row) => (
              <li key={row.assignmentId}>
                <button type="button" onClick={() => openJob({ kind: "job", id: row.jobId as Id<"jobs"> })} className={cn("flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm hover:border-brand-500/40", row.conflict ? "border-destructive/30 bg-destructive/5" : "border-border")}>
                  <span className="min-w-0">
                    <span className="block font-medium text-strong">{row.label}</span>
                    {row.conflict ? <span className="block text-xs font-medium text-destructive-foreground">Conflict: this job {row.conflict}. It stands until a person changes it in Dispatch.</span> : null}
                  </span>
                  <Badge variant={row.status === "accepted" ? "success" : "info"} size="sm">
                    {row.status === "accepted" ? "Accepted" : "Offered"}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Recent work, last 60 days" className="@3xl:col-span-2">
        {past.length === 0 ? (
          <p className="text-sm text-muted-foreground">No offers or jobs in the last 60 days.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Job</th>
                  <th className="py-1.5 pr-3 font-medium">Offer</th>
                  <th className="py-1.5 font-medium">On the day</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {past
                  .slice(0, 20)
                  .map((row) => (
                    <tr key={row.assignmentId}>
                      <td className="py-2 pr-3">
                        <button type="button" onClick={() => openJob({ kind: "job", id: row.jobId as Id<"jobs"> })} className="text-left font-medium text-strong underline-offset-4 hover:underline">
                          {row.label}
                        </button>
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {ASSIGNMENT_WORDS[row.assignment]}
                        {row.endCause ? ` (${END_WORDS[row.endCause] ?? row.endCause})` : ""}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">{row.assignment === "accepted" ? (row.checkedInAt ? `Checked in ${clock(row.checkedInAt, timezone)}` : row.job === "completed" ? "Completed, no check-in recorded" : "No check-in recorded") : "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

const GROUPS = ["blocks_assignments", "blocks_payment", "informational"] as const;

export function OnboardingSection({ profile }: { profile: Profile }) {
  const { companyId, timezone } = useCompany();
  const apply = useMutation(api.workforce.applyTemplateTo);
  const { busy, error, run } = useRun();
  return (
    <div className="grid gap-4">
      <ReadinessCard profile={profile} />
      <FollowUpsCard profile={profile} />
      <PortalAccessCard profile={profile} />
      {GROUPS.map((effect) => {
        const rows = profile.requirements.filter((row) => row.effect === effect);
        if (rows.length === 0) return null;
        return (
          <Card key={effect} title={EFFECT_WORDS[effect]}>
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.key} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-strong">
                      {row.met ? <Check className="size-4 text-success-foreground" aria-hidden /> : <span aria-hidden className="size-4 rounded-full border-2 border-border" />}
                      {row.label}
                    </p>
                    {row.description ? <p className="mt-0.5 pl-6 text-xs text-muted-foreground">{row.description}</p> : null}
                    <p className="mt-0.5 pl-6 text-xs text-muted-foreground">
                      {row.fromRecord ? "Read from their record. " : ""}
                      {row.submittedAt ? `Submitted ${dayName(row.submittedAt, timezone)}. ` : ""}
                      {row.reviewedAt ? `Reviewed ${dayName(row.reviewedAt, timezone)}. ` : ""}
                      {row.expiresAt ? `${row.state === "expired" ? "Expired" : "Valid until"} ${dayName(row.expiresAt, timezone)}. ` : ""}
                      {row.forServices.length > 0 ? `Only for ${row.forServices.join(", ")}. ` : ""}
                      {row.providedBy ? `Provided by the ${row.providedBy}. ` : ""}
                      {row.filesCount > 0 ? (row.files ? `Files: ${row.files.map((file) => file.name).join(", ")}. ` : `${plural(row.filesCount, "file")}, shown to the ${row.reviewer === "owner" ? "Owner" : "Owners and Managers"}. `) : ""}
                    </p>
                    {row.reviewNote ? <p className="mt-1 ml-6 rounded-lg bg-muted/50 px-2 py-1 text-xs text-strong">Review note: {row.reviewNote}</p> : null}
                    {row.waiverReason ? <p className="mt-1 ml-6 rounded-lg bg-muted/50 px-2 py-1 text-xs text-strong">Waived: {row.waiverReason}</p> : null}
                    <RequirementActions profile={profile} row={row} />
                  </div>
                  <RequirementBadge state={row.state} />
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      {profile.requirements.length === 0 ? <p className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">No onboarding requirements are assigned to them. Nothing holds up their work except their engagement status and availability.</p> : null}
      {profile.viewer.manager && profile.notAssigned.length > 0 && profile.status !== "ended" ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-4 sm:p-5">
          <p className="text-sm font-medium text-strong">Not part of their onboarding yet</p>
          <p className="mt-0.5 text-xs text-muted-foreground">These are in your template but were not given to {profile.name}. They hold up nothing until added.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chips items={profile.notAssigned.map((row) => row.label)} max={10} label="Not assigned" />
            <Button variant="outline" size="sm" loading={busy} onClick={() => void run(() => apply({ companyId, cleanerIds: [profile.cleanerId] }))}>
              Add {profile.notAssigned.length === 1 ? "it" : "them"}
            </Button>
          </div>
          <FormError message={error} />
        </div>
      ) : null}
    </div>
  );
}

export function SkillsSection({ profile }: { profile: Profile }) {
  const equipment = profile.requirements.filter((row) => row.kind === "equipment");
  return (
    <div className="grid gap-4 @3xl:grid-cols-2">
      <div className="@3xl:col-span-2">
        <SkillClaims profile={profile} />
      </div>
      <Card title="Confirmed skills">
        {profile.skills.length > 0 ? <Chips items={profile.skills} max={30} tone="brand" label="Skills" /> : <p className="text-sm text-muted-foreground">None confirmed. Jobs that need a skill are not offered to them.</p>}
        <p className="mt-3 text-xs text-muted-foreground">Dispatch matches a job&apos;s required skills against these confirmed skills only.</p>
      </Card>
      <Card title="Equipment">
        {equipment.length === 0 ? (
          <p className="text-sm text-muted-foreground">No equipment requirements apply to them.</p>
        ) : (
          <ul className="grid gap-2">
            {equipment.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium text-strong">{row.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {row.providedBy === "company" ? "The company provides it." : row.providedBy === "crew" ? "Their crew brings it." : "They bring their own."} {EFFECT_WORDS[row.effect]}.
                  </span>
                </span>
                <RequirementBadge state={row.state} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Crews" className="@3xl:col-span-2">
        {profile.crews.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not in any crew. Being in a crew never says someone is free: each member&apos;s own availability is checked.</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {profile.crews.map((crew) => (
              <li key={`${crew.crewId}-${crew.from}`} className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-medium text-strong">{crew.name}</span>
                  <span className="text-xs text-muted-foreground"> · {crew.kind === "temporary" ? "team for one job" : "permanent crew"}{crew.role === "lead" ? " · lead" : ""}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {crew.kind === "temporary" && crew.onJobWords ? `${crew.onJobWords} · ` : ""}
                  {crew.current ? "Current" : "Past"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function PaySection({ profile }: { profile: Profile }) {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const pay = useStableQuery(api.cleanerPay.summary, profile.viewer.owner && now ? { companyId, cleanerId: profile.cleanerId, asOf: now } : "skip");
  if (!profile.viewer.owner) {
    return <p className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">Pay is shown to the Owner only.</p>;
  }
  if (!pay) return <Skeleton className="h-48 rounded-2xl" />;
  return (
    <div className="grid gap-4 @3xl:grid-cols-2">
      <Card title="Arrangement">
        {pay.paidThrough ? (
          <p className="text-sm text-strong">
            Paid through <span className="font-medium">{pay.paidThrough.name}</span>
            {pay.paidThrough.pay ? `, at ${pay.paidThrough.pay}` : ", with no arrangement recorded yet"}. Workers supplied by a subcontractor company carry no pay terms of their own.
          </p>
        ) : pay.current ? (
          <p className="font-heading text-2xl text-strong">{pay.current.words}</p>
        ) : (
          <p className="text-sm text-muted-foreground">No pay arrangement. Dispatch leaves them out of offers until there is one.</p>
        )}
        {pay.pending.map((row) => (
          <p key={row.requestId} className="mt-2 rounded-lg bg-warning/8 px-2.5 py-1.5 text-xs text-strong">
            Waiting for your decision: {row.words}
            {row.effectiveAt ? ` from ${dayName(row.effectiveAt, timezone)}` : ""}.
          </p>
        ))}
        {pay.history.length > 0 ? (
          <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
            {pay.history.map((row) => (
              <li key={row.id}>
                {row.words}, {row.upcoming ? "from" : "since"} {dayName(row.effectiveFrom, timezone)}
                {row.effectiveTo ? ` until ${dayName(row.effectiveTo, timezone)}` : ""} · set by {row.setBy}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <Card title="Earnings and payments">
        <dl className="grid grid-cols-3 gap-2">
          {[
            { label: "To review", cents: pay.finance.reviewCents },
            { label: "Approved, not paid", cents: pay.finance.approvedUnpaidCents },
            { label: `Paid · ${plural(pay.finance.paidCount, "payment")}`, cents: pay.finance.paidCents },
          ].map((cell) => (
            <div key={cell.label} className="rounded-xl border border-border px-2.5 py-2">
              <dt className="text-[11px] leading-tight text-muted-foreground">{cell.label}</dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums text-strong">{money(cell.cents)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-muted-foreground">{pay.finance.words}</p>
        <p className="mt-2 text-sm text-strong">
          {plural(pay.stated.completedJobs, "completed job")} in the last 90 days, stated at {money(pay.stated.completedCents)} in total; {money(pay.finance.approvedCents)} approved in Team Pay.
        </p>
        {pay.adjustmentsPending.length > 0 ? (
          <div className="mt-3 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2.5">
            <p className="text-sm font-medium text-strong">Adjustments waiting for your approval</p>
            <ul className="mt-1 grid gap-1 text-xs text-muted-foreground">
              {pay.adjustmentsPending.map((row) => (
                <li key={row.earningId}>
                  <span className="font-medium tabular-nums text-strong">
                    {row.cents < 0 ? "−" : "+"}
                    {money(Math.abs(row.cents))}
                  </span>{" "}
                  on {row.label}: {row.reasons.join("; ")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <Link href={`/app/finance?tab=team-pay&cleaner=${profile.cleanerId}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-info-foreground underline-offset-4 hover:underline">
          Open in Team Pay
        </Link>
      </Card>
      <Card title="Payments" className="@3xl:col-span-2">
        {pay.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments recorded in Team Pay in the last 90 days.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {pay.payments.map((row) => (
              <li key={row.paymentId} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-strong">
                    {dayName(row.on, timezone)} · {row.method}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {row.status} · {plural(row.jobs, "job")}
                    {row.reference ? ` · reference ${row.reference}` : ""}
                  </span>
                </span>
                <span className={cn("font-medium tabular-nums", row.status === "Canceled" ? "text-muted-foreground line-through" : "text-strong")}>{money(row.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Pay stated on each job" className="@3xl:col-span-2">
        {pay.jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accepted jobs in the last 90 days.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {pay.jobs.map((row) => (
              <li key={row.jobId} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-strong">{row.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.jobStatus === "completed" ? (row.reviewed === "closed" ? "Completed and reviewed" : row.reviewed ? "Completed, closed without review" : "Completed, not reviewed") : row.jobStatus === "cancelled" ? "Cancelled" : "Not completed"}
                    {row.teamPay ? ` · Team Pay: ${row.teamPay.state}${row.teamPay.totalCents !== null && row.teamPay.totalCents !== row.payCents ? `, ${money(row.teamPay.totalCents)}` : ""}` : ""}
                  </span>
                </span>
                <span className="font-medium tabular-nums text-strong">{money(row.payCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function ActivitySection({ cleanerId }: { cleanerId: Id<"cleaners"> }) {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const openJob = useDetail();
  const rows = useQuery(api.cleanerProfile.activity, { companyId, cleanerId });
  const [more, setMore] = useState(false);
  if (!rows) return <Skeleton className="h-64 rounded-2xl" />;
  if (rows.length === 0) return <p className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">Nothing has happened on this record yet.</p>;
  const shown = more ? rows : rows.slice(0, 25);
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5" aria-label="Activity">
      <ol className="relative grid gap-0">
        {shown.map((row, index) => (
          <li key={row.id} className="relative flex gap-3 pb-4 last:pb-0">
            {index < shown.length - 1 ? <span aria-hidden className="absolute top-7 bottom-0 left-[13px] w-px bg-border" /> : null}
            <span className={cn("relative z-10 grid size-7 shrink-0 place-items-center rounded-full border", row.whoKind === "agent" ? "border-brand-500/40 bg-brand-500/10 text-brand-300" : row.tone === "message" ? "border-info/30 bg-info/10 text-info-foreground" : row.tone === "decision" ? "border-warning/50 bg-warning/10 text-warning-foreground" : "border-border bg-card text-muted-foreground")}>
              {row.tone === "message" ? <MessageSquareText className="size-3.5" aria-hidden /> : row.whoKind === "agent" ? <Sparkles className="size-3.5" aria-hidden /> : row.tone === "decision" ? <Hand className="size-3.5" aria-hidden /> : <HistoryIcon className="size-3.5" aria-hidden />}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm text-strong">
                <span className="font-medium">{row.who}</span> {row.text}
              </p>
              <p className="text-xs text-muted-foreground">
                {ago(row.at, now, timezone)}
                {row.jobId ? (
                  <>
                    {" · "}
                    <button type="button" className="font-medium text-brand-300 underline-offset-4 hover:underline" onClick={() => openJob({ kind: "job", id: row.jobId as Id<"jobs"> })}>
                      Open the job
                    </button>
                  </>
                ) : null}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {rows.length > 25 ? (
        <button type="button" onClick={() => setMore(!more)} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-300">
          {more ? "Show less" : `Show all ${rows.length}`}
          <ChevronDown className={cn("size-4", more && "rotate-180")} aria-hidden />
        </button>
      ) : null}
    </section>
  );
}


export function SectionBody({ section, profile, onSection }: { section: SectionId; profile: Profile; onSection?: (section: SectionId) => void }) {
  // Sections lay out by the room they have, so the same section reads well in the drawer and on the page.
  return <div className="@container">{sectionOf(section, profile, onSection)}</div>;
}

function sectionOf(section: SectionId, profile: Profile, onSection?: (section: SectionId) => void) {
  switch (section) {
    case "availability":
      return <AvailabilitySection profile={profile} />;
    case "onboarding":
      return <OnboardingSection profile={profile} />;
    case "skills":
      return <SkillsSection profile={profile} />;
    case "performance":
      return <PerformanceSection cleanerId={profile.cleanerId} name={profile.name} />;
    case "pay":
      return <PaySection profile={profile} />;
    case "activity":
      return <ActivitySection cleanerId={profile.cleanerId} />;
    default:
      return <OverviewSection profile={profile} onSection={onSection} />;
  }
}

/** The section tabs. On the page they are links, so each section has its own address. */
export function SectionTabs({ cleanerId, active, onSection }: { cleanerId: string; active: SectionId; onSection?: (section: SectionId) => void }) {
  return (
    <nav aria-label="Profile sections" className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {SECTIONS.map((section) => {
          const on = section.id === active;
          const className = cn("inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-brand-500", on ? "border-brand-500 text-strong" : "border-transparent text-muted-foreground hover:text-strong");
          return (
            <li key={section.id}>
              {onSection ? (
                <button type="button" aria-current={on ? "page" : undefined} onClick={() => onSection(section.id)} className={className}>
                  {section.label}
                </button>
              ) : (
                <Link href={profilePath(cleanerId, section.id)} aria-current={on ? "page" : undefined} className={className}>
                  {section.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
