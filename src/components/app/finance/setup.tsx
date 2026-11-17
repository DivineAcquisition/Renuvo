"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, TextArea, TextInput, useRun } from "@/components/app/form";
import { PageHeader } from "@/components/app/shell";
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, Wallet } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FINANCE_PATH, moment } from "@/lib/app/finance";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Notice, Section } from "./kit";

type Settings = FunctionReturnType<typeof api.finance.settings>;

/** Finance › Payments setup: the company's own Stripe account, and how its invoices are made. */
/** A starting point the Owner can rename, re-rate, add to or remove before saving. */
const SUGGESTED_TIERS = [
  { name: "New", percent: "35" },
  { name: "Proven", percent: "40" },
  { name: "Lead", percent: "45" },
];

export function PaymentsSetup() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <Setup />
    </Suspense>
  );
}

function Setup() {
  const { companyId, role } = useCompany();
  const data = useQuery(api.finance.settings, role === "owner" ? { companyId } : "skip");
  if (role !== "owner") {
    return (
      <>
        <PageHeader title="Payments setup" />
        <p className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">Payments setup is for the company&apos;s Owner.</p>
      </>
    );
  }
  return (
    <>
      <Link href={FINANCE_PATH} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-strong">
        <ArrowLeft className="size-4" aria-hidden />
        Finance
      </Link>
      <PageHeader title="Payments setup" lead="Where your customers' payments go, and how your invoices are made. Selestial's own plan is separate, under Settings › Plan & Usage." />
      {!data ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid gap-5">
            <StripeCard data={data} />
            <Reminders data={data} />
          </div>
          <InvoiceSettings data={data} />
          <div className="lg:col-span-2">
            <TeamPaySettings data={data} />
          </div>
          <div className="lg:col-span-2">
            <ExpenseCategories data={data} />
          </div>
        </div>
      )}
    </>
  );
}

function StripeCard({ data }: { data: Settings }) {
  const { companyId, timezone } = useCompany();
  const params = useSearchParams();
  const connect = useMutation(api.financeStripe.connect);
  const refresh = useMutation(api.financeStripe.refreshAccount);
  const { busy, error, run, setError } = useRun();
  // When the Owner asked Stripe for an onboarding link. While it is being made the button waits; a
  // failure is read from the record, not kept here.
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const refreshed = useRef(false);
  const stripe = data.stripe;

  // Back from Stripe: read the account again rather than trusting the address.
  useEffect(() => {
    const from = params.get("stripe");
    if ((from === "returned" || from === "refresh") && !refreshed.current) {
      refreshed.current = true;
      void refresh({ companyId }).catch(() => undefined);
    }
  }, [params, refresh, companyId]);

  const asked = askedAt !== null && stripe.onboarding !== null && stripe.onboarding.requestedAt >= askedAt;
  const waiting = askedAt !== null && (!asked || stripe.onboarding?.state === "working" || (stripe.onboarding?.state === "ready" && Boolean(stripe.onboarding.url)));
  const onboardingProblem = asked && stripe.onboarding?.state === "failed" ? (stripe.onboarding.problem ?? "Stripe didn't answer. Try again.") : null;
  // After asking, go to Stripe as soon as its onboarding link is ready.
  const readyUrl = asked && stripe.onboarding?.state === "ready" ? stripe.onboarding.url : null;
  useEffect(() => {
    if (readyUrl) window.location.assign(readyUrl);
  }, [readyUrl]);

  const state = stripe.state;
  const look = {
    not_available: { word: "Not available yet", dot: "bg-muted-foreground/50" },
    not_connected: { word: "Not connected", dot: "bg-muted-foreground/50" },
    disconnected: { word: "Disconnected", dot: "bg-destructive" },
    onboarding: { word: "Setup not finished", dot: "bg-warning" },
    restricted: { word: "Stripe needs something", dot: "bg-destructive" },
    active: { word: "Taking payments", dot: "bg-success" },
  }[state];
  return (
    <Section title="Card and bank payments" description="Through your own Stripe account">
      <div className="grid gap-4">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3.5">
          <span className="grid size-10 place-items-center rounded-xl bg-[#635bff] text-white" aria-hidden>
            <Wallet className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-strong">{stripe.businessName ?? "Stripe"}</p>
            <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("size-2 rounded-full", look.dot)} aria-hidden />
              {look.word}
              {stripe.testMode && state !== "not_available" ? " · test mode" : ""}
              {stripe.checkedAt ? ` · checked ${moment(stripe.checkedAt, timezone, true)}` : ""}
            </p>
          </div>
          {stripe.checkedAt && state !== "not_available" ? (
            <Button size="icon-sm" variant="ghost" aria-label="Check with Stripe again" onClick={() => run(() => refresh({ companyId }))}>
              <RefreshCw aria-hidden />
            </Button>
          ) : null}
        </div>

        {state === "not_available" ? (
          <Notice tone="info" title="Card payments aren't switched on for Selestial yet">
            Selestial&apos;s team is finishing the Stripe setup. Until then you can issue invoices, share them, and record payments you receive.
          </Notice>
        ) : state === "active" ? (
          <ul className="grid gap-2 text-sm">
            <li className="flex items-center gap-2 text-strong">
              <CheckCircle2 className="size-4 text-success-foreground" aria-hidden />
              Customers can pay invoices by card or bank on your pay links
            </li>
            <li className="flex items-center gap-2 text-strong">
              <CheckCircle2 className={cn("size-4", stripe.payoutsEnabled ? "text-success-foreground" : "text-muted-foreground")} aria-hidden />
              {stripe.payoutsEnabled ? "Stripe pays out to your bank" : "Add a bank account in Stripe to receive payouts"}
            </li>
          </ul>
        ) : (
          <div className="grid gap-2 text-sm text-muted-foreground">
            <p>
              {state === "onboarding"
                ? `Stripe still needs ${stripe.requirementsDue ? `${stripe.requirementsDue} detail${stripe.requirementsDue === 1 ? "" : "s"}` : "a few details"} before you can take payments.`
                : state === "restricted"
                  ? (stripe.problem ?? "Stripe has paused payments until it gets more information.")
                  : "Connect your own Stripe account. Customers pay you directly: Selestial never holds your money and takes no fee. Stripe charges its usual processing fee."}
            </p>
          </div>
        )}

        {state !== "not_available" && state !== "active" ? (
          <Button
            variant="default"
            disabled={busy || waiting}
            onClick={() =>
              run(async () => {
                const at = Date.now() - 5_000;
                const result = await connect({ companyId });
                if (result.ok) setAskedAt(at);
                else setError(result.problem);
              })
            }
          >
            {waiting ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <ExternalLink aria-hidden />}
            {waiting ? "Opening Stripe…" : state === "not_connected" || state === "disconnected" ? "Connect Stripe" : "Continue in Stripe"}
          </Button>
        ) : null}
        <FormError message={error ?? onboardingProblem} />
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Stripe collects and checks your business details, not Selestial. You manage payouts, disputes and your bank in your Stripe Dashboard.
        </p>
      </div>
    </Section>
  );
}

/** Whether Selestial prepares reminders on the schedule, and where customers' email replies go. */
function Reminders({ data }: { data: Settings }) {
  const { companyId } = useCompany();
  const save = useMutation(api.financeMessages.saveReminders);
  const { busy, error, run } = useRun();
  const [on, setOn] = useState(data.settings.remindersOn);
  const [replyTo, setReplyTo] = useState(data.settings.replyTo ?? "");
  const [saved, setSaved] = useState(false);
  return (
    <Section title="Invoices and reminders to customers" description="Selestial prepares; you approve every message before it goes">
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await save({ companyId, remindersOn: on, replyTo: replyTo || null });
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
          });
        }}
      >
        <label className="flex items-start gap-2.5 text-sm text-strong">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="mt-0.5 size-4 accent-brand-500" />
          <span>
            Prepare payment reminders on a schedule
            <span className="block text-xs text-muted-foreground">3 days before the due date, then 1, 7 and 14 days late. After that, Selestial flags the invoice for you instead.</span>
          </span>
        </label>
        <Field label="Replies go to" hint="Leave empty to use your own email. Emails go out under your company's name.">
          <TextInput type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="billing@yourcompany.com" />
        </Field>
        <p className="text-xs text-muted-foreground">
          Email or text, the shared sending rules apply: your sending setup (Settings › Compliance), each customer&apos;s recorded permission, the do-not-contact list and quiet hours.
        </p>
        <FormError message={error} />
        <div className="flex items-center justify-end gap-3">
          {saved ? (
            <span role="status" className="inline-flex items-center gap-1 text-sm text-success-foreground">
              <CheckCircle2 className="size-4" aria-hidden /> Saved
            </span>
          ) : null}
          <Button type="submit" variant="default" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </Section>
  );
}

function InvoiceSettings({ data }: { data: Settings }) {
  const { companyId } = useCompany();
  const save = useMutation(api.finance.saveSettings);
  const { busy, error, run } = useRun();
  const s = data.settings;
  const [tax, setTax] = useState(s.taxRateBps === null ? "" : String(s.taxRateBps / 100));
  const [taxLabel, setTaxLabel] = useState(s.taxLabel);
  const [taxable, setTaxable] = useState<string[]>(s.taxableServiceIds);
  const [terms, setTerms] = useState(String(s.paymentTermsDays));
  const [partial, setPartial] = useState(s.allowPartialPayments);
  const [prefix, setPrefix] = useState(s.invoicePrefix);
  const [note, setNote] = useState(s.invoiceNote ?? "");
  const [saved, setSaved] = useState(false);
  const taxBps = tax.trim() === "" ? null : /^\d{1,2}(\.\d{1,2})?$/.test(tax.trim()) ? Math.round(Number(tax) * 100) : NaN;
  return (
    <Section title="Invoices" description="Applied to new drafts. Issued invoices keep what they were made with.">
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (Number.isNaN(taxBps)) return;
          void run(async () => {
            await save({ companyId, revision: s.revision, taxRateBps: taxBps, taxLabel, taxableServiceIds: taxable, paymentTermsDays: Number(terms), allowPartialPayments: partial, invoiceNote: note || null, invoicePrefix: prefix });
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sales tax rate" hint="Leave empty if you don't charge tax. Selestial doesn't file tax." error={Number.isNaN(taxBps) ? "Enter a percentage like 8.25" : null}>
            <div className="relative">
              <TextInput inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="8.25" className="pr-8" />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            </div>
          </Field>
          <Field label="Tax name on invoices">
            <TextInput value={taxLabel} maxLength={40} onChange={(e) => setTaxLabel(e.target.value)} />
          </Field>
        </div>
        {data.services.length ? (
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-sm font-medium text-strong">Taxed services</legend>
            <div className="flex flex-wrap gap-2">
              {data.services.map((service) => {
                const on = taxable.includes(service.id);
                return (
                  <label key={service.id} className={cn("inline-flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm", on ? "border-brand-500/50 bg-brand-500/8 text-strong" : "border-border text-muted-foreground")}>
                    <input type="checkbox" checked={on} onChange={(e) => setTaxable((c) => (e.target.checked ? [...c, service.id] : c.filter((id) => id !== service.id)))} className="size-3.5 accent-brand-500" />
                    {service.name}
                  </label>
                );
              })}
            </div>
            <span className="text-xs text-muted-foreground">Your published services from Services &amp; Pricing. You can still change each line on a draft.</span>
          </fieldset>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment terms" hint="Days from issuing until it's due">
            <TextInput type="number" min={0} max={120} value={terms} onChange={(e) => setTerms(e.target.value)} />
          </Field>
          <Field label="Invoice number prefix" hint={`Next: ${prefix || "INV"}-${s.nextInvoiceNumber}`}>
            <TextInput value={prefix} maxLength={8} onChange={(e) => setPrefix(e.target.value.toUpperCase())} />
          </Field>
        </div>
        <label className="flex items-start gap-2.5 text-sm text-strong">
          <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} className="mt-0.5 size-4 accent-brand-500" />
          <span>
            Let customers pay part of a balance
            <span className="block text-xs text-muted-foreground">They choose the amount on the pay page. Deposits are always paid in full.</span>
          </span>
        </label>
        <Field label="Note on every invoice" hint="For example, how to pay by check">
          <TextArea value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <FormError message={error} />
        <div className="flex items-center justify-end gap-3">
          {saved ? (
            <span role="status" className="inline-flex items-center gap-1 text-sm text-success-foreground">
              <CheckCircle2 className="size-4" aria-hidden /> Saved
            </span>
          ) : null}
          <Button type="submit" variant="default" disabled={busy || Number.isNaN(taxBps)}>
            Save invoice settings
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** Pay tiers the Owner names and rates, and whether customers can tip their crew on the pay page. */
function TeamPaySettings({ data }: { data: Settings }) {
  const { companyId } = useCompany();
  const saveTiers = useMutation(api.teamPay.saveTiers);
  const saveTips = useMutation(api.teamPay.saveTips);
  const { busy, error, run } = useRun();
  const [rows, setRows] = useState(() => data.tiers.map((t) => ({ id: t.id as string | null, name: t.name, percent: String(t.shareBps / 100), cleaners: t.cleaners })));
  const [tipsOn, setTipsOn] = useState(data.settings.tipsOn);
  const [saved, setSaved] = useState(false);
  const bad = rows.find((r) => !r.name.trim() || !/^\d{1,3}(\.\d{1,2})?$/.test(r.percent.trim()) || Number(r.percent) > 100);
  const change = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Section title="Team pay" description="How contractors on a percentage are paid, and tips">
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (bad) return;
          void run(async () => {
            const result = await saveTiers({ companyId, tiers: rows.map((r) => ({ id: r.id, name: r.name, sharePercent: Number(r.percent) })) });
            if (tipsOn !== data.settings.tipsOn) await saveTips({ companyId, tipsOn });
            setRows(result.tiers.map((t) => ({ id: t.id, name: t.name, percent: String(t.shareBps / 100), cleaners: rows.find((r) => r.id === t.id)?.cleaners ?? 0 })));
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
          });
        }}
      >
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium text-strong">Pay tiers</legend>
          <p className="text-xs text-muted-foreground">A share of each job&apos;s price before tax. Put a cleaner on a tier from their page in Team Pay, or give them their own %. Changing a tier&apos;s share applies to jobs worked out from now on.</p>
          {rows.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border px-3.5 py-3 text-sm text-muted-foreground">
              No tiers yet.
              <Button size="sm" variant="outline" onClick={() => setRows(SUGGESTED_TIERS.map((t) => ({ id: null, name: t.name, percent: t.percent, cleaners: 0 })))}>
                Start with New 35%, Proven 40%, Lead 45%
              </Button>
            </div>
          ) : (
            <ul className="grid gap-2">
              {rows.map((row, i) => (
                <li key={row.id ?? `new-${i}`} className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] items-center gap-2">
                  <TextInput aria-label="Tier name" value={row.name} maxLength={30} onChange={(e) => change(i, { name: e.target.value })} />
                  <div className="relative">
                    <TextInput aria-label={`${row.name || "Tier"} share`} inputMode="decimal" value={row.percent} onChange={(e) => change(i, { percent: e.target.value })} className="pr-7" />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={row.cleaners ? `${row.name} has ${row.cleaners} cleaner${row.cleaners === 1 ? "" : "s"}; move them first` : `Remove ${row.name || "tier"}`}
                    disabled={row.cleaners > 0}
                    onClick={() => setRows((list) => list.filter((_, j) => j !== i))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                  {row.cleaners ? <span className="col-span-3 -mt-1 text-xs text-muted-foreground">{row.cleaners} cleaner{row.cleaners === 1 ? "" : "s"} on this tier</span> : null}
                </li>
              ))}
            </ul>
          )}
          {rows.length > 0 && rows.length < 12 ? (
            <Button size="sm" variant="ghost" className="w-fit" onClick={() => setRows((list) => [...list, { id: null, name: "", percent: "", cleaners: 0 }])}>
              <Plus aria-hidden />
              Add a tier
            </Button>
          ) : null}
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium text-strong">Tips</legend>
          <label className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-sm text-strong">
            <input type="checkbox" checked={tipsOn} onChange={(e) => setTipsOn(e.target.checked)} className="mt-0.5 size-4 accent-brand-500" />
            <span>
              Let customers add a tip when they pay
              <span className="block text-xs text-muted-foreground">Offered on the pay page once a job is done, never chosen for them. All of it goes to that job&apos;s crew, split evenly; your company covers Stripe&apos;s fee on it.</span>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">Cash or other tips can be recorded on a job in Team Pay, and are split the same way.</p>
        </fieldset>
        </div>
        <FormError message={error ?? (bad ? "Give each tier a name and a share between 0% and 100%." : null)} />
        <div className="flex items-center justify-end gap-3">
          {saved ? (
            <span role="status" className="inline-flex items-center gap-1 text-sm text-success-foreground">
              <CheckCircle2 className="size-4" aria-hidden /> Saved
            </span>
          ) : null}
          <Button type="submit" variant="default" disabled={busy || Boolean(bad)}>
            Save team pay
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** The categories expenses are filed under: rename, add, choose job cost or overhead, hide. A used category is hidden, never removed. */
function ExpenseCategories({ data }: { data: Settings }) {
  const { companyId } = useCompany();
  const save = useMutation(api.expenses.saveCategories);
  const { busy, error, run } = useRun();
  const [rows, setRows] = useState(() => data.settings.expenseCategories.map((c) => ({ ...c, hidden: Boolean(c.hidden) })));
  const [saved, setSaved] = useState(false);
  const change = (i: number, patch: Partial<(typeof rows)[number]>) => (setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r))), setSaved(false));
  const bad = rows.some((r) => !r.name.trim());
  return (
    <Section title="Expense categories" description="Job costs can be linked to a visit and compared with Services & Pricing's estimates; overhead is the cost of running the business">
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (bad) return;
          void run(async () => {
            await save({ companyId, categories: rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, costKey: r.costKey, accountName: r.accountName, hidden: r.hidden || undefined })) });
            setSaved(true);
          });
        }}
      >
        <ul className="grid gap-2 lg:grid-cols-2 lg:gap-x-6">
          {rows.map((row, i) => (
            <li key={row.id || `new-${i}`} className={cn("grid grid-cols-[minmax(0,1fr)_8.5rem_auto] items-center gap-2", row.hidden && "opacity-60")}>
              <TextInput aria-label="Category name" value={row.name} maxLength={40} onChange={(e) => change(i, { name: e.target.value })} />
              <select aria-label={`${row.name || "Category"} kind`} value={row.kind} onChange={(e) => change(i, { kind: e.target.value as "job" | "overhead" })} className="h-10 rounded-lg border border-border bg-card px-2 text-sm text-strong sm:h-9">
                <option value="job">Job cost</option>
                <option value="overhead">Overhead</option>
              </select>
              <Button size="xs" variant="ghost" onClick={() => change(i, { hidden: !row.hidden })}>
                {row.hidden ? "Show" : "Hide"}
              </Button>
            </li>
          ))}
        </ul>
        {rows.length < 60 ? (
          <Button size="sm" variant="ghost" className="w-fit" onClick={() => setRows((list) => [...list, { id: "", name: "", kind: "overhead" as const, hidden: false }])}>
            <Plus aria-hidden />
            Add a category
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">Hidden categories stay on the expenses already filed under them. Each category maps to a QuickBooks account for when that sync is built.</p>
        <FormError message={error ?? (bad ? "Give each category a name." : null)} />
        <div className="flex items-center justify-end gap-3">
          {saved ? (
            <span role="status" className="inline-flex items-center gap-1 text-sm text-success-foreground">
              <CheckCircle2 className="size-4" aria-hidden /> Saved
            </span>
          ) : null}
          <Button type="submit" variant="default" disabled={busy || bad}>
            Save categories
          </Button>
        </div>
      </form>
    </Section>
  );
}
