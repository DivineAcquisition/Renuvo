"use client";

/**
 * Crews: permanent crews with a lead, the teams put together for upcoming jobs, and a crew builder for one
 * job. Being in a crew never means someone is free: in the builder each person is checked for that job with
 * Dispatch's own rules, the reason anyone cannot take it is shown, and places still open stay visible.
 * Offers go out through Dispatch, so a crew cannot be offered around the checks that protect a cleaner's time.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { canManage, useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { PageHeader } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { ArrowLeft, CalendarIcon, Check, Crown, PenLine, Plus, Search, Sparkles, TriangleAlert, Users, X } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clock, dayName, money } from "@/lib/app/format";
import { useStableQuery } from "@/lib/app/stable-query";
import { cn } from "@/lib/utils";

import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Avatar, ReadinessBadge } from "./bits";
import { CLEANERS_PATH, profilePath } from "./state";

type Crew = FunctionReturnType<typeof api.crews.list>[number];
type ForJob = FunctionReturnType<typeof api.crews.forJob>;
type Person = ForJob["people"][number];
type Result = FunctionReturnType<typeof api.crews.assembleForJob>;

const DAY = 86_400_000;
const CREWS_PATH = `${CLEANERS_PATH}/crews`;

function setJobParam(jobId: string | null) {
  const url = new URL(window.location.href);
  if (jobId) url.searchParams.set("job", jobId);
  else url.searchParams.delete("job");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export function CrewsScreen() {
  const { companyId, role } = useCompany();
  const now = useNow();
  const manager = canManage(role);
  const crews = useStableQuery(api.crews.list, now ? { companyId, asOf: now } : "skip");
  const params = useSearchParams();
  const jobId = params.get("job");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Crew | null>(null);
  const permanent = crews?.filter((crew) => crew.kind === "permanent") ?? [];
  const teams = crews?.filter((crew) => crew.kind === "temporary") ?? [];
  return (
    <>
      <Link href={CLEANERS_PATH} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-strong">
        <ArrowLeft className="size-4" aria-hidden />
        Cleaners
      </Link>
      <PageHeader
        title="Crews"
        lead="Permanent crews with a lead, and the team put together for each job. Being in a crew never means someone is free: each person is checked for each job."
        actions={
          manager ? (
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              Create crew
            </Button>
          ) : null
        }
      />
      {creating ? <CrewDialog onClose={() => setCreating(false)} /> : null}
      {editing ? <CrewDialog crew={editing} onClose={() => setEditing(null)} /> : null}

      <div className="grid grid-cols-1 gap-6">
        <JobPicker selected={jobId} />
        {jobId ? <CrewBuilder key={jobId} jobId={jobId as Id<"jobs">} manager={manager} /> : null}

        <section aria-labelledby="crews-heading" className="grid gap-3">
          <h2 id="crews-heading" className="font-display text-lg font-semibold text-strong">
            Permanent crews
          </h2>
          {!crews ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-44 rounded-2xl" />
              ))}
            </div>
          ) : permanent.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center">
              <Users className="mx-auto size-6 text-muted-foreground" aria-hidden />
              <p className="mt-2 font-medium text-strong">No crews yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">A crew is people who usually work together, with one lead. Jobs can still be staffed person by person.</p>
              {manager ? (
                <Button className="mt-4" variant="primary" size="sm" onClick={() => setCreating(true)}>
                  <Plus aria-hidden />
                  Create crew
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {permanent.map((crew) => (
                <li key={crew.crewId}>
                  <CrewCard crew={crew} onEdit={manager ? () => setEditing(crew) : undefined} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {teams.length > 0 ? (
          <section aria-labelledby="teams-heading" className="grid gap-3">
            <div>
              <h2 id="teams-heading" className="font-display text-lg font-semibold text-strong">
                Teams for jobs
              </h2>
              <p className="text-sm text-muted-foreground">Each keeps the people it was put together with, whatever happens to a permanent crew later, and shows who is on the job now.</p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {teams.map((crew) => (
                <li key={crew.crewId}>
                  <CrewCard crew={crew} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}

/** Where a person on a team stands on its job, as a badge. Someone no longer on it is not shown as a problem. */
const STANDING_BADGE: Record<NonNullable<Crew["members"][number]["onJob"]>, "success" | "info" | "outline"> = { accepted: "success", offered: "info", declined: "outline", expired: "outline", off: "outline" };

function CrewCard({ crew, onEdit }: { crew: Crew; onEdit?: () => void }) {
  const openJob = useDetail();
  const team = crew.staffing;
  const cancelled = crew.job?.status === "cancelled";
  return (
    <article className="flex h-full flex-col rounded-2xl border border-border bg-card p-4">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-strong">{crew.name}</h3>
          {team ? (
            cancelled ? (
              <p className="text-xs text-muted-foreground">The job was cancelled.</p>
            ) : (
              <StaffingDots required={team.required} accepted={team.accepted} offered={team.offersOut} />
            )
          ) : (
            <p className="text-xs text-muted-foreground">
              {crew.members.length} {crew.members.length === 1 ? "person" : "people"} · {crew.ready} ready for assignments
              {crew.subcontractor ? ` · from ${crew.subcontractor.name}` : ""}
            </p>
          )}
        </div>
        {onEdit ? (
          <Button variant="ghost" size="xs" onClick={onEdit}>
            <PenLine aria-hidden />
            Change
          </Button>
        ) : null}
      </header>
      {crew.job ? (
        <button type="button" onClick={() => openJob({ kind: "job", id: crew.job!.jobId as Id<"jobs"> })} className="mt-2 inline-flex items-center gap-1.5 self-start rounded-lg bg-muted px-2 py-1 text-xs font-medium text-strong hover:bg-muted/70">
          <CalendarIcon className="size-3.5" aria-hidden />
          {crew.job.label}
        </button>
      ) : null}
      <ul className="mt-3 grid gap-1.5">
        {crew.members.map((member) => {
          const gone = member.onJob !== null && member.onJob !== "accepted" && member.onJob !== "offered";
          return (
            <li key={member.cleanerId} className={cn("flex items-center gap-2 text-sm", gone && "opacity-70")}>
              <Avatar name={member.name} initials={member.initials} size="sm" />
              <span className="min-w-0 flex-1">
                <Link href={profilePath(member.cleanerId)} className="block truncate font-medium text-strong underline-offset-4 hover:underline">
                  {member.name}
                </Link>
                {!member.fromTeam ? <span className="block text-xs text-muted-foreground">Added to the job in Dispatch</span> : null}
              </span>
              {member.role === "lead" ? (
                <Badge variant="secondary" size="sm">
                  <Crown aria-hidden />
                  Lead
                </Badge>
              ) : null}
              {member.onJob ? (
                <Badge variant={STANDING_BADGE[member.onJob]} size="sm">
                  {member.onJobWords}
                </Badge>
              ) : (
                <span className={cn("size-2 shrink-0 rounded-full", member.readiness === "ready" ? "bg-success" : member.readiness === "blocked" ? "bg-destructive" : "bg-muted-foreground/40")} title={member.readiness === "ready" ? "Ready for assignments" : "Not ready for assignments"} />
              )}
            </li>
          );
        })}
      </ul>
      {crew.equipment.length ? <p className="mt-3 text-xs text-muted-foreground">Brings: {crew.equipment.join(", ")}</p> : null}
    </article>
  );
}

// ── Choosing a job ──────────────────────────────────────────────────────────────────────────────────

function JobPicker({ selected }: { selected: string | null }) {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const from = now ? Math.floor(now / DAY) * DAY : 0;
  const board = useStableQuery(api.dispatchViews.board, now ? { companyId, from, to: from + 15 * DAY } : "skip");
  const [chosen, setChosen] = useState(selected);
  const jobs = (board?.jobs ?? []).filter((job) => job.status === "scheduled" && job.startsAt > now && (job.openPlaces > 0 || job.jobId === chosen));
  const pick = (jobId: string | null) => {
    setChosen(jobId);
    setJobParam(jobId);
  };
  return (
    <section aria-labelledby="builder-heading" className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="builder-heading" className="font-display text-lg font-semibold text-strong">
            Build a crew for a job
          </h2>
          <p className="text-sm text-muted-foreground">Scheduled jobs in the next two weeks with places still open.</p>
        </div>
        {chosen ? (
          <Button variant="ghost" size="xs" onClick={() => pick(null)}>
            <X aria-hidden />
            Close
          </Button>
        ) : null}
      </div>
      {!board ? (
        <Skeleton className="mt-3 h-20 rounded-xl" />
      ) : jobs.length === 0 ? (
        <p className="mt-3 rounded-xl bg-muted/40 px-3 py-3 text-sm text-muted-foreground">Every scheduled job in the next two weeks has the cleaners it needs.</p>
      ) : (
        <ul className="-mx-1 mt-3 flex snap-x gap-2 overflow-x-auto px-1 pb-1" aria-label="Jobs with open places">
          {jobs.map((job) => (
            <li key={job.jobId} className="snap-start">
              <button type="button" aria-pressed={chosen === job.jobId} onClick={() => pick(job.jobId)} className={cn("flex w-56 flex-col gap-1 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-brand-500", chosen === job.jobId ? "border-brand-500 bg-brand-500/5" : "border-border hover:border-brand-500/40")}>
                <span className="text-xs font-medium text-muted-foreground">
                  {dayName(job.startsAt, timezone)} · {clock(job.startsAt, timezone)}
                </span>
                <span className="truncate font-medium text-strong">
                  {job.customer ?? "Customer"} · {job.serviceType}
                </span>
                <StaffingDots required={job.requiredCrew} accepted={job.acceptedCrew} offered={job.offersOut} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StaffingDots({ required, accepted, offered }: { required: number; accepted: number; offered: number }) {
  const offeredShown = Math.min(offered, Math.max(0, required - accepted));
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="flex gap-0.5" aria-hidden>
        {Array.from({ length: required }, (_, index) => (
          <span key={index} className={cn("h-1.5 w-4 rounded-full", index < accepted ? "bg-success" : index < accepted + offeredShown ? "bg-info" : "bg-muted-foreground/25")} />
        ))}
      </span>
      {accepted} of {required} accepted{offered ? ` · ${offered} offered` : ""}
    </span>
  );
}

// ── The builder ─────────────────────────────────────────────────────────────────────────────────────

function CrewBuilder({ jobId, manager }: { jobId: Id<"jobs">; manager: boolean }) {
  const { companyId, timezone, role } = useCompany();
  const data = useQuery(api.crews.forJob, { companyId, jobId });
  const assemble = useMutation(api.crews.assembleForJob);
  const { busy, error, run } = useRun();
  const [chosen, setChosen] = useState<string[]>([]);
  const [lead, setLead] = useState<string | null>(null);
  const [fromCrew, setFromCrew] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [search, setSearch] = useState("");
  const openJob = useDetail();

  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.people ?? []).filter((person) => !q || person.name.toLowerCase().includes(q));
  }, [data, search]);
  if (data === undefined) return <Skeleton className="h-96 rounded-2xl" />;
  const { job, staffing } = data;
  // Places nobody holds: an offer already out keeps its place until it is answered or runs out.
  const open = Math.max(0, staffing.open - staffing.offersOut);
  const choosable = (person: Person) => person.onJob === null && (person.eligible || person.soft);
  const toggle = (person: Person) => {
    setResult(null);
    if (chosen.includes(person.cleanerId)) {
      setChosen(chosen.filter((id) => id !== person.cleanerId));
      if (lead === person.cleanerId) setLead(null);
    } else setChosen([...chosen, person.cleanerId]);
  };
  const chooseCrew = (crewId: string) => {
    const crew = data.crews.find((row) => row.crewId === crewId);
    if (!crew) return;
    const picks = crew.members.filter((member) => member.eligible && member.onJob === null).sort((a, b) => Number(b.role === "lead") - Number(a.role === "lead"));
    const take = picks.slice(0, open).map((member) => member.cleanerId as string);
    setChosen(take);
    const crewLead = picks.find((member) => member.role === "lead");
    setLead(!job.lead && crewLead && take.includes(crewLead.cleanerId) ? crewLead.cleanerId : null);
    setFromCrew(crewId);
    setResult(null);
  };
  const tooMany = chosen.length > open;
  return (
    <section aria-label={`Crew for ${job.label}`} className="@container rounded-2xl border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <button type="button" onClick={() => openJob({ kind: "job", id: jobId })} className="text-left font-display text-lg font-semibold text-strong underline-offset-4 hover:underline">
            {job.service}
            {job.customer ? ` for ${job.customer}` : ""}
          </button>
          <p className="text-sm text-muted-foreground">
            {dayName(job.startsAt, timezone)}, {clock(job.startsAt, timezone)} – {clock(job.endsAt, timezone)}
            {job.requiredSkills.length ? ` · needs ${job.requiredSkills.join(", ")}` : ""}
            {job.lead ? ` · lead: ${job.lead.name} (${job.lead.status === "accepted" ? "accepted" : "offered"})` : ""}
          </p>
        </div>
        <div className="grid min-w-48 gap-1">
          <StaffingDots required={staffing.required} accepted={staffing.accepted} offered={staffing.offersOut} />
          <p className={cn("text-sm font-medium", staffing.open === 0 ? "text-success-foreground" : "text-strong")}>
            {staffing.open === 0 ? "Every place has an accepted cleaner" : `${staffing.open} ${staffing.open === 1 ? "place" : "places"} without an accepted cleaner`}
          </p>
        </div>
      </header>

      <div className={cn("mx-4 mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm sm:mx-5", data.suggestion.kind === "crew" ? "bg-brand-950 text-strong" : "bg-muted/50 text-strong")}>
        <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-300" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="font-medium">Selestial: </span>
          {data.suggestion.words}
        </span>
        {data.suggestion.kind === "crew" && manager ? (
          <Button variant="outline" size="xs" onClick={() => chooseCrew(data.suggestion.kind === "crew" ? data.suggestion.crewId : "")}>
            Use this crew
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 sm:p-5 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="grid content-start gap-2">
          <h3 className="text-sm font-semibold text-strong">Permanent crews for this time</h3>
          {data.crews.length === 0 ? <p className="text-sm text-muted-foreground">No permanent crews yet.</p> : null}
          {data.crews.map((crew) => (
            <article key={crew.crewId} className={cn("rounded-xl border px-3 py-2.5", fromCrew === crew.crewId ? "border-brand-500" : "border-border")}>
              <header className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-strong">{crew.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {crew.eligible} of {crew.members.length} can take this job
                  </span>
                </span>
                {manager && open > 0 ? (
                  <Button variant="ghost" size="xs" disabled={crew.eligible === 0} onClick={() => chooseCrew(crew.crewId)}>
                    Choose
                  </Button>
                ) : null}
              </header>
              <ul className="mt-2 grid gap-1 text-sm">
                {crew.members.map((member) => (
                  <li key={member.cleanerId} className="flex items-start gap-1.5">
                    {member.onJob ? <Check className="mt-0.5 size-3.5 shrink-0 text-info-foreground" aria-hidden /> : member.eligible ? <Check className="mt-0.5 size-3.5 shrink-0 text-success-foreground" aria-hidden /> : <X className="mt-0.5 size-3.5 shrink-0 text-destructive-foreground" aria-hidden />}
                    <span className="min-w-0">
                      <span className="text-strong">{member.name}</span>
                      {member.role === "lead" ? <span className="text-xs text-muted-foreground"> · lead</span> : null}
                      {member.onJob ? <span className="block text-xs text-muted-foreground">{member.onJob === "accepted" ? "Already accepted this job" : "Already offered this job"}</span> : !member.eligible && member.reason ? <span className="block text-xs text-muted-foreground">{capitalize(member.reason)}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <div className="grid content-start gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-strong">Everyone active</h3>
            <label className="relative">
              <span className="sr-only">Find a person</span>
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a person" className="h-8 w-40 pl-8 text-sm sm:w-44" />
            </label>
          </div>
          <ul className="grid gap-1.5">
            {people.map((person) => {
              const can = choosable(person);
              const picked = chosen.includes(person.cleanerId);
              return (
                <li key={person.cleanerId} className={cn("flex items-start gap-2.5 rounded-xl border px-3 py-2", picked ? "border-brand-500 bg-brand-500/5" : "border-border", !can && "bg-muted/30")}>
                  <input type="checkbox" aria-label={`Choose ${person.name}`} className="mt-1 size-4 accent-[#6838ef]" disabled={!manager || !can || open === 0} checked={picked} onChange={() => toggle(person)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Link href={profilePath(person.cleanerId)} className="font-medium text-strong underline-offset-4 hover:underline">
                        {person.name}
                      </Link>
                      {person.onJob ? (
                        <Badge variant={person.onJob === "accepted" ? "success" : "info"} size="sm">
                          {person.onJob === "accepted" ? "Accepted" : "Offered"}
                        </Badge>
                      ) : can ? (
                        <Badge variant={person.eligible ? "success" : "warning"} size="sm">
                          {person.eligible ? "Can take it" : "Check first"}
                        </Badge>
                      ) : (
                        <Badge variant="outline" size="sm">
                          Cannot take it
                        </Badge>
                      )}
                      {person.crews.map((name) => (
                        <span key={name} className="text-xs text-muted-foreground">
                          {name}
                        </span>
                      ))}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {person.reason ? capitalize(person.reason) : person.priorVisits ? `Has cleaned for this customer ${person.priorVisits} ${person.priorVisits === 1 ? "time" : "times"}` : "Free, ready, and within their hours"}
                      {person.payMissing && person.code !== "no_pay" ? ". No pay arrangement either, so an offer could not state their pay" : ""}
                      {role === "owner" && person.pay !== null ? ` · ${money(person.pay)}` : ""}
                    </span>
                  </span>
                  {picked && !job.lead ? (
                    <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <input type="radio" name="lead" className="accent-[#6838ef]" checked={lead === person.cleanerId} onChange={() => setLead(person.cleanerId)} />
                      Lead
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {result ? (
        <div className="mx-4 mb-4 grid gap-2 rounded-xl border border-border bg-muted/30 px-3 py-3 text-sm sm:mx-5" role="status">
          <ul className="grid gap-1">
            {result.results.map((row) => (
              <li key={row.cleanerId} className="flex gap-2">
                {row.offered ? <Check className="mt-0.5 size-4 shrink-0 text-success-foreground" aria-hidden /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />}
                <span className="text-strong">{row.words}</span>
              </li>
            ))}
          </ul>
          <p className="font-medium text-strong">{result.words}</p>
        </div>
      ) : null}

      {manager && open === 0 && staffing.open > 0 ? (
        <footer className="rounded-b-2xl border-t border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground sm:px-5">Every open place has an offer out. Wait for the answers, or withdraw an offer in Dispatch to ask someone else.</footer>
      ) : null}
      {manager && open > 0 ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-border bg-muted/20 px-4 py-3 sm:px-5">
          <p className={cn("text-sm", tooMany ? "font-medium text-destructive-foreground" : "text-muted-foreground")}>
            {chosen.length === 0 ? `Choose up to ${open} ${open === 1 ? "person" : "people"}${staffing.offersOut ? ` (${staffing.offersOut} ${staffing.offersOut === 1 ? "offer is" : "offers are"} already out)` : ""}.` : tooMany ? `${chosen.length} chosen for ${open} ${open === 1 ? "place" : "places"}.` : `${chosen.length} of ${open} ${open === 1 ? "place" : "places"} chosen${lead ? "" : chosen.length > 0 && !job.lead ? "; the first offered leads" : ""}.`}
          </p>
          <FormError message={error} />
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={chosen.length === 0 || tooMany}
            onClick={() =>
              void run(async () => {
                const answer = await assemble({ companyId, jobId, cleanerIds: chosen as Id<"cleaners">[], leadId: (lead ?? undefined) as Id<"cleaners"> | undefined, fromCrewId: (fromCrew ?? undefined) as Id<"crews"> | undefined });
                setResult(answer);
                setChosen([]);
                setLead(null);
                setFromCrew(null);
              })
            }
          >
            {chosen.length ? `Offer to ${chosen.length} ${chosen.length === 1 ? "person" : "people"}` : "Offer"}
          </Button>
        </footer>
      ) : null}
    </section>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// ── Creating and changing a crew ────────────────────────────────────────────────────────────────────

function CrewDialog({ crew, onClose }: { crew?: Crew; onClose: () => void }) {
  const { companyId } = useCompany();
  const now = useNow();
  const directory = useStableQuery(api.workforce.directory, now ? { companyId, asOf: now } : "skip");
  const subs = useQuery(api.subcontractors.list, { companyId });
  const create = useMutation(api.crews.create);
  const change = useMutation(api.crews.changeMembers);
  const archive = useMutation(api.crews.archive);
  const { busy, error, run } = useRun();
  const [form, setForm] = useState({ name: crew?.name ?? "", subcontractorId: crew?.subcontractor?.id ?? "", equipment: crew?.equipment.join(", ") ?? "", notes: crew?.notes ?? "" });
  const [members, setMembers] = useState<string[]>(crew?.members.map((member) => member.cleanerId) ?? []);
  const [lead, setLead] = useState<string>(crew?.members.find((member) => member.role === "lead")?.cleanerId ?? "");
  const [search, setSearch] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const people = (directory?.rows ?? []).filter((row) => row.status !== "ended" && (!form.subcontractorId || row.subcontractor?.id === form.subcontractorId) && (!search.trim() || row.name.toLowerCase().includes(search.trim().toLowerCase())));
  const toggle = (id: string) => {
    if (members.includes(id)) {
      setMembers(members.filter((item) => item !== id));
      if (lead === id) setLead("");
    } else setMembers([...members, id]);
  };
  const names = new Map((directory?.rows ?? []).map((row) => [row.cleanerId as string, row.name]));
  return (
    <Modal open onClose={onClose} title={crew ? `Change ${crew.name}` : "Create crew"} description={crew ? "Who joins and leaves is dated. Teams already put together for jobs keep their people." : "People who usually work together, with one lead. Each is still checked for every job."}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            if (crew) {
              const before = crew.members.map((member) => member.cleanerId as string);
              await change({ companyId, crewId: crew.crewId, add: members.filter((id) => !before.includes(id)) as Id<"cleaners">[], remove: before.filter((id) => !members.includes(id)) as Id<"cleaners">[], leadId: (lead || null) as Id<"cleaners"> | null });
            } else {
              await create({ companyId, name: form.name, memberIds: members as Id<"cleaners">[], leadId: (lead || undefined) as Id<"cleaners"> | undefined, subcontractorId: (form.subcontractorId || undefined) as Id<"subcontractors"> | undefined, equipment: form.equipment.split(",").map((item) => item.trim()).filter(Boolean), notes: form.notes || undefined });
            }
            onClose();
          });
        }}
      >
        {!crew ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={80} placeholder="North Austin crew" />
            </Field>
            <Field label="Supplied by (optional)">
              <SelectInput
                value={form.subcontractorId}
                onChange={(event) => {
                  setForm({ ...form, subcontractorId: event.target.value });
                  setMembers([]);
                  setLead("");
                }}
              >
                <option value="">Our own people</option>
                {(subs ?? []).filter((sub) => sub.status === "active").map((sub) => (
                  <option key={sub.subcontractorId} value={sub.subcontractorId}>
                    {sub.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
        ) : null}
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium text-strong">People</legend>
          <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a person" aria-label="Find a person" />
          <ul className="grid max-h-64 gap-0.5 overflow-y-auto rounded-xl border border-border p-1">
            {!directory ? <Skeleton className="h-24 rounded-lg" /> : null}
            {people.map((row) => (
              <li key={row.cleanerId}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50">
                  <input type="checkbox" className="size-4 accent-[#6838ef]" checked={members.includes(row.cleanerId)} onChange={() => toggle(row.cleanerId)} />
                  <span className="min-w-0 flex-1 truncate font-medium text-strong">{row.name}</span>
                  <ReadinessBadge state={row.readiness.state} />
                </label>
              </li>
            ))}
            {directory && people.length === 0 ? <li className="px-2 py-2 text-sm text-muted-foreground">Nobody matches.</li> : null}
          </ul>
        </fieldset>
        <Field label="Lead" hint="The lead is offered first on a crew job, and sees the places still open.">
          <SelectInput value={lead} onChange={(event) => setLead(event.target.value)}>
            <option value="">No lead</option>
            {members.map((id) => (
              <option key={id} value={id}>
                {names.get(id) ?? crew?.members.find((member) => member.cleanerId === id)?.name ?? "Someone"}
              </option>
            ))}
          </SelectInput>
        </Field>
        {!crew ? (
          <>
            <Field label="What the crew brings (optional)" hint="Separate with commas. Counts for equipment the crew provides.">
              <TextInput value={form.equipment} onChange={(event) => setForm({ ...form, equipment: event.target.value })} placeholder="Vacuum, steam cleaner" />
            </Field>
            <Field label="Notes (optional)">
              <TextArea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={2} maxLength={1000} />
            </Field>
          </>
        ) : null}
        <FormError message={error} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {crew ? (
            confirmArchive ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Retire this crew? Its history stays.</span>
                <Button variant="destructive" size="xs" loading={busy} onClick={() => void run(async () => (await archive({ companyId, crewId: crew.crewId }), onClose()))}>
                  Retire
                </Button>
              </span>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmArchive(true)}>
                Retire crew
              </Button>
            )
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={members.length === 0}>
              {crew ? "Save" : "Create crew"}
            </Button>
          </span>
        </div>
      </form>
    </Modal>
  );
}
