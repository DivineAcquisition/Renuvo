"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/app/format";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type Variant = NonNullable<BadgeProps["variant"]>;
const STATUS: Record<string, { label: string; variant: Variant }> = {
  requested: { label: "Waiting for Selestial", variant: "info" },
  approved: { label: "Approved · starting", variant: "info" },
  provisioning: { label: "Setting up", variant: "info" },
  waiting_on_carriers: { label: "Waiting on the carriers", variant: "warning" },
  active: { label: "Active", variant: "success" },
  failed: { label: "Stopped", variant: "error" },
  rejected: { label: "Turned down", variant: "error" },
  cancelled: { label: "Withdrawn", variant: "outline" },
};

const VERTICALS = [
  { id: "PROFESSIONAL", label: "Professional services (cleaning companies usually choose this)" },
  { id: "REAL_ESTATE", label: "Real estate" },
  { id: "HOSPITALITY", label: "Hospitality" },
  { id: "CONSTRUCTION", label: "Construction" },
  { id: "RETAIL", label: "Retail" },
  { id: "TECHNOLOGY", label: "Technology" },
];

const consentFor = (company: string) =>
  `I agree to receive work texts from ${company} about job offers, confirmations, reminders and check-ins at the number I provided. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out. Consent is not a condition of working with us.`;

function Current({ request }: { request: NonNullable<ReturnType<typeof useMine>> }) {
  const { companyId, role } = useCompany();
  const cancel = useMutation(api.texting.cancel);
  const { busy, error, run } = useRun();
  const status = STATUS[request.status] ?? { label: request.status, variant: "outline" as Variant };
  return (
    <div className="grid gap-2 rounded-xl border border-border bg-background px-3.5 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          <span className="font-medium text-strong">{request.phoneNumber}</span>
          <span className="text-muted-foreground"> · for {request.brand.displayName}</span>
        </p>
        <Badge variant={status.variant} size="sm">
          {status.label}
        </Badge>
      </div>
      {request.step ? <p className="text-strong">{request.step}</p> : null}
      {request.problem ? <p className="text-destructive-foreground">{request.problem}</p> : null}
      {request.note ? <p className="text-xs text-muted-foreground">Selestial’s note: {request.note}</p> : null}
      {request.status === "waiting_on_carriers" ? <p className="text-xs text-muted-foreground">Carriers usually answer within a few days. Texts cannot go out from this number until they approve.</p> : null}
      <FormError message={error} />
      {request.status === "requested" && role === "owner" ? (
        <div>
          <Button variant="ghost" size="xs" disabled={busy} onClick={() => void run(() => cancel({ companyId, requestId: request.requestId }))}>
            Withdraw the request
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function useMine() {
  const { companyId } = useCompany();
  return useQuery(api.texting.mine, { companyId });
}

/**
 * Getting a texting number in the company's own name. The Owner picks a number and says who the
 * company is; Selestial approves it, buys the number and registers it with the carriers. Nothing is
 * bought or filed until Selestial approves.
 */
type Identity = { legalName?: string; tradingName?: string; address?: { line1: string; line2?: string; city: string; region: string; postalCode: string }; supportEmail?: string; supportPhone?: string };

export function TextingSetup({ companyName, identity }: { companyName: string; identity: Identity }) {
  const { companyId, role } = useCompany();
  const mine = useMine();
  const startSearch = useMutation(api.texting.searchNumbersFor);
  const submit = useMutation(api.texting.request);
  const { busy, error, run, setError } = useRun();
  const [areaCode, setAreaCode] = useState("");
  const [searchId, setSearchId] = useState<Id<"numberSearches"> | null>(null);
  const results = useQuery(api.texting.search, searchId ? { companyId, searchId } : "skip");
  const [chosen, setChosen] = useState<string | null>(null);
  // What Settings already knows about the company is the starting point, so nothing is asked twice.
  const sendAs = identity.tradingName ?? companyName;
  const [brand, setBrand] = useState({
    displayName: sendAs,
    companyName: identity.legalName ?? "",
    ein: "",
    phone: identity.supportPhone ?? "",
    street: identity.address ? [identity.address.line1, identity.address.line2].filter(Boolean).join(", ") : "",
    city: identity.address?.city ?? "",
    state: identity.address?.region ?? "",
    postalCode: identity.address?.postalCode ?? "",
    email: identity.supportEmail ?? "",
    website: "",
    vertical: "PROFESSIONAL",
  });
  const [consent, setConsent] = useState(consentFor(sendAs));
  const [starting, setStarting] = useState(false);
  const set = (key: keyof typeof brand) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setBrand((current) => ({ ...current, [key]: event.target.value }));
  const owner = role === "owner";
  const open = mine && ["requested", "approved", "provisioning", "waiting_on_carriers", "active"].includes(mine.status);
  const pick = results?.results.find((row) => row.phoneNumber === chosen);

  return (
    <div id="texting-number" className="grid scroll-mt-20 gap-3 border-t border-border pt-5">
      <div>
        <h3 className="text-sm font-semibold text-strong">A texting number in your company’s name</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a local number and tell us who your company is. Selestial buys the number and registers it with the US carriers (A2P 10DLC) in your company’s name. Carriers check the legal name and EIN against IRS records, and usually decide within a few days. Nothing is bought or filed until Selestial approves your request.
        </p>
      </div>
      {mine === undefined ? <Skeleton className="h-16" /> : mine ? <Current request={mine} /> : null}
      {!owner ? (
        <p className="text-xs text-muted-foreground">Only the Owner asks for a number.</p>
      ) : open ? null : !starting ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => setStarting(true)}>
            {mine ? "Ask again" : "Get a texting number"}
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 rounded-xl border border-border bg-muted p-3.5">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setChosen(null);
              void run(async () => setSearchId(await startSearch({ companyId, areaCode })));
            }}
          >
            <Field label="1. Area code" hint="A local number where your cleaners live reads as more trustworthy.">
              <TextInput inputMode="numeric" value={areaCode} onChange={(event) => setAreaCode(event.target.value)} placeholder="512" maxLength={3} className="w-28" required />
            </Field>
            <Button type="submit" size="sm" loading={busy && !chosen}>
              Search
            </Button>
          </form>
          {searchId && results === undefined ? <Skeleton className="h-16" /> : null}
          {results?.status === "pending" ? <p className="text-sm text-muted-foreground">Searching…</p> : null}
          {results?.status === "failed" ? <p className="text-sm text-destructive-foreground">{results.problem ?? "The search did not work."}</p> : null}
          {results?.status === "done" ? (
            results.results.length === 0 ? (
              <p className="text-sm text-muted-foreground">No numbers that can text are free in {results.areaCode} right now. Try a nearby area code.</p>
            ) : (
              <fieldset className="grid gap-1.5">
                <legend className="mb-1 text-sm font-medium text-strong">2. Choose a number</legend>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {results.results.map((row) => (
                    <label key={row.phoneNumber} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                      <input type="radio" name="number" checked={chosen === row.phoneNumber} onChange={() => setChosen(row.phoneNumber)} className="accent-[var(--color-brand-400)]" />
                      <span className="font-medium text-strong tabular-nums">{row.phoneNumber}</span>
                      <span className="text-xs text-muted-foreground">
                        {[row.locality, row.region].filter(Boolean).join(", ")}
                        {row.monthlyCents !== null ? ` · ${money(row.monthlyCents)}/mo` : ""}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )
          ) : null}
          {pick ? (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!searchId) return setError("Search for a number first.");
                void run(async () => {
                  await submit({ companyId, searchId, phoneNumber: pick.phoneNumber, brand, consentWording: consent });
                  setStarting(false);
                });
              }}
            >
              <p className="text-sm font-medium text-strong">3. Who your company is, exactly as on its IRS records</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name texts are sent under" hint="Every text starts with it.">
                  <TextInput value={brand.displayName} onChange={set("displayName")} required maxLength={60} />
                </Field>
                <Field label="Legal company name">
                  <TextInput value={brand.companyName} onChange={set("companyName")} required maxLength={120} />
                </Field>
                <Field label="EIN (federal tax ID)" hint="Sole proprietors without an EIN cannot use this yet.">
                  <TextInput value={brand.ein} onChange={set("ein")} required placeholder="12-3456789" />
                </Field>
                <Field label="Kind of business">
                  <SelectInput value={brand.vertical} onChange={set("vertical")}>
                    {VERTICALS.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.label}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label="Street address">
                  <TextInput value={brand.street} onChange={set("street")} required autoComplete="address-line1" />
                </Field>
                <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-2">
                  <Field label="City">
                    <TextInput value={brand.city} onChange={set("city")} required />
                  </Field>
                  <Field label="State">
                    <TextInput value={brand.state} onChange={set("state")} required maxLength={2} placeholder="TX" />
                  </Field>
                  <Field label="ZIP">
                    <TextInput value={brand.postalCode} onChange={set("postalCode")} required inputMode="numeric" maxLength={5} />
                  </Field>
                </div>
                <Field label="Business phone">
                  <TextInput type="tel" value={brand.phone} onChange={set("phone")} required placeholder="+15125550100" />
                </Field>
                <Field label="Support email" hint="Shown to cleaners who reply HELP.">
                  <TextInput type="email" value={brand.email} onChange={set("email")} required />
                </Field>
                <Field label="Website" className="sm:col-span-2">
                  <TextInput value={brand.website} onChange={set("website")} required placeholder="https://" />
                </Field>
              </div>
              <Field label="4. What cleaners agree to" hint="Carriers require it to name your business and say HELP, STOP, how often texts come, and that rates may apply. Use these exact words when cleaners agree; they are kept on file and filed with the carriers.">
                <TextArea value={consent} onChange={(event) => setConsent(event.target.value)} rows={4} required />
              </Field>
              <p className="rounded-lg bg-card px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                Asking costs nothing. If Selestial approves, it buys {pick.phoneNumber}
                {pick.upfrontCents !== null ? ` (${money(pick.upfrontCents)} up front, ${money(pick.monthlyCents ?? 0)} a month at today’s price)` : ""} and pays the carriers’ registration fees, and the number is registered for work texts to your cleaners only. No marketing can be sent from it.
              </p>
              <FormError message={error} />
              <div className="flex gap-2">
                <Button type="submit" variant="primary" size="sm" loading={busy}>
                  Send the request to Selestial
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setStarting(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <FormError message={error} />
          )}
        </div>
      )}
    </div>
  );
}
