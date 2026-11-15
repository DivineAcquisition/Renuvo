"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { AgentAvatar, eyebrow, STATE } from "@/components/app/agent";
import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextInput, useRun } from "@/components/app/form";
import { PauseCircleIcon, Play, ShieldCheck } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { centsFrom, money } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

const LEVELS = [
  { id: "off", label: "Off", meaning: "The agent does not do this." },
  { id: "propose", label: "Propose", meaning: "The agent prepares it; a person approves, changes or skips." },
  { id: "execute_and_report", label: "Execute and report", meaning: "The agent acts and tells you each time." },
  { id: "execute", label: "Execute", meaning: "The agent acts. It appears in the history." },
] as const;
type Level = (typeof LEVELS)[number]["id"];
const rank = (level: string) => LEVELS.findIndex((row) => row.id === level);

type Action = { key: string; label: string; level: Level; ceiling: Level; standard: Level; money: boolean; perActionCents: number | null; perDayCents: number | null; changed: boolean };

/** One action's permission. Only the Owner changes it, never past its ceiling, and money needs limits first. */
function PermissionRow({ action, canEdit }: { action: Action; canEdit: boolean }) {
  const { companyId } = useCompany();
  const set = useMutation(api.permissions.set);
  const { busy, error, run, setError } = useRun();
  const [pending, setPending] = useState<Level | null>(null);
  const [perAction, setPerAction] = useState(action.perActionCents !== null ? (action.perActionCents / 100).toFixed(2) : "");
  const [perDay, setPerDay] = useState(action.perDayCents !== null ? (action.perDayCents / 100).toFixed(2) : "");
  const save = (level: Level, limits?: { perActionCents: number; perDayCents: number }) =>
    run(async () => {
      await set({ companyId, action: action.key, level, ...limits });
      setPending(null);
    });
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <span className="min-w-0 flex-1 text-sm text-strong">
          {action.label}
          {action.ceiling === "propose" ? <span className="ml-1.5 text-xs text-muted-foreground">· always needs approval</span> : null}
          {action.money && action.perActionCents !== null && action.perDayCents !== null ? (
            <span className="block text-xs text-muted-foreground">
              Up to {money(action.perActionCents)} each, {money(action.perDayCents)} a day
            </span>
          ) : null}
        </span>
        {canEdit ? (
          <SelectInput
            aria-label={`Permission for ${action.label}`}
            className="w-auto min-w-44 py-1.5"
            disabled={busy}
            value={pending ?? action.level}
            onChange={(event) => {
              const level = event.target.value as Level;
              // Money never runs without review until the Owner has said how much.
              if (action.money && rank(level) > rank("propose")) return setPending(level);
              void save(level);
            }}
          >
            {LEVELS.filter((level) => rank(level.id) <= rank(action.ceiling)).map((level) => (
              <option key={level.id} value={level.id}>
                {level.label}
              </option>
            ))}
          </SelectInput>
        ) : (
          <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-strong">{LEVELS[rank(action.level)]?.label}</span>
        )}
      </div>
      {pending ? (
        <form
          className="mt-2 grid gap-3 rounded-xl border border-border bg-muted p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const [perActionCents, perDayCents] = [centsFrom(perAction), centsFrom(perDay)];
            if (perActionCents === null || perDayCents === null) return setError("Enter both limits as amounts in dollars and cents.");
            void save(pending, { perActionCents, perDayCents });
          }}
        >
          <p className="text-xs text-muted-foreground">This moves money. Set how much {LEVELS[rank(pending)]?.label.toLowerCase()} may spend before it has to ask.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Limit per action">
              <TextInput inputMode="decimal" value={perAction} onChange={(event) => setPerAction(event.target.value)} placeholder="0.00" required />
            </Field>
            <Field label="Limit per day">
              <TextInput inputMode="decimal" value={perDay} onChange={(event) => setPerDay(event.target.value)} placeholder="0.00" required />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" loading={busy}>
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
              Never mind
            </Button>
          </div>
        </form>
      ) : null}
      <FormError message={error} />
    </li>
  );
}

/**
 * Agent permissions, inside Settings: what each agent may do without asking, action by action, and a
 * way to pause it. Only the Owner changes these. Agents the backend does not know yet are not listed,
 * because there is nothing to permit.
 */
export function AgentPermissions() {
  const { companyId, role } = useCompany();
  const team = useQuery(api.overview.agents, { companyId });
  const permissions = useQuery(api.permissions.list, { companyId });
  const setPaused = useMutation(api.companies.setPausedAgents);
  const { busy, error, run } = useRun();
  const owner = role === "owner";
  if (!team || !permissions) return <Skeleton className="h-64 rounded-2xl" />;
  const paused = permissions.pausedAgents;
  const everyone = team.agents.map((agent) => agent.agent);
  const allPaused = everyone.every((agent) => paused.includes(agent));
  return (
    <section id="agents" className="scroll-mt-20 rounded-2xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div>
          <h2 className="font-heading text-base tracking-tight text-strong">Agent permissions</h2>
          <p className="text-xs text-muted-foreground">What each agent may do without asking. Pausing stops an agent from acting; its records stay open.</p>
        </div>
        {owner ? (
          <Button variant="outline" size="sm" loading={busy} onClick={() => void run(() => setPaused({ companyId, agents: allPaused ? [] : everyone }))}>
            {allPaused ? <Play aria-hidden /> : <PauseCircleIcon aria-hidden />}
            {allPaused ? "Resume all agents" : "Pause all agents"}
          </Button>
        ) : null}
      </header>
      <div className="px-4 sm:px-5">
        <FormError message={error} />
      </div>
      <div className="grid divide-y divide-border">
        {team.agents.map((agent) => {
          const actions = permissions.actions.filter((action) => action.agent === agent.agent) as Action[];
          const isPaused = paused.includes(agent.agent);
          return (
            <div key={agent.agent} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <AgentAvatar agent={agent.agent} state={agent.state} size="md" />
                  <div>
                    <h3 className="text-sm font-semibold text-strong">{agent.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {STATE[agent.state].label} · {agent.department.name}
                    </p>
                  </div>
                </div>
                {owner && agent.state !== "not_built" ? (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => setPaused({ companyId, agents: isPaused ? paused.filter((id) => id !== agent.agent) : [...paused, agent.agent] }))}>
                    {isPaused ? <Play aria-hidden /> : <PauseCircleIcon aria-hidden />}
                    {isPaused ? "Resume" : "Pause"}
                  </Button>
                ) : null}
              </div>
              {agent.state === "not_built" ? <p className="mt-3 text-xs text-muted-foreground">Not built yet. These are the permissions it will ask for; nothing runs until its workflow exists.</p> : null}
              <p className={cn(eyebrow, "mt-4 flex items-center gap-1.5")}>
                <ShieldCheck className="size-3.5" aria-hidden />
                What {agent.name} may do
              </p>
              <ul className="mt-1 divide-y divide-border">
                {actions.map((action) => (
                  <PermissionRow key={`${action.key}:${action.level}:${action.perActionCents}:${action.perDayCents}`} action={action} canEdit={owner} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="border-t border-border p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-strong">Always a person, at any setting</h3>
        <ul className="mt-2 grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-2">
          {permissions.personOnly.map((row) => (
            <li key={row.key} className="flex gap-2">
              <span aria-hidden>·</span>
              {row.label}
            </li>
          ))}
        </ul>
        <dl className="mt-4 grid gap-2 border-t border-border pt-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
          {LEVELS.map((level) => (
            <div key={level.id}>
              <dt className="font-medium text-strong">{level.label}</dt>
              <dd className="text-xs leading-relaxed text-muted-foreground">{level.meaning}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
