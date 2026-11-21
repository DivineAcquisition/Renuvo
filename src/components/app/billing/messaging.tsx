"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { HeroCard, HeroStat } from "@/components/app/billing/visuals";
import { useCompany } from "@/components/app/company";
import { FormError, useRun, SelectInput } from "@/components/app/form";
import { InfoTip } from "@/components/app/services/shared";
import { Panel } from "@/components/app/shell";
import { Download, Mail, MessageSquareText, Plus, ReceiptIcon, ShieldCheck, Zap } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { formatUnits, UNITS_PER_CENT } from "../../../../convex/lib/messagingBilling/money";
import { autoTopUpWording } from "../../../../convex/lib/messagingBilling/wording";
import { Checkbox } from "@/components/ui/selection";

type Overview = NonNullable<ReturnType<typeof useQuery<typeof api.messagingUsage.overview>>>;
type Live = Extract<Overview, { connected: true }>;

const day = (at: number | null | undefined) => (at ? new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const dayTime = (at: number) => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const n = (value: number) => value.toLocaleString("en-US");
const dollars = (units: number) => String(Math.round(units / UNITS_PER_CENT / 100));
const toCents = (text: string): number | null => (/^\d{1,6}$/.test(text.trim()) ? Number(text.trim()) * 100 : null);

/** The three separate things a company pays for, side by side so they are never confused. Shown on the Plan tab. */
export function ThreeBalances({ plan, credits }: { plan: { name: string; monthlyCents: number } | null; credits: { remaining: number; granted: number } | null }) {
  const { companyId } = useCompany();
  const data = useQuery(api.messagingUsage.overview, { companyId });
  const live = data?.connected ? data : null;
  return (
    <section aria-label="What you pay for" className="grid gap-3 md:grid-cols-3">
      <Tile icon={ShieldCheck} title="Plan" value={plan ? plan.name : "No plan"} body={plan ? `$${plan.monthlyCents / 100} a month. Your agents and features.` : "Agents and AI work need a plan."} />
      <Tile icon={Zap} title="AI credits" value={credits ? `${n(credits.remaining)} left` : "—"} body="For AI work: writing, reading and creating. Sending a ready message never uses credits." href="/app/settings/billing?tab=usage" link="See credit usage" />
      <Tile
        icon={MessageSquareText}
        title="Messaging balance"
        value={live?.balance ? formatUnits(live.balance.available) : data === undefined ? "…" : "$0.00"}
        tone={live?.balance && live.balance.available <= 0 ? "danger" : undefined}
        body="Prepaid funds for texts and business email. Never expires."
        href="/app/settings/billing?tab=messaging"
        link="Manage messaging"
      />
    </section>
  );
}

function Tile({ icon: Icon, title, value, body, href, link, tone }: { icon: typeof Zap; title: string; value: string; body: string; href?: string; link?: string; tone?: "danger" }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        <Icon aria-hidden className="size-4 text-brand-600" />
        {title}
      </p>
      <p className={cn("mt-1.5 font-heading text-2xl tracking-tight tabular-nums", tone === "danger" ? "text-destructive-foreground" : "text-strong")}>{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      {href ? (
        <Link href={href} className="mt-2 inline-block text-xs font-medium text-brand-600 underline-offset-2 hover:underline">
          {link}
        </Link>
      ) : null}
    </div>
  );
}

/** Settings → Plan & Usage → Messaging. The Owner only. */
export function MessagingTab({ onIntent }: { onIntent: (id: Id<"billingIntents">) => void }) {
  const { companyId } = useCompany();
  const data = useQuery(api.messagingUsage.overview, { companyId });
  if (data === undefined) return <Skeleton className="h-96 rounded-2xl" />;
  if (!data.connected) {
    return (
      <>
        <div role="status" className="rounded-2xl border border-border bg-card px-4 py-4 sm:px-5">
          <p className="text-sm font-semibold text-strong">Messaging funds aren&apos;t available yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Billing is still being set up for your account. Texts and email keep working as they do today. Here is what they will cost.</p>
        </div>
        <RateCard card={data.rateCard} />
      </>
    );
  }
  return (
    <div className="grid min-w-0 gap-5 [&>*]:min-w-0">
      <BalanceHero data={data} onIntent={onIntent} />
      <HeldWork data={data} />
      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <AddFunds data={data} onIntent={onIntent} />
        <AutoTopUp data={data} />
      </div>
      <ThisMonth data={data} />
      <Controls data={data} />
      <RecentCharges data={data} />
      <Payments data={data} />
      <RateCard card={data.rateCard} />
      <Statement />
    </div>
  );
}

function BalanceHero({ data, onIntent }: { data: Live; onIntent: (id: Id<"billingIntents">) => void }) {
  const { companyId } = useCompany();
  const startTopUp = useMutation(api.messagingFunds.startTopUp);
  const { busy, error, run } = useRun();
  const balance = data.balance;
  const available = balance?.available ?? 0;
  const limit = data.month.limit;
  const share = limit ? Math.min(1, data.month.outbound / limit) : 0;
  const low = balance !== null && available > 0 && available < data.controls.lowBalance;
  return (
    <HeroCard>
      {!data.metering ? <p className="mb-4 rounded-xl border border-border bg-muted/60 px-3 py-2 text-sm text-strong">Messaging charges haven&apos;t started for your account. Texts and email send as they do today and nothing is taken from this balance until they start. You&apos;ll be told before they do.</p> : null}
      <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-brand-600 uppercase">
            <span aria-hidden className={cn("size-2 rounded-full", available <= 0 ? "bg-destructive" : low ? "bg-warning" : "live-pulse bg-success")} />
            Messaging balance
          </p>
          <p className={cn("mt-1 font-heading text-4xl tracking-tight tabular-nums", available < 0 ? "text-destructive-foreground" : "text-strong")}>{balance ? formatUnits(available) : "$0.00"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {available <= 0
              ? "Outgoing texts and business email are paused and kept as drafts. Replies still arrive, and opt-outs always work."
              : low
                ? `Below your ${formatUnits(data.controls.lowBalance)} alert. Add funds so messages keep going.`
                : "Prepaid. Funds carry over month to month and never expire."}
          </p>
          {balance?.promotional.remaining ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Includes {formatUnits(balance.promotional.remaining)} in promotional credit{balance.promotional.expiresAt ? `, which expires ${day(balance.promotional.expiresAt)}` : ""}. It is kept apart from the funds you paid for.
            </p>
          ) : null}
          {balance?.negative ? (
            <p role="alert" className="mt-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-strong">
              Incoming texts took the balance below zero. They keep arriving down to {formatUnits(balance.overdraftFloor)}; the amount below zero comes out of your next top-up. Your number is never released for a low balance.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          {data.options.presets.map((cents) => (
            <Button key={cents} size="sm" variant={cents === 2_500 ? "primary" : "outline"} loading={busy} disabled={!data.hasPlan} onClick={() => void run(async () => onIntent(await startTopUp({ companyId, cents })))}>
              <Plus aria-hidden className="size-4" />${cents / 100}
            </Button>
          ))}
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
        <HeroStat label="Set aside for sending" value={formatUnits(balance ? data.balance!.reserved : 0)} hint="Released if a message isn't sent" />
        <HeroStat label="Spent this month" value={formatUnits(data.month.total)} hint="After refunds and credits" />
        <HeroStat label="Monthly limit" value={limit ? `${formatUnits(data.month.outbound)} of ${formatUnits(limit)}` : "No limit"} tone={limit && share >= 1 ? "danger" : limit && share >= 0.8 ? "warning" : undefined} />
        <HeroStat label="Automatic top-up" value={data.controls.autoTopUp.enabled ? `On · ${formatUnits(data.controls.autoTopUp.amount)}` : "Off"} />
      </dl>
      {limit ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${Math.round(share * 100)}% of this month's messaging limit used`}>
          <div className={cn("h-full rounded-full", share >= 1 ? "bg-destructive" : share >= 0.8 ? "bg-warning" : "bg-brand-500")} style={{ width: `${share * 100}%` }} />
        </div>
      ) : null}
      {!data.hasPlan ? <p className="mt-3 text-sm text-muted-foreground">Adding messaging funds needs an active Operate or Expand plan.</p> : null}
      <FormError message={error} />
    </HeroCard>
  );
}

/** Work an agent or a person prepared that is waiting for funds or a limit. Nothing is lost; each one is checked again before it goes. */
function HeldWork({ data }: { data: Live }) {
  if (data.held.length === 0) return null;
  return (
    <section aria-label="Waiting to send" className="grid gap-2">
      {data.held.map((group) => (
        <div key={`${group.reason}:${group.key}`} role="status" className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-strong">
              {group.key === "team" ? "Your team" : group.key === "selestial" ? "Selestial" : group.label} prepared {n(group.count)} message{group.count === 1 ? "" : "s"}. {group.words}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              About {formatUnits(group.estimate)} to send now. They are kept as drafts and checked again (opt-outs, quiet hours, permissions) before each one goes.
              {group.stale ? ` ${n(group.stale)} ${group.stale === 1 ? "is" : "are"} more than a day old and won't be sent automatically.` : ""}
            </p>
          </div>
          {group.reason === "messaging_balance" ? (
            <a href="#add-funds" className="shrink-0 text-sm font-medium text-brand-600 underline-offset-2 hover:underline">
              Add funds
            </a>
          ) : group.reason === "messaging_limit" ? (
            <a href="#messaging-controls" className="shrink-0 text-sm font-medium text-brand-600 underline-offset-2 hover:underline">
              Review limits
            </a>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function AddFunds({ data, onIntent }: { data: Live; onIntent: (id: Id<"billingIntents">) => void }) {
  const { companyId } = useCompany();
  const startTopUp = useMutation(api.messagingFunds.startTopUp);
  const { busy, error, run } = useRun();
  const [custom, setCustom] = useState("");
  const cents = toCents(custom);
  const valid = cents !== null && cents >= data.options.minCents && cents <= data.options.maxCents;
  return (
    <section id="add-funds" className="scroll-mt-24">
      <Panel title="Add funds">
        <p className="text-sm text-muted-foreground">Choose an amount. You&apos;ll see the exact charge, with any tax on its own line, before you pay. Funds never expire.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {data.options.presets.map((value) => (
            <Button key={value} variant="outline" loading={busy} disabled={!data.hasPlan} onClick={() => void run(async () => onIntent(await startTopUp({ companyId, cents: value })))}>
              ${value / 100}
            </Button>
          ))}
        </div>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) void run(async () => onIntent(await startTopUp({ companyId, cents: cents! })));
          }}
        >
          <label className="grid gap-1 text-sm text-strong">
            Another amount
            <span className="flex items-center gap-1">
              <span className="text-muted-foreground">$</span>
              <Input className="w-28" inputMode="numeric" value={custom} onChange={(event) => setCustom(event.target.value)} aria-describedby="custom-hint" placeholder="75" />
            </span>
          </label>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!valid || !data.hasPlan}>
            {valid ? `Review $${cents! / 100}` : "Review"}
          </Button>
          <p id="custom-hint" className="w-full text-xs text-muted-foreground">
            Whole dollars from ${data.options.minCents / 100} to ${n(data.options.maxCents / 100)}.
          </p>
        </form>
        <FormError message={error} />
      </Panel>
    </section>
  );
}

function AutoTopUp({ data }: { data: Live }) {
  const { companyId } = useCompany();
  const save = useMutation(api.messagingFunds.setAutoTopUp);
  const { busy, error, run } = useRun();
  const current = data.controls.autoTopUp;
  const [editing, setEditing] = useState(false);
  const [threshold, setThreshold] = useState(dollars(current.threshold));
  const [amount, setAmount] = useState(dollars(current.amount));
  const [monthly, setMonthly] = useState(dollars(current.monthlyMax));
  const [agreed, setAgreed] = useState(false);
  const t = toCents(threshold);
  const a = toCents(amount);
  const m = toCents(monthly);
  const ready = t !== null && a !== null && m !== null && a >= 1_000 && m >= a;
  const wording = ready ? autoTopUpWording({ threshold: t! * UNITS_PER_CENT, amount: a! * UNITS_PER_CENT, monthlyMax: m! * UNITS_PER_CENT }) : null;
  const args = { companyId, thresholdCents: t ?? 0, amountCents: a ?? 0, monthlyMaxCents: m ?? 0 };
  return (
    <Panel title="Automatic top-up">
      {current.enabled && !editing ? (
        <div className="grid gap-2 text-sm">
          <p className="text-strong">
            When the balance falls below <strong>{formatUnits(current.threshold)}</strong>, add <strong>{formatUnits(current.amount)}</strong>, up to {formatUnits(current.monthlyMax)} a month.
          </p>
          <p className="text-muted-foreground">
            {formatUnits(current.usedThisMonth)} added automatically this month. Authorized {current.authorizedBy ? `by ${current.authorizedBy} ` : ""}on {day(current.authorizedAt)}.
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Change amounts
            </Button>
            <Button size="sm" variant="ghost" loading={busy} onClick={() => void run(() => save({ ...args, thresholdCents: Number(dollars(current.threshold)) * 100, amountCents: Number(dollars(current.amount)) * 100, monthlyMaxCents: Number(dollars(current.monthlyMax)) * 100, enabled: false }))}>
              Turn off
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && agreed && wording) void run(async () => {
              await save({ ...args, enabled: true, wording });
              setEditing(false);
              setAgreed(false);
            });
          }}
        >
          <p className="text-sm text-muted-foreground">Off unless you turn it on. Agents can never add funds or change this.</p>
          <div className="grid grid-cols-3 gap-2">
            <DollarField label="When below" value={threshold} onChange={(v) => (setThreshold(v), setAgreed(false))} />
            <DollarField label="Add" value={amount} onChange={(v) => (setAmount(v), setAgreed(false))} />
            <DollarField label="Monthly most" value={monthly} onChange={(v) => (setMonthly(v), setAgreed(false))} />
          </div>
          {!ready ? <p className="text-xs text-destructive-foreground">Use whole dollars: at least $10 to add, and a monthly most of at least one top-up.</p> : null}
          {wording ? (
            <label className="flex items-start gap-2 rounded-xl border border-border bg-muted/50 p-3 text-sm text-strong">
              <Checkbox className="mt-1" checked={agreed} onCheckedChange={(checked) => setAgreed(checked)} />
              <span>{wording}</span>
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!ready || !agreed || !data.hasPlan}>
              {current.enabled ? "Save new amounts" : "Turn on automatic top-up"}
            </Button>
            {editing ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      )}
      <FormError message={error} />
    </Panel>
  );
}

function DollarField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1 text-xs font-medium text-strong">
      {label}
      <span className="flex items-center gap-1">
        <span className="text-sm text-muted-foreground">$</span>
        <Input inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value)} />
      </span>
    </label>
  );
}

function ThisMonth({ data }: { data: Live }) {
  const kinds = data.month.byKind;
  const out = kinds.filter((row) => row.kind.endsWith("_out"));
  const inbound = kinds.filter((row) => row.kind.endsWith("_in"));
  const top = Math.max(1, ...data.month.byAgent.map((row) => row.amount));
  return (
    <Panel title={`This month, since ${day(data.month.from)}`}>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">What</th>
                <th className="py-1 text-right font-medium">Quantity</th>
                <th className="py-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              <Group label="Sent" rows={out} />
              <Group label="Received" rows={inbound} />
              {data.month.fees || data.month.credits ? (
                <tr className="border-t border-border">
                  <td colSpan={3} className="pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Other
                  </td>
                </tr>
              ) : null}
              {data.month.fees ? <Row label="Numbers and registration" qty="" amount={data.month.fees} /> : null}
              {data.month.credits ? <Row label="Refunds and credits" qty="" amount={-data.month.credits} /> : null}
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-2 text-strong">Total</td>
                <td />
                <td className="py-2 text-right tabular-nums text-strong">{formatUnits(data.month.total)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">Taxes, if any, are on your receipts, not in these amounts.</p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-strong">By who sent it</h3>
          {data.month.byAgent.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nothing charged yet this month.</p>
          ) : (
            <ul className="mt-2 grid gap-2.5">
              {data.month.byAgent.map((row) => (
                <li key={row.key} className="grid gap-1">
                  <span className="flex justify-between gap-2 text-sm">
                    <span className="text-strong">{row.label}</span>
                    <span className="tabular-nums text-muted-foreground">{formatUnits(row.amount)}</span>
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(row.amount / top) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Group({ label, rows }: { label: string; rows: Live["month"]["byKind"] }) {
  return (
    <>
      <tr className="border-t border-border">
        <td colSpan={3} className="pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </td>
      </tr>
      {rows.map((row) => (
        <Row key={row.kind} label={row.label} qty={n(row.count)} amount={row.amount} />
      ))}
    </>
  );
}

function Row({ label, qty, amount }: { label: string; qty: string; amount: number }) {
  return (
    <tr className="border-t border-border/60">
      <td className="py-1.5 text-strong">
        <span className="inline-flex items-center gap-1.5">
          {label.includes("email") ? <Mail aria-hidden className="size-3.5 text-muted-foreground" /> : null}
          {label}
        </span>
      </td>
      <td className="py-1.5 text-right tabular-nums text-muted-foreground">{qty}</td>
      <td className="py-1.5 text-right tabular-nums">{formatUnits(amount)}</td>
    </tr>
  );
}

function Controls({ data }: { data: Live }) {
  const { companyId } = useCompany();
  const save = useMutation(api.messagingFunds.setControls);
  const { busy, error, run } = useRun();
  const c = data.controls;
  const [monthly, setMonthly] = useState(c.monthlyLimit === null ? "" : dollars(c.monthlyLimit));
  const [batch, setBatch] = useState(c.batchLimit === null ? "" : dollars(c.batchLimit));
  const [low, setLow] = useState(dollars(c.lowBalance));
  const [agents, setAgents] = useState<Record<string, string>>(() => Object.fromEntries(c.agentLimits.map((row) => [row.agent, row.limit === null ? "" : dollars(row.limit)])));
  const [saved, setSaved] = useState(false);
  const parse = (text: string) => (text.trim() === "" ? null : toCents(text));
  const bad = [monthly, batch, ...Object.values(agents)].some((text) => text.trim() !== "" && toCents(text) === null) || toCents(low) === null;
  return (
    <section id="messaging-controls" className="scroll-mt-24">
      <Panel title="Spending controls">
        <p className="text-sm text-muted-foreground">
          Limits stop spending; they never give anyone permission to send. An agent still needs your permission for each kind of message, and a message over a limit waits as a draft instead of sending.
        </p>
        <form
          className="mt-4 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (bad) return;
            const agentLimitsCents: Record<string, number> = {};
            for (const [agent, text] of Object.entries(agents)) if (parse(text) !== null) agentLimitsCents[agent] = parse(text)!;
            void run(async () => {
              await save({ companyId, monthlyLimitCents: parse(monthly), batchLimitCents: parse(batch), lowBalanceCents: toCents(low)!, agentLimitsCents });
              setSaved(true);
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <LimitField label="Monthly limit" hint="Blank for no limit" value={monthly} onChange={(v) => (setMonthly(v), setSaved(false))} tip="The most outgoing messages may cost in a calendar month. Replies you receive still arrive." />
            <LimitField label="Largest single batch" hint="Blank for no limit" value={batch} onChange={(v) => (setBatch(v), setSaved(false))} tip="The most one bulk send, such as a campaign or a round of follow-ups, may cost. Larger batches wait for you." />
            <LimitField label="Tell me below" hint="Low-balance alert" value={low} onChange={(v) => (setLow(v), setSaved(false))} tip="When the balance falls below this, you are alerted. Alerts are free and never use the balance." />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-strong">Monthly limit for each agent</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {c.agentLimits.map((row) => (
                <LimitField key={row.agent} label={row.label} hint={`${formatUnits(row.spent)} this month`} value={agents[row.agent] ?? ""} onChange={(v) => (setAgents({ ...agents, [row.agent]: v }), setSaved(false))} />
              ))}
            </div>
          </div>
          {bad ? <p className="text-xs text-destructive-foreground">Use whole dollars, or leave a limit blank for none.</p> : null}
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" variant="primary" loading={busy} disabled={bad}>
              Save controls
            </Button>
            {saved ? <span className="text-xs text-success-foreground">Saved. Waiting messages are checked again.</span> : null}
          </div>
        </form>
        <FormError message={error} />
      </Panel>
    </section>
  );
}

function LimitField({ label, hint, value, onChange, tip }: { label: string; hint: string; value: string; onChange: (value: string) => void; tip?: string }) {
  return (
    <label className="grid gap-1 text-sm font-medium text-strong">
      <span className="flex items-center gap-1">
        {label}
        {tip ? <InfoTip label={label}>{tip}</InfoTip> : null}
      </span>
      <span className="flex items-center gap-1">
        <span className="text-muted-foreground">$</span>
        <Input inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value)} placeholder="—" />
      </span>
      <span className="text-xs font-normal text-muted-foreground">{hint}</span>
    </label>
  );
}

function RecentCharges({ data }: { data: Live }) {
  return (
    <Panel title="Recent charges" flush>
      {data.recent.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">No messaging charges yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium sm:px-5">When</th>
                <th className="py-2 font-medium">What</th>
                <th className="py-2 font-medium">Who</th>
                <th className="py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium sm:px-5">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((row, index) => (
                <tr key={`${row.at}-${index}`} className="border-t border-border">
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground sm:px-5">{dayTime(row.at)}</td>
                  <td className="py-2">
                    <span className="text-strong">{row.what}</span>
                    {row.detail ? <span className="block text-xs text-muted-foreground">{row.detail}</span> : null}
                  </td>
                  <td className="py-2 text-muted-foreground">{row.who}</td>
                  <td className="py-2 text-muted-foreground">{row.status}</td>
                  <td className={cn("px-4 py-2 text-right tabular-nums sm:px-5", row.amount < 0 ? "text-success-foreground" : row.final ? "text-strong" : "text-muted-foreground")}>
                    {row.amount < 0 ? `+${formatUnits(-row.amount)}` : formatUnits(row.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Payments({ data }: { data: Live }) {
  return (
    <Panel title="Funds added">
      {data.payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messaging funds added yet.</p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {data.payments.map((row, index) => (
            <li key={`${row.at}-${index}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 last:border-0">
              <span className="min-w-0">
                <span className="text-strong">
                  {day(row.at)} · {row.source}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {row.status}
                  {row.returned ? ` · ${formatUnits(row.returned)} taken back` : ""}
                  {row.problem ? ` · ${row.problem}` : ""}
                </span>
              </span>
              <span className="flex items-center gap-3 tabular-nums">
                ${(row.cents / 100).toFixed(2)}
                {row.receipt ? (
                  <a className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 underline-offset-2 hover:underline" href={row.receipt} target="_blank" rel="noreferrer">
                    <ReceiptIcon aria-hidden className="size-3.5" />
                    Receipt
                  </a>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RateCard({ card }: { card: Overview["rateCard"] }) {
  return (
    <Panel title="Messaging prices">
      <p className="text-sm text-muted-foreground">The same on every plan. Standard US numbers only; carrier fees are included. Taxes are shown separately on receipts.</p>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div>
          <table className="w-full text-sm">
            <tbody>
              {card.rows.map((row) => (
                <tr key={row.kind} className="border-b border-border last:border-0">
                  <td className="py-2 text-strong">{row.label}</td>
                  <td className="py-2 text-right tabular-nums text-strong">
                    {formatUnits(row.price)} <span className="text-xs font-normal text-muted-foreground">per {row.per}</span>
                  </td>
                </tr>
              ))}
              <tr className="border-b border-border">
                <td className="py-2 text-strong">Business phone number</td>
                <td className="py-2 text-right tabular-nums text-strong">
                  {formatUnits(card.numberMonthly)} <span className="text-xs font-normal text-muted-foreground">a month</span>
                </td>
              </tr>
              <tr>
                <td className="py-2 text-strong">Carrier registration</td>
                <td className="py-2 text-right text-xs text-muted-foreground">At cost, shown before you agree</td>
              </tr>
            </tbody>
          </table>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium text-brand-600">What is a text segment?</summary>
            <p className="mt-2 text-muted-foreground">
              Carriers bill texts in segments. A plain text up to 160 characters is one segment; longer texts are split into segments of 153. Emoji and some special characters make every segment shorter (70, or 67 when split), so the same message can cost more. Before anything is sent you see how many segments it uses and what it will cost, for example: &ldquo;This message uses 2 SMS segments. Estimated cost: $0.05.&rdquo;
            </p>
          </details>
        </div>
        <div className="grid gap-4">
          <div>
            <h3 className="text-sm font-semibold text-strong">Included, never charged</h3>
            <ul className="mt-1.5 grid gap-1 text-sm text-muted-foreground">
              {card.included.map((row) => (
                <li key={row}>· {row}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-strong">Not available</h3>
            <p className="mt-1 text-sm text-muted-foreground">{card.unavailable.join(". ")}. Messages to these are stopped before sending and never charged.</p>
          </div>
          <p className="text-xs text-muted-foreground">Prices effective {day(card.effectiveFrom)}. A message&apos;s price is fixed when its cost is set aside, just before it is sent; a price change never changes what a message already on its way costs. A message waiting for funds is priced when it goes.</p>
        </div>
      </div>
    </Panel>
  );
}

function monthsBack(count: number) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return { value: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) };
  });
}

const csvCell = (value: string | number) => {
  const text = String(value);
  return /[",\n]/.test(text) || /^[=+\-@]/.test(text) ? `"${text.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : text;
};

function Statement() {
  const { companyId } = useCompany();
  const months = useMemo(() => monthsBack(12), []);
  const [month, setMonth] = useState(months[0].value);
  const data = useQuery(api.messagingUsage.statement, { companyId, month });
  const download = () => {
    if (!data) return;
    const lines = [
      ["Messaging statement", data.company, data.month, `Times in ${data.timezone}`],
      [],
      ["Date", "Description", "Type", "Quantity", "Sent by", "Price list", "Status", "Amount (USD)"],
      ...data.lines.map((line) => [line.date, line.description, line.type, line.quantity, line.who, line.rateVersion, line.status, (line.amount / 10_000).toFixed(4)]),
      [],
      ["Funds added"],
      ...data.funds.map((row) => [row.date, row.description, "", "", "", "", "", (row.amount / 10_000).toFixed(2)]),
      [],
      ["Total charged", "", "", "", "", "", "", (data.totals.charged / 10_000).toFixed(4)],
      ["Total funds added", "", "", "", "", "", "", (data.totals.added / 10_000).toFixed(2)],
      ["Taxes appear on payment receipts, not in this statement."],
    ];
    const blob = new Blob([lines.map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `messaging-statement-${data.month}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Panel title="Statement">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm text-strong">
          Month
          <SelectInput className="h-9 rounded-lg border border-border bg-card px-2 text-sm" value={month} onChange={(event) => setMonth(event.target.value)}>
            {months.map((row) => (
              <option key={row.value} value={row.value}>
                {row.label}
              </option>
            ))}
          </SelectInput>
        </label>
        <Button size="sm" variant="outline" loading={data === undefined} disabled={!data} onClick={download}>
          <Download aria-hidden className="size-4" />
          Download statement (CSV)
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{data ? `${n(data.lines.length)} charge${data.lines.length === 1 ? "" : "s"} and ${n(data.funds.length)} top-up${data.funds.length === 1 ? "" : "s"} in this month. ` : ""}Every charge, refund and top-up for the month, with the price list each one used. Opens in any spreadsheet.</p>
    </Panel>
  );
}
