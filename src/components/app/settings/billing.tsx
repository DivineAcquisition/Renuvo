"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, TextInput, useRun } from "@/components/app/form";
import { Guard } from "@/components/app/settings/guard";
import { Panel } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/app/format";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type Data = NonNullable<ReturnType<typeof useQuery<typeof api.billing.planAndUsage>>>;
type Connected = Extract<Data, { connected: true }>;

const day = (at: number | null | undefined) => (at ? new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const n = (value: number) => value.toLocaleString("en-US");

/** Settings → Plan & Usage. Only the Owner reaches the query: for anyone else it is skipped, never sent. */
function PlanUsageInner() {
  const { companyId, role } = useCompany();
  const data = useQuery(api.billing.planAndUsage, role === "owner" ? { companyId } : "skip");
  if (role !== "owner") return <OwnerOnly what="Plan & Usage" />;
  if (!data) return <Skeleton className="h-96 rounded-2xl" />;
  return (
    <div className="grid gap-5">
      {!data.connected ? (
        <Panel title="Billing is not connected">
          <p className="text-sm text-muted-foreground">{data.message}</p>
          <p className="mt-1 text-sm text-muted-foreground">Records, schedules, cleaner links and everything that does not use AI keep working.</p>
        </Panel>
      ) : (
        <ConnectedView data={data} />
      )}
      <Comparison catalog={data.catalog} current={data.plan} canBuy={data.connected && !!data.account} />
    </div>
  );
}

function ConnectedView({ data }: { data: Connected }) {
  const { companyId } = useCompany();
  const refresh = useMutation(api.billing.refresh);
  const { busy, error, run } = useRun();
  const [intentId, setIntentId] = useState<Id<"billingIntents"> | null>(data.pendingIntent);
  const account = data.account;
  useEffect(() => {
    // Back from Stripe or the billing portal: read Autumn's record again.
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("billing") === "returned") void refresh({ companyId }).catch(() => undefined);
  }, [companyId, refresh]);
  return (
    <>
      {data.env === "sandbox" ? <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-strong">Sandbox billing: test cards only, nothing is really charged{data.rateCard?.fixture ? ", and credit prices are test values, not offers" : ""}.</p> : null}
      {data.problem ? <p className="rounded-xl border border-border bg-muted px-4 py-2 text-sm text-strong">{data.problem} New AI work is paused until this is fixed.</p> : null}
      {account?.notices.length ? (
        <ul className="grid gap-2">
          {account.notices.slice(0, 3).map((notice) => (
            <li key={notice.at} role="status" className="rounded-xl border border-border bg-card px-4 py-2 text-sm text-strong">
              {notice.text} <span className="text-xs text-muted-foreground">{day(notice.at)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {intentId ? <IntentDialog intentId={intentId} onClose={() => setIntentId(null)} /> : null}
      <CurrentPlan data={data} onIntent={setIntentId} />
      <Credits data={data} onIntent={setIntentId} />
      {account ? <SpendingControls controls={account.controls} /> : null}
      <Billing data={data} onIntent={setIntentId} />
      <RateCard data={data} />
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" loading={busy} onClick={() => void run(() => refresh({ companyId }))}>
          Check with billing again
        </Button>
        <span className="text-xs text-muted-foreground">{account ? `Last checked ${new Date(account.syncedAt).toLocaleString()}.` : "Not checked yet."}{account?.syncProblem ? ` Last problem: ${account.syncProblem}` : ""}</span>
      </div>
      <FormError message={error} />
    </>
  );
}

function CurrentPlan({ data, onIntent }: { data: Connected; onIntent: (id: Id<"billingIntents">) => void }) {
  const { companyId } = useCompany();
  const cancel = useMutation(api.billing.cancelPlan);
  const resume = useMutation(api.billing.resumePlan);
  const change = useMutation(api.billing.startPlanChange);
  const { busy, error, run } = useRun();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const account = data.account;
  const plan = account?.plan ?? null;
  const sub = account?.subscription;
  const name = plan ? data.catalog.plans.find((row) => row.id === plan)! : null;
  return (
    <Panel title="Current plan">
      {!name ? (
        <p className="text-sm text-strong">No active plan. AI work needs Operate or Expand; choose one below.</p>
      ) : (
        <div className="grid gap-1 text-sm">
          <p className="text-base font-semibold text-strong">
            {name.name} · {money(name.monthlyCents)} a month
          </p>
          <p className="text-muted-foreground">
            {sub?.pastDue ? "Payment overdue. " : "Active, as confirmed by billing. "}
            {sub?.endsAt ? `Ends ${day(sub.endsAt)} and will not renew.` : `Renews ${day(sub?.periodEnd)}.`}
          </p>
          {sub?.scheduledPlan ? <p className="text-muted-foreground">Changes to {sub.scheduledPlan === "operate" ? "Operate" : "Expand"} on {day(sub.scheduledAt ?? sub.periodEnd)}.</p> : null}
        </div>
      )}
      {plan ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {plan === "operate" ? (
            <Button size="sm" variant="primary" loading={busy} onClick={() => void run(async () => onIntent(await change({ companyId, plan: "expand" })))}>
              Upgrade to Expand
            </Button>
          ) : !sub?.scheduledPlan ? (
            <Button size="sm" variant="outline" loading={busy} onClick={() => void run(async () => onIntent(await change({ companyId, plan: "operate" })))}>
              Move to Operate at renewal
            </Button>
          ) : null}
          {sub?.endsAt || sub?.scheduledPlan ? (
            <Button size="sm" variant="outline" loading={busy} onClick={() => void run(async () => onIntent(await resume({ companyId })))}>
              {sub?.endsAt ? "Keep this plan" : "Keep the current plan"}
            </Button>
          ) : confirmCancel ? (
            <>
              <Button size="sm" variant="destructive-outline" loading={busy} onClick={() => void run(async () => onIntent(await cancel({ companyId })))}>
                Confirm: end at {day(sub?.periodEnd)}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
                Not now
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(true)}>
              Cancel plan
            </Button>
          )}
        </div>
      ) : null}
      {confirmCancel ? <p className="mt-2 text-xs text-muted-foreground">The plan stays active until {day(sub?.periodEnd)} and does not renew. Records, completed work, signed agreements and cleaner links are kept. After that date, agents and AI work stop until a plan is chosen again; purchased credits cannot be used without a plan.</p> : null}
      <FormError message={error} />
    </Panel>
  );
}

function Credits({ data, onIntent }: { data: Connected; onIntent: (id: Id<"billingIntents">) => void }) {
  const { companyId } = useCompany();
  const topUp = useMutation(api.billing.startTopUp);
  const { busy, error, run } = useRun();
  const credits = data.account?.credits;
  return (
    <Panel title="Selestial Credits">
      {!credits ? (
        <p className="text-sm text-muted-foreground">No credit balance yet. Monthly credits come with a plan.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Available" value={n(credits.remaining)} />
          <Stat label="Held for work in progress" value={n(data.account?.reserved ?? 0)} />
          <Stat label="Included this month" value={`${n(credits.included.remaining)} of ${n(credits.included.granted)}`} hint={`Resets ${day(credits.nextResetAt)}. Unused credits do not roll over.`} />
          <Stat label="Purchased" value={n(credits.purchased.remaining)} hint={credits.purchased.expiresAt ? `First expiry ${day(credits.purchased.expiresAt)}` : "No expiry date"} />
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Credits pay for AI work, such as a Chat answer or a hiring email read by AI. Viewing records, opening or answering cleaner links, status changes and scheduled reminders use none. Texts and calls are measured separately and are not paid with credits. {data.topUps.consumption}
      </p>
      <div className="mt-4">
        <h3 className="text-sm font-semibold text-strong">Top-ups</h3>
        {data.topUps.packs.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Top-ups are not on sale yet.</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted-foreground">{data.topUps.validity} A top-up adds credits only: it never unlocks an agent or a feature. The price is shown before you pay. Nothing is bought automatically.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {data.topUps.packs.map((pack) => (
                <Button key={pack} size="sm" variant="outline" loading={busy} disabled={!data.account?.plan} onClick={() => void run(async () => onIntent(await topUp({ companyId, credits: pack })))}>
                  Add {n(pack)} credits
                </Button>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-strong">Used this period</h3>
          {data.usage.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">No credits used yet.</p>
          ) : (
            <table className="mt-1 w-full text-sm">
              <tbody>
                {data.usage.map((row) => (
                  <tr key={`${row.agent}:${row.task}`} className="border-b border-border last:border-0">
                    <td className="py-1.5 text-strong">{row.agent}</td>
                    <td className="py-1.5 text-muted-foreground">{row.label}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{n(row.units)}</td>
                    <td className="py-1.5 text-right tabular-nums text-strong">{n(row.credits)} cr</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-strong">Recent AI work</h3>
          {data.recent.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="mt-1 grid gap-1 text-sm">
              {data.recent.slice(0, 12).map((row) => (
                <li key={row.id} className="flex flex-wrap justify-between gap-2 border-b border-border py-1 last:border-0">
                  <span className="text-strong">
                    {row.agent}: {row.task}
                    <span className="text-xs text-muted-foreground"> · {new Date(row.at).toLocaleString()} · rates {row.rateCard}</span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">{row.block ?? (row.state === "completed" ? `${n(row.credits)} cr` : row.state === "reserved" || row.state === "reserving" ? `${n(row.credits)} cr held` : "no charge")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <FormError message={error} />
    </Panel>
  );
}

function SpendingControls({ controls }: { controls: NonNullable<Connected["account"]>["controls"] }) {
  const { companyId } = useCompany();
  const save = useMutation(api.billing.setSpendingControls);
  const { busy, error, run } = useRun();
  const [perRun, setPerRun] = useState(controls.perRunLimit?.toString() ?? "");
  const [monthly, setMonthly] = useState(controls.autonomousMonthly?.toString() ?? "");
  const [alerts, setAlerts] = useState(controls.alertPercents.join(", "));
  const [saved, setSaved] = useState(false);
  const number = (value: string) => (value.trim() ? Number(value) : null);
  return (
    <Panel title="Spending controls">
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          setSaved(false);
          void run(async () => {
            await save({ companyId, perRunLimit: number(perRun), autonomousMonthly: number(monthly), alertPercents: alerts.split(",").map((value) => Number(value.trim())).filter((value) => value > 0), autoTopUp: { enabled: false } });
            setSaved(true);
          });
        }}
      >
        <Field label="Limit for one piece of work (credits)" hint="Bigger work waits for the Owner. Empty: no limit.">
          <TextInput inputMode="numeric" value={perRun} onChange={(event) => setPerRun(event.target.value)} />
        </Field>
        <Field label="Monthly budget for automatic work (credits)" hint="Work no one asked for, such as reading the hiring inbox. Empty: no limit.">
          <TextInput inputMode="numeric" value={monthly} onChange={(event) => setMonthly(event.target.value)} />
        </Field>
        <Field label="Usage alerts (% of included credits)" hint="For example 50, 80, 100.">
          <TextInput value={alerts} onChange={(event) => setAlerts(event.target.value)} />
        </Field>
        <p className="text-xs text-muted-foreground sm:col-span-3">Automatic top-ups are off and are not available yet. Credits are never bought without you.</p>
        <div className="flex items-center gap-2 sm:col-span-3">
          <Button type="submit" size="sm" variant="primary" loading={busy}>
            Save controls
          </Button>
          {saved ? <span className="text-xs text-muted-foreground">Saved.</span> : null}
        </div>
      </form>
      <FormError message={error} />
    </Panel>
  );
}

function Billing({ data, onIntent }: { data: Connected; onIntent: (id: Id<"billingIntents">) => void }) {
  const { companyId } = useCompany();
  const portal = useMutation(api.billing.openBillingPortal);
  const { busy, error, run } = useRun();
  const invoices = data.account?.invoices ?? [];
  return (
    <Panel title="Billing">
      <p className="text-sm text-muted-foreground">Payment methods, the billing contact and receipts are managed in the billing portal (Stripe).</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" loading={busy} disabled={!data.account} onClick={() => void run(async () => onIntent(await portal({ companyId, purpose: "portal" })))}>
          Open billing portal
        </Button>
        <Button size="sm" variant="outline" loading={busy} disabled={!data.account} onClick={() => void run(async () => onIntent(await portal({ companyId, purpose: "payment_method" })))}>
          Update payment method
        </Button>
      </div>
      <h3 className="mt-4 text-sm font-semibold text-strong">Invoices</h3>
      {invoices.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">No invoices yet.</p>
      ) : (
        <ul className="mt-1 grid gap-1 text-sm">
          {invoices.map((invoice) => (
            <li key={invoice.id} className="flex justify-between gap-2 border-b border-border py-1 last:border-0">
              <span className="text-strong">
                {day(invoice.createdAt)} · {invoice.status}
              </span>
              <span className="tabular-nums">
                {money(invoice.cents)}
                {invoice.url ? (
                  <a className="ml-2 underline underline-offset-2" href={invoice.url} target="_blank" rel="noreferrer">
                    View
                  </a>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <FormError message={error} />
    </Panel>
  );
}

function RateCard({ data }: { data: Connected }) {
  if (!data.rateCard) return null;
  return (
    <Panel title="What uses credits">
      <p className="mb-2 text-xs text-muted-foreground">
        Rates {data.rateCard.version}
        {data.rateCard.fixture ? " (test values for the sandbox, not prices)" : ""}. Each item is charged once, when it is completed, whatever it took inside. Work already done is never repriced.
      </p>
      <ul className="grid gap-1 text-sm">
        {data.rateCard.rates.map((row) => (
          <li key={row.task} className="flex justify-between gap-3 border-b border-border py-1 last:border-0">
            <span>
              <span className="text-strong">{row.label}</span>
              <span className="block text-xs text-muted-foreground">{row.unit}</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{!row.available ? "Not available yet" : row.credits === null ? "Not priced yet" : `${n(row.credits)} cr`}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Comparison({ catalog, current, canBuy }: { catalog: Data["catalog"]; current: "operate" | "expand" | null; canBuy: boolean }) {
  const { companyId } = useCompany();
  const change = useMutation(api.billing.startPlanChange);
  const { busy, error, run } = useRun();
  const [intentId, setIntentId] = useState<Id<"billingIntents"> | null>(null);
  return (
    <Panel title="Plans">
      <p className="mb-3 text-sm text-muted-foreground">Start with four essential agents. Expand into a complete team as your operation grows.</p>
      {intentId ? <IntentDialog intentId={intentId} onClose={() => setIntentId(null)} /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {catalog.plans.map((plan) => (
          <section key={plan.id} className="rounded-2xl border border-border bg-card p-4">
            <h3 className="font-heading text-lg tracking-tight text-strong">{plan.name}</h3>
            <p className="text-2xl font-semibold text-strong">
              {money(plan.monthlyCents)}
              <span className="text-sm font-normal text-muted-foreground"> a month</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{plan.summary}</p>
            {canBuy && !current ? (
              <Button className="mt-3" size="sm" variant="primary" loading={busy} onClick={() => void run(async () => setIntentId(await change({ companyId, plan: plan.id })))}>
                Choose {plan.name}
              </Button>
            ) : current === plan.id ? (
              <p className="mt-3 text-xs font-medium text-strong">Your plan</p>
            ) : null}
          </section>
        ))}
      </div>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1 font-medium">Agent</th>
            <th className="py-1 font-medium">Operate</th>
            <th className="py-1 font-medium">Expand</th>
          </tr>
        </thead>
        <tbody>
          {catalog.agents.map((row) => (
            <tr key={row.agent} className="border-t border-border">
              <td className="py-1.5 text-strong">
                {row.name} {!row.released ? <span className="text-xs text-muted-foreground">· not released yet</span> : null}
              </td>
              <td className="py-1.5 text-muted-foreground">{row.operate ? (row.released ? "Included" : "Included when released") : "—"}</td>
              <td className="py-1.5 text-muted-foreground">{row.expand ? (row.released ? "Included" : "Included when released") : "—"}</td>
            </tr>
          ))}
          {catalog.features.map((row) => (
            <tr key={row.feature} className="border-t border-border">
              <td className="py-1.5 text-strong">
                {row.name} {!row.built ? <span className="text-xs text-muted-foreground">· not available yet</span> : null}
              </td>
              <td className="py-1.5 text-muted-foreground">{row.expandOnly ? "—" : "Included"}</td>
              <td className="py-1.5 text-muted-foreground">{row.built ? "Included" : "Included when available"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted-foreground">Both plans include: {catalog.bothInclude.join("; ")}. Expand includes a larger monthly credit allowance. Bespoke implementation, migration and custom development are scoped separately.</p>
      <FormError message={error} />
    </Panel>
  );
}

/** A purchase or change in progress: Autumn's price and date, the Owner's confirmation, then the payment page if one is needed. */
function IntentDialog({ intentId, onClose }: { intentId: Id<"billingIntents">; onClose: () => void }) {
  const { companyId } = useCompany();
  const intent = useQuery(api.billing.intent, { companyId, intentId });
  const confirm = useMutation(api.billing.confirmIntent);
  const { busy, error, run } = useRun();
  if (intent === undefined) return null;
  if (intent === null) return null;
  const preview = intent.preview;
  const what = intent.kind === "top_up" ? `Add ${n(intent.quantity ?? 0)} credits` : intent.kind === "plan_change" ? `Move to ${intent.planId === "expand" ? "Expand" : "Operate"}` : intent.kind === "cancel" ? "End the plan at renewal" : intent.kind === "uncancel" ? "Keep the plan" : "Billing portal";
  return (
    <div role="dialog" aria-label={what} className="rounded-2xl border border-brand-500/40 bg-card p-4">
      <h3 className="text-base font-semibold text-strong">{what}</h3>
      {intent.stage === "previewing" || intent.stage === "submitting" ? <p className="mt-1 text-sm text-muted-foreground">Asking billing…</p> : null}
      {intent.stage === "awaiting_confirmation" && preview ? (
        <div className="mt-2 grid gap-1 text-sm">
          <p className="text-strong">
            Charged now: {money(preview.dueNowCents)} {preview.currency.toUpperCase()}
          </p>
          <p className="text-muted-foreground">Takes effect {preview.effectiveAt ? day(preview.effectiveAt) : "once the payment is confirmed"}.</p>
          {preview.nextCycleCents !== null ? <p className="text-muted-foreground">Then {money(preview.nextCycleCents)} from {day(preview.nextCycleAt)}.</p> : null}
          {preview.lostAgents.length || preview.lostFeatures.length ? <p className="text-strong">At that date the company loses: {[...preview.lostAgents, ...preview.lostFeatures].join(", ")}. Records, completed work, signed agreements and portal data are kept. Work already started before then finishes; new work for these stops.</p> : null}
          {intent.kind === "plan_change" && intent.planId === "expand" ? <p className="text-xs text-muted-foreground">Credits used so far this month still count after the upgrade: the new allowance is Expand&apos;s, less what was already used.</p> : null}
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" loading={busy} onClick={() => void run(() => confirm({ companyId, intentId }))}>
              Confirm and pay
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Not now
            </Button>
          </div>
        </div>
      ) : null}
      {intent.url && (intent.stage === "payment_needed" || intent.stage === "done") ? (
        <p className="mt-2 text-sm">
          <a className="font-medium underline underline-offset-2" href={intent.url}>
            {intent.kind === "portal" || intent.kind === "payment_method" ? "Continue to the billing portal" : "Continue to payment"}
          </a>
          <span className="block text-xs text-muted-foreground">Nothing changes here until billing confirms the payment.</span>
        </p>
      ) : null}
      {intent.stage === "done" && !intent.url ? <p className="mt-2 text-sm text-strong">Done. This page updates when billing confirms it.</p> : null}
      {intent.stage === "failed" ? <p className="mt-2 text-sm text-destructive-foreground">{intent.problem}</p> : null}
      {intent.stage === "done" || intent.stage === "failed" ? (
        <Button className="mt-2" size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      ) : null}
      <FormError message={error} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-strong tabular-nums">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function OwnerOnly({ what }: { what: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
      <p className="text-base font-semibold text-strong">{what} is for the Owner</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">Ask the company&apos;s Owner if you need something from this page.</p>
    </div>
  );
}

export function PlanBilling() {
  return (
    <Guard>
      <PlanUsageInner />
    </Guard>
  );
}
