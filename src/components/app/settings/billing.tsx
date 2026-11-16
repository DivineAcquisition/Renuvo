"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AiFeatures } from "@/components/app/billing/ai-features";
import { UsageDashboard } from "@/components/app/billing/usage";
import { AvatarStack, CreditRing, HeroCard, HeroStat, Motion, SegmentedTabs } from "@/components/app/billing/visuals";
import { useCompany } from "@/components/app/company";
import { FormError, useRun } from "@/components/app/form";
import { Guard } from "@/components/app/settings/guard";
import { Panel } from "@/components/app/shell";
import { Check, Coins, Gauge, Wallet } from "@/components/icons";
import { BorderBeam } from "@/components/ui/border-beam";
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
type Tab = "plan" | "usage" | "billing";
const tabOf = (params: URLSearchParams | null): Tab => {
  const value = params?.get("tab");
  return value === "usage" || value === "billing" ? value : "plan";
};
function useTab(): Tab {
  return tabOf(useSearchParams());
}

const TABS = [
  { id: "plan", label: "Plan", href: "/app/settings/billing?tab=plan", icon: Wallet },
  { id: "usage", label: "Usage", href: "/app/settings/billing?tab=usage", icon: Gauge },
  { id: "billing", label: "Billing", href: "/app/settings/billing?tab=billing", icon: Coins },
] as const;

function Tabs() {
  return <SegmentedTabs label="Plan & Usage sections" tabs={TABS} active={useTab()} />;
}

function PlanUsageInner() {
  const { companyId, role } = useCompany();
  const params = useSearchParams();
  const data = useQuery(api.billing.planAndUsage, role === "owner" ? { companyId } : "skip");
  if (role !== "owner") return <OwnerOnly what="Plan & Usage" />;
  if (!data) return <Skeleton className="h-96 rounded-2xl" />;
  return (
    <Motion>
    <div className="grid gap-5">
      {!data.connected ? (
        <div role="status" className="rounded-2xl border border-border bg-card px-4 py-4 sm:px-5">
          <p className="text-sm font-semibold text-strong">Billing isn&apos;t available for your account yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Selestial&apos;s team is finishing setup. Until then AI work is paused; schedules, records, cleaner links and everything else keep working. The plans are shown below for reference.</p>
        </div>
      ) : (
        <ConnectedView data={data} />
      )}
      {!data.connected || tabOf(params) === "plan" ? <Comparison catalog={data.catalog} current={data.plan} canBuy={data.connected && !!data.account} /> : null}
      {!data.connected ? (
        <Guard>
          <AiFeatures />
        </Guard>
      ) : null}
    </div>
    </Motion>
  );
}

function ConnectedView({ data }: { data: Connected }) {
  const { companyId } = useCompany();
  const refresh = useMutation(api.billing.refresh);
  const { busy, error, run } = useRun();
  const [intentId, setIntentId] = useState<Id<"billingIntents"> | null>(data.pendingIntent);
  const account = data.account;
  const tab = useTab();
  useEffect(() => {
    // Back from Stripe or the billing portal: read Autumn's record again.
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("billing") === "returned") void refresh({ companyId }).catch(() => undefined);
  }, [companyId, refresh]);
  return (
    <>
      {data.env === "sandbox" ? <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-strong">Sandbox billing: test cards only, nothing is really charged{data.rateCard?.fixture ? ", and credit prices are test values, not offers" : ""}.</p> : null}
      {data.problem ? <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-strong">AI prices aren&apos;t published for your account yet, so new AI work is paused. Everything else keeps working.</p> : null}
      {account?.notices.length ? (
        <ul className="grid gap-2">
          {account.notices.slice(0, 3).map((notice) => (
            <li key={notice.at} role="status" className="rounded-xl border border-border bg-card px-4 py-2 text-sm text-strong">
              {notice.text} <span className="text-xs text-muted-foreground">{day(notice.at)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <Tabs />
      {intentId ? <IntentDialog intentId={intentId} onClose={() => setIntentId(null)} /> : null}
      {tab === "plan" ? <CurrentPlan data={data} onIntent={setIntentId} /> : null}
      {tab === "usage" ? (
        <UsageDashboard
          afterOverview={
            <Guard>
              <AiFeatures />
            </Guard>
          }
        />
      ) : null}
      {tab === "billing" ? (
        <>
          <TopUps data={data} onIntent={setIntentId} />
          <Billing data={data} onIntent={setIntentId} />
        </>
      ) : null}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" loading={busy} onClick={() => void run(() => refresh({ companyId }))}>
          Refresh billing details
        </Button>
        <span className="text-xs text-muted-foreground">
          {account ? `Last updated ${new Date(account.syncedAt).toLocaleString()}.` : "Not updated yet."}
          {account?.syncProblem ? " The last update didn't finish. Try again in a few minutes." : ""}
        </span>
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
  const credits = account?.credits ?? null;
  const onPlan = plan ? data.catalog.agents.filter((row) => (plan === "expand" ? row.expand : row.operate)) : [];
  const working = onPlan.filter((row) => row.released);
  const later = onPlan.filter((row) => !row.released);
  return (
    <HeroCard>
      <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
        <div className="grid min-w-0 gap-4">
          {!name ? (
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-brand-600 uppercase">Your plan</p>
              <h2 className="mt-1 font-heading text-2xl tracking-tight text-strong">No active plan yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">Agents and AI work need the Operate or Expand plan. Compare them below.</p>
            </div>
          ) : (
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-brand-600 uppercase">
                <span aria-hidden className={sub?.pastDue ? "size-2 rounded-full bg-destructive" : "live-pulse size-2 rounded-full bg-success"} />
                {sub?.pastDue ? "Payment overdue" : sub?.endsAt ? "Ending" : "Active plan"}
              </p>
              <h2 className="mt-1 font-heading text-3xl tracking-tight text-strong">
                {name.name} <span className="text-lg font-normal text-muted-foreground">· {money(name.monthlyCents)} a month</span>
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {sub?.pastDue ? "Update your payment method on the Billing tab to keep agents working. " : ""}
                {sub?.endsAt ? `Ends ${day(sub.endsAt)} and won't renew.` : `Renews ${day(sub?.periodEnd)}.`}
                {sub?.scheduledPlan ? ` Changes to ${sub.scheduledPlan === "operate" ? "Operate" : "Expand"} on ${day(sub.scheduledAt ?? sub.periodEnd)}.` : ""}
              </p>
            </div>
          )}
          {working.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <AvatarStack agents={working.map((row) => ({ id: row.agent, label: row.name }))} />
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-strong">{working.map((row) => row.name).join(", ")}</span> working for you
                {later.length ? `, and ${later.length} more as they're released` : ""}.
              </p>
            </div>
          ) : null}
          {credits ? (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <HeroStat label="Credits this cycle" value={n(credits.granted)} />
              <HeroStat label="Used" value={n(credits.used)} />
              <HeroStat label="Reserved" value={n(account?.reserved ?? 0)} hint="For work running now" />
              <HeroStat label="Resets" value={credits.nextResetAt ? day(credits.nextResetAt) : "—"} />
            </dl>
          ) : null}
        </div>
        {credits ? (
          <div className="grid justify-items-center gap-2">
            <CreditRing left={credits.remaining} total={credits.granted} low={credits.granted > 0 && credits.remaining < credits.granted * 0.1} empty={credits.remaining <= 0} />
            <Link href="/app/settings/billing?tab=usage" className="text-xs font-medium text-brand-600 underline-offset-2 hover:underline">
              See where credits went
            </Link>
          </div>
        ) : null}
      </div>
      {plan ? (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
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
    </HeroCard>
  );
}

/** Buying credits. A top-up adds credits only: it never changes the plan or unlocks an agent. */
function TopUps({ data, onIntent }: { data: Connected; onIntent: (id: Id<"billingIntents">) => void }) {
  const { companyId } = useCompany();
  const topUp = useMutation(api.billing.startTopUp);
  const { busy, error, run } = useRun();
  return (
    <section id="top-ups" className="scroll-mt-24">
      <Panel title="Buy credits">
        {data.topUps.packs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Top-ups are not on sale yet. Until they are, credits come with the plan each month.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{data.topUps.validity} {data.topUps.consumption}</p>
            <p className="mt-1 text-xs text-muted-foreground">A top-up adds credits only: it never unlocks an agent or a feature. The exact price is shown before you pay. Nothing is bought automatically.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {data.topUps.packs.map((pack) => (
                <Button key={pack} size="sm" variant="outline" loading={busy} disabled={!data.account?.plan} onClick={() => void run(async () => onIntent(await topUp({ companyId, credits: pack })))}>
                  Add {pack.toLocaleString("en-US")} credits
                </Button>
              ))}
            </div>
          </>
        )}
        <FormError message={error} />
      </Panel>
    </section>
  );
}

function Billing({ data, onIntent }: { data: Connected; onIntent: (id: Id<"billingIntents">) => void }) {
  const { companyId } = useCompany();
  const portal = useMutation(api.billing.openBillingPortal);
  const { busy, error, run } = useRun();
  const invoices = data.account?.invoices ?? [];
  return (
    <Panel title="Billing">
      <p className="text-sm text-muted-foreground">Update your card, billing contact and receipts in the secure billing portal.</p>
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
                {day(invoice.createdAt)} · {({ paid: "Paid", open: "Due", draft: "Draft", void: "Voided", uncollectible: "Unpaid" } as Record<string, string>)[invoice.status] ?? "Invoice"}
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
        {catalog.plans.map((plan) => {
          const mine = current === plan.id;
          const agents = catalog.agents.filter((row) => (plan.id === "expand" ? row.expand : row.operate));
          return (
            <section key={plan.id} className={`relative flex flex-col overflow-hidden rounded-2xl border bg-card p-5 ${mine ? "border-brand-500/50" : "border-border"}`}>
              {mine ? <BorderBeam size={90} duration={8} colorFrom="#6838ef" colorTo="#b39eff" borderWidth={2} /> : null}
              {plan.id === "expand" ? <div aria-hidden className="pointer-events-none absolute -top-16 -right-12 size-40 rounded-full bg-brand-500/10 blur-3xl" /> : null}
              <div className="relative flex items-start justify-between gap-2">
                <h3 className="font-heading text-xl tracking-tight text-strong">{plan.name}</h3>
                {mine ? <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-xs font-medium text-brand-600 ring-1 ring-brand-500/25">Your plan</span> : null}
              </div>
              <p className="relative mt-1 text-3xl font-semibold tracking-tight text-strong">
                {money(plan.monthlyCents)}
                <span className="text-sm font-normal text-muted-foreground"> a month</span>
              </p>
              <p className="relative mt-1 text-sm text-muted-foreground">{plan.summary}</p>
              <div className="relative mt-4">
                <AvatarStack agents={agents.map((row) => ({ id: row.agent, label: row.name }))} />
                <ul className="mt-3 grid gap-1 text-sm">
                  {agents.map((row) => (
                    <li key={row.agent} className="flex items-center gap-2">
                      <Check aria-hidden className={`size-4 shrink-0 ${row.released ? "text-success" : "text-muted-foreground"}`} />
                      <span className={row.released ? "text-strong" : "text-muted-foreground"}>{row.name}</span>
                      {!row.released ? <span className="text-xs text-muted-foreground">when released</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
              {canBuy && !current ? (
                <Button className="relative mt-4 self-start" size="sm" variant="primary" loading={busy} onClick={() => void run(async () => setIntentId(await change({ companyId, plan: plan.id })))}>
                  Choose {plan.name}
                </Button>
              ) : null}
            </section>
          );
        })}
      </div>
      <details className="group mt-4">
        <summary className="cursor-pointer text-sm font-medium text-brand-600 focus-visible:outline-2 focus-visible:outline-brand-500">Compare everything in each plan</summary>
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
      </details>
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
