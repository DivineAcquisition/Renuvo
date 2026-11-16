"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/shell";
import { AlertTriangle, ArrowRight, CircleCheckIcon, Download, ShieldCheck } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * Settings → Trust & Compliance. What the company is ready to do, and for each thing it is not, the
 * exact missing piece and where to fix it. Only the operation a gap affects is blocked: a missing
 * texting registration stops texts, not email or the rest of the workspace. Every check shown here is
 * the same one the server runs before a message goes out.
 */
export function ComplianceScreen() {
  return (
    <>
      <PageHeader title="Trust & Compliance" lead="Who your business is, how it contacts people, what it has agreed to, and what it is ready to do." />
      <div className="grid gap-5">
        <Readiness />
        <Identity />
        <Messaging />
        <Disclosures />
        <AgentAuthority />
        <DataAndConnections />
        <AgreementsPanel />
      </div>
    </>
  );
}

const STATE: Record<"ready" | "blocked" | "attention", { label: string; variant: "success" | "error" | "warning" }> = {
  ready: { label: "Ready", variant: "success" },
  blocked: { label: "Blocked", variant: "error" },
  attention: { label: "Needs attention", variant: "warning" },
};

function Readiness() {
  const company = useCompany();
  const readiness = useQuery(api.compliance.readiness, { companyId: company.companyId });
  return (
    <Panel title="Readiness">
      {readiness === undefined ? (
        <div className="grid gap-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : (
        <ul className="grid gap-2.5" aria-label="What the company is ready to do">
          {readiness.operations.map((operation) => {
            const state = STATE[operation.state];
            return (
              <li key={operation.key} className="rounded-xl border border-border bg-background/60 px-3.5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-semibold text-strong">
                    {operation.state === "ready" ? <CircleCheckIcon className="size-4 text-success-foreground" aria-hidden /> : <AlertTriangle className="size-4 text-warning-foreground" aria-hidden />}
                    {operation.label}
                  </p>
                  <Badge variant={state.variant}>{state.label}</Badge>
                </div>
                {operation.blockers.length > 0 ? (
                  <ul className="mt-2 grid gap-1.5">
                    {operation.blockers.map((blocker) => (
                      <li key={blocker.key} className="text-sm leading-relaxed">
                        <span className="text-strong">{blocker.words}</span> <span className="text-muted-foreground">{blocker.next}</span>{" "}
                        {blocker.href ? (
                          <Link href={blocker.href} className="inline-flex items-center gap-0.5 font-medium text-brand-600 underline-offset-2 hover:underline">
                            Fix
                            <ArrowRight className="size-3.5" aria-hidden />
                          </Link>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

type Profile = NonNullable<ReturnType<typeof useProfile>>;
function useProfile() {
  const company = useCompany();
  return useQuery(api.compliance.profile, { companyId: company.companyId });
}

function OwnerOnly({ owner }: { owner: boolean }) {
  return owner ? null : <p className="text-xs text-muted-foreground">Only the Owner changes these.</p>;
}

function Identity() {
  const profile = useProfile();
  return (
    <section id="identity" className="scroll-mt-20">
      <Panel title="Business identity">{profile === undefined ? <Skeleton className="h-40" /> : <IdentityForm profile={profile} />}</Panel>
    </section>
  );
}

function IdentityForm({ profile }: { profile: Profile }) {
  const company = useCompany();
  const owner = company.role === "owner";
  const update = useMutation(api.compliance.updateIdentity);
  const { busy, error, run } = useRun();
  const [saved, setSaved] = useState(false);
  const identity = profile.identity;
  const [form, setForm] = useState({
    legalName: identity.legalName ?? "",
    tradingName: identity.tradingName ?? "",
    line1: identity.address?.line1 ?? "",
    line2: identity.address?.line2 ?? "",
    city: identity.address?.city ?? "",
    region: identity.address?.region ?? "",
    postalCode: identity.address?.postalCode ?? "",
    country: (identity.address?.country ?? "US") as "US" | "CA",
    repName: identity.representative?.name ?? "",
    repTitle: identity.representative?.title ?? "",
    repEmail: identity.representative?.email ?? "",
    supportEmail: identity.supportEmail ?? "",
    supportPhone: identity.supportPhone ?? "",
  });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };
  const hasAddress = form.line1.trim() || form.city.trim() || form.region.trim() || form.postalCode.trim();
  const hasRep = form.repName.trim() || form.repTitle.trim() || form.repEmail.trim();
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await update({
            companyId: company.companyId,
            legalName: form.legalName,
            tradingName: form.tradingName,
            supportEmail: form.supportEmail,
            supportPhone: form.supportPhone,
            ...(hasAddress ? { address: { line1: form.line1, line2: form.line2 || undefined, city: form.city, region: form.region, postalCode: form.postalCode, country: form.country } } : {}),
            ...(hasRep ? { representative: { name: form.repName, title: form.repTitle, email: form.repEmail } } : {}),
          });
          setSaved(true);
        });
      }}
    >
      <p className="text-sm text-muted-foreground sm:col-span-2">The business people are dealing with when they hear from you, and who answers for its messages. Carriers check these against your registration.</p>
      <Field label="Legal name" hint="As registered.">
        <TextInput value={form.legalName} onChange={set("legalName")} disabled={!owner} autoComplete="organization" />
      </Field>
      <Field label="Trading name" hint="If customers know you by another name.">
        <TextInput value={form.tradingName} onChange={set("tradingName")} disabled={!owner} />
      </Field>
      <Field label="Street address" className="sm:col-span-2">
        <TextInput value={form.line1} onChange={set("line1")} disabled={!owner} autoComplete="address-line1" />
      </Field>
      <Field label="Address line 2">
        <TextInput value={form.line2} onChange={set("line2")} disabled={!owner} autoComplete="address-line2" />
      </Field>
      <Field label="City">
        <TextInput value={form.city} onChange={set("city")} disabled={!owner} autoComplete="address-level2" />
      </Field>
      <Field label="State or province">
        <TextInput value={form.region} onChange={set("region")} disabled={!owner} autoComplete="address-level1" />
      </Field>
      <Field label="Postal code">
        <TextInput value={form.postalCode} onChange={set("postalCode")} disabled={!owner} autoComplete="postal-code" />
      </Field>
      <Field label="Country">
        <SelectInput value={form.country} onChange={set("country")} disabled={!owner}>
          <option value="US">United States</option>
          <option value="CA">Canada</option>
        </SelectInput>
      </Field>
      <span className="hidden sm:block" />
      <Field label="Authorised representative">
        <TextInput value={form.repName} onChange={set("repName")} disabled={!owner} placeholder="Full name" />
      </Field>
      <Field label="Their title">
        <TextInput value={form.repTitle} onChange={set("repTitle")} disabled={!owner} placeholder="Owner, Operations Manager…" />
      </Field>
      <Field label="Their email">
        <TextInput type="email" value={form.repEmail} onChange={set("repEmail")} disabled={!owner} />
      </Field>
      <span className="hidden sm:block" />
      <Field label="Support email" hint="Where people can ask for help. Texts that answer HELP name this or the phone.">
        <TextInput type="email" value={form.supportEmail} onChange={set("supportEmail")} disabled={!owner} />
      </Field>
      <Field label="Support phone" hint="International form, for example +15125550100.">
        <TextInput type="tel" value={form.supportPhone} onChange={set("supportPhone")} disabled={!owner} />
      </Field>
      <div className="grid gap-2 sm:col-span-2">
        <FormError message={error} />
        {saved ? <p role="status" className="text-sm text-success-foreground">Saved.</p> : null}
        {owner ? (
          <div>
            <Button type="submit" variant="primary" size="sm" loading={busy}>
              Save business identity
            </Button>
          </div>
        ) : (
          <OwnerOnly owner={owner} />
        )}
      </div>
    </form>
  );
}

const REGISTRATION: Record<string, { label: string; variant: "success" | "error" | "warning" | "info" }> = {
  not_started: { label: "Not started", variant: "warning" },
  submitted: { label: "Submitted, waiting for the carrier", variant: "info" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "error" },
};

function Messaging() {
  const profile = useProfile();
  return (
    <section id="messaging" className="scroll-mt-20">
      <Panel title="Messaging">
        {profile === undefined ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="grid gap-6">
            {profile.suspendedAt ? (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
                Selestial has suspended sending for this company. Nothing is texted or emailed until that is lifted. Write to support to ask why.
              </p>
            ) : null}
            <MessagingForm profile={profile} />
            <Registration profile={profile} />
          </div>
        )}
      </Panel>
    </section>
  );
}

function MessagingForm({ profile }: { profile: Profile }) {
  const company = useCompany();
  const owner = company.role === "owner";
  const update = useMutation(api.compliance.updateMessaging);
  const { busy, error, run } = useRun();
  const [saved, setSaved] = useState(false);
  const m = profile.messaging;
  const [form, setForm] = useState({
    senderName: m.senderName ?? "",
    smsNumber: m.smsNumber ?? "",
    emailFromAddress: m.emailFromAddress ?? "",
    quiet: m.quietHours !== null,
    start: m.quietHours?.start ?? "21:00",
    end: m.quietHours?.end ?? "08:00",
    operational: m.quietHours?.appliesToOperational ?? false,
    marketing: String(m.frequency.marketingPerWeek),
    recruiting: String(m.frequency.recruitingPerWeek),
  });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false);
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
  };
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await update({
            companyId: company.companyId,
            senderName: form.senderName,
            smsNumber: form.smsNumber,
            emailFromAddress: form.emailFromAddress,
            quietHours: form.quiet ? { start: form.start, end: form.end, appliesToOperational: form.operational } : null,
            frequency: { marketingPerWeek: Number(form.marketing), recruitingPerWeek: Number(form.recruiting) },
          });
          setSaved(true);
        });
      }}
    >
      <Field label="Sender name" hint="Every text names your business.">
        <TextInput value={form.senderName} onChange={set("senderName")} disabled={!owner} maxLength={60} />
      </Field>
      <Field label="Texting number" hint="Your number with the texting provider. Changing it means registering again.">
        <TextInput type="tel" value={form.smsNumber} onChange={set("smsNumber")} disabled={!owner} placeholder="+15125550100" />
      </Field>
      <Field label="Emails are sent from" className="sm:col-span-2">
        <TextInput type="email" value={form.emailFromAddress} onChange={set("emailFromAddress")} disabled={!owner} />
      </Field>
      <fieldset className="grid gap-3 rounded-xl border border-border p-3.5 sm:col-span-2 sm:grid-cols-2">
        <legend className="px-1 text-sm font-medium text-strong">Quiet hours</legend>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.quiet} onChange={set("quiet")} disabled={!owner} className="size-4 accent-[#6838ef]" />
          Hold marketing and recruiting texts during quiet hours
        </label>
        {form.quiet ? (
          <>
            <Field label="From" hint={`On your company clock (${company.timezone}).`}>
              <TextInput type="time" value={form.start} onChange={set("start")} disabled={!owner} />
            </Field>
            <Field label="Until">
              <TextInput type="time" value={form.end} onChange={set("end")} disabled={!owner} />
            </Field>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={form.operational} onChange={set("operational")} disabled={!owner} className="mt-0.5 size-4 accent-[#6838ef]" />
              <span>
                Hold work texts too
                <span className="block text-xs text-muted-foreground">Visit changes and offers to cleaners would wait until the morning.</span>
              </span>
            </label>
          </>
        ) : null}
      </fieldset>
      <Field label="Marketing texts per person per week" hint="The most anyone receives. 0 sends none.">
        <TextInput type="number" min={0} max={14} value={form.marketing} onChange={set("marketing")} disabled={!owner} />
      </Field>
      <Field label="Recruiting texts per person per week">
        <TextInput type="number" min={0} max={14} value={form.recruiting} onChange={set("recruiting")} disabled={!owner} />
      </Field>
      <div className="grid gap-2 sm:col-span-2">
        <FormError message={error} />
        {saved ? <p role="status" className="text-sm text-success-foreground">Saved.</p> : null}
        {owner ? (
          <div>
            <Button type="submit" variant="primary" size="sm" loading={busy}>
              Save messaging
            </Button>
          </div>
        ) : (
          <OwnerOnly owner={owner} />
        )}
      </div>
    </form>
  );
}

function Registration({ profile }: { profile: Profile }) {
  const company = useCompany();
  const owner = company.role === "owner";
  const record = useMutation(api.compliance.recordRegistration);
  const { busy, error, run } = useRun();
  const [reference, setReference] = useState(profile.messaging.registration.reference ?? "");
  const registration = profile.messaging.registration;
  const shown = REGISTRATION[registration.status] ?? REGISTRATION.not_started;
  return (
    <div id="registration" className="grid scroll-mt-20 gap-3 border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-strong">Carrier registration</h3>
        <Badge variant={shown.variant}>{shown.label}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Carriers in the US and Canada must approve a business before its texts are delivered. Submit the registration with your texting provider, then record it here. Selestial marks it approved only after checking with the provider.
      </p>
      {registration.note ? <p className="rounded-lg bg-overlay/[0.04] px-3 py-2 text-sm text-strong">{registration.note}</p> : null}
      {owner && registration.status !== "approved" ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => record({ companyId: company.companyId, status: "submitted", reference }));
          }}
        >
          <Field label="Provider's reference" className="min-w-56 flex-1">
            <TextInput value={reference} onChange={(event) => setReference(event.target.value)} />
          </Field>
          <Button type="submit" size="sm" loading={busy}>
            {registration.status === "submitted" ? "Update the reference" : "I have submitted it"}
          </Button>
        </form>
      ) : null}
      <FormError message={error} />
    </div>
  );
}

const CATEGORY_LABEL: Record<string, string> = { operational: "Work messages", marketing: "Marketing", recruiting: "Recruiting" };
const CHANNEL_LABEL: Record<string, string> = { sms: "Texts", email: "Email" };

function Disclosures() {
  const company = useCompany();
  const owner = company.role === "owner";
  const rows = useQuery(api.compliance.disclosures, { companyId: company.companyId });
  const add = useMutation(api.compliance.addDisclosure);
  const { busy, error, run } = useRun();
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [category, setCategory] = useState<"operational" | "marketing" | "recruiting">("marketing");
  const [words, setWords] = useState("");
  const latest = new Map<string, NonNullable<typeof rows>[number]>();
  for (const row of rows ?? []) {
    const key = `${row.channel}:${row.category}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  return (
    <section id="disclosures" className="scroll-mt-20">
      <Panel title="Consent wording">
        <p className="text-sm text-muted-foreground">
          The exact words people see when they agree to hear from you. Every permission points at the version they saw, so changing the wording adds a new version and keeps the old one. No marketing text goes out without wording on file.
        </p>
        {rows === undefined ? (
          <Skeleton className="mt-3 h-20" />
        ) : latest.size === 0 ? (
          <p className="mt-3 text-sm text-strong">No wording on file yet.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {[...latest.values()].map((row) => (
              <li key={row._id} className="rounded-xl border border-border px-3.5 py-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {CHANNEL_LABEL[row.channel]} · {CATEGORY_LABEL[row.category]} · version {row.version}
                </p>
                <p className="mt-1 text-sm text-strong">{row.text}</p>
              </li>
            ))}
          </ul>
        )}
        {owner ? (
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await add({ companyId: company.companyId, channel, category, text: words });
                setWords("");
              });
            }}
          >
            <Field label="Channel">
              <SelectInput value={channel} onChange={(event) => setChannel(event.target.value as "sms" | "email")}>
                <option value="sms">Texts</option>
                <option value="email">Email</option>
              </SelectInput>
            </Field>
            <Field label="Kind of message">
              <SelectInput value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>
                <option value="operational">Work messages</option>
                <option value="marketing">Marketing</option>
                <option value="recruiting">Recruiting</option>
              </SelectInput>
            </Field>
            <Field label="Wording" className="sm:col-span-2" hint="Name your business, what you will send, that rates may apply, and that replying STOP ends it and HELP gets help.">
              <TextArea value={words} onChange={(event) => setWords(event.target.value)} required maxLength={2000} />
            </Field>
            <div className="grid gap-2 sm:col-span-2">
              <FormError message={error} />
              <div>
                <Button type="submit" size="sm" loading={busy} disabled={!words.trim()}>
                  Add as a new version
                </Button>
              </div>
            </div>
          </form>
        ) : null}
      </Panel>
    </section>
  );
}

function AgentAuthority() {
  return (
    <Panel title="Agent authority">
      <div className="grid gap-2 text-sm">
        <p className="text-muted-foreground">What each agent may do on its own, what needs a person to approve, and what it never does, is set per agent in Settings. Whatever is set there, the sending checks above still apply to every message an agent sends.</p>
        <ul className="grid gap-1.5 text-strong">
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />A paused agent sends nothing. A person can still send.
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />A message is checked when it is planned and again at the moment it is sent, so a STOP that arrives in between still stops it.
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />Every action an agent takes is written to the activity log with what it was based on.
          </li>
        </ul>
        <Link href="/app/settings#agents" className="inline-flex items-center gap-1 font-medium text-brand-600 underline-offset-2 hover:underline">
          Open agent permissions
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </Panel>
  );
}

function DataAndConnections() {
  const company = useCompany();
  if (company.role !== "owner") {
    return (
      <section id="data" className="scroll-mt-20">
        <Panel title="Your data">
          <p className="text-sm text-muted-foreground">The Owner can download everything the company holds, erase a person&rsquo;s details, or ask for the company to be deleted.</p>
        </Panel>
      </section>
    );
  }
  return (
    <section id="data" className="scroll-mt-20">
      <Panel title="Your data">
        <div className="grid gap-6">
          <Exports />
          <Erase />
          <CompanyDeletion />
        </div>
      </Panel>
    </section>
  );
}

const when = (at: number) => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Exports() {
  const company = useCompany();
  const rows = useQuery(api.dataRights.exports, { companyId: company.companyId });
  const request = useMutation(api.dataRights.requestExport);
  const download = useMutation(api.dataRights.downloadUrl);
  const { busy, error, run } = useRun();
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-strong">Download everything</h3>
          <p className="text-sm text-muted-foreground">One file with every record the company holds. The link works for 24 hours.</p>
        </div>
        <Button size="sm" loading={busy} onClick={() => void run(() => request({ companyId: company.companyId }))}>
          <Download className="size-4" aria-hidden />
          Prepare an export
        </Button>
      </div>
      <FormError message={error} />
      {rows && rows.length > 0 ? (
        <ul className="grid gap-1.5">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="text-strong">Asked for {when(row.createdAt)}</span>
              {row.status === "ready" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void run(async () => {
                      const { url } = await download({ companyId: company.companyId, exportId: row.id });
                      window.location.assign(url);
                    })
                  }
                >
                  Download
                </Button>
              ) : (
                <span className="text-muted-foreground">{row.status === "preparing" ? "Being prepared" : row.status === "expired" ? "Expired" : (row.problem ?? "Failed")}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Erase() {
  const company = useCompany();
  const [kind, setKind] = useState<"customer" | "cleaner">("customer");
  const [target, setTarget] = useState("");
  const [confirm, setConfirm] = useState("");
  const customers = useQuery(api.customers.list, kind === "customer" ? { companyId: company.companyId } : "skip");
  const cleaners = useQuery(api.cleaners.list, kind === "cleaner" ? { companyId: company.companyId } : "skip");
  const eraseCustomer = useMutation(api.dataRights.eraseCustomer);
  const eraseCleaner = useMutation(api.dataRights.eraseCleaner);
  const history = useQuery(api.dataRights.deletions, { companyId: company.companyId });
  const { busy, error, run } = useRun();
  const [done, setDone] = useState(false);
  const people = (kind === "customer" ? customers : cleaners) ?? [];
  return (
    <div className="grid gap-3 border-t border-border pt-5">
      <div>
        <h3 className="text-sm font-semibold text-strong">Erase a person&rsquo;s details</h3>
        <p className="text-sm text-muted-foreground">Removes their name, contact details and notes, and keeps a record that it was done. Visits and amounts stay, without the person. This cannot be undone.</p>
      </div>
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          setDone(false);
          void run(async () => {
            if (kind === "customer") await eraseCustomer({ companyId: company.companyId, customerId: target as Id<"customers">, confirm: "ERASE" });
            else await eraseCleaner({ companyId: company.companyId, cleanerId: target as Id<"cleaners">, confirm: "ERASE" });
            setTarget("");
            setConfirm("");
            setDone(true);
          });
        }}
      >
        <Field label="Who">
          <SelectInput
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as "customer" | "cleaner");
              setTarget("");
            }}
          >
            <option value="customer">A customer</option>
            <option value="cleaner">A cleaner</option>
          </SelectInput>
        </Field>
        <Field label="Person">
          <SelectInput value={target} onChange={(event) => setTarget(event.target.value)} required>
            <option value="">Choose</option>
            {people.map((person) => (
              <option key={person._id} value={person._id}>
                {person.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label='Type "ERASE" to confirm'>
          <TextInput value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="off" />
        </Field>
        <div className="grid gap-2 sm:col-span-3">
          <FormError message={error} />
          {done ? <p role="status" className="text-sm text-success-foreground">Erased.</p> : null}
          <div>
            <Button type="submit" size="sm" variant="destructive-outline" loading={busy} disabled={!target || confirm !== "ERASE"}>
              Erase
            </Button>
          </div>
        </div>
      </form>
      {history && history.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Erased so far ({history.length})</summary>
          <ul className="mt-2 grid gap-1">
            {history.map((row) => (
              <li key={row._id} className="text-muted-foreground">
                {when(row.at)} · {row.subject.kind === "customer" ? "A customer" : "A cleaner"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function CompanyDeletion() {
  const company = useCompany();
  const ask = useMutation(api.dataRights.requestCompanyDeletion);
  const { busy, error, run } = useRun();
  const [note, setNote] = useState("");
  const [reference, setReference] = useState<string | null>(null);
  return (
    <div className="grid gap-3 border-t border-border pt-5">
      <div>
        <h3 className="text-sm font-semibold text-strong">Delete the company</h3>
        <p className="text-sm text-muted-foreground">A person at Selestial handles this, so nothing is lost by a mistaken click. Download an export first if you want to keep anything.</p>
      </div>
      {reference ? (
        <p role="status" className="text-sm text-strong">
          Asked. Your reference is <span className="font-mono font-semibold">{reference}</span>.
        </p>
      ) : (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const result = await ask({ companyId: company.companyId, note: note || undefined });
              setReference(result.reference);
            });
          }}
        >
          <Field label="Anything we should know">
            <TextArea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} />
          </Field>
          <FormError message={error} />
          <div>
            <Button type="submit" size="sm" variant="destructive-outline" loading={busy}>
              Ask Selestial to delete the company
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Where the company stands on Selestial's Terms, and the Owner's way to accept the version in force. */
export function AgreementsPanel() {
  const company = useCompany();
  const status = useQuery(api.agreements.status, { companyId: company.companyId });
  const accept = useMutation(api.agreements.accept);
  const { busy, error, run } = useRun();
  const [read, setRead] = useState(false);
  const owner = company.role === "owner";
  return (
    <section id="agreements" className="scroll-mt-20">
      <Panel title="Agreements">
        {status === undefined ? (
          <Skeleton className="h-16" />
        ) : (
          <div className="grid gap-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-strong">{status.terms.title}</p>
              <Badge variant={status.terms.current ? "success" : "warning"}>{status.terms.current ? "Accepted" : "Not accepted"}</Badge>
            </div>
            <p className="text-muted-foreground">
              Version in effect from {status.terms.effectiveOn}.{" "}
              {status.terms.latestAcceptance ? `Last accepted by ${status.terms.latestAcceptance.acceptedByName} on ${when(status.terms.latestAcceptance.at)}.` : "Nobody has accepted it yet."}{" "}
              <a href="/terms" target="_blank" rel="noreferrer" className="font-medium text-brand-600 underline-offset-2 hover:underline">
                Read the Terms
              </a>
            </p>
            {!status.terms.current && owner ? (
              <form
                className="grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(() => accept({ companyId: company.companyId, documentId: status.terms.documentId }));
                }}
              >
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={read} onChange={(event) => setRead(event.target.checked)} className="mt-0.5 size-4 accent-[#6838ef]" />
                  <span className="text-strong">I have read the {status.terms.title} and accept them for {company.name}.</span>
                </label>
                <FormError message={error} />
                <div>
                  <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!read}>
                    Accept
                  </Button>
                </div>
              </form>
            ) : !status.terms.current ? (
              <p className="text-muted-foreground">Only the Owner accepts the Terms.</p>
            ) : null}
          </div>
        )}
      </Panel>
    </section>
  );
}

/** A link from the main Settings page. */
export function ComplianceLink() {
  return (
    <Link href="/app/settings/compliance" className="group flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-4 transition-colors hover:border-brand-500/40 sm:px-5">
      <span>
        <span className="flex items-center gap-2 font-heading text-base text-strong">
          <ShieldCheck className="size-4.5 text-brand-600" aria-hidden />
          Trust &amp; Compliance
        </span>
        <span className="mt-0.5 block text-sm text-muted-foreground">Business identity, texting setup, consent wording, your data and agreements.</span>
      </span>
      <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}
