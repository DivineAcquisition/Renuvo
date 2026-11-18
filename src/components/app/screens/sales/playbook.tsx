"use client";

/**
 * The Sales Playbook: how Sales speaks, what it handles, the answers it may give, when it follows up,
 * what it may take off a price, what a booking needs, and what always goes to a person. These are the
 * Owner's rules; Sales reads them every time it acts.
 *
 * What Sales may do without asking is not a Playbook setting of its own: it is the same permission
 * every agent has, shown here in the Owner's words and changed in the same place as everyone else's.
 */
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { PermissionRow, type Action } from "@/components/app/screens/agent-permissions";
import { PageHeader, Panel } from "@/components/app/shell";
import { Plus, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { centsFrom } from "@/lib/app/format";

import { api } from "../../../../../convex/_generated/api";
import { ReadinessPanel } from "./shared";

type Playbook = FunctionReturnType<typeof api.sales.playbook>;
type Settings = Playbook["settings"];
type Kind = Settings["eligibility"]["kinds"][number];

const KINDS: { id: Kind; label: string }[] = [
  { id: "residential", label: "Homes" },
  { id: "short_term_rental", label: "Short-term rentals" },
  { id: "commercial", label: "Commercial spaces" },
];
const TONES: { id: Settings["voice"]["tone"]; label: string; sample: string }[] = [
  { id: "warm", label: "Warm", sample: "Hi Dana, thanks for reaching out! Happy to help." },
  { id: "direct", label: "Direct", sample: "Hi Dana. Here is what we need to give you a price." },
  { id: "formal", label: "Formal", sample: "Hello Dana, thank you for your inquiry." },
];
const ADVERTISING = "sales.draft_ad_campaign";

function Sequence({ label, hint, hours, disabled, onChange }: { label: string; hint: string; hours: number[]; disabled: boolean; onChange: (next: number[]) => void }) {
  return (
    <div className="grid gap-2 rounded-xl border border-border bg-background p-3.5">
      <div>
        <p className="text-sm font-medium text-strong">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {hours.length === 0 ? <p className="text-sm text-muted-foreground">No reminder. Sales waits, and the opportunity stays with the customer.</p> : null}
      <ol className="grid gap-2">
        {hours.map((value, index) => (
          <li key={index} className="flex flex-wrap items-center gap-2 text-sm text-strong">
            <span className="w-32 text-muted-foreground">Reminder {index + 1} after</span>
            <TextInput
              inputMode="numeric"
              value={String(value)}
              disabled={disabled}
              aria-label={`${label}: hours before reminder ${index + 1}`}
              onChange={(event) => onChange(hours.map((before, at) => (at === index ? Math.max(1, Math.min(24 * 60, Number(event.target.value.replace(/\D/g, "")) || 1)) : before)))}
              className="w-20"
            />
            <span className="text-muted-foreground">hours{value >= 24 ? ` (${Math.round((value / 24) * 10) / 10} days)` : ""}</span>
            {!disabled ? (
              <button type="button" onClick={() => onChange(hours.filter((_, at) => at !== index))} aria-label={`Remove reminder ${index + 1}`} className="rounded-md p-1.5 text-muted-foreground hover:text-destructive-foreground focus-visible:outline-2 focus-visible:outline-brand-500">
                <Trash2 className="size-4" aria-hidden />
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      {!disabled && hours.length < 4 ? (
        <div>
          <Button size="xs" variant="outline" onClick={() => onChange([...hours, (hours.at(-1) ?? 24) + 48])}>
            <Plus aria-hidden />
            Add a reminder
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Editor({ playbook, justSaved, onSaved }: { playbook: Playbook; justSaved: boolean; onSaved: (revision: number) => void }) {
  const { companyId } = useCompany();
  const save = useMutation(api.sales.savePlaybook);
  const { busy, error, run, setError } = useRun();
  const [settings, setSettings] = useState<Settings>(playbook.settings);
  const [revision, setRevision] = useState(playbook.settings.revision);
  const [touched, setTouched] = useState(false);
  const setSaved = (value: boolean) => setTouched(!value);
  const [reviewAbove, setReviewAbove] = useState(playbook.settings.quotes.reviewAboveCents === null ? "" : (playbook.settings.quotes.reviewAboveCents / 100).toFixed(2));
  const [depositAmount, setDepositAmount] = useState(playbook.settings.booking.deposit.kind === "fixed" ? (playbook.settings.booking.deposit.cents / 100).toFixed(2) : "");
  const can = playbook.canEdit;
  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSaved(false);
    setSettings((before) => ({ ...before, [key]: value }));
  };
  const saved = justSaved && !touched;
  const dirty = touched || JSON.stringify(settings) !== JSON.stringify(playbook.settings) || reviewAbove !== (playbook.settings.quotes.reviewAboveCents === null ? "" : (playbook.settings.quotes.reviewAboveCents / 100).toFixed(2));

  const submit = () =>
    run(async () => {
      const review = reviewAbove.trim() ? centsFrom(reviewAbove) : null;
      if (reviewAbove.trim() && review === null) return setError("Enter the review amount in dollars, like 500 or 500.00.");
      let deposit = settings.booking.deposit;
      if (deposit.kind === "fixed") {
        const cents = centsFrom(depositAmount);
        if (cents === null || cents <= 0) return setError("Enter the deposit as a dollar amount.");
        deposit = { kind: "fixed", cents };
      }
      const result = await save({
        companyId,
        expectedRevision: revision,
        settings: {
          voice: { tone: settings.voice.tone, ...(settings.voice.signature?.trim() ? { signature: settings.voice.signature.trim() } : {}) },
          eligibility: settings.eligibility,
          answers: settings.answers.filter((row) => row.question.trim() && row.answer.trim()),
          followUp: settings.followUp,
          discounts: { maxPercent: settings.discounts.maxPercent, reasons: settings.discounts.reasons.map((reason) => reason.trim()).filter(Boolean) },
          booking: { ...settings.booking, deposit },
          quotes: { ...settings.quotes, reviewAboveCents: review },
          escalation: { keywords: settings.escalation.keywords.map((word) => word.trim()).filter(Boolean) },
        },
      });
      setRevision(result.revision);
      onSaved(result.revision);
    });

  return (
    <div className="grid gap-5">
      <Panel title="1 · How Sales sounds">
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tone">
            {TONES.map((tone) => (
              <label key={tone.id} className={`grid cursor-pointer gap-1 rounded-xl border px-3.5 py-3 has-focus-visible:outline-2 has-focus-visible:outline-brand-500 ${settings.voice.tone === tone.id ? "border-brand-500 bg-brand-500/5" : "border-border bg-background"}`}>
                <span className="flex items-center gap-2 text-sm font-medium text-strong">
                  <input type="radio" name="tone" checked={settings.voice.tone === tone.id} disabled={!can} onChange={() => patch("voice", { ...settings.voice, tone: tone.id })} className="size-4 accent-[var(--color-brand-500)]" />
                  {tone.label}
                </span>
                <span className="text-xs text-muted-foreground">“{tone.sample}”</span>
              </label>
            ))}
          </div>
          <Field label="Sign messages as (optional)" hint="For example: Maria at Bright Home. Without it, messages are signed with your company’s name.">
            <TextInput value={settings.voice.signature ?? ""} disabled={!can} onChange={(event) => patch("voice", { ...settings.voice, signature: event.target.value || null })} />
          </Field>
          <p className="text-xs text-muted-foreground">Sales writes from templates in this tone. When an AI reader is connected it may reword a template, and the result is rejected if it adds a number, a link or a promise the template did not have.</p>
        </div>
      </Panel>

      <Panel title="2 · What Sales handles">
        <div className="grid gap-3">
          <div className="grid gap-1.5 sm:grid-cols-3">
            {KINDS.map((kind) => (
              <label key={kind.id} className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-strong">
                <input type="checkbox" disabled={!can} checked={settings.eligibility.kinds.includes(kind.id)} onChange={(event) => patch("eligibility", { ...settings.eligibility, kinds: event.target.checked ? [...settings.eligibility.kinds, kind.id] : settings.eligibility.kinds.filter((value) => value !== kind.id) })} className="size-4 accent-[var(--color-brand-500)]" />
                {kind.label}
              </label>
            ))}
          </div>
          <label className="flex items-start gap-2 text-sm text-strong">
            <input type="checkbox" disabled={!can} checked={settings.eligibility.textInquiries} onChange={(event) => patch("eligibility", { ...settings.eligibility, textInquiries: event.target.checked })} className="mt-0.5 size-4 accent-[var(--color-brand-500)]" />
            <span>
              Treat a first text from an unknown number as an inquiry
              <span className="block text-xs text-muted-foreground">Texts from existing customers and from cleaners are never treated as sales inquiries.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-strong">
            <input type="checkbox" disabled={!can} checked={settings.eligibility.commercialNeedsWalkthrough} onChange={(event) => patch("eligibility", { ...settings.eligibility, commercialNeedsWalkthrough: event.target.checked })} className="mt-0.5 size-4 accent-[var(--color-brand-500)]" />
            <span>
              Commercial work is quoted after a walkthrough
              <span className="block text-xs text-muted-foreground">Sales gathers the details and hands it to you to arrange the visit, instead of pricing it from answers.</span>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">A request outside this goes to a person. Existing customers rebooking or coming back are Retention’s, not Sales’s. Sales does not make or answer calls, and does not contact people who have not asked.</p>
        </div>
      </Panel>

      <Panel
        title={`3 · Answers you approved · ${settings.answers.length}`}
        action={
          can ? (
            <Button size="xs" variant="outline" onClick={() => patch("answers", [...settings.answers, { id: `a${Date.now().toString(36)}`, topic: "", question: "", answer: "" }])}>
              <Plus aria-hidden />
              Add an answer
            </Button>
          ) : null
        }
      >
        <p className="mb-3 text-xs text-muted-foreground">Sales answers questions only from these and from your published services. A question it has no approved answer for goes to you.</p>
        {settings.answers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No approved answer yet. Common ones: are you insured, do you bring supplies, what if I need to reschedule.</p>
        ) : (
          <ul className="grid gap-2.5">
            {settings.answers.map((row, index) => {
              const set = (changes: Partial<typeof row>) => patch("answers", settings.answers.map((before, at) => (at === index ? { ...before, ...changes } : before)));
              return (
                <li key={row.id} className="grid gap-2.5 rounded-xl border border-border bg-background p-3.5 sm:grid-cols-[10rem_1fr_auto]">
                  <Field label="Topic">
                    <TextInput value={row.topic} disabled={!can} placeholder="Insurance" onChange={(event) => set({ topic: event.target.value })} />
                  </Field>
                  <div className="grid gap-2.5">
                    <Field label="When a customer asks">
                      <TextInput value={row.question} disabled={!can} placeholder="Are you insured?" onChange={(event) => set({ question: event.target.value })} />
                    </Field>
                    <Field label="Sales answers">
                      <TextArea value={row.answer} disabled={!can} rows={2} onChange={(event) => set({ answer: event.target.value })} />
                    </Field>
                  </div>
                  {can ? (
                    <button type="button" onClick={() => patch("answers", settings.answers.filter((_, at) => at !== index))} aria-label={`Remove the answer about ${row.topic || "this topic"}`} className="self-start rounded-md p-1.5 text-muted-foreground hover:text-destructive-foreground focus-visible:outline-2 focus-visible:outline-brand-500">
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="4 · When Sales follows up">
        <div className="grid gap-3 lg:grid-cols-3">
          <Sequence label="Missing details" hint="The customer was asked something and has not answered." hours={settings.followUp.missingInfoHours} disabled={!can} onChange={(next) => patch("followUp", { ...settings.followUp, missingInfoHours: next })} />
          <Sequence label="A quote that was sent" hint="The customer has the quote and has not answered." hours={settings.followUp.quoteHours} disabled={!can} onChange={(next) => patch("followUp", { ...settings.followUp, quoteHours: next })} />
          <Sequence label="A booking step" hint="The customer accepted and something is still open." hours={settings.followUp.bookingHours} disabled={!can} onChange={(next) => patch("followUp", { ...settings.followUp, bookingHours: next })} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">A reply, a decline, an opt-out, a booking or a person taking over ends a sequence at once. Reminders wait for your quiet hours to end. After the last one goes unanswered the opportunity comes to you; Sales never starts a sequence again by itself.</p>
      </Panel>

      <Panel title="5 · Discounts">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="The most Sales may take off without asking" hint="A percent of the cleaning amount. 0 means never. More than this, or any discount below a service’s minimum, needs your approval.">
            <div className="flex items-center gap-2">
              <TextInput inputMode="numeric" value={String(settings.discounts.maxPercent)} disabled={!can} onChange={(event) => patch("discounts", { ...settings.discounts, maxPercent: Math.max(0, Math.min(30, Number(event.target.value.replace(/\D/g, "")) || 0)) })} className="w-24" />
              <span className="text-sm text-muted-foreground">percent (up to 30)</span>
            </div>
          </Field>
          <Field label="Reasons a discount may be given" hint="One per line. Shown on the quote.">
            <TextArea value={settings.discounts.reasons.join("\n")} disabled={!can} rows={3} placeholder={"First-time customer\nReferred by a customer"} onChange={(event) => patch("discounts", { ...settings.discounts, reasons: event.target.value.split("\n") })} />
          </Field>
        </div>
      </Panel>

      <Panel title="6 · What a booking needs">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-2 text-sm text-strong sm:col-span-2">
            <input type="checkbox" disabled={!can} checked={settings.booking.agreementRequired} onChange={(event) => patch("booking", { ...settings.booking, agreementRequired: event.target.checked })} className="mt-0.5 size-4 accent-[var(--color-brand-500)]" />
            <span>
              A signed service agreement before the first visit
              <span className="block text-xs text-muted-foreground">Sales waits for an agreement that is signed and in force under Agreements. It does not write or send one.</span>
            </span>
          </label>
          <Field label="Deposit">
            <SelectInput value={settings.booking.deposit.kind} disabled={!can} onChange={(event) => patch("booking", { ...settings.booking, deposit: event.target.value === "percent" ? { kind: "percent", percent: 25 } : event.target.value === "fixed" ? { kind: "fixed", cents: 5000 } : { kind: "none" } })}>
              <option value="none">No deposit</option>
              <option value="percent">A percent of the quote</option>
              <option value="fixed">A fixed amount</option>
            </SelectInput>
          </Field>
          {settings.booking.deposit.kind === "percent" ? (
            <Field label="Percent of the quote">
              <TextInput inputMode="numeric" value={String(settings.booking.deposit.percent)} disabled={!can} onChange={(event) => patch("booking", { ...settings.booking, deposit: { kind: "percent", percent: Math.max(1, Math.min(100, Number(event.target.value.replace(/\D/g, "")) || 1)) } })} />
            </Field>
          ) : settings.booking.deposit.kind === "fixed" ? (
            <Field label="Amount ($)">
              <TextInput inputMode="decimal" value={depositAmount} disabled={!can} placeholder="50.00" onChange={(event) => (setSaved(false), setDepositAmount(event.target.value))} />
            </Field>
          ) : (
            <span />
          )}
          <Field label="Hold a chosen time for" hint="Minutes a time stays reserved while the customer finishes the booking steps.">
            <TextInput inputMode="numeric" value={String(settings.booking.holdMinutes)} disabled={!can} onChange={(event) => patch("booking", { ...settings.booking, holdMinutes: Math.max(15, Math.min(1440, Number(event.target.value.replace(/\D/g, "")) || 15)) })} />
          </Field>
          <Field label="Earliest a visit may start" hint="Hours from the moment of booking.">
            <TextInput inputMode="numeric" value={String(settings.booking.minimumNoticeHours)} disabled={!can} onChange={(event) => patch("booking", { ...settings.booking, minimumNoticeHours: Math.max(0, Math.min(720, Number(event.target.value.replace(/\D/g, "")) || 0)) })} />
          </Field>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">A deposit is invoiced and collected by Finance; Sales only reads whether it is paid. A booking is confirmed only when the quote is accepted, these are met, and enough eligible cleaners are free at the chosen time.</p>
      </Panel>

      <Panel title="7 · Quotes">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="A quote is valid for" hint="Days from when it is sent.">
            <TextInput inputMode="numeric" value={String(settings.quotes.validDays)} disabled={!can} onChange={(event) => patch("quotes", { ...settings.quotes, validDays: Math.max(1, Math.min(90, Number(event.target.value.replace(/\D/g, "")) || 1)) })} />
          </Field>
          <Field label="Always review quotes above ($)" hint="Leave empty to review only what your permissions require.">
            <TextInput inputMode="decimal" value={reviewAbove} disabled={!can} placeholder="No amount" onChange={(event) => (setSaved(false), setReviewAbove(event.target.value))} />
          </Field>
          <Field label="Payment terms" className="sm:col-span-2">
            <TextArea value={settings.quotes.paymentTerms} disabled={!can} rows={2} onChange={(event) => patch("quotes", { ...settings.quotes, paymentTerms: event.target.value })} />
          </Field>
          <Field label="Changes and cancellation" className="sm:col-span-2">
            <TextArea value={settings.quotes.cancellationTerms} disabled={!can} rows={2} onChange={(event) => patch("quotes", { ...settings.quotes, cancellationTerms: event.target.value })} />
          </Field>
        </div>
      </Panel>

      <Panel title="8 · What always goes to a person">
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">Damage, injury, complaints, refunds, disputes and anything legal always go to a person, whatever is listed here. So does anything Sales cannot answer from your approved answers or your services.</p>
          <Field label="Also hand over when a customer mentions" hint="One word or phrase per line.">
            <TextArea value={settings.escalation.keywords.join("\n")} disabled={!can} rows={3} placeholder={"mold\nhoarding\nbiohazard"} onChange={(event) => patch("escalation", { keywords: event.target.value.split("\n") })} />
          </Field>
        </div>
      </Panel>

      {can ? (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-[0_18px_40px_-24px_rgba(27,14,69,0.5)] backdrop-blur">
          <Button variant="primary" loading={busy} disabled={!dirty} onClick={() => void submit()}>
            Save the Playbook
          </Button>
          {saved && !error ? (
            <span role="status" className="text-sm text-success-foreground">
              Saved. Sales uses it from its next step.
            </span>
          ) : dirty ? (
            <span className="text-sm text-muted-foreground">You have changes that are not saved.</span>
          ) : null}
          <div className="w-full empty:hidden">
            <FormError message={error} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only the Owner changes the Playbook.</p>
      )}
    </div>
  );
}

export function SalesPlaybookScreen() {
  const { companyId, role } = useCompany();
  const playbook = useQuery(api.sales.playbook, { companyId });
  const permissions = useQuery(api.permissions.list, { companyId });
  const readiness = useQuery(api.sales.readiness, { companyId });
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const mine = (permissions?.actions ?? []).filter((action) => action.agent === "sales");
  const own = mine.filter((action) => action.key !== ADVERTISING);
  const advertising = mine.filter((action) => action.key === ADVERTISING);

  return (
    <>
      <PageHeader title="Playbook" lead="How Sales works for you: what it says, what it handles, when it follows up, and what a booking needs." />
      <div className="grid gap-5" aria-busy={playbook === undefined || permissions === undefined}>
        <Panel
          title="What Sales may do without asking"
          action={
            <Link href="/app/settings/agents" className="text-xs font-medium text-brand-300 underline-offset-4 hover:underline">
              All agents’ permissions
            </Link>
          }
        >
          {permissions === undefined ? (
            <Skeleton className="h-28 rounded-xl" />
          ) : (
            <>
              <p className="text-xs text-muted-foreground">These are the same permissions as in Settings. Whatever you choose, Sales’s first messages wait for one review by you before anything is sent, and a quote that needs a person’s eye still comes to you.</p>
              <ul className="mt-1 divide-y divide-border">
                {own.map((action) => (
                  <PermissionRow key={action.key} action={action as Action} canEdit={role === "owner"} />
                ))}
              </ul>
              {advertising.length > 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-border px-3.5 py-1">
                  <p className="pt-2.5 text-xs text-muted-foreground">Advertising is not part of Sales’s work. This permission is kept under Sales so the Google lead forms and campaign drafts you may already use keep working; it is meant to move to Marketing.</p>
                  <ul>
                    {advertising.map((action) => (
                      <PermissionRow key={action.key} action={action as Action} canEdit={role === "owner"} />
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </Panel>

        {readiness ? (
          <Panel title="What Sales is connected to">
            <ReadinessPanel rows={readiness} />
          </Panel>
        ) : null}

        {playbook === undefined ? <Skeleton className="h-96 rounded-2xl" /> : <Editor key={playbook.settings.revision} playbook={playbook} justSaved={savedRevision === playbook.settings.revision} onSaved={setSavedRevision} />}
      </div>
    </>
  );
}
