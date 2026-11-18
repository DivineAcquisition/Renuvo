"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, messageOf } from "@/components/app/form";
import { JobInputs, defaultInput } from "@/components/app/services/preview";
import { MoneyInput } from "@/components/app/services/shared";
import { Copy, Eye, Plus, Trash2 } from "@/components/icons";
import { ProposalDocument, type ProposalDoc } from "@/components/public/proposal-document";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/app/format";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { DraftBody, ProposalDraft, ProposalSiteDraft } from "../../../../convex/lib/sales/draft";
import { ActionCard } from "./booking-actions";
import { CadencePicker } from "./cadence-picker";
import { CustomerSection } from "./customer-section";
import { Chip, fieldClass, FormSection, ReadyLine, SummaryRow } from "./kit";
import { servicesFor } from "./service-section";
import type { DraftData, Working } from "./use-draft";

type Summary = FunctionReturnType<typeof api.sales.price>;
type Preview = FunctionReturnType<typeof api.proposals.preview>;
type Field = Preview["fields"][number];

function newKey(): string {
  return Math.random().toString(36).slice(2, 8);
}

const FREQUENCIES = [
  { id: "each_visit", label: "Each visit" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "quarterly", label: "Quarterly" },
  { id: "custom", label: "As scheduled" },
] as const;

function DetailInput({ field, value, onChange }: { field: Field; value: string | number | boolean | undefined; onChange: (value: string | number | boolean | undefined) => void }) {
  const label = (
    <span className="font-medium text-strong">
      {field.label}
      {field.customer ? null : <span className="ml-1 text-xs font-normal text-muted-foreground">(office and crew only)</span>}
    </span>
  );
  if (field.kind === "choice")
    return (
      <label className="grid gap-1.5 text-sm">
        {label}
        <select className={fieldClass()} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">Not set</option>
          {field.choices?.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
    );
  if (field.kind === "number")
    return (
      <label className="grid gap-1.5 text-sm">
        {label}
        <input type="number" min={0} className={fieldClass()} value={typeof value === "number" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
      </label>
    );
  if (field.kind === "longtext")
    return (
      <label className="grid gap-1.5 text-sm sm:col-span-2">
        {label}
        <textarea className={fieldClass("min-h-16 py-2")} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)} />
      </label>
    );
  return (
    <label className="grid gap-1.5 text-sm">
      {label}
      <input className={fieldClass()} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)} />
    </label>
  );
}

/** Proposal mode: one client, one or more sites, a recommended plan, terms, then preview and send. */
export function ProposalWorkspace({ data, working, update, setBody, summary, flush, revision }: { data: DraftData; working: Working; update: (change: Partial<Working>) => void; setBody: (change: (body: DraftBody) => DraftBody) => void; summary: Summary | undefined; flush: () => Promise<void>; revision: () => number }) {
  const { companyId, name: companyName } = useCompany();
  const preview = useQuery(api.proposals.preview, { companyId, draftId: data.draft._id });
  const assessments = useQuery(api.assessments.forDraft, { companyId, draftId: data.draft._id });
  const requestAssessment = useMutation(api.assessments.request);
  const applyFindings = useMutation(api.assessments.applyToSite);
  const saveVersion = useMutation(api.proposals.saveVersion);
  const send = useMutation(api.proposals.send);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const proposal: ProposalDraft = working.body.proposal ?? { sites: [], terms: { invoiceFrequency: "monthly", expiresInDays: 30 } };
  const catalog = servicesFor(data.catalog, working.segment);
  const customer = data.customer && data.customer._id === working.customerId ? data.customer : null;
  const setProposal = (change: (p: ProposalDraft) => ProposalDraft) => setBody((b) => ({ ...b, proposal: change(b.proposal ?? { sites: [], terms: {} }) }));
  const setSite = (key: string, patch: Partial<ProposalSiteDraft>) => setProposal((p) => ({ ...p, sites: p.sites.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));
  const sitePrices = summary?.mode === "proposal" ? summary.sitePrices : {};
  const needs = summary?.mode === "proposal" ? summary.needs : [];
  const doneFor = (section: string) => !needs.some((n) => n.section === section && n.blocking);
  const run = (work: () => Promise<string>) => {
    setError(null);
    setDone(null);
    setBusy(true);
    void flush()
      .then(work)
      .then(setDone)
      .catch((caught: unknown) => setError(messageOf(caught)))
      .finally(() => setBusy(false));
  };
  const str = working.segment === "str";

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      <div className="grid gap-5 xl:col-span-8">
        <CustomerSection n={1} data={data} working={working} update={update} setBody={setBody} done={doneFor("customer")} companyId={companyId} />

        <FormSection n={2} id="sites" title={str ? "Properties" : "Sites"} lead={`Each ${str ? "property" : "site"} on this proposal, with its address.`} done={doneFor("sites")}>
          {proposal.sites.map((site, i) => (
            <div key={site.key} className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-strong">Name</span>
                <input className={fieldClass()} value={site.label} placeholder={str ? `Property ${i + 1}` : `Site ${i + 1}`} onChange={(e) => setSite(site.key, { label: e.target.value })} />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-strong">Address</span>
                <select className={fieldClass()} value={site.propertyId ?? ""} onChange={(e) => setSite(site.key, { propertyId: e.target.value || undefined })} disabled={!customer}>
                  <option value="">{customer ? "Choose an address" : "Choose the client first"}</option>
                  {data.properties.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.label ? `${p.label} · ` : ""}
                      {p.address.line1}, {p.address.city}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex justify-end sm:col-span-2">
                <Button size="sm" variant="ghost" onClick={() => setProposal((p) => ({ ...p, sites: p.sites.filter((s) => s.key !== site.key) }))}>
                  <Trash2 aria-hidden className="size-4" /> Remove
                </Button>
              </div>
            </div>
          ))}
          <div>
            <Button size="sm" variant="outline" onClick={() => setProposal((p) => ({ ...p, sites: [...p.sites, { key: newKey(), label: "", ...(str ? { perTurnover: true } : {}) }] }))}>
              <Plus aria-hidden className="size-4" /> Add {str ? "a property" : "a site"}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">Add new addresses to the client in section 1, then choose them here.</p>
          </div>
        </FormSection>

        <FormSection n={3} id="assessment" title="Assessment" lead="Price from information you already have, or send someone to walk the site. The service decides what must be recorded." done={doneFor("assessment")}>
          {proposal.sites.length === 0 ? <p className="text-sm text-muted-foreground">Add a site first.</p> : null}
          {proposal.sites.map((site) => {
            const rows = (assessments ?? []).filter((a) => a.siteKey === site.key);
            const latest = rows[rows.length - 1];
            return (
              <div key={site.key} className="grid gap-2 rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-strong">{site.label || "Site"}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(["not_needed", "needed"] as const).map((choice) => (
                      <label key={choice} className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs ${(site.assessment ?? "not_needed") === choice || (choice === "needed" && (site.assessment === "requested" || site.assessment === "completed")) ? "border-brand-500 bg-brand-500/8 text-strong" : "border-border text-muted-foreground"}`}>
                        <input type="radio" className="sr-only" checked={(site.assessment ?? "not_needed") === choice} onChange={() => setSite(site.key, { assessment: choice })} disabled={site.assessment === "requested" || site.assessment === "completed"} />
                        {choice === "not_needed" ? "Priced from what we know" : "Needs a walkthrough"}
                      </label>
                    ))}
                  </div>
                </div>
                {site.assessment === "needed" ? (
                  <Button size="sm" variant="outline" disabled={busy || !site.propertyId} onClick={() => run(async () => (await requestAssessment({ companyId, draftId: data.draft._id, siteKey: site.key }), "Walkthrough requested. A task was opened to agree the time."))}>
                    Request walkthrough
                  </Button>
                ) : null}
                {latest ? (
                  <div className="grid gap-2 rounded-lg bg-muted/40 p-3 text-sm">
                    <p>
                      <Chip tone={latest.status === "completed" ? "success" : "warning"}>{latest.status}</Chip> {latest.scheduledAt ? new Date(latest.scheduledAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "Time not set"}
                      {latest.assessor ? ` · ${latest.assessor}` : ""}
                    </p>
                    {latest.status !== "completed" ? (
                      <p className="text-xs text-muted-foreground">
                        Records: {latest.required.map((f) => f.label).join("; ")}.
                        {latest.link ? (
                          <button type="button" className="ml-2 inline-flex items-center gap-1 font-medium text-brand-600" onClick={() => void navigator.clipboard.writeText(latest.link!)}>
                            <Copy aria-hidden className="size-3" /> Copy assessor link
                          </button>
                        ) : null}
                      </p>
                    ) : (
                      <>
                        <ul className="grid gap-0.5 text-xs">
                          {latest.required.map((f) => (
                            <li key={f.key}>
                              <span className="text-muted-foreground">{f.label}:</span> {String(latest.findings[f.key] ?? "—")}
                            </li>
                          ))}
                        </ul>
                        {latest.photos.length ? <p className="text-xs text-muted-foreground">{latest.photos.length} photo(s)</p> : null}
                        <div>
                          <Button size="sm" disabled={busy} onClick={() => run(async () => (await applyFindings({ companyId, assessmentId: latest._id, revision: revision() }), "Findings applied to the site's pricing answers. Review the price."))}>
                            {latest.pricingReviewedAt ? "Apply findings again" : "Review and apply findings"}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </FormSection>

        <FormSection n={4} id="plan" title="Service plan" lead="What each site gets and how often. How often you clean is separate from how often you invoice." done={doneFor("sites")}>
          {proposal.sites.map((site) => {
            const spec = data.catalog.find((s) => s.key === site.serviceKey)?.spec ?? null;
            return (
              <div key={site.key} className="grid gap-3 rounded-xl border border-border p-3">
                <p className="text-sm font-semibold text-strong">{site.label || "Site"}</p>
                <label className="grid max-w-md gap-1.5 text-sm">
                  <span className="font-medium text-strong">Service</span>
                  <select className={fieldClass()} value={site.serviceKey ?? ""} onChange={(e) => {
                    const chosen = data.catalog.find((s) => s.key === e.target.value);
                    setSite(site.key, { serviceKey: e.target.value || undefined, input: chosen ? defaultInput(chosen.spec) : undefined });
                  }}>
                    <option value="">Choose a service</option>
                    {catalog.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                {spec && site.serviceKey ? <JobInputs spec={spec} input={site.input ?? {}} onInput={(input) => setSite(site.key, { input })} compact fromBooking /> : null}
                {str ? (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5 accent-brand-500" checked={site.perTurnover !== false} onChange={(e) => setSite(site.key, { perTurnover: e.target.checked })} />
                    <span>
                      <span className="font-medium text-strong">Standing rate per turnover</span>
                      <span className="block text-xs text-muted-foreground">Turnovers are booked from real stays. Uncheck only if the host wants a fixed recurring schedule.</span>
                    </span>
                  </label>
                ) : null}
                {!site.perTurnover ? <CadencePicker name={`cadence-${site.key}`} cadence={site.cadence} onChange={(cadence) => setSite(site.key, { cadence })} /> : null}
                {preview ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {preview.fields.map((field) => (
                      <DetailInput key={field.key} field={field} value={site.details?.[field.key]} onChange={(value) => setSite(site.key, { details: { ...site.details, [field.key]: value as never } })} />
                    ))}
                  </div>
                ) : null}
                {working.segment === "office" ? (
                  <fieldset className="grid gap-2">
                    <legend className="text-sm font-medium text-strong">Task schedule</legend>
                    {(site.matrix ?? []).map((row, i) => (
                      <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2">
                        <input className={fieldClass()} aria-label="Task" value={row.task} onChange={(e) => setSite(site.key, { matrix: (site.matrix ?? []).map((r, j) => (j === i ? { ...r, task: e.target.value } : r)) })} />
                        <select className={fieldClass("w-36")} aria-label="How often" value={row.frequency} onChange={(e) => setSite(site.key, { matrix: (site.matrix ?? []).map((r, j) => (j === i ? { ...r, frequency: e.target.value as typeof row.frequency } : r)) })}>
                          {FREQUENCIES.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                        <Button size="icon-sm" variant="ghost" aria-label="Remove task" onClick={() => setSite(site.key, { matrix: (site.matrix ?? []).filter((_, j) => j !== i) })}>
                          <Trash2 aria-hidden className="size-4" />
                        </Button>
                      </div>
                    ))}
                    <div>
                      <Button size="sm" variant="outline" onClick={() => setSite(site.key, { matrix: [...(site.matrix ?? []), { task: "", frequency: "each_visit" }] })}>
                        <Plus aria-hidden className="size-4" /> Add a task
                      </Button>
                    </div>
                  </fieldset>
                ) : null}
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-strong">Access notes (office and crew only)</span>
                  <textarea className={fieldClass("min-h-14 py-2")} value={site.accessNotes ?? ""} onChange={(e) => setSite(site.key, { accessNotes: e.target.value })} />
                </label>
              </div>
            );
          })}
        </FormSection>

        <FormSection n={5} id="pricing" title="Options & pricing" lead="Prices come from Services & Pricing. A custom rate keeps the calculated one beside it and needs the Owner's approval." done={doneFor("sites")}>
          {proposal.sites.map((site) => {
            const price = sitePrices[site.key];
            return (
              <div key={site.key} className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">
                <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-strong">{site.label || "Site"}</p>
                  <p className="text-sm tabular-nums">
                    Calculated: {price?.cents !== null && price?.cents !== undefined ? <span className="font-semibold">{money(price.cents)}</span> : <Chip tone="warning">{price?.outcome === "walkthrough" ? "Needs a walkthrough" : price?.outcome === "incomplete" ? "Answers missing" : "Not priced yet"}</Chip>}
                  </p>
                </div>
                <MoneyInput label="Custom rate" unit={`per ${site.perTurnover ? "turnover" : "visit"}`} cents={site.customRateCents ?? null} onCents={(cents) => setSite(site.key, { customRateCents: cents ?? undefined })} hint="Leave empty to use the calculated price." />
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-strong">Reason for the custom rate</span>
                  <input className={fieldClass()} value={site.customReason ?? ""} disabled={site.customRateCents === undefined} onChange={(e) => setSite(site.key, { customReason: e.target.value })} />
                </label>
                <MoneyInput label="Initial charge (optional)" unit="once" cents={site.initialChargeCents ?? null} onCents={(cents) => setSite(site.key, { initialChargeCents: cents ?? undefined })} />
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-strong">What the initial charge is for</span>
                  <input className={fieldClass()} placeholder="Initial deep clean and setup" value={site.initialChargeLabel ?? ""} onChange={(e) => setSite(site.key, { initialChargeLabel: e.target.value })} />
                </label>
              </div>
            );
          })}
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium text-strong">Alternatives (optional)</legend>
            <p className="text-xs text-muted-foreground">A real alternative from your services, such as a different service level. The recommended plan above is always shown first.</p>
            {(proposal.options ?? []).map((option, i) => (
              <div key={option.id} className="grid gap-2 rounded-xl border border-border p-3">
                <div className="flex gap-2">
                  <input className={fieldClass()} aria-label="Alternative name" value={option.label} placeholder={`Alternative ${i + 1}`} onChange={(e) => setProposal((p) => ({ ...p, options: (p.options ?? []).map((o) => (o.id === option.id ? { ...o, label: e.target.value } : o)) }))} />
                  <Button size="icon-sm" variant="ghost" aria-label="Remove alternative" onClick={() => setProposal((p) => ({ ...p, options: (p.options ?? []).filter((o) => o.id !== option.id) }))}>
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </div>
                {proposal.sites.map((site) => (
                  <label key={site.key} className="grid gap-1 text-sm sm:grid-cols-[10rem_1fr] sm:items-center">
                    <span className="text-muted-foreground">{site.label || "Site"}</span>
                    <select className={fieldClass()} value={option.siteServiceKeys?.[site.key] ?? ""} onChange={(e) => setProposal((p) => ({ ...p, options: (p.options ?? []).map((o) => (o.id === option.id ? { ...o, siteServiceKeys: { ...o.siteServiceKeys, [site.key]: e.target.value } } : o)) }))}>
                      <option value="">Choose a service</option>
                      {catalog.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            ))}
            {(proposal.options ?? []).length < 3 ? (
              <div>
                <Button size="sm" variant="outline" onClick={() => setProposal((p) => ({ ...p, options: [...(p.options ?? []), { id: newKey(), label: "" }] }))}>
                  <Plus aria-hidden className="size-4" /> Add an alternative
                </Button>
              </div>
            ) : null}
          </fieldset>
        </FormSection>

        <FormSection n={6} id="terms" title="Terms & start plan" lead="Billing, agreement length and how service starts." done={doneFor("terms")}>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-strong">Invoicing</span>
              <select className={fieldClass()} value={proposal.terms.invoiceFrequency ?? ""} onChange={(e) => setProposal((p) => ({ ...p, terms: { ...p.terms, invoiceFrequency: (e.target.value || undefined) as ProposalDraft["terms"]["invoiceFrequency"] } }))}>
                <option value="">Choose</option>
                <option value="per_visit">After each visit</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-strong">Payment due (days)</span>
              <input type="number" min={0} max={90} className={fieldClass()} value={proposal.terms.netDays ?? ""} onChange={(e) => setProposal((p) => ({ ...p, terms: { ...p.terms, netDays: e.target.value === "" ? undefined : Number(e.target.value) } }))} />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-strong">Agreement length (months)</span>
              <input type="number" min={0} max={60} className={fieldClass()} placeholder="0 = month to month" value={proposal.terms.contractTermMonths ?? ""} onChange={(e) => setProposal((p) => ({ ...p, terms: { ...p.terms, contractTermMonths: e.target.value === "" ? undefined : Number(e.target.value) } }))} />
            </label>
          </div>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-strong">How service starts</span>
            <textarea className={fieldClass("min-h-16 py-2")} placeholder="For example: a walkthrough with your facilities lead, then the first visit the following Monday." value={proposal.terms.startPlan ?? ""} onChange={(e) => setProposal((p) => ({ ...p, terms: { ...p.terms, startPlan: e.target.value } }))} />
          </label>
          {proposal.sites.length > 1 ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 accent-brand-500" checked={proposal.terms.startTogether === true} onChange={(e) => setProposal((p) => ({ ...p, terms: { ...p.terms, startTogether: e.target.checked } }))} />
              <span className="font-medium text-strong">All sites start together</span>
            </label>
          ) : null}
          {str ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-strong">Rush or same-day terms</span>
                <textarea className={fieldClass("min-h-16 py-2")} value={proposal.terms.rushTerms ?? ""} onChange={(e) => setProposal((p) => ({ ...p, terms: { ...p.terms, rushTerms: e.target.value } }))} />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-strong">Restocking policy</span>
                <textarea className={fieldClass("min-h-16 py-2")} value={proposal.terms.restockPolicy ?? ""} onChange={(e) => setProposal((p) => ({ ...p, terms: { ...p.terms, restockPolicy: e.target.value } }))} />
              </label>
            </div>
          ) : null}
          <label className="grid max-w-xs gap-1.5 text-sm">
            <span className="font-medium text-strong">Open for (days)</span>
            <input type="number" min={1} max={120} className={fieldClass()} value={proposal.terms.expiresInDays ?? 30} onChange={(e) => setProposal((p) => ({ ...p, terms: { ...p.terms, expiresInDays: Number(e.target.value) } }))} />
          </label>
        </FormSection>

        <FormSection n={7} id="review" title="Presentation & review" lead="What the client reads, then save a version and send it.">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-strong">Personal introduction</span>
            <textarea className={fieldClass("min-h-20 py-2")} value={proposal.intro ?? ""} onChange={(e) => setProposal((p) => ({ ...p, intro: e.target.value }))} />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <ActionCard title="Preview" creates="Shows exactly what the client will read. Internal notes, access details, calculated reference prices and reasons are never shown.">
              <Button variant="outline" onClick={() => setShowPreview((v) => !v)}>
                <Eye aria-hidden className="size-4" /> {showPreview ? "Hide preview" : "Show preview"}
              </Button>
            </ActionCard>
            <ActionCard title="Save version" creates="Freezes this proposal as a numbered version. Custom rates go to the Owner to approve exactly this version." pending="Sending.">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const result = await saveVersion({ companyId, draftId: data.draft._id, revision: revision() });
                    return `Saved as version ${result.version}.${result.waitingForApproval ? " Waiting for the Owner to approve the custom rates." : ""}${result.unresolved.length ? ` Still unresolved: ${result.unresolved.join("; ")}.` : ""}`;
                  })
                }
              >
                Save version
              </Button>
            </ActionCard>
            <ActionCard title="Send proposal" creates="Emails the client a secure link to the saved version. They can accept, ask for changes or decline." pending="The client's answer, then the agreement, billing and each site's start.">
              <Button
                disabled={busy || !preview?.proposal || preview.proposal.latestVersion === 0 || preview.content.unresolved.length > 0}
                onClick={() =>
                  run(async () => {
                    const result = await send({ companyId, proposalId: preview!.proposal!._id as Id<"proposals">, version: preview!.proposal!.latestVersion });
                    if (result.url) void navigator.clipboard.writeText(result.url).catch(() => undefined);
                    return result.url ? "Sent. The client's link is copied." : "Sent.";
                  })
                }
              >
                Send proposal
              </Button>
            </ActionCard>
          </div>
          {showPreview && preview ? (
            <div className="rounded-2xl border border-border bg-background p-4">
              <ProposalDocument doc={preview.content as unknown as ProposalDoc} company={companyName} version={preview.proposal?.latestVersion ?? null} expiresAt={null} />
            </div>
          ) : null}
          {done ? (
            <p role="status" className="rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-sm text-success-foreground">
              {done}
            </p>
          ) : null}
          <FormError message={error} />
        </FormSection>
      </div>
      <aside className="xl:col-span-4" aria-label="Proposal summary">
        <div className="xl:sticky xl:top-24">
          <ProposalSummary preview={preview} />
        </div>
      </aside>
    </div>
  );
}

function ProposalSummary({ preview }: { preview: Preview | undefined }) {
  if (!preview) return <Skeleton className="h-80 rounded-2xl" />;
  const { content, proposal } = preview;
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_8px_30px_-16px_color-mix(in_oklab,var(--color-brand-500)_40%,transparent)]">
      <div className="bg-gradient-to-br from-brand-600 via-brand-500 to-[#8b6cff] px-5 py-4 text-white">
        <p className="text-xs font-semibold tracking-wide uppercase opacity-90">Live proposal</p>
        <p className="mt-1 text-sm">{content.client.name}</p>
        <p className="mt-2 font-heading text-2xl tabular-nums">{content.totals.fixedMonthlyEstimateCents !== null ? `~${money(content.totals.fixedMonthlyEstimateCents)}/mo` : content.totals.anyVariable ? "Per turnover" : "—"}</p>
        <p className="text-xs opacity-85">{content.totals.fixedMonthlyEstimateCents !== null ? "Estimate from the real number of visits; invoiced for visits done" : "No monthly total is promised"}</p>
      </div>
      <div className="grid gap-4 px-5 py-4">
        <dl className="grid gap-1.5">
          {content.sites.map((site) => (
            <SummaryRow key={site.key} label={`${site.label}${site.cadence ? ` · ${site.cadence}` : ""}`} value={site.priceCents !== null ? `${money(site.priceCents)}/${site.perTurnover ? "turnover" : "visit"}` : "Unresolved"} muted={site.priceCents === null} />
          ))}
          {content.totals.initialCents ? <SummaryRow label="Initial charges" value={money(content.totals.initialCents)} /> : null}
        </dl>
        <ul className="grid gap-2">
          <ReadyLine label="Rates" state={content.unresolved.some((u) => /rate|walkthrough|service/.test(u)) ? "waiting" : "done"} detail={content.customRates ? (proposal?.approval?.state === "approved" ? "Custom rates approved by the Owner." : proposal?.approval?.state === "waiting" ? "Custom rates waiting for the Owner." : preview.canApproveRates ? "Your custom rates apply when you save." : "Custom rates need the Owner's approval when saved.") : "Calculated from Services & Pricing."} />
          <ReadyLine label="Status" state={proposal?.status === "accepted" ? "done" : proposal ? "waiting" : "unknown"} detail={proposal ? `${proposal.statusWords}${proposal.latestVersion ? ` · v${proposal.latestVersion}` : ""}${proposal.viewCount ? ` · opened ${proposal.viewCount}×` : ""}${proposal.expiresAt ? ` · open until ${new Date(proposal.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}` : "Not saved yet."} />
        </ul>
        {content.unresolved.length ? (
          <div className="rounded-lg border border-warning/30 bg-warning/8 p-3">
            <p className="text-xs font-semibold text-warning-foreground">Still needed</p>
            <ul className="mt-1 grid gap-1 text-sm text-strong">
              {content.unresolved.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-sm text-success-foreground">Ready to save and send.</p>
        )}
      </div>
    </section>
  );
}
