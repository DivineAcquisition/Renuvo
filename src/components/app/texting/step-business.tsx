"use client";

/**
 * Step 1: who the business is, as the carriers will check it. Details Selestial already had are filled in
 * with where they came from. The EIN is typed once, sealed on the server, and shown back only as its last
 * four digits; it never goes into analytics, logs or Selestial's assistant.
 */
import { useMutation } from "convex/react";
import { useState } from "react";

import { Field, SelectInput, TextInput } from "@/components/app/form";
import { Lock } from "@/components/icons";
import { Button } from "@/components/ui/button";

import { api } from "../../../../convex/_generated/api";
import type { BusinessField } from "../../../../convex/lib/texting/schema";
import { formatPhone, useSetup } from "./context";
import { ChoiceCard, Note, Section, SourceChip, StepHeading } from "./parts";

const ENTITY_ORDER = ["PRIVATE_PROFIT", "SOLE_PROPRIETOR", "NON_PROFIT", "PUBLIC_PROFIT"] as const;
const EXCHANGES = ["NASDAQ", "NYSE", "AMEX", "TSX", "LON"];

export function BusinessStep() {
  const { view, commit, locked } = useSetup();
  const b = view.setup.business;
  // Phone numbers are kept in international form and shown the way people write them.
  const [values, setValues] = useState<Partial<Record<BusinessField, string>>>(() => ({ ...b, ...(b.supportPhone ? { supportPhone: formatPhone(b.supportPhone) } : {}), ...(b.mobilePhone ? { mobilePhone: formatPhone(b.mobilePhone) } : {}) }));
  const problem = (field: string) => (view.issues.business.find((row) => row.field === field) && values[field as BusinessField] !== undefined && values[field as BusinessField] !== "" ? view.issues.business.find((row) => row.field === field)!.words : null);
  const entity = values.entityType;
  const sole = entity === "SOLE_PROPRIETOR";

  const field = (name: BusinessField) => ({
    value: values[name] ?? "",
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues((current) => ({ ...current, [name]: event.target.value })),
    onBlur: () => {
      const typed = values[name] ?? "";
      const saved = b[name] ?? "";
      const same = name === "supportPhone" || name === "mobilePhone" ? typed.replace(/\D/g, "").replace(/^1/, "") === saved.replace(/\D/g, "").replace(/^1/, "") : typed === saved;
      if (!same) void commit({ business: { [name]: typed } });
    },
  });
  const choose = (name: BusinessField, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    void commit({ business: { [name]: value } });
  };

  return (
    <>
      <StepHeading eyebrow="Step 1 of 6" title="Your business" lead="Carriers check these details against official records, so they need to match exactly. Anything Selestial already knew is filled in and marked with where it came from." />

      <Section title="What kind of business is this?">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Kind of business">
          {ENTITY_ORDER.map((key) => (
            <ChoiceCard key={key} selected={entity === key} onPress={() => choose("entityType", key)} title={view.catalog.entities[key].label} hint={view.catalog.entities[key].hint} disabled={locked} />
          ))}
        </div>
        {sole ? (
          <Note>
            Without an EIN, you register as a sole proprietor under your own name. The carriers text a one-time code to your own mobile to confirm it&apos;s you. You get one number and one registration, with room for about 1,000 texts a day to T-Mobile customers. Promotions aren&apos;t allowed on this kind of registration. If you get an EIN later, you can register again as a company.
          </Note>
        ) : null}
      </Section>

      <Section title="Names" lead="The name customers see on every text, and the name on your official records.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1">
            <Field label="Name customers know you by" hint="Every text starts with this name." error={problem("displayName")}>
              <TextInput {...field("displayName")} autoComplete="organization" maxLength={100} />
            </Field>
            <SourceChip field="displayName" />
          </div>
          {!sole ? (
            <div className="grid gap-1">
              <Field label="Legal business name" hint="Exactly as on your IRS records (your CP 575 or 147C letter)." error={problem("legalName")}>
                <TextInput {...field("legalName")} maxLength={100} />
              </Field>
              <SourceChip field="legalName" />
            </div>
          ) : null}
        </div>
      </Section>

      {sole ? (
        <Section title="You, as the owner" lead="A sole proprietor registers in their own name.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" error={problem("contactFirstName")}>
              <TextInput {...field("contactFirstName")} autoComplete="given-name" />
            </Field>
            <Field label="Last name" error={problem("contactLastName")}>
              <TextInput {...field("contactLastName")} autoComplete="family-name" />
            </Field>
            <Field label="Your mobile number" hint="The carriers text a one-time code here after Selestial review. It must be a US mobile you can reach." error={problem("mobilePhone")}>
              <TextInput {...field("mobilePhone")} autoComplete="tel" inputMode="tel" />
            </Field>
          </div>
        </Section>
      ) : (
        <TaxId
          onNoEin={() => {
            setValues((current) => ({ ...current, entityType: "SOLE_PROPRIETOR" }));
            void commit({ business: { entityType: "SOLE_PROPRIETOR" }, noTaxId: true });
          }}
        />
      )}

      {entity === "PUBLIC_PROFIT" ? (
        <Section title="Stock listing">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Stock symbol" error={problem("stockSymbol")}>
              <TextInput {...field("stockSymbol")} maxLength={10} />
            </Field>
            <Field label="Exchange" error={problem("stockExchange")}>
              <SelectInput value={values.stockExchange ?? ""} onChange={(event) => choose("stockExchange", event.target.value)}>
                <option value="">Choose…</option>
                {EXCHANGES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Business contact email" error={problem("contactEmail")}>
              <TextInput {...field("contactEmail")} type="email" />
            </Field>
          </div>
        </Section>
      ) : null}

      <Section title="Kind of work" lead="Carriers don't list cleaning, so choose the closest fit.">
        <Field label="Industry" error={problem("vertical")}>
          <SelectInput value={values.vertical ?? ""} onChange={(event) => choose("vertical", event.target.value)}>
            {view.catalog.verticals.map((row) => (
              <option key={row.value} value={row.value}>
                {row.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <SourceChip field="vertical" />
      </Section>

      <Section title="Business address" lead={sole ? "Where you run the business." : "The address the IRS has for the business."}>
        <div className="grid gap-4 sm:grid-cols-6">
          <div className="grid gap-1 sm:col-span-6">
            <Field label="Street address" error={problem("street")}>
              <TextInput {...field("street")} autoComplete="street-address" />
            </Field>
            <SourceChip field="street" />
          </div>
          <Field label="City" error={problem("city")} className="sm:col-span-3">
            <TextInput {...field("city")} autoComplete="address-level2" />
          </Field>
          <Field label="State" error={problem("state")} className="sm:col-span-1">
            <TextInput {...field("state")} autoComplete="address-level1" maxLength={2} placeholder="TX" />
          </Field>
          <Field label="ZIP code" error={problem("postalCode")} className="sm:col-span-2">
            <TextInput {...field("postalCode")} autoComplete="postal-code" inputMode="numeric" maxLength={5} />
          </Field>
        </div>
      </Section>

      <Section title="How customers reach you">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1 sm:col-span-2">
            <Field label="Website" hint={sole ? "Optional for a sole proprietor." : view.company.handle ? `No website? Your Selestial booking page works: https://…/b/${view.company.handle}` : "The site carriers will look at to confirm the business."} error={problem("website")}>
              <TextInput {...field("website")} type="url" inputMode="url" placeholder="https://" />
            </Field>
            <SourceChip field="website" />
          </div>
          <div className="grid gap-1">
            <Field label="Support email" hint="Shown in your HELP reply and texting terms." error={problem("supportEmail")}>
              <TextInput {...field("supportEmail")} type="email" autoComplete="email" />
            </Field>
            <SourceChip field="supportEmail" />
          </div>
          <div className="grid gap-1">
            <Field label="Support phone" error={problem("supportPhone")}>
              <TextInput {...field("supportPhone")} type="tel" autoComplete="tel" />
            </Field>
            <SourceChip field="supportPhone" />
          </div>
        </div>
      </Section>
    </>
  );
}

function TaxId({ onNoEin }: { onNoEin: () => void }) {
  const { view, run, companyId, locked } = useSetup();
  const setTaxId = useMutation(api.textingSetup.setTaxId);
  const clearTaxId = useMutation(api.textingSetup.clearTaxId);
  const [typed, setTyped] = useState("");
  const [editing, setEditing] = useState(!view.setup.taxIdLast4);
  const saved = view.setup.taxIdLast4;

  async function store() {
    const value = typed;
    setTyped("");
    if (await run((revision) => setTaxId({ companyId, revision, taxId: value }))) setEditing(false);
  }

  return (
    <Section title="EIN (federal tax ID)" lead="Carriers match it with your legal name. It's stored encrypted, and only its last four digits are ever shown again.">
      {saved && !editing ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3.5 py-3">
          <Lock className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-sm text-strong tabular-nums">
            ••-•••<span className="sr-only">ending in </span>
            {saved}
          </span>
          {!locked ? (
            <span className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                Replace
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void run((revision) => clearTaxId({ companyId, revision }))}>
                Remove
              </Button>
            </span>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="EIN" hint="9 digits, for example 12-3456789." className="min-w-56 flex-1">
            <TextInput value={typed} onChange={(event) => setTyped(event.target.value.replace(/[^\d-]/g, "").slice(0, 10))} inputMode="numeric" autoComplete="off" data-private="true" spellCheck={false} placeholder="12-3456789" />
          </Field>
          <Button variant="primary" onClick={() => void store()} disabled={typed.replace(/\D/g, "").length !== 9}>
            Save securely
          </Button>
          {saved ? (
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Keep the saved one
            </Button>
          ) : null}
        </div>
      )}
      {!view.secureStorage ? <Note tone="warning">Selestial can&apos;t store an EIN securely on this server right now, so saving it will be refused. Selestial has been told.</Note> : null}
      {!saved ? (
        <button type="button" onClick={onNoEin} className="justify-self-start text-sm font-medium text-brand-300 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
          I don&apos;t have an EIN
        </button>
      ) : null}
    </Section>
  );
}
