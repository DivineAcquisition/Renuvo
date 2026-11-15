"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { AgentAvatar, eyebrow, STATE } from "@/components/app/agent";
import { useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { Field, FormError, SelectInput, TextInput, useRun } from "@/components/app/form";
import { AgentWork, departmentPath } from "@/components/app/overview/team-at-work";
import { PageHeader } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { PauseCircleIcon, Play, ShieldCheck } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ago, centsFrom, money } from "@/lib/app/format";
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
            if (perActionCents === null || perDayCents === null) return setError("Enter both limits as amounts, for example 25.00 and 100.00.");
            void save(pending, { perActionCents, perDayCents });
          }}
        >
          <p className="text-xs text-muted-foreground">This moves money. Set how much {LEVELS[rank(pending)]?.label.toLowerCase()} may spend before it has to ask.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Limit per action">
              <TextInput inputMode="decimal" value={perAction} onChange={(event) => setPerAction(event.target.value)} placeholder="25.00" required />
            </Field>
            <Field label="Limit per day">
              <TextInput inputMode="decimal" value={perDay} onChange={(event) => setPerDay(event.target.value)} placeholder="100.00" required />
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
 * The AI Team: every agent as a member of the team. What it is responsible for, what it is doing, what
 * it may do without asking, and a way to pause it.
 */
export function TeamScreen() {
  const { companyId, timezone, role } = useCompany();
  const now = useNow();
  const open = useDetail();
  const team = useQuery(api.overview.agents, { companyId });
  const permissions = useQuery(api.permissions.list, { companyId });
  const setPaused = useMutation(api.companies.setPausedAgents);
  const { busy, error, run } = useRun();
  const owner = role === "owner";
  if (!team || !permissions) return <Skeleton className="h-96 rounded-2xl" />;
  const paused = permissions.pausedAgents;
  return (
    <>
      <PageHeader
        title="AI Team"
        lead="Four agents, each with one responsibility and a standard for when its work is done. You decide, action by action, what each may do without asking."
        actions={
          owner ? (
            <Button variant="outline" size="sm" loading={busy} onClick={() => void run(() => setPaused({ companyId, agents: paused.length === 4 ? [] : ["sales", "recruiter", "dispatch", "retention"] }))}>
              {paused.length === 4 ? <Play aria-hidden /> : <PauseCircleIcon aria-hidden />}
              {paused.length === 4 ? "Resume all agents" : "Pause all agents"}
            </Button>
          ) : undefined
        }
      />
      <FormError message={error} />
      <div className="grid items-start gap-5 xl:grid-cols-2">
        {team.agents.map((agent) => {
          const actions = permissions.actions.filter((action) => action.agent === agent.agent) as Action[];
          const isPaused = paused.includes(agent.agent);
          return (
            <section key={agent.agent} className={cn("rounded-2xl border bg-card", agent.state === "not_built" ? "border-dashed border-border" : "border-border")}>
              <header className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <AgentAvatar agent={agent.agent} state={agent.state} size="lg" />
                  <div>
                    <h2 className="font-heading text-lg tracking-tight text-strong">{agent.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {STATE[agent.state].label} ·{" "}
                      <Link href={departmentPath(agent.department.id)} className="font-medium text-brand-700 underline-offset-4 hover:underline">
                        {agent.department.name}
                      </Link>
                    </p>
                  </div>
                </div>
                {owner && agent.state !== "not_built" ? (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => setPaused({ companyId, agents: isPaused ? paused.filter((id) => id !== agent.agent) : [...paused, agent.agent] }))}>
                    {isPaused ? <Play aria-hidden /> : <PauseCircleIcon aria-hidden />}
                    {isPaused ? "Resume" : "Pause"}
                  </Button>
                ) : null}
              </header>

              <div className="grid gap-4 border-t border-border p-4 sm:p-5">
                <div>
                  <p className={eyebrow}>Responsibility</p>
                  <p className="mt-1 text-sm text-strong">{agent.responsibility}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    <span className="font-medium">Done means:</span> {agent.completion}
                  </p>
                </div>

                {agent.state === "not_built" ? (
                  <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">Not built yet. Its permissions are shown so you can see what it will ask for; nothing runs until its workflow exists.</p>
                ) : (
                  <>
                    <div>
                      <p className={eyebrow}>Current work</p>
                      <div className="mt-2">
                        <AgentWork agent={agent} now={now} timezone={timezone} onOpen={open} limit={5} />
                      </div>
                    </div>
                    <div>
                      <p className={eyebrow}>Recent outcomes</p>
                      {agent.recentOutcomes.length === 0 ? (
                        <p className="mt-1 text-sm text-muted-foreground">Nothing closed yet.</p>
                      ) : (
                        <ul className="mt-1.5 grid gap-1.5">
                          {agent.recentOutcomes.map((row) => (
                            <li key={row.taskId}>
                              <button type="button" onClick={() => open({ kind: "task", id: row.taskId })} className="-mx-1.5 block w-[calc(100%+0.75rem)] rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand-500">
                                <span className="text-strong">{row.outcome || row.title}</span>
                                <span className="block text-xs text-muted-foreground">
                                  {row.title}
                                  {row.closedAt ? ` · ${ago(row.closedAt, now, timezone)}` : ""}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}

                <div>
                  <p className={cn(eyebrow, "flex items-center gap-1.5")}>
                    <ShieldCheck className="size-3.5" aria-hidden />
                    What {agent.name} may do
                  </p>
                  <ul className="mt-1 divide-y divide-border">
                    {actions.map((action) => (
                      <PermissionRow key={`${action.key}:${action.level}:${action.perActionCents}:${action.perDayCents}`} action={action} canEdit={owner} />
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <section className="mt-5 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <h2 className="font-heading text-base tracking-tight text-strong">Always a person, at any setting</h2>
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
      </section>
    </>
  );
}
