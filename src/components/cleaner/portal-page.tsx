"use client";

/**
 * A cleaner's portal, from the link the company texted or emailed them. Phone first: one column, large
 * targets, a bar at the bottom. The link is the only key. Opening the page changes nothing; each button is
 * one named action that the record checks, and pay needs a one-time code sent to them.
 */
import { useMutation } from "convex/react";

import { useStableQuery } from "@/lib/app/stable-query";
import { useState } from "react";

import { CalendarIcon, Check, ClipboardList, Clock, HouseIcon, Lock, Wallet } from "@/components/icons";
import { cn } from "@/lib/utils";

import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cleanerTextWording } from "../../../convex/lib/texting/wording";
import { ContactPortal } from "./contact-portal";
import { Action, Card, Loading, Notice, Page, Problem, problemWords, Row } from "./shell";
import { fmt, useMinute, zoned } from "./time";
import { Checkbox } from "@/components/ui/selection";

type View = Extract<FunctionReturnType<typeof api.portal.view>, { state: "active"; jobs: unknown }>;
type Step = View["steps"][number];
const TABS = [
  { id: "home", label: "Home", Icon: HouseIcon },
  { id: "jobs", label: "Jobs", Icon: CalendarIcon },
  { id: "hours", label: "Hours", Icon: Clock },
  { id: "steps", label: "Steps", Icon: ClipboardList },
  { id: "pay", label: "Pay", Icon: Wallet },
] as const;
type Tab = (typeof TABS)[number]["id"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMinute = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

export function PortalPage({ token }: { token: string }) {
  const now = useMinute();
  const view = useStableQuery(api.portal.view, now ? { token, asOf: now } : "skip");
  const [tab, setTab] = useState<Tab>("home");
  if (view === undefined) return <Loading what="your portal" />;
  if (view.state === "subcontractor") return <ContactPortal token={token} />;
  if (view.state !== "active") {
    const copy = {
      expired: { title: "This link has expired", body: "Ask the office for a new link. Your jobs and details are all still there." },
      revoked: { title: "This link is no longer active", body: "The office ended it or sent you a newer one. Use the latest link you received." },
      ended: { title: "Your work with us has ended", body: "This link no longer changes anything. Contact the office if you have a question." },
    }[view.state];
    return <Closed company={view.company} title={copy.title} body={copy.body} />;
  }
  return (
    <>
      <Page company={view.company} title={tab === "home" ? `Hi ${view.firstName}` : TABS.find((row) => row.id === tab)!.label}>
        {tab === "home" ? <Home view={view} token={token} onTab={setTab} /> : null}
        {tab === "jobs" ? <Jobs view={view} token={token} /> : null}
        {tab === "hours" ? <Hours view={view} token={token} /> : null}
        {tab === "steps" ? <Steps view={view} token={token} onTab={setTab} /> : null}
        {tab === "pay" ? <Pay view={view} token={token} /> : null}
      </Page>
      <nav aria-label="Portal" className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {TABS.map(({ id, label, Icon }) => (
            <li key={id}>
              <button type="button" onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined} className={cn("flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium", tab === id ? "text-brand-300" : "text-muted-foreground")}>
                <Icon className="size-5" aria-hidden />
                {label}
                {id === "steps" && view.steps.some((step) => step.mine && !step.met && step.state !== "awaiting_review" && step.state !== "submitted") ? <span className="sr-only">(things to do)</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function Closed({ company, title, body }: { company: string; title: string; body: string }) {
  return (
    <Page company={company} title={title}>
      <Notice tone="neutral" title={title}>
        {body}
      </Notice>
    </Page>
  );
}

/** Who else is on a job they accepted; a lead also sees the places still open. */
function TeamLine({ team }: { team: NonNullable<View["jobs"][number]["team"]> }) {
  const others = team.with.length ? `With ${team.with.join(", ")}` : "No one else has accepted yet";
  const open = team.lead && team.open > 0 ? ` · ${team.open} ${team.open === 1 ? "place" : "places"} still open${team.offersOut ? `, ${team.offersOut} offered` : ""}` : "";
  return (
    <p className="text-sm text-muted-foreground">
      {team.lead ? <span className="font-medium text-foreground">You lead. </span> : null}
      {others}
      {open}
    </p>
  );
}

const todo = (step: Step) => step.mine && !step.met && step.state !== "awaiting_review" && step.state !== "submitted";

function Home({ view, token, onTab }: { view: View; token: string; onTab: (tab: Tab) => void }) {
  const ask = useMutation(api.portal.askForHelp);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const steps = view.steps.filter(todo);
  const waiting = view.steps.filter((step) => step.state === "awaiting_review" || step.state === "submitted");
  const next = view.jobs.find((job) => job.status === "accepted");
  return (
    <>
      {view.purpose === "check_in" && view.allowed.includes("respond_check_in") ? <CheckInCard view={view} token={token} onTab={onTab} /> : null}
      {view.engagement === "onboarding" || steps.length > 0 ? (
        <Card title={steps.length > 0 ? "To finish your onboarding" : "Onboarding"}>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={view.readiness.progress.total} aria-valuenow={view.readiness.progress.met} aria-label={`${view.readiness.progress.met} of ${view.readiness.progress.total} done`}>
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${view.readiness.progress.total ? (view.readiness.progress.met / view.readiness.progress.total) * 100 : 0}%` }} />
          </div>
          <p className="text-sm text-muted-foreground">
            {view.readiness.progress.met} of {view.readiness.progress.total} done{waiting.length ? `, ${waiting.length} with the office to check` : ""}.
          </p>
          {steps.slice(0, 4).map((step) => (
            <p key={step.key} className="flex items-center gap-2 text-sm">
              <span aria-hidden className="size-2 rounded-full bg-brand-500" />
              {step.label}
              {step.state === "needs_changes" ? <span className="text-xs font-medium text-amber-600"> · needs a change</span> : null}
            </p>
          ))}
          {steps.length > 0 ? <Action onPress={() => onTab("steps")}>Continue</Action> : <p className="text-sm text-muted-foreground">Nothing for you to do right now. The office will let you know.</p>}
        </Card>
      ) : null}
      <Card title="Next job">
        {next ? (
          <>
            <Row label="When">{fmt(next.startsAt, view.timezone, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</Row>
            <Row label="What">{next.service}</Row>
            {next.where ? <Row label="Where">{next.where}</Row> : null}
            {next.team ? <TeamLine team={next.team} /> : null}
            {next.page ? (
              <a href={next.page} className="mt-1 text-sm font-semibold text-brand-300 underline-offset-4">
                Open the job
              </a>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No accepted jobs coming up.</p>
        )}
      </Card>
      {view.crews.length > 0 ? (
        <Card title={view.crews.length === 1 ? "Your crew" : "Your crews"}>
          {view.crews.map((crew) => (
            <Row key={crew.name} label={crew.lead ? `${crew.name} (you lead)` : crew.name}>
              {crew.with.length ? crew.with.join(", ") : "Just you for now"}
            </Row>
          ))}
        </Card>
      ) : null}
      {view.feedback.length > 0 ? (
        <Card title="From the office">
          {view.feedback.slice(0, 2).map((item) => (
            <div key={item.id} className="text-sm">
              <p className="font-medium">{item.title}</p>
              <p className="text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </Card>
      ) : null}
      <Card title="Ask the office">
        {asked ? (
          <Notice tone="good" title="Sent to the office">
            Someone will get back to you.
          </Notice>
        ) : (
          <>
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} placeholder="Your question" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-base" />
            <Problem message={problem} />
            <Action
              kind="secondary"
              busy={busy}
              disabled={!question.trim()}
              onPress={() => {
                setBusy(true);
                setProblem(null);
                ask({ token, text: question })
                  .then(() => setAsked(true))
                  .catch((error) => setProblem(problemWords(error)))
                  .finally(() => setBusy(false));
              }}
            >
              Send
            </Action>
          </>
        )}
      </Card>
      <p className="text-center text-xs text-muted-foreground">This link is only for you. It works until {fmt(view.expiresAt, view.timezone, { month: "short", day: "numeric" })}.</p>
    </>
  );
}

function Jobs({ view, token }: { view: View; token: string }) {
  return (
    <>
      <Card title="Coming up">
        {view.jobs.length === 0 ? <p className="text-sm text-muted-foreground">Nothing coming up in the next three weeks.</p> : null}
        {view.jobs.map((job) => (
          <div key={job.id} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0 last:pb-0">
            <p className="text-sm font-medium">
              {fmt(job.startsAt, view.timezone, { weekday: "short", month: "short", day: "numeric" })}, {fmt(job.startsAt, view.timezone, { hour: "numeric", minute: "2-digit" })} – {fmt(job.endsAt, view.timezone, { hour: "numeric", minute: "2-digit" })}
            </p>
            <p className="text-sm text-muted-foreground">
              {job.service}
              {job.where ? ` · ${job.where}` : ""} · {job.status === "accepted" ? "Accepted" : "Offered to you"}
            </p>
            {job.team ? <TeamLine team={job.team} /> : null}
            {job.page ? (
              <a href={job.page} className="text-sm font-semibold text-brand-300">
                Open the job
              </a>
            ) : null}
          </div>
        ))}
      </Card>
      <Card title="Recent">
        {view.past.length === 0 ? <p className="text-sm text-muted-foreground">No jobs in the last few weeks.</p> : null}
        {view.past.map((job) => (
          <PastJob key={job.id} job={job} view={view} token={token} />
        ))}
      </Card>
    </>
  );
}

function Hours({ view, token }: { view: View; token: string }) {
  const setWeek = useMutation(api.portal.setAvailability);
  const confirm = useMutation(api.portal.confirmAvailability);
  const addAway = useMutation(api.portal.addTimeAway);
  const initial = Object.fromEntries(ORDER.map((day) => [day, view.availability.windows.find((row) => row.weekday === day) ?? null])) as Record<number, { startMinute: number; endMinute: number } | null>;
  const [week, setWeekState] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [impact, setImpact] = useState<string[]>([]);
  const [away, setAway] = useState({ from: "", to: "", note: "" });
  const act = (name: string, work: () => Promise<unknown>) => {
    setBusy(name);
    setProblem(null);
    setSaved(null);
    work()
      .catch((error) => setProblem(problemWords(error)))
      .finally(() => setBusy(null));
  };
  return (
    <>
      <Card title="The days and hours you can work">
        <p className="text-sm text-muted-foreground">You are only offered work inside these hours.</p>
        {ORDER.map((day) => {
          const window = week[day];
          return (
            <div key={day} className="flex items-center gap-2">
              <label className="flex w-20 items-center gap-2 text-sm font-medium">
                <Checkbox checked={Boolean(window)} onCheckedChange={(checked) => setWeekState({ ...week, [day]: checked ? { startMinute: 8 * 60, endMinute: 17 * 60 } : null })} />
                {DAYS[day]}
              </label>
              {window ? (
                <span className="flex flex-1 items-center gap-1.5">
                  <input type="time" aria-label={`${DAYS[day]} from`} value={toTime(window.startMinute)} onChange={(event) => setWeekState({ ...week, [day]: { ...window, startMinute: toMinute(event.target.value) } })} className="h-11 flex-1 rounded-lg border border-border bg-background px-2 text-base" />
                  <span className="text-muted-foreground">–</span>
                  <input type="time" aria-label={`${DAYS[day]} until`} value={toTime(window.endMinute)} onChange={(event) => setWeekState({ ...week, [day]: { ...window, endMinute: toMinute(event.target.value) } })} className="h-11 flex-1 rounded-lg border border-border bg-background px-2 text-base" />
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">Not working</span>
              )}
            </div>
          );
        })}
        <Problem message={problem} />
        {saved ? <Notice tone="good" title={saved} /> : null}
        {impact.length > 0 ? (
          <Notice tone="warn" title="Some jobs you accepted fall outside this">
            {impact.join(". ")}. You still have them; the office will talk with you.
          </Notice>
        ) : null}
        <Action
          busy={busy === "week"}
          onPress={() =>
            act("week", async () => {
              const windows = ORDER.flatMap((day) => (week[day] ? [{ weekday: day, ...week[day]! }] : []));
              const result = await setWeek({ token, windows });
              setImpact(result.impact);
              setSaved("Saved. Thank you.");
            })
          }
        >
          Save my hours
        </Action>
        {view.availability.windows.length > 0 ? (
          <Action kind="secondary" busy={busy === "confirm"} onPress={() => act("confirm", async () => { await confirm({ token }); setSaved("Thanks. Your hours are confirmed."); })}>
            These are still right
          </Action>
        ) : null}
      </Card>
      <Card title="Time away">
        {view.availability.timeAway.map((row) => (
          <Row key={row.startsAt} label={row.note ?? "Away"}>
            {fmt(row.startsAt, view.timezone, { month: "short", day: "numeric" })} – {fmt(row.endsAt - 1, view.timezone, { month: "short", day: "numeric" })}
          </Row>
        ))}
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-sm">
            From
            <input type="date" value={away.from} onChange={(event) => setAway({ ...away, from: event.target.value })} className="h-11 rounded-lg border border-border bg-background px-2 text-base" />
          </label>
          <label className="grid gap-1 text-sm">
            Back on
            <input type="date" value={away.to} onChange={(event) => setAway({ ...away, to: event.target.value })} className="h-11 rounded-lg border border-border bg-background px-2 text-base" />
          </label>
        </div>
        <input value={away.note} onChange={(event) => setAway({ ...away, note: event.target.value })} placeholder="Note for the office (optional)" className="h-11 rounded-lg border border-border bg-background px-3 text-base" />
        <Action
          kind="secondary"
          busy={busy === "away"}
          disabled={!away.from || !away.to}
          onPress={() =>
            act("away", async () => {
              const startsAt = zoned(away.from, "00:00", view.timezone);
              const endsAt = zoned(away.to, "00:00", view.timezone);
              if (startsAt === null || endsAt === null) throw new Error("dates");
              const result = await addAway({ token, startsAt, endsAt, note: away.note || undefined });
              setImpact(result.impact);
              setAway({ from: "", to: "", note: "" });
              setSaved(result.impact.length ? "Saved. The office has been told about the jobs it touches." : "Saved. No work is offered to you then.");
            })
          }
        >
          Add time away
        </Action>
      </Card>
    </>
  );
}

function Steps({ view, token, onTab }: { view: View; token: string; onTab: (tab: Tab) => void }) {
  const ordered = [...view.steps].sort((a, b) => Number(todo(b)) - Number(todo(a)) || Number(a.met) - Number(b.met));
  return (
    <>
      {ordered.map((step) => (
        <StepCard key={step.key} step={step} view={view} token={token} onTab={onTab} />
      ))}
      {ordered.length === 0 ? <Notice tone="neutral" title="No onboarding steps">The office has not asked you for anything.</Notice> : null}
    </>
  );
}

const STATE: Record<Step["state"], { label: string; tone: string }> = {
  not_started: { label: "To do", tone: "bg-brand-500/10 text-brand-300" },
  submitted: { label: "Sent, the office is checking", tone: "bg-sky-500/10 text-sky-700" },
  awaiting_review: { label: "Sent, the office is checking", tone: "bg-sky-500/10 text-sky-700" },
  accepted: { label: "Done", tone: "bg-emerald-500/10 text-emerald-700" },
  needs_changes: { label: "Needs a change", tone: "bg-amber-500/15 text-amber-700" },
  expired: { label: "Needs renewing", tone: "bg-amber-500/15 text-amber-700" },
  waived: { label: "Not needed", tone: "bg-muted text-muted-foreground" },
};

function StepCard({ step, view, token, onTab }: { step: Step; view: View; token: string; onTab: (tab: Tab) => void }) {
  const confirmContact = useMutation(api.portal.confirmContact);
  const acknowledge = useMutation(api.portal.acknowledge);
  const uploadUrl = useMutation(api.portal.uploadUrl);
  const submit = useMutation(api.portal.submitRequirement);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [phone, setPhone] = useState(view.contact.phone ?? "");
  const [email, setEmail] = useState(view.contact.email ?? "");
  const [texts, setTexts] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const open = todo(step) && view.allowed.includes(step.kind === "contact" ? "confirm_contact" : step.kind === "acknowledgment" ? "acknowledge" : "submit_requirement");
  const run = (work: () => Promise<string>) => {
    setBusy(true);
    setProblem(null);
    work()
      .then(setDone)
      .catch((error) => setProblem(problemWords(error)))
      .finally(() => setBusy(false));
  };
  // A step the office records is the office's to do, never shown to the cleaner as theirs.
  const state = !step.mine && !step.met && step.state === "not_started" ? { label: "With the office", tone: "bg-muted text-muted-foreground" } : STATE[step.state];
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold">{step.label}</h2>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", state.tone)}>{step.met ? <Check className="inline size-3.5" aria-hidden /> : null} {state.label}</span>
      </div>
      {step.description ? <p className="text-sm text-muted-foreground">{step.description}</p> : null}
      {step.changes ? (
        <Notice tone="warn" title="What to change">
          {step.changes}
        </Notice>
      ) : null}
      {done ? <Notice tone="good" title={done} /> : null}
      {!done && open && step.kind === "contact" ? (
        <div className="flex flex-col gap-2">
          <label className="grid gap-1 text-sm">
            Mobile number
            <input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" className="h-11 rounded-lg border border-border bg-background px-3 text-base" />
          </label>
          <label className="grid gap-1 text-sm">
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" className="h-11 rounded-lg border border-border bg-background px-3 text-base" />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={texts} onCheckedChange={(checked) => setTexts(checked)} className="mt-0.5" />
            <span>{cleanerTextWording(view.company)}</span>
          </label>
          <Problem message={problem} />
          <Action busy={busy} onPress={() => run(async () => ((await confirmContact({ token, phone, email, workTexts: texts })).status === "accepted" ? "Confirmed. Thank you." : "Sent. The office will check your new details."))}>
            These are right
          </Action>
        </div>
      ) : null}
      {!done && open && step.kind === "acknowledgment" ? (
        <>
          <p className="text-sm">The office gives you the company&apos;s policies. Ask the office if you do not have them.</p>
          <Problem message={problem} />
          <Action busy={busy} onPress={() => run(async () => { await acknowledge({ token, key: step.key, words: step.description ?? "" }); return "Thank you."; })}>
            I have read and agree to them
          </Action>
        </>
      ) : null}
      {!done && open && !["contact", "acknowledgment", "availability", "service_areas", "agreement"].includes(step.kind) ? (
        <div className="flex flex-col gap-2">
          <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-dashed border-border px-3 text-sm font-medium">
            {files.length ? `${files.length} ${files.length === 1 ? "file" : "files"} chosen` : "Take a photo or choose a file"}
            <input type="file" accept="application/pdf,image/*" multiple className="sr-only" onChange={(event) => setFiles([...(event.target.files ?? [])].slice(0, 5))} />
          </label>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder={step.kind === "payment" ? "For example: sent my bank details to the office" : "A note (optional)"} className="h-11 rounded-lg border border-border bg-background px-3 text-base" />
          <Problem message={problem} />
          <Action
            busy={busy}
            disabled={files.length === 0 && !note.trim()}
            onPress={() =>
              run(async () => {
                const storageIds: Id<"_storage">[] = [];
                for (const file of files) {
                  const response = await fetch(await uploadUrl({ token }), { method: "POST", headers: { "Content-Type": file.type }, body: file });
                  storageIds.push(((await response.json()) as { storageId: Id<"_storage"> }).storageId);
                }
                await submit({ token, key: step.key, text: note || undefined, storageIds });
                return "Sent. The office will check it; nothing counts until they do.";
              })
            }
          >
            Send
          </Action>
        </div>
      ) : null}
      {!step.met && (step.kind === "availability" || step.kind === "service_areas") ? (
        <Action kind="secondary" onPress={() => onTab("hours")}>
          Set my hours
        </Action>
      ) : null}
      {!step.met && step.kind === "agreement" ? <p className="text-sm text-muted-foreground">{view.agreements.length ? `${view.agreements[0].title}: ${view.agreements[0].state.toLowerCase()}.` : "The office will send you the agreement to sign."} Opening a document is not signing it.</p> : null}
    </Card>
  );
}

function Pay({ view, token }: { view: View; token: string }) {
  const now = useMinute();
  const earnings = useStableQuery(api.portal.earnings, now ? { token, asOf: now } : "skip");
  const request = useMutation(api.portal.requestCode);
  const verify = useMutation(api.portal.verifyCode);
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (earnings === undefined) return <Loading what="your pay" />;
  if (earnings === null) return null;
  if (earnings.locked) {
    return (
      <Card title="Your pay is private">
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          {sentTo ? `We sent a 6-digit code to ${sentTo}. Enter it within 10 minutes.` : `To see it, we send a 6-digit code to ${view.codeTo ?? "your phone or email"}. It works for 10 minutes.`}
        </p>
        {sentTo ? (
          <>
            <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" aria-label="Code" className="h-12 rounded-lg border border-border bg-background px-3 text-center text-xl tracking-[0.4em]" />
            <Problem message={problem} />
            <Action busy={busy} disabled={code.length !== 6} onPress={() => { setBusy(true); setProblem(null); verify({ token, code }).catch((error) => setProblem(problemWords(error))).finally(() => setBusy(false)); }}>
              Open my pay
            </Action>
          </>
        ) : (
          <>
            <Problem message={problem} />
            <Action busy={busy} disabled={!view.codeTo} onPress={() => { setBusy(true); setProblem(null); request({ token }).then((result) => setSentTo(result.sentTo)).catch((error) => setProblem(problemWords(error))).finally(() => setBusy(false)); }}>
              Send me a code
            </Action>
          </>
        )}
      </Card>
    );
  }
  return (
    <>
      <Card title="How you are paid">
        <p className="text-base font-semibold">{earnings.arrangement}</p>
      </Card>
      <Card title="Your recent jobs">
        <p className="text-xs text-muted-foreground">{earnings.note}</p>
        {earnings.jobs.length === 0 ? <p className="text-sm text-muted-foreground">No jobs in the last two months.</p> : null}
        {earnings.jobs.map((job) => (
          <Row key={job.id} label={`${fmt(job.startsAt, view.timezone, { month: "short", day: "numeric" })} · ${job.service}`}>
            ${(job.payCents / 100).toFixed(2)}
          </Row>
        ))}
      </Card>
    </>
  );
}

/** "Are you still available?" One tap; a break says until when, and wanting to stop goes to a person. */
function CheckInCard({ view, token, onTab }: { view: View; token: string; onTab: (tab: Tab) => void }) {
  const respond = useMutation(api.portal.respondCheckIn);
  const [answer, setAnswer] = useState<"available" | "fewer" | "break" | "stop" | null>(null);
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const options = [
    { id: "available", label: "Yes, I'm available" },
    { id: "fewer", label: "Yes, but fewer jobs" },
    { id: "break", label: "I'm taking a break" },
    { id: "stop", label: "I want to stop" },
  ] as const;
  if (done) {
    return (
      <Notice tone="good" title="Thanks for letting us know">
        {done}
        {answer === "fewer" ? (
          <button type="button" onClick={() => onTab("hours")} className="mt-1 block text-left font-semibold text-brand-300">
            Change your hours
          </button>
        ) : null}
      </Notice>
    );
  }
  return (
    <Card title={`Are you still looking for work with ${view.company}?`}>
      <p className="text-sm text-muted-foreground">We have not had work with you for a while. Nothing changes until you tell us, and there is no wrong answer.</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Your answer">
        {options.map((option) => (
          <button key={option.id} type="button" role="radio" aria-checked={answer === option.id} onClick={() => setAnswer(option.id)} className={cn("min-h-12 rounded-xl border px-3 text-sm font-medium", answer === option.id ? "border-brand-500 bg-brand-500/10 text-brand-300" : "border-border bg-background")}>
            {option.label}
          </button>
        ))}
      </div>
      {answer === "break" ? (
        <label className="grid gap-1 text-sm">
          Back on
          <input type="date" value={until} onChange={(event) => setUntil(event.target.value)} className="h-11 rounded-lg border border-border bg-background px-2 text-base" />
        </label>
      ) : null}
      {answer ? <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Anything else? (optional)" className="h-11 rounded-lg border border-border bg-background px-3 text-base" /> : null}
      <Problem message={problem} />
      <Action
        busy={busy}
        disabled={!answer || (answer === "break" && !until)}
        onPress={() => {
          if (!answer) return;
          const back = answer === "break" ? zoned(until, "00:00", view.timezone) : null;
          setBusy(true);
          setProblem(null);
          respond({ token, answer, until: back ?? undefined, note: note || undefined })
            .then((result) => setDone(result.words + (result.impact.length ? " The office will sort out the jobs your break touches." : "")))
            .catch((error) => setProblem(problemWords(error)))
            .finally(() => setBusy(false));
        }}
      >
        Send
      </Action>
    </Card>
  );
}

/** A past job, and a way to say its record is wrong. The office decides; it is left out of their measures meanwhile. */
function PastJob({ job, view, token }: { job: View["past"][number]; view: View; token: string }) {
  const dispute = useMutation(api.portal.disputeRecord);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  return (
    <div className="flex flex-col gap-1 border-b border-border pb-2 last:border-0 last:pb-0">
      <Row label={fmt(job.startsAt, view.timezone, { month: "short", day: "numeric" })}>
        {job.service} · {job.status === "completed" ? "Done" : job.status === "cancelled" ? "Cancelled" : "In progress"}
      </Row>
      {view.allowed.includes("dispute") ? (
        sent ? (
          <p className="text-xs text-muted-foreground">Sent. The office will look at it, and it does not count against you meanwhile.</p>
        ) : open ? (
          <>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} placeholder="What is wrong with this record?" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-base" />
            <Problem message={problem} />
            <Action
              kind="secondary"
              busy={busy}
              disabled={!reason.trim()}
              onPress={() => {
                setBusy(true);
                setProblem(null);
                dispute({ token, assignmentId: job.id as Id<"assignments">, reason })
                  .then(() => setSent(true))
                  .catch((error) => setProblem(problemWords(error)))
                  .finally(() => setBusy(false));
              }}
            >
              Send to the office
            </Action>
          </>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="self-start text-xs font-medium text-muted-foreground underline underline-offset-4">
            Something wrong with this record?
          </button>
        )
      ) : null}
    </div>
  );
}
