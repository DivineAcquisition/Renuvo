"use client";

/**
 * The shared booking rules: the company's booking address and public profile, scheduling, payment
 * policies and booking agreements. Every experience chooses from these; none keeps its own copy, so a
 * deposit or an agreement is one rule the Owner can see and change in one place.
 */
import { Plus, Trash, UploadSimple, X } from "@phosphor-icons/react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Notice, Segmented } from "@/components/app/services/shared";
import { buttonVariants } from "@/components/ui/button-variants";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type Policy = { id: string; label: string; kind: "none" | "deposit_percent" | "deposit_fixed" | "full"; percent?: number; cents?: number; balanceTerms: string };
type Agreement = { id: string; label: string; templateId: Id<"agreementTemplates">; standing: Record<string, string | number | boolean> };

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 7)}`;

type RulesData = NonNullable<FunctionReturnType<typeof api.bookingExperiences.rules>>;

export function BookingRules({ onClose }: { onClose: () => void }) {
  const { companyId } = useCompany();
  const rules = useQuery(api.bookingExperiences.rules, { companyId });
  if (!rules) return <div className="h-72 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />;
  return <RulesForm rules={rules} onClose={onClose} />;
}

function RulesForm({ rules, onClose }: { rules: RulesData; onClose: () => void }) {
  const { companyId } = useCompany();
  const save = useMutation(api.bookingExperiences.saveRules);
  const uploadUrl = useMutation(api.bookingExperiences.uploadUrl);
  const { busy, error, run } = useRun();
  const [saved, setSaved] = useState(false);
  const [state, setState] = useState(() => ({
    handle: rules.handle ?? "",
    profile: { displayName: rules.profile.displayName, phone: rules.profile.phone ?? "", email: rules.profile.email ?? "", website: rules.profile.website ?? "", logo: rules.profile.logo as Id<"_storage"> | undefined, brandColor: rules.profile.brandColor, accentColor: rules.profile.accentColor },
    scheduling: rules.scheduling,
    policies: rules.paymentPolicies as Policy[],
    agreements: rules.agreements as Agreement[],
    revision: rules.revision,
    logoUrl: rules.profile.logoUrl as string | null,
  }));
  const can = rules.canChange;
  const set = (patch: Partial<typeof state>) => {
    setSaved(false);
    setState({ ...state, ...patch });
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4 md:p-5" aria-labelledby="booking-rules">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id="booking-rules" className="font-heading text-lg tracking-tight text-strong">Booking rules</h2>
          <p className="text-sm text-muted-foreground">Shared by every booking experience. {can ? "" : "Only the Owner changes these."}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close booking rules" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
          <X aria-hidden />
        </button>
      </header>
      <fieldset disabled={!can || busy} className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <h3 className="font-medium text-strong">Booking address and public profile</h3>
          <Field label="Booking address" hint={`Pages live at …/b/${state.handle || "your-name"}/<page>. Lower-case letters, numbers and dashes.`}>
            <TextInput value={state.handle} maxLength={40} onChange={(e) => set({ handle: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
          </Field>
          <Field label="Name customers see">
            <TextInput value={state.profile.displayName} maxLength={80} onChange={(e) => set({ profile: { ...state.profile, displayName: e.target.value } })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Public phone">
              <TextInput type="tel" value={state.profile.phone} onChange={(e) => set({ profile: { ...state.profile, phone: e.target.value } })} />
            </Field>
            <Field label="Public email">
              <TextInput type="email" value={state.profile.email} onChange={(e) => set({ profile: { ...state.profile, email: e.target.value } })} />
            </Field>
          </div>
          <Field label="Website">
            <TextInput value={state.profile.website} placeholder="https://" onChange={(e) => set({ profile: { ...state.profile, website: e.target.value } })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["brandColor", "accentColor"] as const).map((k) => (
              <Field key={k} label={k === "brandColor" ? "Brand color" : "Accent color"}>
                <span className="flex items-center gap-2">
                  <input type="color" aria-label={k === "brandColor" ? "Brand color" : "Accent color"} value={state.profile[k]} onChange={(e) => set({ profile: { ...state.profile, [k]: e.target.value } })} className="h-10 w-12 cursor-pointer rounded-lg border border-border" />
                  <TextInput value={state.profile[k]} maxLength={7} onChange={(e) => set({ profile: { ...state.profile, [k]: e.target.value } })} />
                </span>
              </Field>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {state.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={state.logoUrl} alt="Current logo" className="size-12 rounded-lg border border-border object-contain" />
            ) : (
              <span className="grid size-12 place-items-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">Logo</span>
            )}
            <label className={buttonVariants({ variant: "outline", size: "sm" })}>
              <UploadSimple aria-hidden /> Upload logo
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void run(async () => {
                    const url = await uploadUrl({ companyId });
                    const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
                    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
                    set({ profile: { ...state.profile, logo: storageId }, logoUrl: URL.createObjectURL(file) });
                  });
                }}
              />
            </label>
            {state.profile.logo ? (
              <button type="button" onClick={() => set({ profile: { ...state.profile, logo: undefined }, logoUrl: null })} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Remove
              </button>
            ) : null}
          </div>

          <h3 className="pt-2 font-medium text-strong">Scheduling</h3>
          <Segmented label="Times customers pick" value={state.scheduling.mode} options={[{ id: "capacity", label: "Open times, held for them" }, { id: "request", label: "Preferred times, you confirm" }]} onChange={(mode) => set({ scheduling: { ...state.scheduling, mode } })} />
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["noticeHours", "Notice (hours)"],
                ["horizonDays", "Up to (days ahead)"],
                ["slotMinutes", "Every (minutes)"],
                ["holdMinutes", "Hold a time (minutes)"],
                ["defaultWindowMinutes", "Arrival window (minutes)"],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label}>
                <TextInput inputMode="numeric" value={state.scheduling[k]} onChange={(e) => set({ scheduling: { ...state.scheduling, [k]: Number(e.target.value.replace(/\D/g, "")) || 0 } })} />
              </Field>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Booking hours and ZIP codes come from Business details. The arrival window is when the team arrives, not how long the visit takes; a service&apos;s own window is used when it has one.</p>
        </div>

        <div className="space-y-4">
          <h3 className="font-medium text-strong">Payment policies</h3>
          <p className="text-sm text-muted-foreground">Card payments go to your own Stripe account through Finance. The rest is collected with a Finance invoice after the visit.</p>
          {state.policies.map((p, i) => (
            <div key={p.id} className="space-y-3 rounded-xl border border-border p-3">
              <div className="flex gap-2">
                <TextInput aria-label="Policy name" value={p.label} onChange={(e) => set({ policies: state.policies.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <button type="button" aria-label={`Remove ${p.label}`} onClick={() => set({ policies: state.policies.filter((_, j) => j !== i) })} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
                  <Trash aria-hidden />
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="What's paid when booking">
                  <SelectInput value={p.kind} onChange={(e) => set({ policies: state.policies.map((x, j) => (j === i ? { ...x, kind: e.target.value as Policy["kind"] } : x)) })}>
                    <option value="deposit_percent">A percentage deposit</option>
                    <option value="deposit_fixed">A fixed deposit</option>
                    <option value="full">The full amount</option>
                    <option value="none">Nothing (invoice later)</option>
                  </SelectInput>
                </Field>
                {p.kind === "deposit_percent" ? (
                  <Field label="Percent">
                    <TextInput inputMode="numeric" value={p.percent ?? ""} onChange={(e) => set({ policies: state.policies.map((x, j) => (j === i ? { ...x, percent: Number(e.target.value.replace(/\D/g, "")) || undefined } : x)) })} />
                  </Field>
                ) : p.kind === "deposit_fixed" ? (
                  <Field label="Amount ($)">
                    <TextInput inputMode="decimal" value={p.cents !== undefined ? (p.cents / 100).toString() : ""} onChange={(e) => set({ policies: state.policies.map((x, j) => (j === i ? { ...x, cents: Math.round(Number(e.target.value) * 100) || undefined } : x)) })} />
                  </Field>
                ) : null}
              </div>
              {p.kind !== "full" ? (
                <Field label="How the rest is collected" hint="Shown to customers word for word.">
                  <TextInput value={p.balanceTerms} maxLength={200} placeholder="Invoiced after the visit." onChange={(e) => set({ policies: state.policies.map((x, j) => (j === i ? { ...x, balanceTerms: e.target.value } : x)) })} />
                </Field>
              ) : null}
            </div>
          ))}
          <button type="button" onClick={() => set({ policies: [...state.policies, { id: uid("pay"), label: "Deposit", kind: "deposit_percent", percent: 25, balanceTerms: "Invoiced after the visit." }] })} className={buttonVariants({ variant: "outline", size: "xs" })}>
            <Plus aria-hidden /> Add a payment policy
          </button>

          <h3 className="pt-2 font-medium text-strong">Booking agreements</h3>
          {rules.templates.length === 0 ? <Notice tone="info" title="No approved customer templates">Approve a customer agreement template in Company Agreements first.</Notice> : null}
          {state.agreements.map((a, i) => (
            <AgreementRule key={a.id} rule={a} templates={rules.templates} onChange={(next) => set({ agreements: state.agreements.map((x, j) => (j === i ? next : x)) })} onRemove={() => set({ agreements: state.agreements.filter((_, j) => j !== i) })} />
          ))}
          {rules.templates.length ? (
            <button type="button" onClick={() => set({ agreements: [...state.agreements, { id: uid("agr"), label: rules.templates[0].title, templateId: rules.templates[0].id, standing: {} }] })} className={buttonVariants({ variant: "outline", size: "xs" })}>
              <Plus aria-hidden /> Add a booking agreement
            </button>
          ) : null}
        </div>
      </fieldset>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
        {saved ? <span role="status" className="text-sm text-muted-foreground">Saved.</span> : null}
        <FormError message={error} />
        {can ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await save({
                  companyId,
                  expectedRevision: state.revision,
                  handle: state.handle || undefined,
                  profile: { displayName: state.profile.displayName, phone: state.profile.phone || undefined, email: state.profile.email || undefined, website: state.profile.website || undefined, logo: state.profile.logo, brandColor: state.profile.brandColor, accentColor: state.profile.accentColor },
                  scheduling: state.scheduling,
                  paymentPolicies: state.policies,
                  agreements: state.agreements,
                });
                setState({ ...state, revision: result.revision });
                setSaved(true);
              })
            }
            className={buttonVariants({ variant: "primary", size: "sm" })}
          >
            {busy ? "Saving…" : "Save booking rules"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function AgreementRule({ rule, templates, onChange, onRemove }: { rule: Agreement; templates: { id: Id<"agreementTemplates">; title: string }[]; onChange: (next: Agreement) => void; onRemove: () => void }) {
  const { companyId } = useCompany();
  const needs = useQuery(api.bookingExperiences.agreementNeeds, { companyId, templateId: rule.templateId });
  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex gap-2">
        <TextInput aria-label="Agreement name" value={rule.label} onChange={(e) => onChange({ ...rule, label: e.target.value })} />
        <button type="button" aria-label={`Remove ${rule.label}`} onClick={onRemove} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
          <Trash aria-hidden />
        </button>
      </div>
      <Field label="Approved template">
        <SelectInput value={rule.templateId} onChange={(e) => onChange({ ...rule, templateId: e.target.value as Id<"agreementTemplates">, standing: {} })}>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </SelectInput>
      </Field>
      {needs === undefined ? null : !needs.ok ? (
        <Notice tone="warning" title={needs.why ?? "This template can't be used."}>{" "}</Notice>
      ) : needs.needs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Every answer comes from the booking itself.</p>
      ) : (
        <details className="rounded-lg border border-border p-2.5" open>
          <summary className="cursor-pointer text-sm font-medium text-strong">Company answers this agreement needs ({needs.needs.filter((n) => rule.standing[n.key] !== undefined && rule.standing[n.key] !== "").length}/{needs.needs.length})</summary>
          <p className="mt-1 text-xs text-muted-foreground">The customer&apos;s name, address, service, price, deposit and date are filled from each booking.</p>
          <div className="mt-3 space-y-3">
            {needs.needs.map((n) => (
              <Field key={n.key} label={n.label} hint={n.ask}>
                {n.type === "longtext" ? (
                  <TextArea value={String(rule.standing[n.key] ?? "")} onChange={(e) => onChange({ ...rule, standing: { ...rule.standing, [n.key]: e.target.value } })} />
                ) : n.type === "bool" ? (
                  <SelectInput value={rule.standing[n.key] === undefined ? "" : String(rule.standing[n.key])} onChange={(e) => onChange({ ...rule, standing: { ...rule.standing, [n.key]: e.target.value === "true" } })}>
                    <option value="">Choose…</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </SelectInput>
                ) : n.choices.length ? (
                  <SelectInput value={String(rule.standing[n.key] ?? "")} onChange={(e) => onChange({ ...rule, standing: { ...rule.standing, [n.key]: e.target.value } })}>
                    <option value="">Choose…</option>
                    {n.choices.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </SelectInput>
                ) : (
                  <TextInput
                    inputMode={n.type === "int" || n.type === "money" ? "decimal" : undefined}
                    value={n.type === "money" && typeof rule.standing[n.key] === "number" ? String((rule.standing[n.key] as number) / 100) : String(rule.standing[n.key] ?? "")}
                    onChange={(e) => onChange({ ...rule, standing: { ...rule.standing, [n.key]: n.type === "int" ? Number(e.target.value) || 0 : n.type === "money" ? Math.round(Number(e.target.value) * 100) || 0 : e.target.value } })}
                  />
                )}
              </Field>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
