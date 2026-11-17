"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Component, Suspense, useState } from "react";

import { EditDetailsForm, HoursForm, PayForm, StatusForm, TimeOffForm, WorkerTypeForm } from "@/components/app/cleaners/forms";
import { OnboardingSection, TextPermissionForm } from "@/components/app/cleaners/onboarding";
import { Avatar, Chips, ReadinessLine, StatusBadge, TypeLabel, type Profile } from "@/components/app/cleaners/shared";
import { canManage, useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { FormError, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { NotBuilt } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { ArrowLeft, ArrowRight, Building2, CalendarIcon, CheckCircle2, CircleDashed, DeviceMobileIcon, Info, Lock, Mail, MapPin, PenLine, Plus, TeamIcon, Trash2, TriangleAlert } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CLEANERS_ROOT, isSection, LAST_LIST_KEY, PROFILE_SECTIONS, type ProfileSectionId } from "@/lib/app/cleaners";
import { ago } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type Check = Profile["readiness"]["checks"][number];

const BLOCKS_WORDS: Record<Check["blocks"], string> = { assignments: "Blocks assignments", payment: "Blocks payment", info: "Good to know" };

/** Every readiness check: what is unmet first, each with what it blocks and where to fix it, then what is met, compactly. */
export function ReadinessChecklist({ checks, onSection }: { checks: Check[]; onSection?: (section: ProfileSectionId) => void }) {
  const unmet = [...checks.filter((check) => check.state === "unmet")].sort((a, b) => Number(b.blocks === "assignments") - Number(a.blocks === "assignments"));
  const met = checks.filter((check) => check.state === "met");
  return (
    <div className="grid gap-3">
      {unmet.length > 0 ? (
        <ul className="grid gap-1.5">
          {unmet.map((check) => (
            <li key={check.key} className={cn("flex items-start gap-2.5 rounded-xl border px-3 py-2", check.blocks === "assignments" ? "border-warning/40 bg-warning/5" : "border-border bg-muted/40")}>
              {check.blocks === "assignments" ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium text-strong">{check.label}</span>
                  <span className={cn("text-[11px] font-medium", check.blocks === "assignments" ? "text-warning-foreground" : "text-muted-foreground")}>{BLOCKS_WORDS[check.blocks]}</span>
                </span>
                <span className="block text-xs leading-relaxed text-muted-foreground">{check.detail}</span>
              </span>
              {onSection && check.section !== "overview" ? (
                <button type="button" onClick={() => onSection(check.section as ProfileSectionId)} className="shrink-0 rounded-md px-1.5 py-1 text-xs font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500 dark:text-brand-300">
                  Fix
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {met.length > 0 ? (
        <ul className="grid gap-x-4 gap-y-2 sm:grid-cols-2" aria-label="Met">
          {met.map((check) => (
            <li key={check.key} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-foreground" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm text-strong">{check.label}</span>
                <span className="block text-xs leading-snug text-muted-foreground">{check.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Card({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card", className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5">
        <h2 className="font-heading text-base tracking-tight text-strong">{title}</h2>
        {action}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm text-strong">{children}</dd>
    </div>
  );
}

type Open = "details" | "status" | "type" | "hours" | "timeoff" | "pay" | "permission" | null;

// ── The header ─────────────────────────────────────────────────────────────────────────────────

export function ProfileHeader({ profile, onEdit, compact }: { profile: Profile; onEdit?: (what: Open) => void; compact?: boolean }) {
  const manager = canManage(profile.viewer.role);
  return (
    <div className="flex items-start gap-3 sm:gap-4">
      <Avatar initials={profile.initials} seed={profile.cleanerId} size={compact ? "lg" : "xl"} className={compact ? "" : "max-sm:size-12 max-sm:text-base"} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className={cn("font-heading tracking-tight text-strong", compact ? "text-xl" : "text-2xl")}>{profile.name}</h1>
          <StatusBadge status={profile.status} size="default" />
        </div>
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
          {profile.preferredName ? <span>Goes by {profile.preferredName} ·</span> : null}
          <TypeLabel row={profile} />
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <ReadinessLine readiness={profile.readiness} className="text-sm" />
          {profile.crews.length > 0 ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <TeamIcon className="size-3.5" aria-hidden />
              {profile.crews.map((crew) => `${crew.name}${crew.role === "lead" ? " (lead)" : ""}`).join(", ")}
            </span>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {profile.phone ? (
            <Button variant="outline" size="sm" render={<a href={`tel:${profile.phone.replace(/[^\d+]/g, "")}`} />}>
              <DeviceMobileIcon aria-hidden /> Call
            </Button>
          ) : null}
          {profile.email ? (
            <Button variant="outline" size="sm" render={<a href={`mailto:${profile.email}`} />}>
              <Mail aria-hidden /> Email
            </Button>
          ) : null}
          {manager && onEdit ? (
            <>
              <Button variant="outline" size="sm" onClick={() => onEdit("details")}>
                <PenLine aria-hidden /> Edit details
              </Button>
              <Button variant={profile.status === "onboarding" ? "primary" : "outline"} size="sm" onClick={() => onEdit("status")}>
                {profile.status === "onboarding" ? "Make active" : profile.status === "ready" ? "Pause or end" : "Change status"}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Sections ───────────────────────────────────────────────────────────────────────────────────

/** Questions the cleaner sent from their portal. A person answers them; marking one answered stops it being listed. */
function HelpCard({ cleanerId }: { cleanerId: Id<"cleaners"> }) {
  const company = useCompany();
  const now = useNow();
  const rows = useQuery(api.workforce.helpRequests, now ? { companyId: company.companyId, cleanerId, asOf: now } : "skip");
  const answer = useMutation(api.workforce.answerHelp);
  const { busy, error, run } = useRun();
  if (!rows || rows.length === 0) return null;
  return (
    <Card title="Questions from them">
      <ul className="grid gap-2">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border border-brand-500/30 bg-brand-500/5 p-3">
            <p className="text-sm text-strong">“{row.text}”</p>
            <p className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                About {row.topic}, {row.when}. Reply by text or call them.
              </span>
              <Button size="xs" variant="outline" loading={busy} onClick={() => void run(() => answer({ companyId: company.companyId, helpRequestId: row.id }))}>
                Mark answered
              </Button>
            </p>
          </li>
        ))}
      </ul>
      <FormError message={error} />
    </Card>
  );
}

function OverviewSection({ profile, onSection, onEdit }: { profile: Profile; onSection: (section: ProfileSectionId) => void; onEdit: (what: Open) => void }) {
  const openJob = useDetail();
  return (
    <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
      <div className="grid content-start gap-4">
        <HelpCard cleanerId={profile.cleanerId} />
        {profile.attentionItems.length > 0 ? (
          <Card title="Needs attention">
            <ul className="grid gap-3">
              {profile.attentionItems.map((item) => (
                <li key={item.key} className="rounded-xl border border-warning/40 bg-warning/5 p-3">
                  <p className="text-sm font-medium text-strong">{item.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{item.detail}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.evidence.map((evidence, index) =>
                      evidence.jobId ? (
                        <button key={index} type="button" onClick={() => openJob({ kind: "job", id: evidence.jobId! })} className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs text-strong hover:border-brand-500/50">
                          <CalendarIcon className="size-3.5 text-muted-foreground" aria-hidden />
                          {evidence.label}
                        </button>
                      ) : null,
                    )}
                    <button type="button" onClick={() => onSection(item.action.section as ProfileSectionId)} className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-brand-500/30 bg-brand-500/8 px-2 text-xs font-medium text-strong hover:border-brand-500/60">
                      {item.action.label} <ArrowRight className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        <Card title="Readiness">
          <p className="mb-3 text-sm text-muted-foreground">
            {profile.readiness.state === "ready"
              ? "Dispatch can offer them work that fits their skills, areas and hours. Each job is still checked on its own."
              : profile.readiness.state === "blocked"
                ? "They are active, but Dispatch cannot offer them work until the items marked below are done."
                : profile.readiness.state === "onboarding"
                  ? "They are still onboarding. A person makes them active when they can take work."
                  : profile.readiness.state === "paused"
                    ? "Paused. Nobody offers them work until a person makes them active again."
                    : "Their engagement has ended. Their history is kept."}
          </p>
          <ReadinessChecklist checks={profile.readiness.checks} onSection={onSection} />
          {canManage(profile.viewer.role) && profile.readiness.checks.some((check) => check.key === "work_texts" && check.state === "unmet") ? (
            <Button className="mt-3" variant="outline" size="sm" onClick={() => onEdit("permission")}>
              Record their permission for work texts
            </Button>
          ) : null}
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            Payout readiness is kept by Finance, which is not built yet, so it is not shown here as ready or not ready.
          </p>
        </Card>
      </div>
      <div className="grid content-start gap-4">
        <Card title="Details" action={canManage(profile.viewer.role) ? <Button variant="ghost" size="xs" onClick={() => onEdit("details")}><PenLine aria-hidden /> Edit</Button> : null}>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Fact label="Mobile">{profile.phone ?? <span className="text-muted-foreground">Not on record</span>}</Fact>
            <Fact label="Email">{profile.email ? <span className="break-all">{profile.email}</span> : <span className="text-muted-foreground">Not on record</span>}</Fact>
            <Fact label="Worker type">
              <span className="flex flex-wrap items-center gap-2">
                <TypeLabel row={profile} />
                {profile.viewer.seesPay ? (
                  <button type="button" onClick={() => onEdit("type")} className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
                    Change
                  </button>
                ) : null}
              </span>
            </Fact>
            <Fact label="On record since">
              {profile.createdWords}
              <span className="block text-xs text-muted-foreground">{profile.source === "import" ? "Imported from a list" : profile.source === "hiring" ? "From an accepted hiring offer" : "Added by hand"}</span>
            </Fact>
            <Fact label="Service areas">
              <Chips values={profile.serviceAreas} max={8} empty="None set" mono />
            </Fact>
            <Fact label="Weekly hours">{profile.hoursWords}</Fact>
          </dl>
          {profile.applicationId ? (
            <Link href={`/app/agents/recruiter/applicants?application=${profile.applicationId}`} className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
              Their hiring history in Recruiter <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          ) : null}
        </Card>
        {profile.statusChange ? (
          <Card title="Status">
            <p className="text-sm text-strong">
              {profile.statusWords} since {profile.statusChange.at}
              {profile.statusChange.by ? `, set by ${profile.statusChange.by}` : ""}.
            </p>
            {profile.statusChange.note ? <p className="mt-1 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">“{profile.statusChange.note}”</p> : null}
            {profile.statusChange.noteHidden ? (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3.5" aria-hidden /> A reason was recorded. Managers and the Owner can read it.
              </p>
            ) : null}
          </Card>
        ) : null}
        {profile.subcontractor || profile.affiliationHistory.length > 0 ? (
          <Card title="Supplied by">
            {profile.subcontractor ? (
              <p className="flex items-center gap-2 text-sm text-strong">
                <Building2 className="size-4 text-muted-foreground" aria-hidden />
                {profile.subcontractor.name}
                {profile.subcontractor.status !== "active" ? <Badge variant="warning" size="sm">{profile.subcontractor.status}</Badge> : null}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Works directly for the company now.</p>
            )}
            {profile.affiliationHistory.length > 0 ? (
              <ol className="mt-3 grid gap-1 border-l border-border pl-3">
                {profile.affiliationHistory.map((row, index) => (
                  <li key={index} className="text-xs text-muted-foreground">
                    <span className="text-strong">{row.subcontractor}</span> · {row.from} – {row.until ?? "now"}
                  </li>
                ))}
              </ol>
            ) : null}
          </Card>
        ) : null}
      </div>
    </div>
  );
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Days with the same hours on one line: "Mon–Fri, 7:00 AM – 6:00 PM". */
function groupedHours(windows: Profile["windows"]): string[] {
  const byHours = new Map<string, { days: number[]; words: string }>();
  for (const window of windows) {
    const key = `${window.startMinute}-${window.endMinute}`;
    const hours = window.words.slice(window.words.indexOf(" ") + 1);
    const entry = byHours.get(key) ?? { days: [], words: hours };
    entry.days.push(window.weekday);
    byHours.set(key, entry);
  }
  return [...byHours.values()].map((entry) => {
    const days = [...new Set(entry.days)].sort((a, b) => a - b);
    const groups: number[][] = [];
    for (const day of days) {
      const last = groups[groups.length - 1];
      if (last && last[last.length - 1] === day - 1) last.push(day);
      else groups.push([day]);
    }
    const dayWords = days.length === 7 ? "Every day" : groups.map((group) => (group.length >= 3 ? `${DAY_SHORT[group[0]]}–${DAY_SHORT[group[group.length - 1]]}` : group.map((day) => DAY_SHORT[day]).join(", "))).join(", ");
    return `${dayWords}, ${entry.words}`;
  });
}

/** The week at a glance: each day's hours as a bar on a 6 AM – 10 PM ruler. */
function WeekBars({ windows }: { windows: Profile["windows"] }) {
  const start = 6 * 60;
  const span = 16 * 60;
  return (
    <div className="grid gap-1.5" role="img" aria-label={windows.length === 0 ? "No hours on record" : `Weekly hours: ${windows.map((window) => window.words).join("; ")}`}>
      {DAY_SHORT.map((day, weekday) => {
        const own = windows.filter((window) => window.weekday === weekday);
        return (
          <div key={day} className="grid grid-cols-[2.5rem_1fr] items-center gap-2">
            <span className={cn("text-xs", own.length > 0 ? "font-medium text-strong" : "text-muted-foreground")}>{day}</span>
            <span className="relative h-5 rounded-md bg-muted/60">
              {own.map((window, index) => {
                const left = Math.max(0, ((window.startMinute - start) / span) * 100);
                const right = Math.min(100, ((window.endMinute - start) / span) * 100);
                return <span key={index} className="absolute inset-y-0.5 rounded bg-brand-500/70" style={{ left: `${left}%`, width: `${Math.max(2, right - left)}%` }} title={window.words} />;
              })}
            </span>
          </div>
        );
      })}
      <div className="grid grid-cols-[2.5rem_1fr] gap-2 text-[10px] text-muted-foreground">
        <span />
        <span className="flex justify-between">
          <span>6 AM</span>
          <span>Noon</span>
          <span>6 PM</span>
          <span>10 PM</span>
        </span>
      </div>
    </div>
  );
}

function AvailabilitySection({ profile, onEdit }: { profile: Profile; onEdit: (what: Open) => void }) {
  const company = useCompany();
  const now = useNow();
  const jobs = useQuery(api.workforce.jobs, now ? { companyId: company.companyId, cleanerId: profile.cleanerId, asOf: now } : "skip");
  const removeTimeOff = useMutation(api.availability.removeTimeOff);
  const openJob = useDetail();
  const { error, run } = useRun();
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <div className="grid content-start gap-4">
        <Card title="Weekly hours" action={<Button variant="ghost" size="xs" onClick={() => onEdit("hours")}><PenLine aria-hidden /> Edit</Button>}>
          <WeekBars windows={profile.windows} />
          {profile.windows.length > 0 ? (
            <ul className="mt-3 grid gap-0.5 text-xs text-muted-foreground">
              {groupedHours(profile.windows).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-warning-foreground">No hours on record, so they cannot be offered any visit.</p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">On your company&apos;s clock ({profile.timezone}). These are the hours they said they can work, not a schedule.</p>
        </Card>
        <Card title="Time away" action={<Button variant="ghost" size="xs" onClick={() => onEdit("timeoff")}><Plus aria-hidden /> Add</Button>}>
          {profile.timeOff.length === 0 ? (
            <p className="text-sm text-muted-foreground">No time away coming up.</p>
          ) : (
            <ul className="grid gap-2">
              {profile.timeOff.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-2 rounded-xl border border-border px-3 py-2">
                  <span>
                    <span className="block text-sm text-strong">{item.words}</span>
                    {item.note ? <span className="block text-xs text-muted-foreground">{item.note}</span> : null}
                  </span>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove time away ${item.words}`} onClick={() => void run(() => removeTimeOff({ companyId: company.companyId, timeOffId: item.id }))}>
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <FormError message={error} />
        </Card>
        <Card title="Service areas">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Chips values={profile.serviceAreas} max={30} empty="None set: no visit matches them." mono />
          </div>
          {canManage(profile.viewer.role) ? (
            <button type="button" onClick={() => onEdit("details")} className="mt-3 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
              Change service areas
            </button>
          ) : null}
        </Card>
      </div>
      <div className="grid content-start gap-4">
        <Card title="Upcoming work">
          {jobs === undefined ? (
            <Skeleton className="h-16" />
          ) : jobs.upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accepted visits or open offers.</p>
          ) : (
            <ul className="grid gap-2">
              {jobs.upcoming.map((row) => (
                <li key={row.assignmentId}>
                  <button type="button" onClick={() => openJob({ kind: "job", id: row.jobId })} className="flex w-full items-start justify-between gap-3 rounded-xl border border-border px-3 py-2.5 text-left hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-strong">{row.when}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.service} · {row.customer}
                        {row.role ? ` · ${row.role}` : ""}
                      </span>
                    </span>
                    <Badge variant={row.status === "accepted" ? "success" : "info"} size="sm">
                      {row.statusWords}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent history">
          {jobs === undefined ? (
            <Skeleton className="h-24" />
          ) : jobs.past.length === 0 ? (
            <p className="text-sm text-muted-foreground">No past offers or visits yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {jobs.past.map((row) => (
                <li key={row.assignmentId}>
                  <button type="button" onClick={() => openJob({ kind: "job", id: row.jobId })} className="flex w-full items-start justify-between gap-3 py-2 text-left hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-brand-500">
                    <span className="min-w-0">
                      <span className="block text-sm text-strong">{row.when}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.service} · {row.customer}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs text-muted-foreground">
                      {row.completed ? "Visit closed" : row.statusWords}
                      {row.checkedIn ? <span className="block">Checked in {row.checkedIn}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">An offer they did not answer is shown apart from one they declined. Neither is a judgement of them.</p>
        </Card>
      </div>
    </div>
  );
}

function SkillsSection({ profile, onEdit }: { profile: Profile; onEdit: (what: Open) => void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Skills" action={canManage(profile.viewer.role) ? <Button variant="ghost" size="xs" onClick={() => onEdit("details")}><PenLine aria-hidden /> Edit</Button> : null}>
        {profile.skills.length === 0 ? <p className="text-sm text-muted-foreground">No skills on record. They match only visits that need no particular skill.</p> : <Chips values={profile.skills} max={40} />}
        <p className="mt-3 text-xs text-muted-foreground">A skill here is what the company recorded. Confirmed qualifications, with who confirmed them and when, come with onboarding requirements.</p>
      </Card>
      <NotBuilt title="Equipment is not tracked yet" body="What each service needs, and whether the company, the cleaner or the crew provides it, comes with onboarding requirements. Nothing here sets a supply threshold." />
    </div>
  );
}

function PaySection({ profile, onEdit }: { profile: Profile; onEdit: (what: Open) => void }) {
  const company = useCompany();
  const now = useNow();
  const pay = useQuery(api.workforce.pay, profile.viewer.seesPay && now ? { companyId: company.companyId, cleanerId: profile.cleanerId, asOf: now } : "skip");
  if (!profile.viewer.seesPay) {
    return (
      <Card title="Pay">
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          Pay is shown to the Owner only. Readiness says whether pay is set, never what it is.
        </p>
      </Card>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <div className="grid content-start gap-4">
        <Card title="Pay arrangement" action={<Button variant="ghost" size="xs" onClick={() => onEdit("pay")}><PenLine aria-hidden /> {pay?.arrangement ? "Change" : "Set pay"}</Button>}>
          {pay === undefined ? (
            <Skeleton className="h-12" />
          ) : pay.arrangement ? (
            <>
              <p className="font-heading text-xl tracking-tight text-strong">{pay.arrangement.words}</p>
              <p className="mt-1 text-xs text-muted-foreground">{pay.lastChanged ? `Last changed ${pay.lastChanged}.` : "Set before changes were recorded."} A change applies to offers made after it.</p>
            </>
          ) : (
            <p className="text-sm text-warning-foreground">Not set. Dispatch cannot offer them work until it is, because an offer states the person&apos;s pay.</p>
          )}
        </Card>
        <Card title="Earnings and payments">
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {pay?.finance.words ?? "Approved earnings and payments are kept by Finance, which is not built yet."}
          </p>
        </Card>
      </div>
      <Card title="Pay stated on each job">
        {pay === undefined ? (
          <Skeleton className="h-24" />
        ) : pay.jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accepted jobs or open offers yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th scope="col" className="py-1.5 pr-3">Visit</th>
                  <th scope="col" className="py-1.5 pr-3">Status</th>
                  <th scope="col" className="py-1.5 text-right">Pay as offered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pay.jobs.map((row) => (
                  <tr key={row.jobId}>
                    <td className="py-2 pr-3">
                      <span className="block text-strong">{row.when}</span>
                      <span className="block text-xs text-muted-foreground">{row.service} · offered {row.offeredOn}</span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{row.status}</td>
                    <td className="py-2 text-right font-medium text-strong tabular-nums">{row.pay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Each job keeps the pay its offer stated, so a later change of rate never rewrites an earlier job. This is not a payment record.</p>
      </Card>
    </div>
  );
}

function ActivitySection({ profile }: { profile: Profile }) {
  const company = useCompany();
  const now = useNow();
  const rows = useQuery(api.workforce.activity, now ? { companyId: company.companyId, cleanerId: profile.cleanerId, asOf: now } : "skip");
  const openJob = useDetail();
  return (
    <Card title="Activity">
      {rows === undefined ? (
        <Skeleton className="h-32" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ol className="relative grid gap-3 border-l border-border pl-4">
          {rows.map((row) => (
            <li key={row.id} className="relative">
              <span aria-hidden className={cn("absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card", row.actor.kind === "agent" ? "bg-brand-500" : row.actor.kind === "member" ? "bg-slate-400" : "bg-muted-foreground/50")} />
              <p className="text-sm text-strong">
                <span className="font-medium">{row.actor.label}</span> {row.text}
              </p>
              <p className="text-xs text-muted-foreground">
                {now ? ago(row.at, now, company.timezone) : null}
                {row.ref?.kind === "job" ? (
                  <>
                    {" · "}
                    <button type="button" onClick={() => openJob(row.ref!)} className="font-medium text-brand-700 hover:underline dark:text-brand-300">
                      Open the visit
                    </button>
                  </>
                ) : null}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// ── The page ───────────────────────────────────────────────────────────────────────────────────

function Tabs({ active, onPick, attention }: { active: ProfileSectionId; onPick: (section: ProfileSectionId) => void; attention: number }) {
  return (
    <nav aria-label="Profile sections" className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {PROFILE_SECTIONS.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => onPick(section.id)}
              aria-current={active === section.id ? "page" : undefined}
              className={cn("relative inline-flex h-10 items-center gap-1.5 px-3 text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-brand-500", active === section.id ? "text-strong after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-500" : "text-muted-foreground hover:text-strong")}
            >
              {section.label}
              {section.id === "overview" && attention > 0 ? <span className="rounded-full bg-warning/15 px-1.5 text-[11px] font-semibold text-warning-foreground tabular-nums">{attention}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function ProfileModals({ profile, open, onClose }: { profile: Profile; open: Open; onClose: () => void }) {
  const company = useCompany();
  const subs = useQuery(api.subcontractors.list, open === "type" ? { companyId: company.companyId } : "skip");
  const pay = useQuery(api.workforce.pay, open === "pay" && profile.viewer.seesPay ? { companyId: company.companyId, cleanerId: profile.cleanerId, asOf: profile.asOf } : "skip");
  return (
    <>
      <Modal open={open === "details"} onClose={onClose} title={`Edit ${profile.name}`} description="Details everyone who schedules can see.">
        <EditDetailsForm profile={profile} onDone={onClose} />
      </Modal>
      <Modal open={open === "status"} onClose={onClose} title="Engagement status" description="A person decides this. Agents never change it.">
        <StatusForm profile={profile} onDone={onClose} />
      </Modal>
      <Modal open={open === "type"} onClose={onClose} title="Worker type" description="The Owner records how this person works with the company.">
        {subs ? <WorkerTypeForm profile={profile} subcontractors={subs} onDone={onClose} /> : <Skeleton className="h-24" />}
      </Modal>
      <Modal open={open === "hours"} onClose={onClose} title="Weekly hours" description="The days and times they said they can work.">
        <HoursForm cleanerId={profile.cleanerId} windows={profile.windows} timezone={profile.timezone} onDone={onClose} />
      </Modal>
      <Modal open={open === "timeoff"} onClose={onClose} title="Add time away" description="They are offered nothing in this time.">
        <TimeOffForm cleanerId={profile.cleanerId} timezone={profile.timezone} onDone={onClose} />
      </Modal>
      <Modal open={open === "permission"} onClose={onClose} title="Permission for work texts" description="Texts to a cleaner go out only with their recorded permission. Record how they gave it.">
        <TextPermissionForm cleanerId={profile.cleanerId} onDone={onClose} />
      </Modal>
      <Modal open={open === "pay"} onClose={onClose} title="Pay" description="The Owner's decision. Agents never change pay.">
        {pay !== undefined || !profile.viewer.seesPay ? <PayForm cleanerId={profile.cleanerId} engagement={profile.engagement} current={pay?.arrangement ?? null} onDone={onClose} /> : <Skeleton className="h-24" />}
      </Modal>
    </>
  );
}

function ProfileLoading() {
  return (
    <div className="grid gap-5" aria-busy="true" aria-label="Loading profile">
      <div className="flex gap-4">
        <Skeleton className="size-16 rounded-full" />
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-8 w-80" />
        </div>
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}

class Boundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <p className="text-base font-semibold text-strong">This profile cannot be opened</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">It may have been removed, the link may be incomplete, or it may belong to a company you are not signed in to.</p>
        <Button className="mt-4" variant="outline" size="sm" render={<Link href={CLEANERS_ROOT} />}>
          Back to Cleaners
        </Button>
      </div>
    );
  }
}

/** Back to the list exactly as it was left: its search, filters and view. The side panel is not reopened. */
function BackLink() {
  const router = useRouter();
  return (
    <Link
      href={CLEANERS_ROOT}
      onClick={(event) => {
        try {
          const last = window.sessionStorage.getItem(LAST_LIST_KEY);
          if (!last) return;
          const params = new URLSearchParams(last);
          params.delete("cleaner");
          const text = params.toString();
          event.preventDefault();
          router.push(`${CLEANERS_ROOT}${text ? `?${text}` : ""}`);
        } catch {
          // Storage refused: the plain list.
        }
      }}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500"
    >
      <ArrowLeft className="size-4" aria-hidden /> Cleaners
    </Link>
  );
}

function Page({ cleanerId }: { cleanerId: Id<"cleaners"> }) {
  const company = useCompany();
  const now = useNow();
  const params = useSearchParams();
  const router = useRouter();
  const section: ProfileSectionId = isSection(params.get("section")) ? (params.get("section") as ProfileSectionId) : "overview";
  const profile = useQuery(api.workforce.profile, now ? { companyId: company.companyId, cleanerId, asOf: now } : "skip");
  const [open, setOpen] = useState<Open>(null);
  const pick = (next: ProfileSectionId) => router.replace(`${CLEANERS_ROOT}/${cleanerId}${next === "overview" ? "" : `?section=${next}`}`, { scroll: false });
  if (profile === undefined) return <ProfileLoading />;
  return (
    <div className="grid gap-5">
      <BackLink />
      <ProfileHeader profile={profile} onEdit={setOpen} />
      <Tabs active={section} onPick={pick} attention={profile.attentionItems.length} />
      {section === "overview" ? <OverviewSection profile={profile} onSection={pick} onEdit={setOpen} /> : null}
      {section === "availability" ? <AvailabilitySection profile={profile} onEdit={setOpen} /> : null}
      {section === "onboarding" ? <OnboardingSection profile={profile} /> : null}
      {section === "skills" ? <SkillsSection profile={profile} onEdit={setOpen} /> : null}
      {section === "performance" ? <NotBuilt title="Performance and coaching are not built yet" body="Factual measures with their time period and number of jobs, an explainable score once there is enough history, and coaching notes come in a later phase. Nothing ranks this person until then." /> : null}
      {section === "pay" ? <PaySection profile={profile} onEdit={setOpen} /> : null}
      {section === "activity" ? <ActivitySection profile={profile} /> : null}
      <ProfileModals profile={profile} open={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** One worker's own page, deep-linkable to a section with `?section=`. */
export function CleanerProfilePage({ cleanerId }: { cleanerId: string }) {
  return (
    <Boundary>
      <Suspense fallback={<ProfileLoading />}>
        <Page cleanerId={cleanerId as Id<"cleaners">} />
      </Suspense>
    </Boundary>
  );
}
