"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useId, useState } from "react";

import { AgentAvatar, STATE } from "@/components/app/agent";
import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextInput, useRun } from "@/components/app/form";
import { ChevronDown, Info, PauseCircleIcon, Play } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { centsFrom, money } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

/** The four permission levels, in the owner's words. The ids are the permission engine's and do not change. */
export const LEVELS = [
  { id: "off", label: "Off", meaning: "The agent never does this." },
  { id: "propose", label: "Ask me first", meaning: "The agent prepares it. You approve, change or skip it." },
  { id: "execute_and_report", label: "Act and notify me", meaning: "The agent does it and tells you each time." },
  { id: "execute", label: "Act automatically", meaning: "The agent does it. You can see it in Activity." },
] as const;
type Level = (typeof LEVELS)[number]["id"];
const rank = (level: string) => LEVELS.findIndex((row) => row.id === level);
export const levelLabel = (level: string) => LEVELS[rank(level)]?.label ?? "Off";

export type Action = { key: string; label: string; level: Level; ceiling: Level; standard: Level; money: boolean; perActionCents: number | null; perDayCents: number | null; changed: boolean };

/**
 * One action's permission. Only the Owner changes it, never past its ceiling. An action that spends
 * money needs a per-action and a per-day limit before it can run without approval.
 */
export function PermissionRow({ action, canEdit }: { action: Action; canEdit: boolean }) {
  const { companyId } = useCompany();
  const set = useMutation(api.permissions.set);
  const { busy, error, run, setError } = useRun();
  const [pending, setPending] = useState<Level | null>(null);
  const [saved, setSaved] = useState(false);
  const [perAction, setPerAction] = useState(action.perActionCents !== null ? (action.perActionCents / 100).toFixed(2) : "");
  const [perDay, setPerDay] = useState(action.perDayCents !== null ? (action.perDayCents / 100).toFixed(2) : "");
  const id = useId();
  const save = (level: Level, limits?: { perActionCents: number; perDayCents: number }) =>
    run(async () => {
      await set({ companyId, action: action.key, level, ...limits });
      setPending(null);
      setSaved(true);
    });
  const spends = action.money && action.perActionCents !== null && action.perDayCents !== null && rank(action.level) > rank("propose");
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <span className="min-w-0 flex-1 basis-full text-sm text-strong sm:basis-auto">
          <span id={`${id}-label`}>{action.label}</span>
          {action.ceiling === "propose" ? <span className="block text-xs text-muted-foreground">Always needs your approval.</span> : null}
          {spends ? (
            <span className="block text-xs text-muted-foreground">
              Spends up to {money(action.perActionCents!)} each time and {money(action.perDayCents!)} a day without asking. Anything more needs your approval.
            </span>
          ) : null}
        </span>
        {canEdit ? (
          <span className="flex w-full items-center gap-2 sm:w-auto">
            {saved && !busy && !error ? (
              <span role="status" className="text-xs text-success">
                Saved
              </span>
            ) : null}
            <SelectInput
              aria-labelledby={`${id}-label`}
              className="w-full py-1.5 sm:w-auto sm:min-w-48"
              disabled={busy}
              value={pending ?? action.level}
              onChange={(event) => {
                setSaved(false);
                const level = event.target.value as Level;
                // Money never moves without review until the Owner has said how much.
                if (action.money && rank(level) > rank("propose")) return setPending(level);
                setPending(null);
                void save(level);
              }}
            >
              {LEVELS.filter((level) => rank(level.id) <= rank(action.ceiling)).map((level) => (
                <option key={level.id} value={level.id}>
                  {level.label}
                </option>
              ))}
            </SelectInput>
          </span>
        ) : (
          <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-strong">{levelLabel(action.level)}</span>
        )}
      </div>
      {pending ? (
        <form
          className="mt-2 grid gap-3 rounded-xl border border-border bg-muted p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const [perActionCents, perDayCents] = [centsFrom(perAction), centsFrom(perDay)];
            if (perActionCents === null || perDayCents === null) return setError("Enter both limits as dollar amounts, like 50 or 50.00.");
            if (perDayCents < perActionCents) return setError("The daily limit can't be less than the limit for one action.");
            void save(pending, { perActionCents, perDayCents });
          }}
        >
          <p className="text-sm text-strong">
            This action spends money. Choose how much the agent may spend without asking you. Anything over these amounts waits for your approval.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Most it can spend at once ($)">
              <TextInput inputMode="decimal" value={perAction} onChange={(event) => setPerAction(event.target.value)} placeholder="50.00" required />
            </Field>
            <Field label="Most it can spend in a day ($)">
              <TextInput inputMode="decimal" value={perDay} onChange={(event) => setPerDay(event.target.value)} placeholder="200.00" required />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" loading={busy}>
              Save limits and switch to &ldquo;{levelLabel(pending)}&rdquo;
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      <FormError message={error} />
    </li>
  );
}

type Team = NonNullable<ReturnType<typeof useQuery<typeof api.overview.agents>>>;
type TeamAgent = Team["agents"][number];
type Credits = ReturnType<typeof useQuery<typeof api.billing.creditIndicator>>;
type Live = ReturnType<typeof useQuery<typeof api.integrations.overview>>;
type Texting = ReturnType<typeof useQuery<typeof api.texting.agentTexting>>;

/** Agents that send texts can't reach people until the business texting number is set up. */
const NEEDS_TEXTING = new Set(["sales", "dispatch", "retention", "recruiter"]);

type Status = { label: string; tone: "success" | "warning" | "outline" | "info" | "error"; detail?: string; link?: { href: string; label: string } };

/**
 * Where an agent stands, with each reason kept separate: not on the plan, paused, setup missing, and
 * out of credits each mean something different and need a different next step.
 */
function statusOf(agent: TeamAgent, paused: boolean, credits: Credits, live: Live, owner: boolean, texting: Texting): Status[] {
  const out: Status[] = [];
  const access = (agent as TeamAgent & { access?: { ok: boolean; block?: string; message?: string } }).access;
  if (access && !access.ok) {
    out.push(
      access.block === "not_released"
        ? { label: "Coming soon", tone: "outline", detail: access.message }
        : { label: "Not on your plan", tone: "warning", detail: access.message, link: owner ? { href: "/app/settings/billing?tab=plan", label: "See plans" } : undefined },
    );
  }
  if (paused) out.push({ label: "Paused", tone: "outline", detail: "It won't start anything new until you resume it. Its records stay open." });
  // Texting, for this agent's own texts: what its registration covers, not one company-wide switch.
  const texts = texting?.find((row) => row.agent === agent.agent);
  if (NEEDS_TEXTING.has(agent.agent) && texts && texts.state !== "ready") {
    const tone = texts.state === "paused" ? "error" : texts.state === "partly" || texts.state === "in_progress" ? "info" : "warning";
    out.push({ label: `Texting: ${texts.label.toLowerCase()}`, tone, detail: texts.words, link: owner && texts.state !== "in_progress" ? { href: "/app/texting", label: texts.state === "paused" ? "See what's happening" : "Set up business texting" } : undefined });
  } else if (NEEDS_TEXTING.has(agent.agent) && !texts && live && live.live["texting-number"].state !== "connected") {
    out.push({ label: "Setup needed", tone: "warning", detail: "Your business texting number isn't set up yet, so this agent can't text people.", link: { href: "/app/texting", label: "Set up business texting" } });
  }
  if (credits && (credits.state === "empty" || credits.state === "no_plan")) {
    out.push({ label: credits.state === "empty" ? "Out of credits" : "No active plan", tone: "error", detail: credits.state === "empty" ? "AI work is paused until credits are added or the monthly reset. Its other work continues." : "AI work needs an active plan.", link: owner ? { href: "/app/settings/billing", label: "Plan & Usage" } : undefined });
  }
  if (out.length === 0) out.push({ label: STATE[agent.state].label, tone: agent.state === "needs_you" ? "warning" : agent.state === "working" ? "success" : "info" });
  return out;
}

function AgentCard({ agent, actions, paused, owner, credits, live, texting, onTogglePause, busy }: { agent: TeamAgent; actions: Action[]; paused: boolean; owner: boolean; credits: Credits; live: Live; texting: Texting; onTogglePause: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const statuses = statusOf(agent, paused, credits, live, owner, texting);
  const automatic = actions.filter((action) => rank(action.level) >= rank("execute_and_report")).length;
  const asks = actions.filter((action) => action.level === "propose").length;
  return (
    <li className="rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-start gap-3 p-4 sm:p-5">
        <AgentAvatar agent={agent.agent} state={agent.state} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-strong">{agent.name}</h3>
            {statuses.map((status) => (
              <Badge key={status.label} variant={status.tone} size="sm">
                {status.label}
              </Badge>
            ))}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{agent.responsibility}</p>
          {statuses
            .filter((status) => status.detail)
            .map((status) => (
              <p key={status.label} className="mt-1.5 text-xs text-muted-foreground">
                {status.detail}{" "}
                {status.link ? (
                  <Link href={status.link.href} className="font-medium text-brand-600 underline-offset-2 hover:underline">
                    {status.link.label}
                  </Link>
                ) : null}
              </p>
            ))}
        </div>
        {owner ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={onTogglePause}>
            {paused ? <Play aria-hidden /> : <PauseCircleIcon aria-hidden />}
            {paused ? "Resume" : "Pause"}
          </Button>
        ) : null}
      </div>
      <div className="border-t border-border">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 sm:px-5"
        >
          <span>
            <span className="font-medium text-strong">Actions &amp; approvals</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {actions.length} action{actions.length === 1 ? "" : "s"} · {automatic} without asking · {asks} ask you first
            </span>
          </span>
          <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {open ? (
          <div id={panel} className="px-4 pb-2 sm:px-5">
            <ul className="divide-y divide-border">
              {actions.map((action) => (
                <PermissionRow key={`${action.key}:${action.level}:${action.perActionCents}:${action.perDayCents}`} action={action} canEdit={owner} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Agent controls: one card per agent with its real status, a pause switch, and what it may do on its
 * own. Only the Owner changes these. Agents that are not released are listed separately, with nothing to set.
 */
export function AgentPermissions() {
  const { companyId, role } = useCompany();
  const team = useQuery(api.overview.agents, { companyId });
  const permissions = useQuery(api.permissions.list, { companyId });
  const credits = useQuery(api.billing.creditIndicator, { companyId });
  const live = useQuery(api.integrations.overview, { companyId });
  const texting = useQuery(api.texting.agentTexting, { companyId });
  const setPaused = useMutation(api.companies.setPausedAgents);
  const { busy, error, run } = useRun();
  const owner = role === "owner";
  if (!team || !permissions) return <Skeleton className="h-64 rounded-2xl" />;
  const paused = permissions.pausedAgents;
  const built = team.agents.filter((agent) => agent.state !== "not_built");
  const everyone = built.map((agent) => agent.agent);
  const allPaused = everyone.length > 0 && everyone.every((agent) => paused.includes(agent));
  return (
    <section aria-labelledby="your-agents" className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="your-agents" className="font-heading text-lg tracking-tight text-strong">
            Your agents
          </h2>
          <p className="text-sm text-muted-foreground">Each change saves as soon as you make it.</p>
        </div>
        {owner && everyone.length > 0 ? (
          <Button variant="outline" size="sm" loading={busy} onClick={() => void run(() => setPaused({ companyId, agents: allPaused ? [] : everyone }))}>
            {allPaused ? <Play aria-hidden /> : <PauseCircleIcon aria-hidden />}
            {allPaused ? "Resume all agents" : "Pause all agents"}
          </Button>
        ) : null}
      </div>
      <FormError message={error} />
      <ul className="grid gap-3">
        {built.map((agent) => {
          const isPaused = paused.includes(agent.agent);
          return (
            <AgentCard
              key={agent.agent}
              agent={agent}
              actions={permissions.actions.filter((action) => action.agent === agent.agent) as Action[]}
              paused={isPaused}
              owner={owner}
              credits={credits}
              live={live}
              texting={texting}
              busy={busy}
              onTogglePause={() => void run(() => setPaused({ companyId, agents: isPaused ? paused.filter((id) => id !== agent.agent) : [...paused, agent.agent] }))}
            />
          );
        })}
      </ul>
      <details className="group rounded-2xl border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <Info aria-hidden className="size-4 text-muted-foreground" />
            What the permission choices mean, and what always needs a person
          </span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-4 border-t border-border px-4 py-4 sm:px-5">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {LEVELS.map((level) => (
              <div key={level.id}>
                <dt className="font-medium text-strong">{level.label}</dt>
                <dd className="text-xs leading-relaxed text-muted-foreground">{level.meaning}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h3 className="text-sm font-semibold text-strong">Always done by a person, whatever you choose</h3>
            <ul className="mt-1.5 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
              {permissions.personOnly.map((row) => (
                <li key={row.key} className="flex gap-2">
                  <span aria-hidden>·</span>
                  {row.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </section>
  );
}
