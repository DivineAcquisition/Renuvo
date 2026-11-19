"use client";

/**
 * "Your agents are working" on Home: the owner's focus, each agent's tasks with the steps they actually
 * took, ready assets with the link to the real record, decisions waiting, blockers with the action that
 * clears them, and the routines that keep running. Everything is read from the server's records, so it is
 * the same on every device and after the browser was closed. No percentage is shown: the work isn't
 * measurable that way, so it isn't pretended.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AgentAvatar, eyebrow, type AgentId } from "@/components/app/agent";
import { useCompany } from "@/components/app/company";
import { messageOf } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { useNow } from "@/components/app/use-now";
import { ArrowRight, ArrowUpRight, ChevronDown, Hand, Rocket, Sparkles } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { PRIORITY_INFO } from "../../../../convex/lib/setup/path";
import type { Priority } from "../../../../convex/lib/setup/schema";
import { ActivationReview } from "./review";
import { relative, StateBadge, STEP_DOT, type TaskState } from "./shared";

const AGENT_ORDER: AgentId[] = ["sales", "recruiter", "dispatch", "retention"];

export function AgentsWorking() {
  const { companyId, role } = useCompany();
  const params = useSearchParams();
  const linked = params.get("activation");
  const view = useQuery(api.activation.current, { companyId, ...(linked && /^[a-z0-9]{8,64}$/i.test(linked) ? { activationId: linked as Id<"activations"> } : {}) });
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState<Id<"activationTasks"> | null>(null);
  const now = useNow();
  useEffect(() => {
    if (linked && view?.activation) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [linked, view?.activation]);

  if (view === undefined) return <Skeleton className="h-40 rounded-2xl" />;
  if (!view.activation) return role === "owner" ? <StartCard focus={view.focus} /> : null;
  const a = view.activation;
  // A batch that settled more than two weeks ago steps aside unless a notice links to it.
  if (!linked && a.finishedAt && now && now - a.finishedAt > 14 * 86_400_000) return role === "owner" ? <StartCard focus={view.focus} again /> : null;
  const running = a.status === "running";
  const byAgent = AGENT_ORDER.map((agent) => ({ agent, tasks: a.tasks.filter((t) => t.agent === agent) })).filter((group) => group.tasks.length);
  const decisions = a.tasks.filter((t) => t.state === "ready_for_review");

  return (
    <section ref={ref} id="agents-working" aria-labelledby="agents-working-title" className="scroll-mt-20 overflow-hidden rounded-2xl border border-brand-500/25 bg-card">
      <div className="relative border-b border-border bg-gradient-to-br from-brand-500/12 via-brand-500/5 to-transparent px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className={eyebrow}>{running ? "Working in the background" : a.status === "canceled" ? "Stopped" : "First work settled"}</p>
            <h2 id="agents-working-title" className="mt-1 flex items-center gap-2 font-heading text-xl tracking-tight text-strong">
              {running ? <span className="live-pulse size-2.5 rounded-full bg-success" aria-hidden /> : <Sparkles className="size-5 text-brand-600" aria-hidden />}
              {running ? "Your agents are working" : a.status === "canceled" ? "Your agents' first work was stopped" : "Your agents' first work"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Focus: <span className="font-medium text-strong">{a.focus.words}</span>
              {running ? " · You can leave this page; work continues and we'll notify you when results are ready." : null}
            </p>
          </div>
          <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="Where the work stands">
            {a.counts.working ? <Count label="in progress" value={a.counts.working} tone="info" /> : null}
            {a.counts.ready ? <Count label="ready for you" value={a.counts.ready} tone="warning" /> : null}
            {a.counts.outputs ? <Count label={a.counts.outputs === 1 ? "result" : "results"} value={a.counts.outputs} tone="success" /> : null}
            {a.counts.blocked ? <Count label="waiting on something" value={a.counts.blocked} tone="outline" /> : null}
            {a.counts.failed ? <Count label="failed" value={a.counts.failed} tone="error" /> : null}
          </ul>
        </div>
        {decisions.length || a.approvals.length ? (
          <p className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-sm text-strong">
            <Hand className="size-4 text-warning-foreground" aria-hidden />
            <span className="min-w-0 flex-1">{[...decisions.map((t) => t.statusLine), ...(a.approvals.length ? [`${a.approvals.length} ${a.approvals.length === 1 ? "approval waits" : "approvals wait"} for you.`] : [])].slice(0, 3).join(" ")}</span>
            {a.approvals.length ? (
              <Link href="/app/approvals" className="text-xs font-medium text-brand-600 underline-offset-4 hover:underline">
                Open approvals
              </Link>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-2">
        {byAgent.map((group) => (
          <article key={group.agent} className="grid content-start gap-2 rounded-xl border border-border bg-background/50 p-3">
            <header className="flex items-center gap-2">
              <AgentAvatar agent={group.agent} size="sm" />
              <h3 className="font-medium text-strong">{group.tasks[0].agentName}</h3>
              <span className="ml-auto text-xs text-muted-foreground">{group.tasks.length === 1 ? "1 task" : `${group.tasks.length} tasks`}</span>
            </header>
            <ul className="grid gap-2">
              {group.tasks.map((task) => (
                <TaskCard key={task.id} task={task} onOpen={() => setOpen(task.id)} />
              ))}
            </ul>
          </article>
        ))}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 sm:px-5">
        <Routines />
        {role === "owner" && running ? <CancelButton activationId={a.id} /> : null}
      </footer>
      <TaskDetail taskId={open} onClose={() => setOpen(null)} />
    </section>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: "info" | "warning" | "success" | "outline" | "error" }) {
  return (
    <li>
      <Badge variant={tone} size="lg" className="tabular-nums">
        {value} {label}
      </Badge>
    </li>
  );
}

type HomeTask = NonNullable<NonNullable<ReturnType<typeof useQuery<typeof api.activation.current>>>["activation"]>["tasks"][number];

function TaskCard({ task, onOpen }: { task: HomeTask; onOpen: () => void }) {
  const now = useNow() ?? 0;
  return (
    <li className={cn("grid gap-2 rounded-lg border bg-card p-3", task.state === "working" ? "border-info/40" : task.state === "ready_for_review" ? "border-warning/40" : "border-border")}>
      <div className="flex flex-wrap items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium text-strong">{task.title}</p>
        <StateBadge state={task.state as TaskState} />
      </div>
      <p className="text-sm text-strong" aria-live={task.state === "working" ? "polite" : undefined}>
        {task.statusLine}
      </p>
      {task.steps.length ? (
        <ol className="grid gap-1 border-l border-border pl-3 text-xs text-muted-foreground">
          {task.steps.map((s, i) => (
            <li key={`${s.at}-${i}`} className="relative">
              <span className={cn("absolute top-1.5 -left-[15.5px] size-1.5 rounded-full", STEP_DOT[s.kind])} aria-hidden />
              {s.words} <span className="text-muted-foreground/70">· {relative(s.at, now)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {task.outputs.length ? (
        <ul className="grid gap-1.5">
          {task.outputs.map((o) => (
            <li key={`${o.kind}-${o.ref.id}`} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium text-strong">{o.ref.label}</span> <span className="text-xs text-muted-foreground">· {o.state}</span>
                {o.flags?.length ? <span className="block text-xs text-warning-foreground">{o.flags.join(" ")}</span> : null}
              </span>
              <Link href={o.ref.href} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 underline-offset-4 hover:underline">
                Open
                <ArrowUpRight className="size-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {task.blocker ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-strong">
          <span className="min-w-0 flex-1">{task.blocker.words}</span>
          <Button size="xs" variant="outline" render={<Link href={task.blocker.action.href} />}>
            {task.blocker.action.label}
          </Button>
        </div>
      ) : null}
      <button type="button" onClick={onOpen} className="justify-self-start text-xs font-medium text-muted-foreground underline-offset-4 hover:text-strong hover:underline">
        Details: inputs, actions, outputs and cost
      </button>
    </li>
  );
}

function TaskDetail({ taskId, onClose }: { taskId: Id<"activationTasks"> | null; onClose: () => void }) {
  const { companyId } = useCompany();
  const task = useQuery(api.activation.task, taskId ? { companyId, taskId } : "skip");
  const retry = useMutation(api.activation.retry);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open={taskId !== null} onClose={onClose} title={task?.title ?? "Task"} description={task ? `${task.agentName} · ${task.stateWords}` : undefined}>
      {!task ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="grid gap-4 text-sm">
          <p className="text-muted-foreground">{task.objective}</p>
          <Section title="Inputs">
            <ul className="grid gap-1 text-muted-foreground">
              {task.inputs.sources.map((s) => (
                <li key={s.label}>
                  {s.label}: <span className="font-medium text-strong tabular-nums">{s.count}</span>
                </li>
              ))}
              {task.inputs.prerequisites.map((p) => (
                <li key={p.words}>
                  {p.met ? "✓" : "○"} {p.words}
                </li>
              ))}
            </ul>
            <details className="mt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Company context used (version {task.inputs.contextVersion})</summary>
              <ul className="mt-1 grid gap-0.5">
                {task.inputs.context.map((c) => (
                  <li key={c.key}>
                    {c.key}: {c.value} <span className={c.state === "confirmed" ? "text-success-foreground" : ""}>({c.state === "found" ? "found, not confirmed: not used as fact" : c.state})</span>
                  </li>
                ))}
              </ul>
            </details>
          </Section>
          <Section title="Actions taken">
            <ol className="grid gap-1 text-muted-foreground">
              {task.steps.map((s, i) => (
                <li key={`${s.at}-${i}`} className="flex gap-2">
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", STEP_DOT[s.kind])} aria-hidden />
                  <span>
                    {s.words} <span className="text-xs">· {new Date(s.at).toLocaleString()}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Section>
          <Section title="Outputs">
            {task.outputs.length ? (
              <ul className="grid gap-1">
                {task.outputs.map((o) => (
                  <li key={`${o.kind}-${o.ref.id}`}>
                    <Link href={o.ref.href} className="font-medium text-brand-600 underline-offset-4 hover:underline">
                      {o.ref.label}
                    </Link>{" "}
                    <span className="text-muted-foreground">
                      · {o.state}
                      {o.created ? "" : " · already existed, left as it was"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">Nothing yet. {task.expectedOutput}</p>
            )}
          </Section>
          <Section title="Permission and cost">
            <p className="text-muted-foreground">{task.authority.words}</p>
            <p className="text-muted-foreground">{task.estimate.words}</p>
            <p className="text-muted-foreground">Charged so far: {task.charges.length ? task.charges.map((c) => `${c.credits} credits (${c.label}, ${c.state})`).join("; ") : "nothing"}.</p>
            {task.approvals.length ? <p className="text-muted-foreground">Approvals it asked for: {task.approvals.map((a) => `${a.summary} (${a.status})`).join("; ")}.</p> : null}
          </Section>
          <Section title="Next step">
            <p className="text-strong">{task.next}</p>
            {task.lastError ? <p className="text-xs text-muted-foreground">Last problem: {task.lastError}</p> : null}
          </Section>
          {task.canRetry ? (
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void retry({ companyId, taskId: task.id })
                    .then(() => setError(null))
                    .catch((caught) => setError(messageOf(caught)))
                }
              >
                Try again
              </Button>
              {error ? <p className="mt-1 text-xs text-destructive-foreground">{error}</p> : null}
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-1">
      <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h4>
      {children}
    </section>
  );
}

const LEVEL_WORDS: Record<string, string> = { off: "Off", propose: "Asks you first", execute_and_report: "Acts, then tells you", execute: "Acts on its own", paused: "Paused", unknown: "Not set", person_only: "A person decides" };

function Routines() {
  const { companyId } = useCompany();
  const [open, setOpen] = useState(false);
  const routines = useQuery(api.activation.routines, open ? { companyId } : "skip");
  return (
    <div className="min-w-0 flex-1">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-1.5 text-sm font-medium text-strong">
        What keeps running after this
        <ChevronDown className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {(routines ?? []).map((r) => (
            <li key={r.agent} className="grid gap-1 rounded-lg border border-border p-2.5 text-xs">
              <p className="flex items-center gap-2 font-medium text-strong">
                <AgentAvatar agent={r.agent as AgentId} size="xs" />
                {r.name}
                <Badge variant={r.paused ? "outline" : "success"} size="sm" className="ml-auto">
                  {r.paused ? "Paused" : "Running"}
                </Badge>
              </p>
              <p className="text-muted-foreground">{r.trigger}</p>
              <p className="text-muted-foreground">{r.schedule}</p>
              <p className="text-muted-foreground">
                Sending: <span className="text-strong">{LEVEL_WORDS[r.level] ?? r.level}</span> ·{" "}
                <Link href="/app/settings/agents" className="text-brand-600 underline-offset-4 hover:underline">
                  {r.paused ? "Resume" : "Pause or change"}
                </Link>
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CancelButton({ activationId }: { activationId: Id<"activations"> }) {
  const { companyId } = useCompany();
  const cancel = useMutation(api.activation.cancel);
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      Stop the rest? What&apos;s already made is kept.
      <Button size="xs" variant="destructive" onClick={() => void cancel({ companyId, activationId }).finally(() => setConfirm(false))}>
        Stop
      </Button>
      <Button size="xs" variant="ghost" onClick={() => setConfirm(false)}>
        Keep going
      </Button>
    </span>
  ) : (
    <Button size="xs" variant="ghost" onClick={() => setConfirm(true)}>
      Stop remaining work
    </Button>
  );
}

const FOCUS_CHOICES: Priority[] = ["sales", "recruiter", "dispatch", "retention"];
const FOCUS_WORDS: Record<string, string> = { sales: "Get more bookings", recruiter: "Hire cleaners", dispatch: "Stop chasing cleaners", retention: "Keep more customers" };

/** For an Owner with no batch yet (or an old one): start first agent tasks without going through setup again. */
function StartCard({ focus, again }: { focus: Priority | null; again?: boolean }) {
  const { companyId } = useCompany();
  const start = useMutation(api.activation.start);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Priority | null>(focus && FOCUS_CHOICES.includes(focus) ? focus : focus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await start({ companyId, source: "workspace", focus: chosen });
      setOpen(false);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-brand-500/25 bg-gradient-to-br from-brand-500/10 to-transparent p-4 sm:p-5" aria-labelledby="start-first-tasks">
      <span className="grid size-10 place-items-center rounded-xl bg-brand-500 text-white" aria-hidden>
        <Rocket className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="start-first-tasks" className="font-heading text-lg text-strong">
          {again ? "Start another round of agent work" : "Start my first agent tasks"}
        </h2>
        <p className="text-sm text-muted-foreground">Pick a focus and review exactly what Selestial will prepare, using what you&apos;ve already told us. No need to go through setup again.</p>
      </div>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Review and start
        <ArrowRight aria-hidden />
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Start your agents" description="Selestial will begin the work shown below. You can leave this page—we’ll notify you when results are ready.">
        <div className="grid gap-4">
          <div role="radiogroup" aria-label="Focus" className="grid grid-cols-2 gap-2">
            {FOCUS_CHOICES.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={chosen === value}
                onClick={() => setChosen(value)}
                className={cn("rounded-xl border px-3 py-2.5 text-left text-sm", chosen === value ? "border-brand-500 bg-brand-500/8 font-medium text-strong" : "border-border hover:border-brand-500/40")}
              >
                {FOCUS_WORDS[value]}
                <span className="block text-xs font-normal text-muted-foreground">{PRIORITY_INFO.find((p) => p.id === value)?.title}</span>
              </button>
            ))}
          </div>
          {chosen ? <ActivationReview focus={chosen} /> : null}
          {error ? (
            <p className="text-sm text-destructive-foreground" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Not now
            </Button>
            <Button variant="primary" onClick={() => void go()} disabled={!chosen || busy} loading={busy}>
              <Rocket aria-hidden />
              Start my agents
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
