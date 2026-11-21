"use client";

import { useMutation, useQuery } from "convex/react";
import { motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextInput, useRun } from "@/components/app/form";
import { Panel } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentRoster, CreditRing, HeroCard, HeroStat, type RosterRow } from "@/components/app/billing/visuals";
import { MessageSquareText, Sparkles, TrendingUp, type LucideIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Checkbox } from "@/components/ui/selection";

type Usage = Extract<NonNullable<ReturnType<typeof useQuery<typeof api.billingUsage.usage>>>, { connected: true }>;

const n = (value: number) => value.toLocaleString("en-US");
const date = (at: number | null | undefined, withTime = false) =>
  at ? new Date(at).toLocaleString("en-US", withTime ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", year: "numeric" }) : "—";
const dayInput = (at: number) => new Date(at).toISOString().slice(0, 10);

/** Fixed colour per agent and per action, so a filter never repaints what stays on screen. */
const AGENT_SLOT: Record<string, number> = { chat: 1, recruiter: 2, dispatch: 3, studio: 4, sales: 5, retention: 6, marketing: 7, quality: 8 };
const TASK_SLOT: Record<string, number> = { chat_response_standard: 1, chat_response_advanced: 7, hiring_message_reading: 2, image_generation: 4, image_edit: 5, video_generation: 3 };
const color = (slot: number | undefined) => (slot ? `var(--viz-${slot})` : "var(--viz-other)");

/** Settings → Plan & Usage → Usage. The Owner only; the query is never sent for anyone else. */
export function UsageDashboard({ afterOverview }: { afterOverview?: React.ReactNode } = {}) {
  const { companyId } = useCompany();
  const [range, setRange] = useState<{ from?: number; to?: number }>({});
  const [filters, setFilters] = useState<{ agent?: string; task?: string; status?: string; memberId?: Id<"members">; search?: string }>({});
  const data = useQuery(api.billingUsage.usage, { companyId, ...range, ...filters });
  if (data === undefined) return <Skeleton className="h-[40rem] rounded-2xl" />;
  if (!data.connected)
    return (
      <>
        <Panel title="Usage">
          <p className="text-sm text-muted-foreground">{data.message}</p>
        </Panel>
        {afterOverview}
      </>
    );
  return (
    <div className="usage-viz grid gap-5">
      <Overview data={data} />
      {afterOverview}
      <UsageOverTime data={data} range={range} onRange={setRange} />
      <WhereCreditsWent data={data} />
      <WorkDelivered data={data} />
      <ActivityAndHistory data={data} filters={filters} onFilters={setFilters} />
      <SpendingControls data={data} />
      <PriceList data={data} />
      <Communication data={data} />
    </div>
  );
}

// ── 1. Credit overview ───────────────────────────────────────────────────────────────────────────

function Overview({ data }: { data: Usage }) {
  const { overview } = data;
  const monthly = overview.monthly;
  const used = monthly ? Math.max(0, monthly.granted - monthly.remaining) : 0;
  const share = monthly && monthly.granted > 0 ? Math.min(1, used / monthly.granted) : 0;
  const value = (number: number | null) => (overview.updating || number === null ? "Updating usage" : n(number));
  return (
    <section aria-labelledby="usage-overview" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="usage-overview" className="font-heading text-lg tracking-tight text-strong">
          Selestial Credits
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" render={<Link href="/app/settings/billing?tab=billing#top-ups" />}>
            Buy credits
          </Button>
          <Button size="sm" variant="outline" render={<a href="#spending" />}>
            Manage spending
          </Button>
          <Button size="sm" variant="ghost" render={<Link href="/app/settings/billing?tab=plan" />}>
            Change plan
          </Button>
        </div>
      </div>
      {overview.updating ? (
        <p role="status" className="rounded-xl border border-border bg-muted px-4 py-2 text-sm text-strong">
          Updating usage: the latest balance from billing has not arrived yet{overview.syncedAt ? ` (last confirmed ${date(overview.syncedAt, true)})` : ""}. Numbers appear once billing confirms them.
        </p>
      ) : null}
      {overview.zero ? (
        <div role="alert" className="rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-strong">
          <p className="font-semibold">No credits left. New AI work is paused.</p>
          <p className="mt-1 text-muted-foreground">
            Paused: Company Chat answers, Recruiter&apos;s AI reading of hiring email (emails are still filed and read by rules), and Creative Studio generations. Still working: schedules, records, manual work, cleaner text-message links and jobs in progress.
          </p>
          <p className="mt-1">
            <Link className="underline underline-offset-2" href="/app/settings/billing?tab=billing#top-ups">
              Buy credits
            </Link>{" "}
            or wait for the monthly reset on {date(overview.nextResetAt)}.
          </p>
        </div>
      ) : null}
      <HeroCard>
        <div className="grid items-center gap-6 md:grid-cols-[auto_1fr]">
          <CreditRing left={overview.updating ? null : overview.available} total={monthly ? monthly.granted + (overview.purchased?.granted ?? 0) : 0} low={share > 0.9} empty={overview.zero} />
          <div className="grid min-w-0 gap-4">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <HeroStat label="Available" value={value(overview.available)} hint="Ready for new work" tone={overview.zero ? "danger" : share > 0.9 ? "warning" : undefined} />
              <HeroStat label="Used this cycle" value={value(overview.usedThisCycle)} hint="Completed work" />
              <HeroStat label="Reserved" value={n(overview.reserved)} hint="Held for work running now" />
              <HeroStat label="Resets" value={overview.nextResetAt ? date(overview.nextResetAt) : "—"} hint={monthly ? `${n(monthly.granted)} monthly credits` : "Comes with a plan"} />
            </dl>
            <div>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium text-strong">Monthly credits</span>
                <span className="tabular-nums text-muted-foreground">{monthly && !overview.updating ? `${n(used)} of ${n(monthly.granted)} used` : "Updating usage"}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Monthly credits used" aria-valuemin={0} aria-valuemax={monthly?.granted ?? 0} aria-valuenow={used}>
                <motion.div className={cn("h-full rounded-full", share >= 1 ? "bg-destructive" : share > 0.8 ? "bg-warning" : "bg-gradient-to-r from-[#b39eff] to-brand-500")} initial={{ width: 0 }} animate={{ width: `${share * 100}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Unused monthly credits don&apos;t roll over. Purchased credits: {overview.purchased && !overview.updating ? n(overview.purchased.remaining) : "0"} left
                {overview.purchased?.expiresAt ? `, first expiry ${date(overview.purchased.expiresAt)}` : ""}, used after monthly credits.
              </p>
            </div>
            {data.forecast ? (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <TrendingUp aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600" />
                <span>{data.forecast}</span>
              </p>
            ) : null}
          </div>
        </div>
      </HeroCard>
    </section>
  );
}


// ── 2. Usage over time ───────────────────────────────────────────────────────────────────────────

function UsageOverTime({ data, range, onRange }: { data: Usage; range: { from?: number; to?: number }; onRange: (next: { from?: number; to?: number }) => void }) {
  const [group, setGroup] = useState<"agent" | "task">("agent");
  const [compare, setCompare] = useState(false);
  const [asTable, setAsTable] = useState(false);
  const keys = group === "agent" ? data.byAgent.filter((row) => row.credits > 0).map((row) => ({ key: row.key, label: row.label, slot: AGENT_SLOT[row.key] })) : data.byTask.filter((row) => row.credits > 0).map((row) => ({ key: row.key, label: row.label, slot: TASK_SLOT[row.key] }));
  const cycleIndex = data.cycles.findIndex((cycle) => cycle.from === data.range.from && cycle.to === data.range.to);
  return (
    <Panel title="Usage over time">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Period">
          <SelectInput value={cycleIndex >= 0 ? String(cycleIndex) : "custom"} onChange={(event) => (event.target.value === "custom" ? onRange({ from: data.range.from, to: data.range.to }) : onRange(event.target.value === "0" ? {} : { from: data.cycles[Number(event.target.value)].from, to: data.cycles[Number(event.target.value)].to }))}>
            {data.cycles.map((cycle, index) => (
              <option key={cycle.from} value={index}>
                {cycle.label}
              </option>
            ))}
            <option value="custom">Custom dates</option>
          </SelectInput>
        </Field>
        <Field label="From">
          <TextInput type="date" value={dayInput(data.range.from)} onChange={(event) => event.target.value && onRange({ ...range, from: Date.parse(`${event.target.value}T00:00:00Z`), to: range.to ?? data.range.to })} />
        </Field>
        <Field label="To">
          <TextInput type="date" value={dayInput(data.range.to - 1)} onChange={(event) => event.target.value && onRange({ ...range, from: range.from ?? data.range.from, to: Date.parse(`${event.target.value}T00:00:00Z`) + 86_400_000 })} />
        </Field>
        <div role="group" aria-label="Break down by" className="flex rounded-lg border border-border p-0.5 text-sm">
          {(["agent", "task"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={group === value} onClick={() => setGroup(value)} className={cn("rounded-md px-3 py-1", group === value ? "bg-muted font-medium text-strong" : "text-muted-foreground")}>
              {value === "agent" ? "By agent" : "By action"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-strong">
          <Checkbox checked={compare} onCheckedChange={(checked) => setCompare(checked)} />
          Compare with the previous period
        </label>
        <label className="flex items-center gap-1.5 text-sm text-strong">
          <Checkbox checked={asTable} onCheckedChange={(checked) => setAsTable(checked)} />
          Show as a table
        </label>
      </div>
      {keys.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No credits were used in this period.</p>
      ) : asTable ? (
        <UsageTable data={data} keys={keys} group={group} compare={compare} />
      ) : (
        <UsageChart data={data} keys={keys} group={group} compare={compare} />
      )}
    </Panel>
  );
}

type Key = { key: string; label: string; slot: number | undefined };

function UsageChart({ data, keys, group, compare }: { data: Usage; keys: Key[]; group: "agent" | "task"; compare: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const height = 220;
  const pad = { left: 44, right: 8, top: 10, bottom: 26 };
  const days = data.series;
  const max = Math.max(1, ...days.map((day) => day.total), ...(compare ? data.previous : []));
  const step = (width - pad.left - pad.right) / Math.max(1, days.length);
  const bar = Math.max(2, Math.min(28, step - 2));
  const y = (value: number) => pad.top + (height - pad.top - pad.bottom) * (1 - value / max);
  const ticks = [0, Math.round(max / 2), max];
  const values = (day: (typeof days)[number]) => (group === "agent" ? day.byAgent : day.byTask) as Record<string, number>;
  const labelEvery = Math.ceil(days.length / 8);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full text-muted-foreground" role="img" aria-label="Credits used per day">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="var(--viz-grid)" />
            <text x={pad.left - 6} y={y(tick) + 4} textAnchor="end" fontSize="10" fill="currentColor">
              {n(tick)}
            </text>
          </g>
        ))}
        {days.map((day, i) => {
          let top = height - pad.bottom;
          const x = pad.left + i * step + (step - bar) / 2;
          return (
            <g key={day.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.left + i * step} y={pad.top} width={step} height={height - pad.top - pad.bottom} fill="transparent" />
              {keys.map((key) => {
                const value = values(day)[key.key] ?? 0;
                if (!value) return null;
                const h = Math.max(1, (height - pad.top - pad.bottom) * (value / max) - 2);
                top -= h + 2;
                return <rect key={key.key} x={x} y={top + 2} width={bar} height={h} rx={Math.min(4, bar / 2)} fill={color(key.slot)} opacity={hover === null || hover === i ? 1 : 0.55} />;
              })}
              {i % labelEvery === 0 ? (
                <text x={x + bar / 2} y={height - 8} textAnchor="middle" fontSize="10" fill="currentColor">
                  {day.day.slice(5)}
                </text>
              ) : null}
            </g>
          );
        })}
        {compare ? <polyline fill="none" stroke="var(--viz-compare)" strokeWidth={2} strokeDasharray="4 3" points={data.previous.slice(0, days.length).map((value, i) => `${pad.left + i * step + step / 2},${y(value)}`).join(" ")} /> : null}
      </svg>
      {hover !== null ? (
        <div className="pointer-events-none absolute top-0 right-0 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-sm">
          <p className="font-medium text-strong">{days[hover].day}</p>
          {keys.map((key) => (
            <p key={key.key} className="flex items-center gap-1.5 text-muted-foreground">
              <span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: color(key.slot) }} />
              {key.label}: <span className="tabular-nums text-strong">{n(values(days[hover])[key.key] ?? 0)}</span>
            </p>
          ))}
          <p className="mt-1 text-strong">Total: {n(days[hover].total)}</p>
          {compare ? <p className="text-muted-foreground">Previous period: {n(data.previous[hover] ?? 0)}</p> : null}
        </div>
      ) : null}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        {keys.map((key) => (
          <li key={key.key} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: color(key.slot) }} />
            {key.label}
          </li>
        ))}
        {compare ? (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-4 border-t-2 border-dashed" style={{ borderColor: "var(--viz-compare)" }} />
            Previous period (total)
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function UsageTable({ data, keys, group, compare }: { data: Usage; keys: Key[]; group: "agent" | "task"; compare: boolean }) {
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-1 font-medium">Day</th>
            {keys.map((key) => (
              <th key={key.key} className="py-1 text-right font-medium">
                {key.label}
              </th>
            ))}
            <th className="py-1 text-right font-medium">Total</th>
            {compare ? <th className="py-1 text-right font-medium">Previous</th> : null}
          </tr>
        </thead>
        <tbody>
          {data.series.map((day, i) => (
            <tr key={day.day} className="border-t border-border">
              <td className="py-1 text-strong">{day.day}</td>
              {keys.map((key) => (
                <td key={key.key} className="py-1 text-right tabular-nums text-muted-foreground">
                  {n(((group === "agent" ? day.byAgent : day.byTask) as Record<string, number>)[key.key] ?? 0)}
                </td>
              ))}
              <td className="py-1 text-right tabular-nums text-strong">{n(day.total)}</td>
              {compare ? <td className="py-1 text-right tabular-nums text-muted-foreground">{n(data.previous[i] ?? 0)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 3. Where credits went, 4. Work delivered ─────────────────────────────────────────────────────

/** Which agents (and Company Chat or Creative Studio) did the work, with their live state. */
const NOT_AGENTS: Record<string, { icon: LucideIcon }> = { chat: { icon: MessageSquareText }, studio: { icon: Sparkles } };

function WhereCreditsWent({ data }: { data: Usage }) {
  const { companyId } = useCompany();
  const team = useQuery(api.overview.agents, { companyId });
  const [view, setView] = useState<"agent" | "task">("agent");
  const rows = view === "agent" ? data.byAgent.map((row) => ({ ...row, slot: AGENT_SLOT[row.key] })) : data.byTask.map((row) => ({ ...row, slot: TASK_SLOT[row.key] }));
  return (
    <Panel
      title="Agents at work"
      action={
        <div role="group" aria-label="View" className="flex rounded-lg border border-border p-0.5 text-sm">
          {(["agent", "task"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)} className={cn("rounded-md px-3 py-1", view === value ? "bg-muted font-medium text-strong" : "text-muted-foreground")}>
              {value === "agent" ? "By agent" : "By action"}
            </button>
          ))}
        </div>
      }
    >
      {view === "agent" ? (
        <AgentRoster
          rows={data.byAgent
            .filter((row) => row.credits > 0 || row.units > 0)
            .map((row) => ({
              key: row.key,
              label: row.label,
              agent: NOT_AGENTS[row.key] ? null : (row.key as RosterRow["agent"]),
              icon: NOT_AGENTS[row.key]?.icon ?? Sparkles,
              state: team?.agents.find((agent) => agent.agent === row.key)?.state,
              credits: row.credits,
              units: row.units,
              share: row.share,
              color: color(AGENT_SLOT[row.key]),
            }))}
        />
      ) : (
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-1 font-medium">Action</th>
            <th className="py-1 text-right font-medium">Completed</th>
            <th className="py-1 text-right font-medium">Credits</th>
            <th className="w-1/3 py-1 pl-4 font-medium">Share of usage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-border">
              <td className="py-2 text-strong">
                <span aria-hidden className="mr-2 inline-block size-2.5 rounded-sm align-middle" style={{ background: color(row.slot) }} />
                {row.label}
              </td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">{n(row.units)}</td>
              <td className="py-2 text-right tabular-nums text-strong">{n(row.credits)}</td>
              <td className="py-2 pl-4">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${row.share}%`, background: color(row.slot) }} />
                  </div>
                  <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{row.share}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
      {view === "agent" ? <p className="mt-2 text-xs text-muted-foreground">Company Chat answers count under Company Chat. Work an agent does is counted once, under that agent, even when it was asked for in Chat.</p> : null}
    </Panel>
  );
}

function WorkDelivered({ data }: { data: Usage }) {
  return (
    <Panel title="Work delivered">
      {data.delivered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has been completed in this period yet.</p>
      ) : (
        <ul className="grid gap-2">
          {data.delivered.map((row) => (
            <li key={`${row.agent}:${row.task}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-sm">
              <span>
                <span className="font-semibold text-strong">{row.agent}:</span> {n(row.units)} {row.task.toLowerCase()}
                {row.units === 1 ? "" : "s"} · <span className="tabular-nums">{n(row.credits)} credits</span>
              </span>
              {row.link ? (
                <Link className="text-sm underline underline-offset-2" href={row.link.path}>
                  Open {row.link.label.toLowerCase()}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Counts of completed work only. Links open the work for people whose role allows it.</p>
    </Panel>
  );
}

// ── 5. Activity and credit history ───────────────────────────────────────────────────────────────

function ActivityAndHistory({ data, filters, onFilters }: { data: Usage; filters: { agent?: string; task?: string; status?: string; memberId?: Id<"members">; search?: string }; onFilters: (next: typeof filters) => void }) {
  const [view, setView] = useState<"activity" | "balance">("activity");
  const [open, setOpen] = useState<Id<"aiExecutions"> | null>(null);
  const set = (key: keyof typeof filters, value: string) => onFilters({ ...filters, [key]: value || undefined });
  return (
    <Panel
      title="Activity and credit history"
      action={
        <div role="group" aria-label="View" className="flex rounded-lg border border-border p-0.5 text-sm">
          {(["activity", "balance"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)} className={cn("rounded-md px-3 py-1", view === value ? "bg-muted font-medium text-strong" : "text-muted-foreground")}>
              {value === "activity" ? "Usage activity" : "Balance history"}
            </button>
          ))}
        </div>
      }
    >
      {view === "activity" ? (
        <>
          <div className="mb-3 grid gap-2 sm:grid-cols-5">
            <TextInput aria-label="Search activity" placeholder="Search" value={filters.search ?? ""} onChange={(event) => set("search", event.target.value)} />
            <SelectInput aria-label="Agent" value={filters.agent ?? ""} onChange={(event) => set("agent", event.target.value)}>
              <option value="">Every agent</option>
              {data.filters.agents.map((row) => (
                <option key={row.key} value={row.key}>
                  {row.label}
                </option>
              ))}
            </SelectInput>
            <SelectInput aria-label="Action" value={filters.task ?? ""} onChange={(event) => set("task", event.target.value)}>
              <option value="">Every action</option>
              {data.filters.tasks.map((row) => (
                <option key={row.key} value={row.key}>
                  {row.label}
                </option>
              ))}
            </SelectInput>
            <SelectInput aria-label="Status" value={filters.status ?? ""} onChange={(event) => set("status", event.target.value)}>
              <option value="">Every status</option>
              {data.filters.statuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </SelectInput>
            <SelectInput aria-label="Initiated by" value={filters.memberId ?? ""} onChange={(event) => set("memberId", event.target.value)}>
              <option value="">Anyone or automatic</option>
              {data.filters.members.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </SelectInput>
          </div>
          {data.activity.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No AI work matches.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 font-medium">Date and time</th>
                    <th className="py-1 font-medium">Agent / origin</th>
                    <th className="py-1 font-medium">Action</th>
                    <th className="py-1 font-medium">Record or output</th>
                    <th className="py-1 font-medium">Status</th>
                    <th className="py-1 text-right font-medium">Credits</th>
                    <th className="py-1 pl-3 font-medium">Initiated by</th>
                  </tr>
                </thead>
                <tbody>
                  {data.activity.map((row) => (
                    <tr key={row.id} className="cursor-pointer border-t border-border hover:bg-muted/50" onClick={() => setOpen(row.id)}>
                      <td className="py-2 whitespace-nowrap text-strong">
                        <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => setOpen(row.id)}>
                          {date(row.at, true)}
                        </button>
                      </td>
                      <td className="py-2 text-strong">
                        {row.agent} <span className="text-muted-foreground">· {row.origin}</span>
                      </td>
                      <td className="py-2 text-muted-foreground">{row.action}</td>
                      <td className="py-2">
                        {row.record ? (
                          <Link className="underline underline-offset-2" href={row.record.path} onClick={(event) => event.stopPropagation()}>
                            {row.record.label}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 text-muted-foreground">{row.status}</td>
                      <td className="py-2 text-right tabular-nums text-strong">{row.held ? `${n(row.credits)} held` : n(row.credits)}</td>
                      <td className="py-2 pl-3 text-muted-foreground">{row.initiatedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {open ? <ExecutionDetail executionId={open} onClose={() => setOpen(null)} /> : null}
        </>
      ) : (
        <BalanceHistory data={data} />
      )}
    </Panel>
  );
}

function ExecutionDetail({ executionId, onClose }: { executionId: Id<"aiExecutions">; onClose: () => void }) {
  const { companyId } = useCompany();
  const row = useQuery(api.billingUsage.execution, { companyId, executionId });
  if (!row) return null;
  return (
    <div role="dialog" aria-label={`${row.agent}: ${row.action}`} className="mt-4 rounded-2xl border border-brand-500/40 bg-card p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-strong">
            {row.agent}: {row.action}
          </p>
          <p className="text-muted-foreground">
            {date(row.at, true)} · {row.origin} · {row.initiatedBy} · {row.status}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-4">
        <Fact label="Estimate" value={`${n(row.estimate)} credits`} />
        <Fact label="Final charge" value={row.final === null ? "Still running" : `${n(row.final)} credits`} />
        <Fact label="Rate" value={`${n(row.rate)} per unit · card ${row.rateCard}`} />
        <Fact label="Units" value={row.completedUnits === null ? `${row.units} requested` : `${row.completedUnits} of ${row.units} completed`} />
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">One unit: {row.unit}</p>
      {row.explanation ? <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-strong">{row.explanation}</p> : null}
      <h4 className="mt-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Charge history</h4>
      <ol className="mt-1 grid gap-1">
        {row.history.map((step, i) => (
          <li key={i} className="flex flex-wrap gap-x-2">
            <span className="tabular-nums text-muted-foreground">{date(step.at, true)}</span>
            <span className="font-medium text-strong">{step.kind.replace(/_/g, " ")}</span>
            {step.credits !== undefined ? <span className="tabular-nums">{n(step.credits)} credits</span> : null}
            {step.note ? <span className="text-muted-foreground">{step.note}</span> : null}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        Execution {row.id}
        {row.link ? (
          <>
            {" · "}
            <Link className="underline underline-offset-2" href={row.link.path}>
              Open {row.link.label.toLowerCase()}
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-strong tabular-nums">{value}</dd>
    </div>
  );
}

function BalanceHistory({ data }: { data: Usage }) {
  if (data.ledger === null) return <p className="py-6 text-center text-sm text-muted-foreground">Balance history is not available from billing yet. Monthly renewals, purchases and adjustments will be listed here.</p>;
  if (data.ledger.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No balance changes yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="py-1 font-medium">Date</th>
          <th className="py-1 font-medium">Change</th>
          <th className="py-1 text-right font-medium">Credits</th>
          <th className="py-1 text-right font-medium">Balance after</th>
        </tr>
      </thead>
      <tbody>
        {data.ledger.map((row) => (
          <tr key={row.id} className="border-t border-border">
            <td className="py-2 text-strong">{date(row.at, true)}</td>
            <td className="py-2 text-muted-foreground">{row.label}</td>
            <td className="py-2 text-right tabular-nums text-strong">{row.change === null ? "—" : `${row.change > 0 ? "+" : ""}${n(row.change)}`}</td>
            <td className="py-2 text-right tabular-nums text-muted-foreground">{row.after === null ? "—" : n(row.after)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── 6. Spending controls ─────────────────────────────────────────────────────────────────────────

function SpendingControls({ data }: { data: Usage }) {
  const { companyId } = useCompany();
  const save = useMutation(api.billing.setSpendingControls);
  const { busy, error, run } = useRun();
  const controls = data.controls;
  const text = (value: number | undefined) => (value === undefined ? "" : String(value));
  const [form, setForm] = useState(() => ({
    maxPerExecution: text(controls?.maxPerExecution),
    approvalThreshold: text(controls?.approvalThreshold ?? controls?.perRunLimit),
    autonomousMonthly: text(controls?.autonomousMonthly),
    lowBalance: text(controls?.lowBalance),
    alertPercents: (controls?.alertPercents ?? [50, 80, 100]).join(", "),
    budgets: Object.fromEntries(Object.entries(controls?.agentBudgets ?? {}).map(([key, value]) => [key, String(value)])) as Record<string, string>,
    autoCap: text(controls?.autoTopUp.maxPerMonth),
  }));
  const [saved, setSaved] = useState(false);
  const number = (value: string) => (value.trim() ? Number(value.replace(/,/g, "")) : null);
  const set = (key: Exclude<keyof typeof form, "budgets">, value: string) => {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  };
  if (!controls) return null;
  return (
    <section id="spending" className="scroll-mt-24">
      <Panel title="Spending controls">
        <div className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
          <p className="rounded-lg bg-muted px-3 py-2">
            <span className="font-semibold text-strong">Alerts</span> only tell the Owner. Nothing pauses.
          </p>
          <p className="rounded-lg bg-muted px-3 py-2">
            <span className="font-semibold text-strong">Hard limits</span> pause new AI work of that kind until the limit resets or is raised. Schedules, records, cleaner links and work already running carry on.
          </p>
        </div>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            setSaved(false);
            void run(async () => {
              await save({
                companyId,
                maxPerExecution: number(form.maxPerExecution),
                approvalThreshold: number(form.approvalThreshold),
                autonomousMonthly: number(form.autonomousMonthly),
                lowBalance: number(form.lowBalance),
                agentBudgets: Object.fromEntries(Object.entries(form.budgets).filter(([, value]) => value.trim()).map(([key, value]) => [key, Number(value.replace(/,/g, ""))])),
                alertPercents: form.alertPercents.split(",").map((value) => Number(value.trim())).filter((value) => value > 0),
                autoTopUp: { enabled: false, maxPerMonth: number(form.autoCap) ?? undefined },
              });
              setSaved(true);
            });
          }}
        >
          <Field label="Maximum per piece of work (hard limit)" hint="Nothing larger starts. Empty: no maximum.">
            <TextInput inputMode="numeric" value={form.maxPerExecution} onChange={(event) => set("maxPerExecution", event.target.value)} />
          </Field>
          <Field label="Approval threshold" hint="Work estimated above this waits for the Owner. Empty: none.">
            <TextInput inputMode="numeric" value={form.approvalThreshold} onChange={(event) => set("approvalThreshold", event.target.value)} />
          </Field>
          <Field label="Monthly budget for automatic work (hard limit)" hint="Work no one asked for, such as reading the hiring inbox. When it is used, those emails are read by rules instead.">
            <TextInput inputMode="numeric" value={form.autonomousMonthly} onChange={(event) => set("autonomousMonthly", event.target.value)} />
          </Field>
          <Field label="Low-balance alert (credits)" hint="Tell the Owner when available credits fall below this.">
            <TextInput inputMode="numeric" value={form.lowBalance} onChange={(event) => set("lowBalance", event.target.value)} />
          </Field>
          <Field label="Usage alerts (% of monthly credits)" hint="For example 50, 80, 100.">
            <TextInput value={form.alertPercents} onChange={(event) => set("alertPercents", event.target.value)} />
          </Field>
          <fieldset className="sm:col-span-2 lg:col-span-3">
            <legend className="text-sm font-medium text-strong">Monthly budget per agent (hard limit, optional)</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {data.budgetAgents.map((agent) => (
                <Field key={agent.key} label={agent.label}>
                  <TextInput inputMode="numeric" placeholder="No budget" value={form.budgets[agent.key] ?? ""} onChange={(event) => setForm((current) => ({ ...current, budgets: { ...current.budgets, [agent.key]: event.target.value } }))} />
                </Field>
              ))}
            </div>
          </fieldset>
          <div className="rounded-lg border border-dashed border-border px-3 py-2 text-sm sm:col-span-2 lg:col-span-3">
            <p className="font-medium text-strong">Automatic top-ups: off</p>
            <p className="text-muted-foreground">Not available yet. Credits are never bought without you. When automatic top-ups arrive, they stay off until you turn them on, and never go past this monthly purchase cap.</p>
            <div className="mt-2 max-w-xs">
              <Field label="Monthly purchase cap (credits)">
                <TextInput inputMode="numeric" value={form.autoCap} onChange={(event) => set("autoCap", event.target.value)} />
              </Field>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
            <Button type="submit" size="sm" variant="primary" loading={busy}>
              Save controls
            </Button>
            {saved ? <span className="text-xs text-muted-foreground">Saved.</span> : null}
          </div>
        </form>
        <FormError message={error} />
      </Panel>
    </section>
  );
}

// ── 7. What costs credits, 8. Communication ──────────────────────────────────────────────────────

function PriceList({ data }: { data: Usage }) {
  const list = data.priceList;
  if (!list) return null;
  return (
    <Panel title="What costs credits?">
      <p className="mb-3 text-xs text-muted-foreground">
        Published rates, card {list.version}
        {list.fixture ? " (test values for the sandbox, not prices)" : ""}. Each item is charged once, when it is completed. Work already done is never repriced.
      </p>
      <ul className="grid gap-2">
        {list.rows.map((row) => (
          <li key={row.task} className="grid gap-1 rounded-xl border border-border px-3 py-2 sm:grid-cols-[1fr_auto]">
            <div>
              <p className="text-sm font-medium text-strong">{row.label}</p>
              <p className="text-xs text-muted-foreground">{row.setup ?? row.unit}</p>
              {row.model ? <p className="text-xs text-muted-foreground">Model: {row.model}</p> : null}
            </div>
            <p className="text-sm font-semibold tabular-nums text-strong sm:text-right">{row.credits === null ? "Not priced yet" : `${row.startingAt ? "From " : ""}${n(row.credits)} ${row.credits === 1 ? "credit" : "credits"}`}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-strong">No credits for:</p>
      <ul className="mt-1 grid gap-0.5 text-sm text-muted-foreground">
        {list.free.map((line) => (
          <li key={line}>· {line}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">A price marked &quot;From&quot; becomes an exact number before anything is generated: Creative Studio shows the exact credits for the setup chosen, or says that setup has no published price yet.</p>
    </Panel>
  );
}

function Communication({ data }: { data: Usage }) {
  const rows = useMemo(
    () => [
      { label: "Text messages (SMS)", ...data.communication.sms },
      { label: "Email", ...data.communication.email },
    ],
    [data.communication],
  );
  return (
    <Panel title="Texts, email and calls">
      <p className="mb-3 text-sm text-muted-foreground">Texts and business email are paid from the messaging balance, never with AI credits. Sending a message that is already written uses no credits. Prices, funds and limits are on the Messaging tab.</p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-1 font-medium">Channel</th>
            <th className="py-1 text-right font-medium">Messages</th>
            <th className="py-1 text-right font-medium">Sent</th>
            <th className="py-1 text-right font-medium">Not sent or failed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-border">
              <td className="py-2 text-strong">{row.label}</td>
              <td className="py-2 text-right tabular-nums">{n(row.total)}</td>
              <td className="py-2 text-right tabular-nums">{n(row.sent)}</td>
              <td className="py-2 text-right tabular-nums">{n(row.failed)}</td>
            </tr>
          ))}
          <tr className="border-t border-border">
            <td className="py-2 text-strong">Voice calls</td>
            <td colSpan={3} className="py-2 text-right text-muted-foreground">
              Not available yet
            </td>
          </tr>
        </tbody>
      </table>
    </Panel>
  );
}
